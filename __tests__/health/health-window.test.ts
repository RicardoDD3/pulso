import {
  HEALTH_WINDOW_DAYS,
  TREND_WINDOWS,
  TREND_WINDOWS_LABEL,
} from "@/lib/health/health-window";

/**
 * Este archivo es el ÚNICO que fija el número. El resto de los tests de la
 * ventana (fetch-health-data, coach-prompt) asertan contra la constante, para
 * que cambiar la ventana sea un cambio de una línea y no una cacería de
 * strings — pero que el número no se mueva por accidente lo cuida este test.
 */
describe("HEALTH_WINDOW_DAYS", () => {
  it("la ventana de datos de los chats es de 90 días", () => {
    expect(HEALTH_WINDOW_DAYS).toBe(90);
  });
});

describe("TREND_WINDOWS", () => {
  it("no propone ventanas más largas que los datos que llegan", () => {
    for (const days of TREND_WINDOWS) {
      expect(days).toBeLessThanOrEqual(HEALTH_WINDOW_DAYS);
    }
  });

  it("con ventana de 90 días son 7, 30 y 90, ordenadas y sin duplicados", () => {
    expect(TREND_WINDOWS).toEqual([7, 30, 90]);
  });

  it("la etiqueta del prompt se deriva de las ventanas", () => {
    expect(TREND_WINDOWS_LABEL).toBe("7/30/90");
  });
});
