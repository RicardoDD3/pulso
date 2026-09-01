// Ruta y perfil de elevación de una carrera a partir de activity_laps.
// La polyline fina de Garmin NO se guarda; lo que hay son las coordenadas de
// inicio/fin de cada vuelta (~1 punto/km) y su elevación min/max/gain/loss. Con
// eso se dibuja un CONTORNO de la ruta (reconocible, no un track suave) y un
// perfil de elevación. Todo puro y proyectado a un viewBox fijo para SVG.

import { toNum } from "./activity-detail";

export interface GeoLap {
  start_latitude?: number | string | null;
  start_longitude?: number | string | null;
  end_latitude?: number | string | null;
  end_longitude?: number | string | null;
  distance_meters?: number | string | null;
  min_elevation_m?: number | string | null;
  max_elevation_m?: number | string | null;
  elevation_gain_m?: number | string | null;
  elevation_loss_m?: number | string | null;
}

export interface RoutePoint {
  lat: number;
  lng: number;
}

/** Coordenadas de la ruta: start del primer lap + end de cada lap; sin (0,0)
 *  ni puntos consecutivos idénticos. */
export function routePoints(laps: GeoLap[]): RoutePoint[] {
  const pts: RoutePoint[] = [];
  const push = (la: unknown, lo: unknown) => {
    const lat = toNum(la);
    const lng = toNum(lo);
    if (lat === null || lng === null) return;
    if (lat === 0 && lng === 0) return; // coordenada nula
    pts.push({ lat, lng });
  };
  laps.forEach((l, i) => {
    if (i === 0) push(l.start_latitude, l.start_longitude);
    push(l.end_latitude, l.end_longitude);
  });
  return pts.filter((p, i) => i === 0 || p.lat !== pts[i - 1].lat || p.lng !== pts[i - 1].lng);
}

// --- Mapa con tiles OSM (Web Mercator) -------------------------------------

const TILE_SIZE = 256;

/** lng/lat → pixel mundial (256·2^z) en Web Mercator (proyección de los tiles OSM). */
export function lngLatToWorldPixel(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = Math.pow(2, z);
  const x = ((lng + 180) / 360) * n * TILE_SIZE;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n * TILE_SIZE;
  return { x, y };
}

export interface TileRef {
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

export interface TileMap {
  z: number;
  tiles: TileRef[];
  points: { x: number; y: number }[];
  path: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  width: number;
  height: number;
}

/**
 * Arma el mapa: elige el zoom OSM más alto donde la ruta cabe en el box,
 * proyecta los puntos a coordenadas del box y lista los tiles que lo cubren.
 * null si hay menos de 2 puntos GPS. La ruta se superpone en SVG con la misma
 * proyección, así que calza con los tiles.
 */
export function buildTileMap(
  laps: GeoLap[],
  boxW = 260,
  boxH = 170,
  pad = 22,
  minZoom = 3,
  maxZoom = 17
): TileMap | null {
  const pts = routePoints(laps);
  if (pts.length < 2) return null;

  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  // Zoom más alto donde el bbox cabe en el box con padding.
  let z = minZoom;
  for (let cz = maxZoom; cz >= minZoom; cz--) {
    const tl = lngLatToWorldPixel(minLng, maxLat, cz);
    const br = lngLatToWorldPixel(maxLng, minLat, cz);
    if (Math.abs(br.x - tl.x) <= boxW - 2 * pad && Math.abs(br.y - tl.y) <= boxH - 2 * pad) {
      z = cz;
      break;
    }
  }

  const center = lngLatToWorldPixel((minLng + maxLng) / 2, (minLat + maxLat) / 2, z);
  const originX = center.x - boxW / 2;
  const originY = center.y - boxH / 2;
  const round1 = (v: number) => Math.round(v * 10) / 10;

  const points = pts.map((p) => {
    const w = lngLatToWorldPixel(p.lng, p.lat, z);
    return { x: round1(w.x - originX), y: round1(w.y - originY) };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  const n = Math.pow(2, z);
  const tiles: TileRef[] = [];
  const tx0 = Math.floor(originX / TILE_SIZE), tx1 = Math.floor((originX + boxW) / TILE_SIZE);
  const ty0 = Math.floor(originY / TILE_SIZE), ty1 = Math.floor((originY + boxH) / TILE_SIZE);
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      if (ty < 0 || ty >= n) continue; // fuera de rango vertical
      const wrapX = ((tx % n) + n) % n; // el mundo se repite en x
      tiles.push({
        z,
        x: wrapX,
        y: ty,
        left: Math.round(tx * TILE_SIZE - originX),
        top: Math.round(ty * TILE_SIZE - originY),
      });
    }
  }

  return {
    z,
    tiles,
    points,
    path,
    start: points[0],
    end: points[points.length - 1],
    width: boxW,
    height: boxH,
  };
}

export interface ElevationPoint {
  km: number;
  elev: number;
}

export interface ElevationProfile {
  points: ElevationPoint[];
  minElev: number;
  maxElev: number;
  totalGain: number;
  totalLoss: number;
}

/**
 * Perfil de elevación: un punto por vuelta (elevación media = (min+max)/2) sobre
 * la distancia acumulada, más gain/loss totales. null si no hay datos de altura.
 */
export function buildElevationProfile(laps: GeoLap[]): ElevationProfile | null {
  const points: ElevationPoint[] = [];
  let cumKm = 0;
  let totalGain = 0;
  let totalLoss = 0;
  const round2 = (x: number) => Math.round(x * 100) / 100;

  for (const l of laps) {
    const dist = toNum(l.distance_meters) ?? 0;
    const gain = toNum(l.elevation_gain_m);
    const loss = toNum(l.elevation_loss_m);
    if (gain !== null) totalGain += gain;
    if (loss !== null) totalLoss += loss;
    cumKm += dist / 1000;
    const min = toNum(l.min_elevation_m);
    const max = toNum(l.max_elevation_m);
    if (min !== null && max !== null) {
      points.push({ km: round2(cumKm), elev: Math.round((min + max) / 2) });
    }
  }

  if (points.length < 2) return null;
  // Ancla el inicio en km 0 para que la línea arranque a la izquierda.
  if (points[0].km > 0) points.unshift({ km: 0, elev: points[0].elev });

  const elevs = points.map((p) => p.elev);
  return {
    points,
    minElev: Math.min(...elevs),
    maxElev: Math.max(...elevs),
    totalGain: Math.round(totalGain),
    totalLoss: Math.round(totalLoss),
  };
}
