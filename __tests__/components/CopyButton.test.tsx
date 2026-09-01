/**
 * Botón de copiar compartido por los chats de Biohacking (Coach de
 * Biomarcadores, Coach de Tracking, chat "Planes").
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import CopyButton from "@/components/shared/CopyButton";

const writeText = jest.fn<Promise<void>, [string]>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

test("copia el texto al portapapeles al hacer click", async () => {
  render(<CopyButton text="respuesta del coach" label="Copiar mensaje" />);

  fireEvent.click(screen.getByRole("button", { name: "Copiar mensaje" }));

  await waitFor(() => expect(writeText).toHaveBeenCalledWith("respuesta del coach"));
});

test("confirma con 'Copiado' y regresa al estado normal después de 2s", async () => {
  jest.useFakeTimers();
  try {
    render(<CopyButton text="hola" label="Copiar mensaje" />);
    const btn = screen.getByRole("button", { name: "Copiar mensaje" });

    await act(async () => {
      fireEvent.click(btn);
    });
    expect(screen.getByRole("button", { name: "Copiado" })).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("button", { name: "Copiar mensaje" })).toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

test("no confirma si el portapapeles falla (permiso denegado)", async () => {
  writeText.mockRejectedValue(new Error("denied"));
  render(<CopyButton text="hola" label="Copiar mensaje" />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copiar mensaje" }));
  });

  expect(screen.queryByRole("button", { name: "Copiado" })).not.toBeInTheDocument();
});

test("se deshabilita cuando no hay texto que copiar (chat vacío)", () => {
  render(<CopyButton text="   " label="Copiar chat" />);
  const btn = screen.getByRole("button", { name: "Copiar chat" });

  expect(btn).toBeDisabled();
  fireEvent.click(btn);
  expect(writeText).not.toHaveBeenCalled();
});
