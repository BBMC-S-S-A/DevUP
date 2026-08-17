"use client";

import type { WebContainer } from "@webcontainer/api";
import { useEffect, useRef, useState } from "react";
import { bootWebContainer } from "@/lib/dev/webcontainer";

type Estado = "arrancando" | "listo" | "error";

/**
 * Arranca el WebContainer al montar y expone su estado. La instancia va en
 * un `ref` y no en `useState`: `WebContainer` no es serializable ni conviene
 * que dispare un re-render por sí sola — lo que importa a los componentes es
 * el cambio de `status`, no la identidad del objeto.
 */
export function useWebContainer() {
  const [status, setStatus] = useState<Estado>("arrancando");
  const [error, setError] = useState<string | null>(null);
  const instance = useRef<WebContainer | null>(null);

  useEffect(() => {
    let cancelado = false;

    bootWebContainer()
      .then((webcontainer) => {
        if (cancelado) return;
        instance.current = webcontainer;
        setStatus("listo");
      })
      .catch((caught: unknown) => {
        if (cancelado) return;
        setError(caught instanceof Error ? caught.message : "no se pudo arrancar el entorno");
        setStatus("error");
      });

    return () => {
      cancelado = true;
    };
  }, []);

  return { status, error, instance };
}
