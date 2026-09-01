/**
 * Labs PDF extraction prompt (ported verbatim from the original
 * extract-prompt.ts — the compact schema keeps output tokens low).
 * The prompt stays in English with Spanish category anchors because most
 * source PDFs are Spanish-language labs; extraction output uses normalized
 * snake_case English keys regardless of PDF language.
 */
export const LAB_EXTRACTION_PROMPT = `Extract ALL biomarkers from this lab PDF into JSON. Return ONLY valid JSON, no markdown fences, no explanation.

Schema:
{"patient":{"name":"str","dob":"YYYY-MM-DD","sex":"M/F","age":int},"lab":{"name":"str","location":"str","doctor":"str"},"sample_date":"YYYY-MM-DD","results":[{"cat":"str","name":"str","key":"str","val":num|null,"txt":"str|null","unit":"str","rmin":num|null,"rmax":num|null,"rtxt":"str|null","flag":bool}]}

Field mapping:
- cat: category from [BH,GM,PL,HE,EM,VIT,TIR,HOR,RI,OM,EO]
- name: short test name (e.g. "Eritrocitos", "Glucosa", "TSH") - omit method codes like (CL010)
- key: snake_case English key (e.g. "rbc", "glucose", "tsh")
- val: numeric result (null if non-numeric)
- txt: text result for non-numeric values like "Negativo" (null if numeric)
- unit: unit of measurement
- rmin/rmax: reference range min/max numbers (null if complex)
- rtxt: full reference text only if range is complex/conditional
- flag: true if outside reference range or marked with *

Category codes: BH=Biometria Hematica, GM=Glucosa y Metabolismo, PL=Perfil Lipidico, HE=Hepatico, EM=Electrolitos y Minerales, VIT=Vitaminas, TIR=Tiroides, HOR=Hormonas, RI=Resistencia a Insulina, OM=Otros Marcadores, EO=Examen de Orina

Rules:
- Extract EVERY test from ALL pages
- Include Quantose RI components under RI
- Include all urinalysis results under EO
- Keep JSON compact, no extra whitespace
`;
