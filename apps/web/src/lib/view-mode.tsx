"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Profesional o inmersiva.
 *
 * La vista profesional es la que ya existía y es la de por defecto, siempre.
 * Ver docs/decisiones/0002-vistas-profesional-e-inmersiva.md: la oficina es
 * opcional y tiene que seguir siéndolo — quien nunca la abra no debe notar
 * que existe más allá de un botón.
 *
 * La preferencia vive en `localStorage` y no en el perfil, a propósito. Es una
 * decisión por dispositivo: la misma persona quiere la oficina en el portátil
 * grande de casa y la lista sobria en el monitor compartido de la oficina, y
 * guardarla en el servidor le impondría la misma en los dos.
 */
const STORAGE_KEY = "devup:view-mode";

export type ViewMode = "professional" | "immersive";

export function useViewMode(): {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  /** Falso hasta leer el almacenamiento, para no parpadear al cargar. */
  ready: boolean;
} {
  const [mode, setStored] = useState<ViewMode>("professional");
  const [ready, setReady] = useState(false);

  // Se lee en un efecto y no al inicializar el estado porque en el servidor no
  // hay `localStorage`: hacerlo antes rompe el renderizado en servidor de Next.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "immersive" || saved === "professional") setStored(saved);
    } catch {
      // Modo privado con almacenamiento bloqueado: se sigue con el valor por
      // defecto, que es exactamente lo que hay que hacer.
    }
    setReady(true);
  }, []);

  const setMode = useCallback((next: ViewMode) => {
    setStored(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Si no se puede guardar, la preferencia dura lo que la pestaña. No es
      // motivo para impedir el cambio.
    }
  }, []);

  return { mode, setMode, ready };
}
