import { formatRelative } from "@/lib/training/format-time";

// "now" fijo para que los buckets relativos sean deterministas.
const NOW = new Date("2026-07-20T12:00:00.000Z");

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatRelative", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("devuelve cadena vacía para valores nulos o inválidos", () => {
    expect(formatRelative(null)).toBe("");
    expect(formatRelative(undefined)).toBe("");
    expect(formatRelative("")).toBe("");
    expect(formatRelative("no-es-fecha")).toBe("");
  });

  it("muestra 'ahora' para menos de 60 segundos (sin el borde '0m')", () => {
    expect(formatRelative(ago(0))).toBe("ahora");
    expect(formatRelative(ago(30 * SEC))).toBe("ahora");
    expect(formatRelative(ago(59 * SEC))).toBe("ahora");
  });

  it("muestra minutos entre 1 y 59 min", () => {
    expect(formatRelative(ago(1 * MIN))).toBe("1m");
    expect(formatRelative(ago(5 * MIN))).toBe("5m");
    expect(formatRelative(ago(59 * MIN))).toBe("59m");
  });

  it("muestra horas entre 1 y 23 h", () => {
    expect(formatRelative(ago(1 * HOUR))).toBe("1h");
    expect(formatRelative(ago(2 * HOUR))).toBe("2h");
    expect(formatRelative(ago(23 * HOUR))).toBe("23h");
  });

  it("muestra días entre 1 y 6 d", () => {
    expect(formatRelative(ago(1 * DAY))).toBe("1d");
    expect(formatRelative(ago(3 * DAY))).toBe("3d");
    expect(formatRelative(ago(6 * DAY))).toBe("6d");
  });

  it("muestra semanas entre 1 y 4 sem", () => {
    expect(formatRelative(ago(7 * DAY))).toBe("1sem");
    expect(formatRelative(ago(14 * DAY))).toBe("2sem");
    expect(formatRelative(ago(28 * DAY))).toBe("4sem");
  });

  it("cae a una fecha corta cuando es más viejo que ~5 semanas", () => {
    const out = formatRelative(ago(40 * DAY)); // ~10 de junio
    expect(out).not.toBe("ahora");
    expect(out).not.toMatch(/^\d+(m|h|d|sem)$/); // ya no es un bucket relativo
    expect(out).toMatch(/\d/); // contiene el día del mes
    expect(out.toLowerCase()).toContain("jun");
  });
});
