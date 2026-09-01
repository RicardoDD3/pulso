import {
  routePoints,
  buildElevationProfile,
  lngLatToWorldPixel,
  buildTileMap,
  type GeoLap,
} from "@/lib/health/activity-geo";

const LAPS: GeoLap[] = [
  { start_latitude: 19.3975, start_longitude: -99.2418, end_latitude: 19.3998, end_longitude: -99.2422, distance_meters: 1000, min_elevation_m: 2391, max_elevation_m: 2425, elevation_gain_m: 20, elevation_loss_m: 5 },
  { start_latitude: 19.3998, start_longitude: -99.2423, end_latitude: 19.3999, end_longitude: -99.2438, distance_meters: 1000, min_elevation_m: 2404, max_elevation_m: 2419, elevation_gain_m: 8, elevation_loss_m: 12 },
  { start_latitude: 19.3999, start_longitude: -99.2438, end_latitude: 19.3990, end_longitude: -99.2422, distance_meters: 1000, min_elevation_m: 2405, max_elevation_m: 2428, elevation_gain_m: 15, elevation_loss_m: 18 },
];

describe("routePoints", () => {
  it("collects start of first lap + end of each lap", () => {
    const pts = routePoints(LAPS);
    // start(l0) + end(l0,l1,l2) = 4 puntos
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual({ lat: 19.3975, lng: -99.2418 });
    expect(pts[3]).toEqual({ lat: 19.399, lng: -99.2422 });
  });

  it("drops null/zero coords and dedups consecutive identical points", () => {
    const pts = routePoints([
      { start_latitude: 0, start_longitude: 0, end_latitude: 19.4, end_longitude: -99.2 },
      { end_latitude: 19.4, end_longitude: -99.2 }, // igual al anterior → dedup
      { end_latitude: null, end_longitude: null }, // nulo → fuera
      { end_latitude: 19.41, end_longitude: -99.21 },
    ]);
    expect(pts).toEqual([
      { lat: 19.4, lng: -99.2 },
      { lat: 19.41, lng: -99.21 },
    ]);
  });
});

describe("lngLatToWorldPixel", () => {
  it("maps (0,0) to the center of the world at z=0", () => {
    const p = lngLatToWorldPixel(0, 0, 0);
    expect(p.x).toBeCloseTo(128);
    expect(p.y).toBeCloseTo(128);
  });
  it("increases x eastward and y southward", () => {
    const west = lngLatToWorldPixel(-100, 20, 12);
    const east = lngLatToWorldPixel(-99, 20, 12);
    const north = lngLatToWorldPixel(-99.5, 21, 12);
    const south = lngLatToWorldPixel(-99.5, 19, 12);
    expect(east.x).toBeGreaterThan(west.x);
    expect(south.y).toBeGreaterThan(north.y); // y crece hacia el sur
  });
});

describe("buildTileMap", () => {
  it("chooses a zoom in range, lists valid tiles and projects the route into the box", () => {
    const map = buildTileMap(LAPS, 260, 170);
    expect(map).not.toBeNull();
    expect(map!.z).toBeGreaterThanOrEqual(3);
    expect(map!.z).toBeLessThanOrEqual(17);
    expect(map!.tiles.length).toBeGreaterThan(0);
    const n = Math.pow(2, map!.z);
    for (const t of map!.tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(n);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(n);
    }
    // ruta dentro del box
    for (const p of map!.points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(260);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(170);
    }
    expect(map!.path.startsWith("M ")).toBe(true);
    expect(map!.start).toEqual(map!.points[0]);
  });

  it("returns null with fewer than 2 GPS points", () => {
    expect(buildTileMap([{ end_latitude: 19.4, end_longitude: -99.2 }])).toBeNull();
  });
});

describe("buildElevationProfile", () => {
  it("builds cumulative-distance points and sums gain/loss", () => {
    const prof = buildElevationProfile(LAPS);
    expect(prof).not.toBeNull();
    expect(prof!.totalGain).toBe(20 + 8 + 15);
    expect(prof!.totalLoss).toBe(5 + 12 + 18);
    // ancla en km 0 + 3 laps = 4 puntos; último en km 3
    expect(prof!.points[0].km).toBe(0);
    expect(prof!.points[prof!.points.length - 1].km).toBe(3);
    // elev media del primer lap = (2391+2425)/2 = 2408
    expect(prof!.points[1].elev).toBe(2408);
    expect(prof!.minElev).toBeLessThanOrEqual(prof!.maxElev);
  });

  it("returns null when laps have no elevation", () => {
    expect(buildElevationProfile([{ distance_meters: 1000 }, { distance_meters: 1000 }])).toBeNull();
  });
});
