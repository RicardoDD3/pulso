/**
 * Canonical unit conversions (spec docs 02/03).
 *
 * Pulso stores meters, seconds, °C, kg, ml, ms. Conversion happens ONCE at
 * ingestion time via these pure helpers; render code only formats. Each helper
 * is number → number; callers handle null/undefined before converting.
 */

export function fahrenheitToCelsius(f: number): number {
  return ((f - 32) * 5) / 9;
}

export function milesToMeters(miles: number): number {
  return miles * 1609.344;
}

export function kmToMeters(km: number): number {
  return km * 1000;
}

export function minutesToSeconds(minutes: number): number {
  return minutes * 60;
}

export function secondsToMinutes(seconds: number): number {
  return seconds / 60;
}

export function gramsToKg(grams: number): number {
  return grams / 1000;
}

export function poundsToKg(pounds: number): number {
  return pounds * 0.45359237;
}

export function litersToMl(liters: number): number {
  return liters * 1000;
}

export function kmhToMps(kmh: number): number {
  return kmh / 3.6;
}

/** Pace in sec/km (OW's avg_pace_sec_per_km) → speed in m/s. */
export function paceSecPerKmToMps(secPerKm: number): number {
  if (secPerKm <= 0) return 0;
  return 1000 / secPerKm;
}
