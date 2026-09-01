/**
 * Lab PDF extraction job body (spec doc 07): read the stored PDF, call the
 * vision model through generateJson (Zod-validated, 1 retry with the error),
 * normalize analytes, write session+results transactionally.
 */
import { readFile } from "node:fs/promises";
import { generateJson } from "@/lib/llm";
import { LAB_EXTRACTION_PROMPT } from "./extract-prompt";
import { labExtractionSchema } from "./schema";
import { normalizeTestName, toCanonicalUnit } from "./catalog";
import * as labsRepo from "@/lib/db/repos/labs";
import { logger } from "@/lib/logger";

export async function processLabSession(input: {
  userId: string;
  sessionId: string;
  filePath: string;
  timezone: string;
}): Promise<void> {
  const { userId, sessionId, filePath, timezone } = input;
  try {
    const pdf = await readFile(filePath);
    const viewer = { userId, effectiveUserId: userId, grant: null };
    const { value, model } = await generateJson(
      {
        feature: "labs_extraction",
        viewer,
        system: LAB_EXTRACTION_PROMPT,
        messages: [{ role: "user", content: "Extract the biomarkers from the attached lab PDF." }],
        attachments: [{ mediaType: "application/pdf", data: new Uint8Array(pdf), filename: "lab.pdf" }],
        schema: labExtractionSchema,
        retries: 1,
      },
      { timezone },
    );

    const results = value.results.map((r) => {
      const normalized = normalizeTestName(r.name) ?? (r.key ? normalizeTestName(r.key) : null) ?? r.key;
      let valueNum = r.val;
      let unit = r.unit;
      if (valueNum != null && normalized) {
        const converted = toCanonicalUnit(valueNum, unit, normalized);
        valueNum = converted.value;
        unit = converted.unit;
      }
      return {
        category: r.cat,
        testName: r.name,
        testNameNormalized: normalized ?? null,
        valueNum,
        valueText: r.txt,
        unit,
        refLow: r.rmin,
        refHigh: r.rmax,
        refText: r.rtxt,
        isFlagged: r.flag,
      };
    });

    await labsRepo.completeSession(userId, sessionId, {
      sampleDate: value.sample_date,
      labName: value.lab?.name ?? null,
      labLocation: value.lab?.location ?? null,
      patientName: value.patient?.name ?? null,
      patientDob: value.patient?.dob ?? null,
      patientSex: value.patient?.sex ?? null,
      patientAge: value.patient?.age != null ? String(value.patient.age) : null,
      doctorName: value.lab?.doctor ?? null,
      extractionModel: model,
      results,
    });
    logger.info({ sessionId, resultCount: results.length }, "labs_extraction_completed");
  } catch (err) {
    // Never log lab content — ids only (spec doc 11 M2).
    logger.warn({ sessionId, err: err instanceof Error ? err.name : "unknown" }, "labs_extraction_failed");
    await labsRepo.markSessionFailed(userId, sessionId, "extraction_failed");
  }
}
