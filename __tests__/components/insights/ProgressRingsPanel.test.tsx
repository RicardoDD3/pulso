/**
 * ProgressRingsPanel (insights portados): pinta los tres anillos con sus
 * porcentajes y los badges bloqueados/desbloqueados del fixture.
 *
 * next-intl es ESM-only y jest no lo transforma; se mockea useTranslations
 * resolviendo las claves reales de messages/en.json (así el test también
 * detecta claves faltantes), con interpolación ICU básica {param}.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import ProgressRingsPanel from "@/components/training/insights/ProgressRingsPanel";
import type { ProgressRings } from "@/lib/training/plan-insights";

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

const rings: ProgressRings = {
  consistency: 85,
  volume: 62,
  longRun: 40,
  badges: [
    {
      id: "primera-semana",
      name: "Primera Semana",
      description: "Completa >80% de la primera semana",
      unlocked: true,
    },
    {
      id: "maratonista",
      name: "Maratonista",
      description: "Completa un run de 42.2km+",
      unlocked: false,
    },
  ],
};

test("pinta los tres anillos con porcentaje y label", () => {
  render(<ProgressRingsPanel rings={rings} />);

  expect(screen.getByText("Progress")).toBeInTheDocument();
  expect(screen.getByText("85%")).toBeInTheDocument();
  expect(screen.getByText("62%")).toBeInTheDocument();
  expect(screen.getByText("40%")).toBeInTheDocument();
  expect(screen.getByText("Consistency")).toBeInTheDocument();
  expect(screen.getByText("Volume")).toBeInTheDocument();
  expect(screen.getByText("Long Run")).toBeInTheDocument();
});

test("badges: el desbloqueado va sin candado y el bloqueado con candado", () => {
  render(<ProgressRingsPanel rings={rings} />);

  expect(screen.getByText("Primera Semana")).toBeInTheDocument();
  // El nombre del badge bloqueado va precedido por el candado.
  expect(screen.getByText(/Maratonista/)).toHaveTextContent("🔒 Maratonista");
  expect(screen.getByText("Completa un run de 42.2km+")).toBeInTheDocument();
});

test("sin badges no pinta la cuadrícula de badges", () => {
  const { container } = render(
    <ProgressRingsPanel rings={{ ...rings, badges: [] }} />
  );
  expect(container.querySelector(".grid")).toBeNull();
});
