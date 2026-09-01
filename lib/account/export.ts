/**
 * Full data export (spec doc 04): JSON per table + original lab PDFs, as a
 * ZIP built without external deps (STORE entries, own central directory).
 * The format doubles as the portability story — documented in docs/.
 */
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { OwnerViewer } from "@/lib/authz/viewer";

type ZipEntry = { name: string; data: Uint8Array };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal ZIP writer (method 0 = STORE). */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, 0x0800, true); // UTF-8 names
    header.setUint16(8, 0, true); // STORE
    header.setUint32(14, crc, true);
    header.setUint32(18, entry.data.length, true);
    header.setUint32(22, entry.data.length, true);
    header.setUint16(26, nameBytes.length, true);
    const headerBytes = new Uint8Array(header.buffer);
    chunks.push(headerBytes, nameBytes, entry.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, entry.data.length, true);
    cd.setUint32(24, entry.data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += headerBytes.length + nameBytes.length + entry.data.length;
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of [...chunks, ...central, new Uint8Array(end.buffer)]) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

const EXPORT_TABLES = {
  profile: schema.profiles,
  health_days: schema.healthDays,
  sleep_sessions: schema.sleepSessions,
  body_measurements: schema.bodyMeasurements,
  workouts: schema.workouts,
  metric_samples: schema.metricSamples,
  provider_scores: schema.providerScores,
  lab_sessions: schema.labSessions,
  lab_results: schema.labResults,
  conversations: schema.conversations,
  training_plans: schema.trainingPlans,
  training_plan_workouts: schema.trainingPlanWorkouts,
  training_settings: schema.trainingSettings,
  manual_workouts: schema.manualWorkouts,
  exercise_definitions: schema.exerciseDefinitions,
  exercise_logs: schema.exerciseLogs,
  exercise_sets: schema.exerciseSets,
} as const;

export async function exportUserData(viewer: OwnerViewer): Promise<Uint8Array> {
  const db = getDb();
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [];

  for (const [name, table] of Object.entries(EXPORT_TABLES)) {
    const rows = await db
      .select()
      .from(table)
      .where(eq(table.userId, viewer.userId));
    entries.push({ name: `${name}.json`, data: encoder.encode(JSON.stringify(rows, null, 1)) });
  }

  // Messages join through conversations (no direct user_id on messages).
  const messages = await db
    .select({ message: schema.messages })
    .from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(eq(schema.conversations.userId, viewer.userId));
  entries.push({
    name: "messages.json",
    data: encoder.encode(JSON.stringify(messages.map((m) => m.message), null, 1)),
  });

  // Original lab PDFs.
  const sessions = await db
    .select({ id: schema.labSessions.id, path: schema.labSessions.sourceFilePath })
    .from(schema.labSessions)
    .where(eq(schema.labSessions.userId, viewer.userId));
  for (const session of sessions) {
    if (!session.path) continue;
    try {
      const pdf = await readFile(session.path);
      entries.push({ name: `lab-pdfs/${session.id}.pdf`, data: new Uint8Array(pdf) });
    } catch {
      /* file missing — skip */
    }
  }

  entries.push({
    name: "README.txt",
    data: encoder.encode(
      "Pulso data export\n\nOne JSON file per table, scoped to your user. Units are canonical: meters, seconds, °C, kg, ml, ms.\nLab PDFs are the original uploaded files.\n",
    ),
  });

  return buildZip(entries);
}
