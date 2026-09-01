/**
 * Formulario de generación de planes (Training): el modo determinístico
 * manda el body correcto a POST /api/training/plans y el modo IA solo
 * aparece cuando aiPlansEnabled.
 *
 * next-intl es ESM-only y jest no lo transforma; se mockea useTranslations
 * resolviendo las claves reales de messages/en.json (así el test también
 * detecta claves faltantes).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanGeneratorForm } from "@/components/training/PlanGeneratorForm";

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
  return {
    useTranslations: (namespace: string) => (key: string) => resolve(namespace, key),
    useLocale: () => "en",
  };
});

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ plan: { id: "plan-1" } }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

function renderForm(props: { aiPlansEnabled?: boolean; onCreated?: () => void } = {}) {
  return render(
    <PlanGeneratorForm
      aiPlansEnabled={props.aiPlansEnabled ?? false}
      onCreated={props.onCreated ?? jest.fn()}
    />,
  );
}

test("el submit determinístico llama a POST /api/training/plans con el body correcto", async () => {
  const onCreated = jest.fn();
  renderForm({ onCreated });

  fireEvent.click(screen.getByRole("button", { name: "21.1 km" }));
  fireEvent.change(screen.getByLabelText("Race date"), {
    target: { value: "2026-12-06" },
  });
  fireEvent.change(screen.getByLabelText("Current weekly km"), {
    target: { value: "40" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/training/plans");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({
    generator: "deterministic",
    raceDistanceKm: 21.1,
    raceDate: "2026-12-06",
    currentWeeklyKm: 40,
    daysPerWeek: 6,
    longRunDay: "saturday",
    experienceLevel: "intermediate",
  });
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
});

test("un preset menor a 21 km deshabilita el submit con hint (límite del generador)", () => {
  renderForm();

  fireEvent.click(screen.getByRole("button", { name: "10 km" }));

  expect(screen.getByRole("button", { name: "Generate plan" })).toBeDisabled();
  expect(
    screen.getByText(/standard generator needs a race of at least 21 km/i),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
  expect(fetchMock).not.toHaveBeenCalled();
});

test("el toggle de IA solo aparece con aiPlansEnabled", () => {
  const { unmount } = renderForm({ aiPlansEnabled: false });
  expect(screen.queryByRole("button", { name: "AI" })).not.toBeInTheDocument();
  unmount();

  renderForm({ aiPlansEnabled: true });
  expect(screen.getByRole("button", { name: "AI" })).toBeInTheDocument();
});
