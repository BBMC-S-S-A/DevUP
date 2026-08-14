"use client";

import { useEffect, useRef } from "react";
import type { Message } from "../api";
import { buildWsUrl, requestTicket } from "../ws";

/**
 * Mensajes del canal en tiempo real.
 *
 * A diferencia de la biblioteca de archivos —donde un aviso dispara una
 * recarga—, aquí el mensaje viaja entero por el socket y se inserta tal cual.
 * En un chat, el ida y vuelta de «algo cambió, ¿qué era?» se nota: el mensaje
 * propio aparecería al instante y el de los demás medio segundo tarde.
 */
export function useChannelFeed(
  channelId: string,
  onMessage: (action: "created" | "updated" | "deleted", message: Message) => void,
): void {
  const callback = useRef(onMessage);
  callback.current = onMessage;

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

        socket = new WebSocket(buildWsUrl("/ws/channel", { channelId, ticket }));

        socket.onopen = () => {
          attempt = 0;
        };

        socket.onmessage = (event) => {
          const payload = JSON.parse(String(event.data)) as {
            type?: string;
            action?: "created" | "updated" | "deleted";
            message?: Message;
          };
          if (payload.type === "message" && payload.action && payload.message) {
            callback.current(payload.action, payload.message);
          }
        };

        socket.onclose = () => {
          if (closed) return;
          // Espera creciente con tope: una API caída no debe convertirse en
          // cien conexiones por minuto desde cada pestaña abierta.
          attempt += 1;
          retry = setTimeout(() => void connect(), Math.min(1000 * 2 ** attempt, 30_000));
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
  }, [channelId]);
}
