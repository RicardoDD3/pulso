/**
 * Zod schema for LLM lab extraction output (spec docs 07/11 M5):
 * every element validated, categories constrained to the known enum,
 * hard cap of 300 results per session. Mirrors the compact prompt schema.
 */
import { z } from "zod";
import { LAB_CATEGORY_CODES } from "./categories";

export const MAX_LAB_RESULTS = 300;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

export const labExtractionSchema = z.object({
  patient: z
    .object({
      name: z.string().max(120).nullable().catch(null),
      dob: dateStr.catch(null),
      sex: z.string().max(10).nullable().catch(null),
      age: z.coerce.number().int().min(0).max(130).nullable().catch(null),
    })
    .partial()
    .nullable()
    .catch(null),
  lab: z
    .object({
      name: z.string().max(160).nullable().catch(null),
      location: z.string().max(200).nullable().catch(null),
      doctor: z.string().max(120).nullable().catch(null),
    })
    .partial()
    .nullable()
    .catch(null),
  sample_date: dateStr.catch(null),
  results: z
    .array(
      z.object({
        cat: z.enum(LAB_CATEGORY_CODES as [string, ...string[]]).catch("OM"),
        name: z.string().min(1).max(160),
        key: z.string().max(80).nullable().catch(null),
        val: z.number().finite().nullable().catch(null),
        txt: z.string().max(200).nullable().catch(null),
        unit: z.string().max(40).nullable().catch(null),
        rmin: z.number().finite().nullable().catch(null),
        rmax: z.number().finite().nullable().catch(null),
        rtxt: z.string().max(300).nullable().catch(null),
        flag: z.boolean().catch(false),
      }),
    )
    .min(1)
    .max(MAX_LAB_RESULTS),
});

export type LabExtraction = z.infer<typeof labExtractionSchema>;
