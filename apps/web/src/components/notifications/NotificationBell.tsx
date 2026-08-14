"use client";

import { AtSign, Bell, CheckCheck, Mail, Radio, SquareCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Notification, api } from "@/lib/api";
import { buildWsUrl, requestTicket } from "@/lib/ws";

const ICONOS = {
  mention: AtSign,
  task_assigned: SquareCheck,
  invitation: Mail,
  recording: Radio,
} as const;

/**
 * Campana de notificaciones.
 *
 * Llegan por un socket propio de la persona, no del canal: te tienen que
 * avisar de una mención en un canal que no estás mirando, que es justamente el
 * caso en el que una notificación sirve para algo.
 */
export function NotificationBell() {
  const [abierta, setAbierta] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const contenedor = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    const { notifications, unread } = await api
      .get<{ notifications: Notification[]; unread: number }>("/notifications?limit=30")
      .catch(() => ({ notifications: [], unread: 0 }));
    setItems(notifications);
    setPendientes(unread);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Socket con reintento de espera creciente, igual que el resto.
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
        socket = new WebSocket(buildWsUrl("/ws/user", { ticket }));
        socket.onopen = () => {
          attempt = 0;
        };
        socket.onmessage = (event) => {
          const payload = JSON.parse(String(event.data)) as { type?: string };
          // Se recarga en vez de insertar lo recibido: la notificación viene
          // sin el nombre de quien la provocó, porque se compone bajo la
          // identidad de otra persona y RLS no deja leer la fila ajena.
          if (payload.type === "notification") void cargar();
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
  }, [cargar]);

  // Cerrar al pulsar fuera. Sin esto el panel se queda abierto tapando la
  // interfaz mientras navegas.
  useEffect(() => {
    if (!abierta) return;
    const fuera = (event: MouseEvent) => {
      if (!contenedor.current?.contains(event.target as Node)) setAbierta(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierta]);

  return (
    <div ref={contenedor} className="relative">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-label={`Notificaciones${pendientes > 0 ? ` (${pendientes} sin leer)` : ""}`}
        className="relative rounded-lg p-1.5 text-muted transition hover:bg-raised hover:text-ink"
      >
        <Bell size={16} />
        {pendientes > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-medium text-canvas">
            {pendientes > 9 ? "9+" : pendientes}
          </span>
        )}
      </button>

      {abierta && (
        <div className="absolute bottom-full left-0 z-40 mb-2 max-h-96 w-80 overflow-y-auto rounded-xl border border-line bg-surface shadow-xl">
          <header className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-xs font-medium">Notificaciones</span>
            {pendientes > 0 && (
              <button
                type="button"
                onClick={async () => {
                  await api.post("/notifications/read-all").catch(() => {});
                  await cargar();
                }}
                className="flex items-center gap-1 text-[11px] text-faint transition hover:text-ink"
              >
                <CheckCheck size={12} />
                Marcar todas
              </button>
            )}
          </header>

          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-faint">Nada por ahora.</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((item) => {
                const Icono = ICONOS[item.kind] ?? Bell;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.link || "/app"}
                      onClick={async () => {
                        setAbierta(false);
                        if (!item.readAt) {
                          await api.post(`/notifications/${item.id}/read`).catch(() => {});
                          await cargar();
                        }
                      }}
                      className={`flex gap-2.5 px-3 py-2.5 transition hover:bg-raised ${
                        item.readAt ? "opacity-60" : ""
                      }`}
                    >
                      <Icono size={14} className="mt-0.5 shrink-0 text-accent" />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium">{item.title}</span>
                        {item.body && (
                          <span className="mt-0.5 block truncate text-[11px] text-faint">
                            {item.body}
                          </span>
                        )}
                      </span>
                      {!item.readAt && (
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
