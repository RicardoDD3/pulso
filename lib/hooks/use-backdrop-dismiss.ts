"use client";

import { useCallback, useRef } from "react";
import type { MouseEvent, PointerEvent } from "react";

/**
 * Props para el fondo (backdrop) de un modal que se cierra al hacer click fuera
 * del panel.
 *
 * Por qué no basta con `onClick={onClose}` en el fondo: el navegador dispara el
 * `click` sobre el ANCESTRO COMÚN del `mousedown` y el `mouseup`. Si el usuario
 * presiona dentro del panel (p. ej. arrastrando para seleccionar el número de
 * un input) y suelta afuera, ese ancestro es el fondo — el `stopPropagation`
 * del panel nunca corre y el modal se cerraba a media selección, perdiendo lo
 * escrito.
 *
 * Aquí se recuerda dónde empezó la pulsación (`pointerdown`, que cubre mouse y
 * touch) y solo se cierra si empezó Y terminó en el fondo. Si `pointerdown` no
 * llegara nunca (navegador sin pointer events), el default es cerrar: nunca
 * deja el modal atrapado.
 */
export interface BackdropDismissProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onClick: (e: MouseEvent<HTMLElement>) => void;
}

export function useBackdropDismiss(onDismiss: () => void): BackdropDismissProps {
  const pressStartedInside = useRef(false);

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    pressStartedInside.current = e.target !== e.currentTarget;
  }, []);

  const onClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      // El click nació dentro del panel: no es un click en el fondo.
      if (e.target !== e.currentTarget) return;
      if (pressStartedInside.current) {
        pressStartedInside.current = false;
        return;
      }
      onDismiss();
    },
    [onDismiss]
  );

  return { onPointerDown, onClick };
}
