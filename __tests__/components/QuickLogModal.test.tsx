/**
 * Regresión: seleccionar (arrastrando) el número del input de peso cerraba el
 * modal sin guardar. El navegador dispara el `click` sobre el ancestro común
 * del mousedown y el mouseup — si sueltas fuera del panel, ese ancestro es el
 * fondo, así que el `stopPropagation` del panel nunca corre y el onClick del
 * fondo cerraba el modal a media selección.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import QuickLogModal from "@/components/training/QuickLogModal";
import type { ExerciseDefLite } from "@/lib/training/week-tracks";

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

const defs: ExerciseDefLite[] = [
  {
    exercise_key: "bench",
    label: "Bench",
    emoji: "🏋️",
    type: "weighted",
    weekly_goal: null,
    sort_order: 1,
    is_active: true,
  },
];

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ sets: [] }),
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function renderModal(onClose: () => void) {
  return render(
    <QuickLogModal date="2026-08-03" dayLabel="Lun" mode="strength" defs={defs} onClose={onClose} />
  );
}

test("seleccionar el número del input y soltar fuera del panel NO cierra el modal", async () => {
  const onClose = jest.fn();
  const { container } = renderModal(onClose);
  const backdrop = container.firstChild as HTMLElement;

  const weight = await screen.findByLabelText(/weight/i);
  // El usuario arrastra para seleccionar "150": presiona dentro del input...
  fireEvent.pointerDown(weight);
  // ...y suelta fuera del panel, así que el click aterriza en el fondo.
  fireEvent.click(backdrop);

  expect(onClose).not.toHaveBeenCalled();
});

test("un click de verdad en el fondo sí cierra el modal", async () => {
  const onClose = jest.fn();
  const { container } = renderModal(onClose);
  const backdrop = container.firstChild as HTMLElement;

  await screen.findByLabelText(/weight/i);
  fireEvent.pointerDown(backdrop);
  fireEvent.click(backdrop);

  expect(onClose).toHaveBeenCalledTimes(1);
});

test("el botón Cerrar sigue cerrando", async () => {
  const onClose = jest.fn();
  renderModal(onClose);
  fireEvent.click(await screen.findByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("el default es 3 sets × 5 reps", async () => {
  renderModal(jest.fn());

  expect(await screen.findByLabelText(/^sets$/i)).toHaveValue(3);
  expect(screen.getByLabelText(/^reps$/i)).toHaveValue(5);
  expect(screen.getByRole("button", { name: "+ 3 sets × 5 reps" })).toBeInTheDocument();
});

test("guarda un POST por set con el peso y las reps escritas", async () => {
  renderModal(jest.fn());

  const weight = await screen.findByLabelText(/weight/i);
  fireEvent.change(weight, { target: { value: "150" } });
  fireEvent.click(screen.getByRole("button", { name: "+ 3 sets × 5 reps" }));

  await waitFor(() => {
    const posts = (global.fetch as jest.Mock).mock.calls.filter((c) => c[1]?.method === "POST");
    expect(posts).toHaveLength(3);
  });
  const posts = (global.fetch as jest.Mock).mock.calls.filter((c) => c[1]?.method === "POST");
  for (const post of posts) {
    expect(post[0]).toBe("/api/exercises/sets");
    expect(JSON.parse(post[1].body)).toEqual({
      date: "2026-08-03",
      exerciseKey: "bench",
      weightKg: 150,
      reps: 5,
    });
  }
});

test("respeta el número de sets que escriba el usuario", async () => {
  renderModal(jest.fn());

  fireEvent.change(await screen.findByLabelText(/weight/i), { target: { value: "80" } });
  fireEvent.change(screen.getByLabelText(/^sets$/i), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText(/^reps$/i), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: "+ 2 sets × 10 reps" }));

  await waitFor(() => {
    const posts = (global.fetch as jest.Mock).mock.calls.filter((c) => c[1]?.method === "POST");
    expect(posts).toHaveLength(2);
  });
  const posts = (global.fetch as jest.Mock).mock.calls.filter((c) => c[1]?.method === "POST");
  expect(JSON.parse(posts[0][1].body)).toMatchObject({ weightKg: 80, reps: 10 });
});

test("una entrada inválida no dispara ningún POST y muestra el error", async () => {
  renderModal(jest.fn());

  await screen.findByLabelText(/weight/i); // el peso queda vacío
  fireEvent.click(screen.getByRole("button", { name: "+ 3 sets × 5 reps" }));

  expect(await screen.findByText("Peso inválido")).toBeInTheDocument();
  const posts = (global.fetch as jest.Mock).mock.calls.filter((c) => c[1]?.method === "POST");
  expect(posts).toHaveLength(0);
});

test("si un set falla a medio camino se detiene y avisa", async () => {
  let posts = 0;
  global.fetch = jest.fn().mockImplementation((_url, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts++;
      if (posts === 2) {
        return Promise.resolve({
          ok: false,
          json: async () => ({
            error: { code: "max_sets", message: "Max 20 sets per exercise per day." },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ set: {} }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ sets: [] }) });
  }) as unknown as typeof fetch;

  renderModal(jest.fn());
  fireEvent.change(await screen.findByLabelText(/weight/i), { target: { value: "150" } });
  fireEvent.click(screen.getByRole("button", { name: "+ 3 sets × 5 reps" }));

  expect(await screen.findByText("Max 20 sets per exercise per day.")).toBeInTheDocument();
  expect(posts).toBe(2); // el 3º nunca se intenta
});
