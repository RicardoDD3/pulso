/**
 * Canonical analyte catalog (spec doc 07 — NEW over the original): normalized
 * keys, es/en aliases, canonical units and conversion factors. This is what
 * makes per-analyte trends work across labs that report different names/units.
 *
 * normalizeTestName(raw) → canonical key or null — a result NEVER gets dropped
 * for not being in the catalog; it's just stored un-normalized.
 */
export type AnalyteDef = {
  key: string;
  canonicalUnit: string;
  aliases: string[];
  /** unit (lowercased) → factor to canonical */
  conversions?: Record<string, number>;
};

const A = (key: string, canonicalUnit: string, aliases: string[], conversions?: Record<string, number>): AnalyteDef => ({
  key,
  canonicalUnit,
  aliases,
  conversions,
});

// mmol/L → mg/dL factors: glucose ×18.016, cholesterol ×38.67, triglycerides ×88.57, creatinine ×0.0113 (µmol/L→mg/dL)
export const ANALYTE_CATALOG: AnalyteDef[] = [
  A("glucose", "mg/dL", ["glucosa", "glucose", "glu", "glucosa en suero", "glucosa serica"], { "mmol/l": 18.016 }),
  A("hba1c", "%", ["hba1c", "hemoglobina glucosilada", "hemoglobina glicosilada", "glycated hemoglobin", "a1c"]),
  A("total_cholesterol", "mg/dL", ["colesterol total", "total cholesterol", "colesterol"], { "mmol/l": 38.67 }),
  A("ldl", "mg/dL", ["ldl", "colesterol ldl", "ldl cholesterol", "c-ldl"], { "mmol/l": 38.67 }),
  A("hdl", "mg/dL", ["hdl", "colesterol hdl", "hdl cholesterol", "c-hdl"], { "mmol/l": 38.67 }),
  A("triglycerides", "mg/dL", ["trigliceridos", "triglycerides", "tg"], { "mmol/l": 88.57 }),
  A("creatinine", "mg/dL", ["creatinina", "creatinine"], { "umol/l": 1 / 88.42, "µmol/l": 1 / 88.42 }),
  A("urea", "mg/dL", ["urea"], { "mmol/l": 6.006 }),
  A("uric_acid", "mg/dL", ["acido urico", "ácido úrico", "uric acid"], { "mmol/l": 16.81 }),
  A("tsh", "µIU/mL", ["tsh", "tirotropina", "thyroid stimulating hormone", "hormona estimulante de tiroides"], { "miu/l": 1 }),
  A("t3_free", "pg/mL", ["t3 libre", "free t3", "t3l"]),
  A("t4_free", "ng/dL", ["t4 libre", "free t4", "t4l"]),
  A("vitamin_d", "ng/mL", ["vitamina d", "25-oh vitamina d", "vitamin d", "25-hydroxyvitamin d", "25(oh)d"], { "nmol/l": 1 / 2.496 }),
  A("vitamin_b12", "pg/mL", ["vitamina b12", "vitamin b12", "b12", "cobalamina"], { "pmol/l": 1 / 0.7378 }),
  A("ferritin", "ng/mL", ["ferritina", "ferritin"], { "µg/l": 1, "ug/l": 1 }),
  A("iron", "µg/dL", ["hierro", "iron", "hierro serico", "hierro sérico"], { "µmol/l": 5.587, "umol/l": 5.587 }),
  A("hemoglobin", "g/dL", ["hemoglobina", "hemoglobin", "hb", "hgb"], { "g/l": 0.1 }),
  A("hematocrit", "%", ["hematocrito", "hematocrit", "hto", "hct"]),
  A("rbc", "10^6/µL", ["eritrocitos", "rbc", "red blood cells", "globulos rojos", "glóbulos rojos"]),
  A("wbc", "10^3/µL", ["leucocitos", "wbc", "white blood cells", "globulos blancos", "glóbulos blancos"]),
  A("platelets", "10^3/µL", ["plaquetas", "platelets", "plt"]),
  A("alt", "U/L", ["alt", "tgp", "alanina aminotransferasa", "alanine aminotransferase", "sgpt"]),
  A("ast", "U/L", ["ast", "tgo", "aspartato aminotransferasa", "aspartate aminotransferase", "sgot"]),
  A("ggt", "U/L", ["ggt", "gamma glutamil transferasa", "gamma-glutamyl transferase"]),
  A("alkaline_phosphatase", "U/L", ["fosfatasa alcalina", "alkaline phosphatase", "alp"]),
  A("total_bilirubin", "mg/dL", ["bilirrubina total", "total bilirubin"], { "µmol/l": 1 / 17.104, "umol/l": 1 / 17.104 }),
  A("albumin", "g/dL", ["albumina", "albúmina", "albumin"], { "g/l": 0.1 }),
  A("sodium", "mEq/L", ["sodio", "sodium", "na"], { "mmol/l": 1 }),
  A("potassium", "mEq/L", ["potasio", "potassium", "k"], { "mmol/l": 1 }),
  A("calcium", "mg/dL", ["calcio", "calcium", "ca"], { "mmol/l": 4.008 }),
  A("magnesium", "mg/dL", ["magnesio", "magnesium", "mg"], { "mmol/l": 2.431 }),
  A("insulin", "µIU/mL", ["insulina", "insulin"], { "pmol/l": 1 / 6.945 }),
  A("testosterone", "ng/dL", ["testosterona", "testosterone", "testosterona total"], { "nmol/l": 28.84 }),
  A("cortisol", "µg/dL", ["cortisol"], { "nmol/l": 1 / 27.59 }),
  A("crp", "mg/L", ["pcr", "proteina c reactiva", "proteína c reactiva", "crp", "c-reactive protein", "hs-crp", "pcr ultrasensible"], { "mg/dl": 10 }),
];

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const aliasIndex = new Map<string, string>();
for (const def of ANALYTE_CATALOG) {
  aliasIndex.set(fold(def.key.replace(/_/g, " ")), def.key);
  for (const alias of def.aliases) aliasIndex.set(fold(alias), def.key);
}

/** raw test name (any language/casing/accents) → canonical key or null. */
export function normalizeTestName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return aliasIndex.get(fold(raw)) ?? null;
}

/**
 * Convert a value to the analyte's canonical unit when the pair is known.
 * Unknown units come back unchanged with converted=false (never lossy).
 */
export function toCanonicalUnit(
  value: number,
  unit: string | null | undefined,
  testKey: string,
): { value: number; unit: string | null; converted: boolean } {
  const def = ANALYTE_CATALOG.find((d) => d.key === testKey);
  if (!def || !unit) return { value, unit: unit ?? null, converted: false };
  const u = fold(unit);
  if (u === fold(def.canonicalUnit)) return { value, unit: def.canonicalUnit, converted: false };
  const factor = def.conversions?.[u];
  if (factor == null) return { value, unit, converted: false };
  return { value: value * factor, unit: def.canonicalUnit, converted: true };
}
