import { scheduleDragOpacity } from "@/lib/training/drag-visual";

// Regresión: arrastrar un chip de sesión extra/pendiente lanzaba
//   "Cannot read properties of null (reading 'style')"
// porque el handler leía `e.currentTarget` DENTRO del requestAnimationFrame,
// y React pone `currentTarget = null` en cuanto el handler retorna.
// El elemento debe leerse SÍNCRONO (dentro del handler) y capturarse para
// el frame siguiente. `scheduleDragOpacity` fuerza eso al recibir el elemento
// ya resuelto en vez del evento.
describe("scheduleDragOpacity", () => {
  const makeEl = () => ({ style: { opacity: "1" } }) as unknown as HTMLElement;

  it("reproduce el bug: leer currentTarget dentro del frame lanza si React lo nulificó", () => {
    let scheduled: (() => void) | null = null;
    const schedule = (cb: () => void) => {
      scheduled = cb;
    };
    const evt: { currentTarget: HTMLElement | null } = { currentTarget: makeEl() };

    // Patrón BUGGY (lo que había antes): diferir la lectura de currentTarget.
    schedule(() => {
      (evt.currentTarget as HTMLElement).style.opacity = "0.5";
    });
    evt.currentTarget = null; // React nulifica currentTarget tras el handler.

    expect(() => scheduled!()).toThrow();
  });

  it("captura el elemento síncrono: no lanza aunque el evento quede en null", () => {
    let scheduled: (() => void) | null = null;
    const schedule = (cb: () => void) => {
      scheduled = cb;
    };
    const el = makeEl();
    const evt: { currentTarget: HTMLElement | null } = { currentTarget: el };

    // Se lee currentTarget AHORA (argumento evaluado síncrono).
    scheduleDragOpacity(evt.currentTarget, "0.5", schedule);
    evt.currentTarget = null; // React nulifica; ya no importa.

    expect(() => scheduled!()).not.toThrow();
    expect(el.style.opacity).toBe("0.5");
  });

  it("es no-op cuando el elemento es null", () => {
    let scheduled: (() => void) | null = null;
    const schedule = (cb: () => void) => {
      scheduled = cb;
    };
    scheduleDragOpacity(null, "0.5", schedule);
    expect(scheduled).toBeNull();
  });

  it("usa requestAnimationFrame por defecto", () => {
    const el = makeEl();
    const raf = jest
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    try {
      scheduleDragOpacity(el, "0.5");
      expect(raf).toHaveBeenCalledTimes(1);
      expect(el.style.opacity).toBe("0.5");
    } finally {
      raf.mockRestore();
    }
  });
});
