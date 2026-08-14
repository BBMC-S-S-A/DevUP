"use client";

import { useEffect, useRef } from "react";
import { buildWsUrl, requestTicket } from "../ws";

/**
 * Avisos de cambios en la biblioteca del workspace.
 *
 * Sustituye a la suscripción de Realtime sobre la tabla `files`. Cuando llega
 * un aviso no se aplica el cambio a mano: se vuelve a pedir el listado. Es una
 * consulta más, pero evita el problema clásico de mantener dos copias del
 * estado que divergen —el filtro activo, el orden, las etiquetas— por un
 * mensaje que llegó desordenado.
 */
export function useFileFeed(workspaceId: string, onChange: () => void): void {
  const callback = useRef(onChange);
  callback.current = onChange;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let closed = false;

    const connect = async () => {
      if (closed) return;
      try {
        const ticket = await requestTicket();
        if (closed) return;

        socket = new WebSocket(buildWsUrl("/ws/files", { workspaceId, ticket }));

        socket.onopen = () => {
          attempt = 0;
        };

        socket.onmessage = (event) => {
          const message = JSON.parse(String(event.data)) as { type?: string };
          if (message.type === "file-change") callback.current();
        };

        socket.onclose = () => {
          if (closed) return;
          // Reintento con espera creciente y tope: una API caída no debe
          // convertirse en cien conexiones por minuto desde cada pestaña.
          attempt += 1;
          const delay = Math.min(1000 * 2 ** attempt, 30_000);
          retry = setTimeout(() => void connect(), delay);
        };
      } catch {
        attempt += 1;
        retry = setTimeout(() => void connect(), Math.min(1000 * 2 ** attempt, 30_000));
      }
    };

    void connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [workspaceId]);
}
