import {
  ACTIVITY_DETAIL_BLOCK,
  ACTIVITY_DETAIL_TRIM_DAYS,
  DAILY_LOG_BLOCK,
  DAILY_LOG_TRIM_DAYS,
  estimateTokens,
  trimContextToBudget,
} from "@/lib/health/context-trim";

/**
 * Regla dura NUEVA del spec (doc 08, §budget): si el prompt armado excede
 * MAX_CONTEXT_TOKENS, se recorta por bloques en orden inverso de valor
 * (registro diario → 45 días, detalle de actividades → 10 días) y el recorte
 * queda anotado dentro del propio prompt.
 */

function shift(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function dailyLog(days: number): string {
  const lines = ["REGISTRO DIARIO COMPLETO (una línea por día, dato crudo del reloj):"];
  for (let i = days - 1; i >= 0; i--) {
    lines.push(`  ${shift("2026-07-20", -i)}: pasos 10000 | dist 8.0 km | cal 2500`);
  }
  return lines.join("\n");
}

function activityDetail(days: number): string {
  const entries: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = shift("2026-07-20", -i);
    entries.push(
      `[${date}] Carrera (running) · 8.00km · 40:00 · ritmo 5:00/km\n  Vueltas (8): L1 1.00km 5:00 140/150♥`
    );
  }
  return entries.join("\n\n");
}

describe("estimateTokens", () => {
  it("estima ~4 chars por token, redondeando arriba", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("x".repeat(60_000 * 4))).toBe(60_000);
  });
});

describe("trimContextToBudget", () => {
  it("bajo presupuesto no toca nada", () => {
    const blocks = [
      { name: DAILY_LOG_BLOCK, text: dailyLog(90) },
      { name: ACTIVITY_DETAIL_BLOCK, text: activityDetail(15) },
    ];
    const { blocks: out, trimmed } = trimContextToBudget(blocks, 1_000_000);
    expect(trimmed).toEqual([]);
    expect(out[0].text).toBe(blocks[0].text);
    expect(out[1].text).toBe(blocks[1].text);
  });

  it("primero recorta el registro diario a 45 días y lo anota en el prompt", () => {
    const full = dailyLog(90);
    const blocks = [{ name: DAILY_LOG_BLOCK, text: full }];
    const { blocks: out, trimmed } = trimContextToBudget(blocks, estimateTokens(full) - 1);
    expect(trimmed).toEqual([DAILY_LOG_BLOCK]);
    const text = out[0].text;
    const dayLines = text.split("\n").filter((l) => /^ {2}\d{4}-\d{2}-\d{2}: /.test(l));
    expect(dayLines).toHaveLength(DAILY_LOG_TRIM_DAYS);
    // Se quedan los días MÁS RECIENTES
    expect(text).toContain("2026-07-20: pasos");
    expect(text).not.toContain("2026-04-22: pasos"); // día 90 (el más viejo)
    // La anotación viaja dentro del bloque
    expect(text).toContain(`[Recortado por presupuesto de contexto: solo los últimos ${DAILY_LOG_TRIM_DAYS} días de 90.]`);
    expect(text).toContain("REGISTRO DIARIO COMPLETO");
  });

  it("si aún no cabe, recorta el detalle de actividades a 10 días con su anotación", () => {
    const blocks = [
      { name: DAILY_LOG_BLOCK, text: dailyLog(90) },
      { name: ACTIVITY_DETAIL_BLOCK, text: activityDetail(15) },
    ];
    const { blocks: out, trimmed } = trimContextToBudget(blocks, 1);
    expect(trimmed).toEqual([DAILY_LOG_BLOCK, ACTIVITY_DETAIL_BLOCK]);
    const detail = out.find((b) => b.name === ACTIVITY_DETAIL_BLOCK)!.text;
    const dates = [...new Set([...detail.matchAll(/^\[(\d{4}-\d{2}-\d{2})\]/gm)].map((m) => m[1]))];
    expect(dates).toHaveLength(ACTIVITY_DETAIL_TRIM_DAYS);
    // Los 10 más recientes sobreviven; los 5 más viejos no
    expect(detail).toContain("[2026-07-20]");
    expect(detail).not.toContain("[2026-07-06]");
    expect(detail).toContain(
      `[Recortado por presupuesto de contexto: solo los últimos ${ACTIVITY_DETAIL_TRIM_DAYS} días con actividades, de 15.]`
    );
  });

  it("bloques que no conoce quedan intactos aunque el total exceda", () => {
    const blocks = [{ name: "training", text: "x".repeat(4000) }];
    const { blocks: out, trimmed } = trimContextToBudget(blocks, 1);
    expect(trimmed).toEqual([]);
    expect(out[0].text).toBe(blocks[0].text);
  });

  it("un registro diario que ya cabe en 45 días no se recorta dos veces", () => {
    const small = dailyLog(30);
    const { blocks: out, trimmed } = trimContextToBudget(
      [{ name: DAILY_LOG_BLOCK, text: small }],
      1
    );
    // 30 ≤ 45: el recorte de daily-log no aplica (y no hay más pasos para este bloque)
    expect(out[0].text).toBe(small);
    expect(trimmed).toEqual([]);
  });
});
