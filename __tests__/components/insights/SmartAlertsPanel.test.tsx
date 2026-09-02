/**
 * SmartAlertsPanel (insights portados): pinta las alertas, permite
 * descartarlas una a una y desaparece cuando no queda ninguna.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import SmartAlertsPanel from "@/components/training/insights/SmartAlertsPanel";
import type { SmartAlert } from "@/lib/training/plan-insights";

jest.mock("next-intl", () => {
  const en = jest.requireActual("@/messages/en.json");
  const resolve = (namespace: string, key: string, values?: Record<string, unknown>): string => {
    let cur: unknown = en;
    for (const part of `${namespace}.${key}`.split(".")) {
      cur = (cur as Record<string, unknown> | undefined)?.[part];
    }
    if (typeof cur !== "string") throw new Error(`missing i18n key: ${namespace}.${key}`);
    return cur.replace(/\{(\w+)\}/g, (m, k) => (values && k in values ? String(values[k]) : m));
  };
  return {
    useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      resolve(namespace, key, values),
    useLocale: () => "en",
  };
});

const alerts: SmartAlert[] = [
  {
    id: "missed-streak",
    type: "missed",
    severity: "warning",
    title: "3 sesiones seguidas sin completar",
    body: "Llevas varios dias sin entrenar.",
  },
  {
    id: "low-battery-today",
    type: "low_battery",
    severity: "danger",
    title: "Body Battery bajo para sesion intensa",
    body: "Tu Body Battery esta en 30.",
  },
];

test("pinta título y cuerpo de cada alerta", () => {
  render(<SmartAlertsPanel alerts={alerts} />);

  expect(screen.getByText("3 sesiones seguidas sin completar")).toBeInTheDocument();
  expect(screen.getByText("Body Battery bajo para sesion intensa")).toBeInTheDocument();
  expect(screen.getAllByLabelText("Dismiss alert")).toHaveLength(2);
});

test("descartar una alerta la quita; al descartar todas el panel desaparece", () => {
  const { container } = render(<SmartAlertsPanel alerts={alerts} />);

  fireEvent.click(screen.getAllByLabelText("Dismiss alert")[0]);
  expect(screen.queryByText("3 sesiones seguidas sin completar")).toBeNull();
  expect(screen.getByText("Body Battery bajo para sesion intensa")).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("Dismiss alert"));
  expect(container).toBeEmptyDOMElement();
});

test("sin alertas no pinta nada", () => {
  const { container } = render(<SmartAlertsPanel alerts={[]} />);
  expect(container).toBeEmptyDOMElement();
});
