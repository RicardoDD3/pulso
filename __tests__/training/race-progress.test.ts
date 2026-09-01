import { raceProgress, type PlanRace } from "@/lib/training/plan-insights";

const SEASON: PlanRace[] = [
  { name: "Arizona 300", date: "2026-03-27" },
  { name: "Tahoe 200", date: "2026-06-12" },
  { name: "Bigfoot 200", date: "2026-08-14" },
  { name: "Moab 240", date: "2026-10-09" },
];

describe("raceProgress", () => {
  it("cuenta completadas (fecha pasada) y restantes (hoy o futuro)", () => {
    const p = raceProgress(SEASON, "2026-07-17");
    expect(p.total).toBe(4);
    expect(p.completed).toBe(2); // Arizona, Tahoe
    expect(p.remaining).toBe(2); // Bigfoot, Moab
    expect(p.remainingNames).toEqual(["Bigfoot 200", "Moab 240"]);
  });

  it("una carrera HOY cuenta como restante (aún no completada)", () => {
    const p = raceProgress(SEASON, "2026-08-14");
    expect(p.remaining).toBe(2); // Bigfoot (hoy) + Moab
    expect(p.remainingNames[0]).toBe("Bigfoot 200");
  });

  it("temporada terminada: 0 restantes", () => {
    const p = raceProgress(SEASON, "2026-12-01");
    expect(p.completed).toBe(4);
    expect(p.remaining).toBe(0);
    expect(p.remainingNames).toEqual([]);
  });

  it("antes de todas: todas restantes", () => {
    const p = raceProgress(SEASON, "2026-01-01");
    expect(p.completed).toBe(0);
    expect(p.remaining).toBe(4);
  });

  it("sin carreras: ceros", () => {
    expect(raceProgress([], "2026-07-17")).toEqual({ total: 0, completed: 0, remaining: 0, remainingNames: [] });
  });
});
