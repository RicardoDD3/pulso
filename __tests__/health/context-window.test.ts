/**
 * Regla dura (a) del port (spec doc 08): `HEALTH_WINDOW_DAYS` viene de
 * `getEnv().HEALTH_WINDOW_DAYS` y es LA ÚNICA perilla de ventana — el filtro
 * de las queries (healthWindowFrom) y las etiquetas del prompt derivan de la
 * misma constante. Este test cambia la variable y verifica que TODO se mueva
 * junto.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

describe("HEALTH_WINDOW_DAYS — una sola perilla desde el env", () => {
  const OLD_ENV = process.env;

  afterEach(() => {
    process.env = OLD_ENV;
    jest.resetModules();
  });

  it("con HEALTH_WINDOW_DAYS=45, filtro y etiquetas derivan del mismo valor", () => {
    jest.isolateModules(() => {
      process.env = {
        ...OLD_ENV,
        HEALTH_WINDOW_DAYS: "45",
        DATABASE_URL: "postgres://test/test",
        AUTH_SECRET: "0123456789abcdef",
      };
      const hw = require("@/lib/health/health-window");
      expect(hw.HEALTH_WINDOW_DAYS).toBe(45);
      expect(hw.TREND_WINDOWS).toEqual([7, 30, 45]);
      expect(hw.TREND_WINDOWS_LABEL).toBe("7/30/45");

      // El filtro de las queries…
      const { healthWindowFrom } = require("@/lib/health/tz");
      expect(healthWindowFrom("2026-09-01")).toBe("2026-07-18");

      // …y las etiquetas del prompt salen del MISMO número.
      const { buildCoachSystemPrompt } = require("@/lib/health/coach-prompt");
      const prompt = buildCoachSystemPrompt("g", "b", "t");
      expect(prompt).toContain("=== DATOS DE GARMIN (últimos 45 días) ===");
      expect(prompt).toContain("baseline de 45 días");
      expect(prompt).toContain("los promedios 7/30/45");
    });
  });

  it("sin la variable aplica el default (90) en filtro y etiquetas", () => {
    jest.isolateModules(() => {
      process.env = { ...OLD_ENV };
      delete process.env.HEALTH_WINDOW_DAYS;
      const hw = require("@/lib/health/health-window");
      expect(hw.HEALTH_WINDOW_DAYS).toBe(90);
      const { healthWindowFrom } = require("@/lib/health/tz");
      expect(healthWindowFrom("2026-09-01")).toBe("2026-06-03");
      const { buildCoachSystemPrompt } = require("@/lib/health/coach-prompt");
      expect(buildCoachSystemPrompt("g", "b", "t")).toContain(
        "=== DATOS DE GARMIN (últimos 90 días) ==="
      );
    });
  });
});
