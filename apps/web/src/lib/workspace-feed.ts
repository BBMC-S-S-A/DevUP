"use client";

import { useEffect, useRef } from "react";
import { buildWsUrl, requestTicket } from "./ws";

/**
 * El socket del espacio de trabajo, del que cuelgan los avisos en vivo.
 *
 * POR QUÉ UNO Y NO DOS. La biblioteca y el tablero necesitan lo mismo —«algo
 * cambió aquí, vuelve a pedirlo»— y el servidor los reparte por la misma sala,
 * que es el espacio. Escribir el segundo a mano habría duplicado lo único
 * delicado que tiene esto: el reintento con espera creciente. Dos copias de un
 * reintento divergen sin que nadie lo note, y la que se queda mal convierte una
 * API caída en cien conexiones por minuto desde cada pestaña.
 *
 * CUANDO LLEGA UN AVISO NO SE APLICA EL CAMBIO A MANO: se vuelve a pedir. Es
 * una consulta más y evita el problema clásico de mantener dos copias del
 * estado que divergen —el filtro activo, el orden, las categorías— por un
 * mensaje que llegó desordenado.
 */
export function useAvisosDelEspacio(
  workspaceId: string,
  /** Qué mensajes interesan: `file-change`, `board-change`… */
  tipo: string,
  onChange: () => void,
): void {
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
          if (message.type === tipo) callback.current();
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
  }, [workspaceId, tipo]);
}
