/**
 * Mismo bug que QuickLogModal: seleccionar arrastrando el texto de un input y
 * soltar fuera del panel disparaba el click sobre el fondo (ancestro común de
 * mousedown/mouseup) y cerraba el modal perdiendo la edición del día.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import DayEditModal from "@/components/training/DayEditModal";
import type { GeneratedDay } from "@/lib/training/plan-generator-types";

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

const day: GeneratedDay = {
  date: "2026-08-03",
  dayOfWeek: 0,
  dayLabel: "Lun",
  sessionType: "z2",
  distanceKm: 12,
  zone: "Z2 pace",
  notes: "",
  isKeySession: false,
};

function renderModal(onClose: () => void) {
  return render(
    <DayEditModal
      day={day}
      weekIndex={0}
      dayIndex={0}
      planId="9c5c1a90-0000-4000-8000-000000000000"
      onSave={() => {}}
      onClose={onClose}
    />
  );
}

test("seleccionar texto de un input y soltar fuera del panel NO cierra el modal", () => {
  const onClose = jest.fn();
  const { container } = renderModal(onClose);
  const backdrop = container.firstChild as HTMLElement;

  const zone = screen.getByDisplayValue("Z2 pace");
  fireEvent.pointerDown(zone);
  fireEvent.click(backdrop);

  expect(onClose).not.toHaveBeenCalled();
});

test("un click de verdad en el fondo sí cierra el modal", () => {
  const onClose = jest.fn();
  const { container } = renderModal(onClose);
  const backdrop = container.firstChild as HTMLElement;

  fireEvent.pointerDown(backdrop);
  fireEvent.click(backdrop);

  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Cancelar sigue cerrando", () => {
  const onClose = jest.fn();
  renderModal(onClose);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
