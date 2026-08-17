"use client";

import { useEffect, useRef } from "react";
import { buildWsUrl, requestTicket } from "../ws";

/**
 * Avisos de música compartida de un canal, por el mismo socket que ya reparte
 * los mensajes (`/ws/channel`) — es tan ligero como el de la biblioteca de
 * archivos: un aviso de "algo cambió" y quien lo recibe vuelve a pedir el
 * estado por HTTP, no un estado entero viajando por el socket.
 */
export function useSpotifyChannelFeed(channelId: string, onEvent: (kind: string) => void): void {
  const callback = useRef(onEvent);
  callback.current = onEvent;

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
          const payload = JSON.parse(String(event.data)) as { type?: string; kind?: string };
          if (payload.type === "spotify" && payload.kind) callback.current(payload.kind);
        };

        socket.onclose = () => {
          if (closed) return;
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
