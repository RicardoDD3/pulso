/**
 * El modal avisa que fundir dos sesiones del mismo tipo no se deshace
 * arrastrando: solo desde el chat del planner.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import MergeSessionsModal from "@/components/training/MergeSessionsModal";
import type { SectionMoveInfo } from "@/lib/training/week-tracks";

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

const runMerge: SectionMoveInfo = {
  section: "run",
  kind: "merge",
  needsConfirm: true,
  fromLabel: "Mar 4",
  toLabel: "Mié 5",
  sessionType: "z2",
  fromKm: 10.8,
  targetKm: 8.2,
  resultKm: 19,
};

test("muestra origen, destino y el resultado de la fusión", () => {
  render(<MergeSessionsModal info={runMerge} onConfirm={() => {}} onCancel={() => {}} />);
  expect(screen.getByText(/Mar 4/)).toBeInTheDocument();
  expect(screen.getByText(/Mié 5/)).toBeInTheDocument();
  expect(screen.getByText(/19 km/)).toBeInTheDocument();
});

test("Fusionar llama onConfirm y Cancelar llama onCancel", () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  render(<MergeSessionsModal info={runMerge} onConfirm={onConfirm} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole("button", { name: "Merge" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("fuerza: avisa que la semana pierde una sesión", () => {
  const strengthMerge: SectionMoveInfo = {
    ...runMerge,
    section: "strength",
    sessionType: "strength",
    fromKm: 0,
    targetKm: 0,
    resultKm: 0,
  };
  render(<MergeSessionsModal info={strengthMerge} onConfirm={() => {}} onCancel={() => {}} />);
  expect(screen.getByText(/one less strength session/i)).toBeInTheDocument();
});

test("seleccionar dentro del panel y soltar en el fondo NO cancela (backdrop-dismiss)", () => {
  const onCancel = jest.fn();
  const { container } = render(
    <MergeSessionsModal info={runMerge} onConfirm={() => {}} onCancel={onCancel} />
  );
  const backdrop = container.firstChild as HTMLElement;
  const panelText = screen.getByText(/19 km/);

  fireEvent.pointerDown(panelText);
  fireEvent.click(backdrop);
  expect(onCancel).not.toHaveBeenCalled();

  fireEvent.pointerDown(backdrop);
  fireEvent.click(backdrop);
  expect(onCancel).toHaveBeenCalledTimes(1);
});
