/**
 * Route downsampling (spec doc 02): workout_route_points is capped at
 * ≤2000 points per workout. Uniform stride sampling that ALWAYS keeps the
 * first and last point, so start/finish stay exact.
 */
export const MAX_ROUTE_POINTS = 2000;

export function downsampleRoute<T>(points: T[], max: number = MAX_ROUTE_POINTS): T[] {
  if (max < 2) throw new RangeError("max must be ≥ 2");
  if (points.length <= max) return points;
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(points[Math.round(i * step)]);
  }
  // Guarantee exact endpoints even with rounding.
  out[0] = points[0];
  out[out.length - 1] = points[points.length - 1];
  return out;
}
