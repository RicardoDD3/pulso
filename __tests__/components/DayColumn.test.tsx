/**
 * El cuadrito de una sesión arrastrada desde otro día se identifica como tal,
 * y un día vaciado muestra un guion en vez de quedarse en blanco.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import DayColumn from "@/components/training/DayColumn";
import type { GeneratedDay } from "@/lib/training/plan-generator-types";

// next-intl es ESM-only y jest no lo transforma; se mockea useTranslations
// resolviendo las claves reales de messages/en.json (así el test también
// detecta claves faltantes). Soporta interpolación simple {var}.
jest.mock("next-intl", () => {
  const en = jest.requireActual("@/messages/en.json");
  const resolve = (namespace: string, key: string): string => {
    let cur: unknown = en;
    for (const part of `${namespace}.${key}`.split(".")) {
      cur = (cur as Record<string, unknown> | undefined)?.[part];
    }
    if (typeof cur !== "string") throw new Error(`missing i18n key: ${namespace}.${key}`);
    return cur;
  };
  const interpolate = (msg: string, values?: Record<string, unknown>): string =>
    msg.replace(/\{(\w+)\}/g, (_, k) => (values && k in values ? String(values[k]) : `{${k}}`));
  return {
    useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      interpolate(resolve(namespace, key), values),
    useLocale: () => "en",
  };
});

function makeDay(overrides: Partial<GeneratedDay> = {}): GeneratedDay {
  return {
    date: "2026-08-05",
    dayOfWeek: 2,
    dayLabel: "Mié",
    sessionType: "z2",
    distanceKm: 8.2,
    zone: "Z2",
    notes: "",
    isKeySession: false,
    ...overrides,
  };
}

const noDrag = () => ({
  isSelected: false,
  isDragOver: false,
  draggable: false,
  onDragStart: () => {},
  onDragOver: () => {},
  onDragLeave: () => {},
  onDrop: () => {},
  onDragEnd: () => {},
});

test("el chip de una sesión movida dice de qué día viene", () => {
  const day = makeDay({
    extraSessions: [
      { id: "mv", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-08-04" },
    ],
  });
  render(
    <DayColumn
      day={day}
      actualKm={null}
      exerciseTotals={[]}
      steps={null}
      stepsDayGoal={25000}
      drag={noDrag}
    />
  );
  expect(screen.getByText(/Moved from/)).toBeInTheDocument();
});

test("un chip con estrella la muestra con el mismo ícono/color/title que el encabezado del día", () => {
  const day = makeDay({
    extraSessions: [
      { id: "mv", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-08-04", isKeySession: true },
    ],
  });
  render(
    <DayColumn
      day={day}
      actualKm={null}
      exerciseTotals={[]}
      steps={null}
      stepsDayGoal={25000}
      drag={noDrag}
    />
  );
  const star = screen.getByTitle("Key session");
  expect(star).toHaveTextContent("★");
  expect(star).toHaveClass("text-amber-400");
});

test("un chip sin estrella no la muestra", () => {
  const day = makeDay({
    extraSessions: [
      { id: "mv", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-08-04" },
    ],
  });
  render(
    <DayColumn day={day} actualKm={null} exerciseTotals={[]} steps={null} stepsDayGoal={25000} drag={noDrag} />
  );
  expect(screen.queryByTitle("Key session")).not.toBeInTheDocument();
});

test("un día vaciado (0 km) se lee como vacío: sin etiqueta de tipo, sin zona, con guion", () => {
  render(
    <DayColumn
      day={makeDay({ distanceKm: 0, zone: "Ritmo suave" })}
      actualKm={null}
      exerciseTotals={[]}
      steps={null}
      stepsDayGoal={25000}
      drag={noDrag}
    />
  );
  // El box de Correr YA NO muestra su tipo ni su zona cuando el día se vació
  // (p. ej. porque su sesión se arrastró a otro día): se lee como vacío, mismo
  // lenguaje atenuado que los boxes de Fuerza/Ejercicios/Pasos sin datos.
  // Acotado al guion del box de Correr (data-testid="run-empty-dash"): los
  // otros boxes también muestran "—" cuando están vacíos, así que un
  // getAllByText("—") sin acotar pasa aunque el guion de Correr no exista.
  expect(screen.queryByText("Z2", { selector: "span" })).not.toBeInTheDocument();
  expect(screen.queryByText("Ritmo suave")).not.toBeInTheDocument();
  expect(screen.getByTestId("run-empty-dash")).toHaveTextContent("—");
});

test("un día vaciado (0 km) CON carrera muestra el actual real (sin etiqueta de tipo), no un guion", () => {
  const { container } = render(
    <DayColumn
      day={makeDay({ distanceKm: 0, zone: "Ritmo suave" })}
      actualKm={null}
      dayActivities={[
        { activity_id: 1, distance_meters: 8200, duration_seconds: 2460, avg_hr: 140, max_hr: 160 },
      ]}
      exerciseTotals={[]}
      steps={null}
      stepsDayGoal={25000}
      drag={noDrag}
    />
  );
  // Los km reales ya no viven solo en el renglón de la carrera: el box
  // también los muestra como "objetivo → actual (diferencia)", aunque el
  // objetivo sea 0. El guion queda solo para el día vaciado SIN carrera
  // (test anterior). La etiqueta de tipo y la zona siguen ocultas: el día
  // sigue "vaciado" aunque tenga una carrera asignada.
  expect(screen.queryByTestId("run-empty-dash")).not.toBeInTheDocument();
  expect(screen.queryByText("Z2", { selector: "span" })).not.toBeInTheDocument();
  expect(screen.queryByText("Ritmo suave")).not.toBeInTheDocument();
  const runKmLine = container.querySelector("p.text-xs.text-slate-200.font-medium");
  expect(runKmLine?.textContent?.replace(/\s+/g, " ").trim()).toBe("0 → 8.2 (+8.2)");
  expect(screen.getByText(/⌚/)).toBeInTheDocument();
});

test("un día normal (con km) sí muestra su etiqueta de tipo y su zona", () => {
  render(
    <DayColumn
      day={makeDay({ distanceKm: 8.2, zone: "Ritmo suave" })}
      actualKm={null}
      exerciseTotals={[]}
      steps={null}
      stepsDayGoal={25000}
      drag={noDrag}
    />
  );
  expect(screen.getByText("Z2", { selector: "span" })).toBeInTheDocument();
  expect(screen.getByText("Ritmo suave")).toBeInTheDocument();
});

describe("tooltip del botón de quitar una sesión extra", () => {
  test("un extra 'moved' advierte que baja la meta semanal", () => {
    const day = makeDay({
      extraSessions: [
        { id: "mv", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-08-04" },
      ],
    });
    render(
      <DayColumn
        day={day}
        actualKm={null}
        exerciseTotals={[]}
        steps={null}
        stepsDayGoal={25000}
        drag={noDrag}
        onRemoveExtra={() => {}}
      />
    );
    expect(screen.getByTitle(/lowers the weekly target/i)).toBeInTheDocument();
  });

  test("un extra manual/planner dice 'Remove extra session'", () => {
    const day = makeDay({
      extraSessions: [{ id: "m1", sessionType: "z2", distanceKm: 4, origin: "manual" }],
    });
    render(
      <DayColumn
        day={day}
        actualKm={null}
        exerciseTotals={[]}
        steps={null}
        stepsDayGoal={25000}
        drag={noDrag}
        onRemoveExtra={() => {}}
      />
    );
    expect(screen.getByTitle("Remove extra session")).toBeInTheDocument();
  });

  test("un carryover dice 'Discard pending'", () => {
    // sessionType distinto al del día (z2): si coincidiera, el pendiente se
    // FUNDE en el número principal (partitionExtrasForDisplay) y no aparece
    // como chip con su propio botón de quitar.
    const day = makeDay({
      extraSessions: [
        { id: "co", sessionType: "hiit", distanceKm: 4, origin: "carryover", carryoverFrom: "2026-08-01" },
      ],
    });
    render(
      <DayColumn
        day={day}
        actualKm={null}
        exerciseTotals={[]}
        steps={null}
        stepsDayGoal={25000}
        drag={noDrag}
        onRemoveExtra={() => {}}
      />
    );
    expect(screen.getByTitle("Discard pending")).toBeInTheDocument();
  });
});
