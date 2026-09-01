/**
 * Exercise key generation (pure, ported from the original POST
 * /api/training/exercise-definitions): slugify the label, then suffix _2, _3…
 * until it doesn't collide with the user's existing keys.
 */
export function slugifyExerciseLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function generateExerciseKey(label: string, existingKeys: Iterable<string>): string | null {
  const baseKey = slugifyExerciseLabel(label);
  if (!baseKey) return null;
  const keySet = new Set(existingKeys);
  if (!keySet.has(baseKey)) return baseKey;
  let suffix = 2;
  while (keySet.has(`${baseKey}_${suffix}`)) suffix++;
  return `${baseKey}_${suffix}`;
}
