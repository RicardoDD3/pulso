/**
 * The 11 lab categories (ported constants — spec doc 07).
 * Codes match the extraction prompt; labels are i18n-keyed in the UI.
 */
export const LAB_CATEGORIES = [
  { code: "BH", label: "Biometría Hemática" },
  { code: "GM", label: "Glucosa y Metabolismo" },
  { code: "PL", label: "Perfil Lipídico" },
  { code: "HE", label: "Hepático" },
  { code: "EM", label: "Electrolitos y Minerales" },
  { code: "VIT", label: "Vitaminas" },
  { code: "TIR", label: "Tiroides" },
  { code: "HOR", label: "Hormonas" },
  { code: "RI", label: "Resistencia a Insulina" },
  { code: "OM", label: "Otros Marcadores" },
  { code: "EO", label: "Examen de Orina" },
] as const;

export type LabCategoryCode = (typeof LAB_CATEGORIES)[number]["code"];

export const LAB_CATEGORY_CODES = LAB_CATEGORIES.map((c) => c.code) as LabCategoryCode[];

export function labCategoryLabel(code: string): string {
  return LAB_CATEGORIES.find((c) => c.code === code)?.label ?? code;
}
