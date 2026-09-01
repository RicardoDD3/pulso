/**
 * body_battery_samples y stress_samples nunca llegaban a ningún chat: de la
 * batería y el estrés solo viajaba el agregado del día (alto→bajo, promedio),
 * así que el coach no podía explicar POR QUÉ se drenó un día ni a qué hora.
 *
 * OJO: ~480 muestras/día por tabla (cada 3 min). Este bloque las comprime a una
 * línea por día; la consulta va día por día porque 7 días rebasan el tope de
 * 1000 filas de Supabase.
 */
import { formatBodyBatteryStressBlock } from "@/lib/health/bb-stress";

/** Muestra a las HH:MM hora CDMX del 2026-08-04. */
const at = (hh: number, mm: number, level: number) => ({
  timestamp_ms: Date.parse(`2026-08-04T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-06:00`),
  level,
});

describe("formatBodyBatteryStressBlock", () => {
  it("resume la batería del día: inicio, fin, pico y mínimo con hora", () => {
    const text = formatBodyBatteryStressBlock({
      "2026-08-04": { battery: [at(6, 0, 70), at(9, 0, 76), at(21, 40, 37), at(23, 0, 41)] },
    });

    expect(text).toContain("BODY BATTERY Y ESTRÉS INTRADÍA");
    expect(text).toContain("BB 70 → 41");
    expect(text).toContain("pico 76 (09:00)");
    expect(text).toContain("mín 37 (21:40)");
  });

  it("reporta la mayor caída sostenida con su ventana horaria", () => {
    const text = formatBodyBatteryStressBlock({
      "2026-08-04": { battery: [at(6, 0, 90), at(10, 0, 40), at(14, 0, 60), at(20, 0, 55)] },
    });

    // La caída 90→40 (50) es mayor que 60→55 (5)
    expect(text).toContain("mayor caída −50 (06:00→10:00)");
  });

  it("resume el estrés: promedio, pico con hora y minutos en estrés alto", () => {
    const text = formatBodyBatteryStressBlock({
      "2026-08-04": {
        stress: [at(8, 0, 20), at(8, 3, 80), at(8, 6, 90), at(8, 9, 30)],
      },
    });

    expect(text).toContain("estrés medio 55");
    expect(text).toContain("pico 90 (08:06)");
    expect(text).toMatch(/min en estrés alto/);
  });

  it("ignora las muestras inválidas de estrés (Garmin manda −1/−2)", () => {
    const text = formatBodyBatteryStressBlock({
      "2026-08-04": { stress: [at(8, 0, -1), at(8, 3, -2), at(8, 6, 40), at(8, 9, 60)] },
    });

    expect(text).toContain("estrés medio 50");
    expect(text).not.toContain("-1");
  });

  it("lista los días del más reciente al más viejo y tolera días con una sola serie", () => {
    const text = formatBodyBatteryStressBlock({
      "2026-08-02": { stress: [at(8, 0, 30)] },
      "2026-08-04": { battery: [at(6, 0, 70), at(22, 0, 30)] },
    });
    const dates = text.match(/2026-08-0\d/g);

    expect(dates).toEqual(["2026-08-04", "2026-08-02"]);
    expect(text).toContain("estrés medio 30");
  });

  it("devuelve cadena vacía cuando no hay muestras", () => {
    expect(formatBodyBatteryStressBlock({})).toBe("");
    expect(formatBodyBatteryStressBlock({ "2026-08-04": { battery: [], stress: [] } })).toBe("");
  });
});
