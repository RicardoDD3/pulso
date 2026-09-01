/**
 * Programa un cambio de opacidad sobre el elemento arrastrado en el siguiente
 * frame (efecto "fantasma" mientras se arrastra un chip).
 *
 * Recibe el elemento YA resuelto —no el evento— a propósito: en un handler de
 * React, `event.currentTarget` se pone a `null` en cuanto el handler retorna,
 * así que leerlo dentro del `requestAnimationFrame` lanza
 * "Cannot read properties of null (reading 'style')". Al pedir el elemento como
 * argumento, la lectura de `e.currentTarget` ocurre síncrona en el call site y
 * queda capturada para cuando corra el frame.
 *
 * `schedule` es inyectable para poder testear sin un frame real.
 */
export function scheduleDragOpacity(
  el: HTMLElement | null | undefined,
  opacity: string,
  schedule: (cb: () => void) => void = defaultSchedule,
): void {
  if (!el) return;
  schedule(() => {
    if (el) el.style.opacity = opacity;
  });
}

function defaultSchedule(cb: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(cb);
  else cb();
}
