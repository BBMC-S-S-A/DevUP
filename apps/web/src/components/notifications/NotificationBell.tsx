"use client";

import { AtSign, Bell, BellOff, CheckCheck, Mail, Radio, SquareCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Notification, api } from "@/lib/api";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import { buildWsUrl, requestTicket } from "@/lib/ws";

const ICONOS = {
  mention: AtSign,
  task_assigned: SquareCheck,
  invitation: Mail,
  recording: Radio,
} as const;

/**
 * Las cuatro esquinas desde las que puede colgar el panel, con su
 * `transform-origin` a juego: sin él el panel crece desde su propio centro y se
 * despega visualmente de la campana que lo abrió.
 */
const ANCLAJES = {
  "arriba-izquierda": "bottom-full left-0 mb-2 origin-bottom-left",
  "arriba-derecha": "bottom-full right-0 mb-2 origin-bottom-right",
  "abajo-izquierda": "top-full left-0 mt-2 origin-top-left",
  "abajo-derecha": "top-full right-0 mt-2 origin-top-right",
} as const;

/** Medidas aproximadas del panel, solo para decidir hacia dónde abrirlo. */
const ALTO_PANEL = 416;
const ANCHO_PANEL = 320;

/**
 * Tiempo relativo corto. Un «12 min» dice más de un aviso que una fecha
 * completa, y cabe en la esquina de la fila sin robarle sitio al texto.
 */
function hace(iso: string): string {
  const marca = new Date(iso).getTime();
  if (Number.isNaN(marca)) return "";
  const segundos = Math.max(0, (Date.now() - marca) / 1000);
  if (segundos < 60) return "ahora";
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias < 7 ? `${dias} d` : `${Math.floor(dias / 7)} sem`;
}

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
  const [anclaje, setAnclaje] = useState<keyof typeof ANCLAJES>("arriba-izquierda");
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

  /**
   * La campana vive en dos sitios muy distintos —arriba a la derecha del
   * vestíbulo y abajo a la izquierda de la barra lateral—, así que el lado se
   * mide al abrir en vez de fijarse: clavado a uno, en el otro el panel se sale
   * de la pantalla. Se calcula antes de abrir para que no se vea saltar.
   */
  const alternar = () => {
    if (abierta) {
      setAbierta(false);
      return;
    }
    const caja = contenedor.current?.getBoundingClientRect();
    if (caja) {
      const vertical = caja.bottom + ALTO_PANEL > window.innerHeight ? "arriba" : "abajo";
      const horizontal = caja.left + ANCHO_PANEL > window.innerWidth ? "derecha" : "izquierda";
      setAnclaje(`${vertical}-${horizontal}` as keyof typeof ANCLAJES);
    }
    setAbierta(true);
  };

  return (
    <div ref={contenedor} className="relative">
      <BotonIcono
        etiqueta={`Notificaciones${pendientes > 0 ? ` (${pendientes} sin leer)` : ""}`}
        aria-expanded={abierta}
        aria-haspopup="dialog"
        onClick={alternar}
        className={`relative ${abierta ? "bg-raised" : ""}`}
      >
        {/* El icono lleva su propio color para que la campana encendida siga
            encendida al pasar el puntero: un instrumento con aviso no se apaga. */}
        <Bell size={16} className={pendientes > 0 ? "text-accent" : undefined} />

        {pendientes > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center
              rounded-full border border-canvas bg-accent px-1 font-mono text-[9px] font-bold leading-none
              tabular-nums text-canvas shadow-[0_0_12px_-2px_rgb(91_140_255/0.9)]"
          >
            {/* Late el halo, no la cifra: un número que parpadea no se lee. */}
            <span className="absolute -inset-1 animate-pulse-slow rounded-full bg-accent/25 blur-[2px]" />
            <span className="relative">{pendientes > 9 ? "9+" : pendientes}</span>
          </span>
        )}
      </BotonIcono>

      {abierta && (
        <div
          role="dialog"
          aria-label="Notificaciones"
          className={`devup-emerge cristal absolute z-40 flex max-h-[26rem] w-80 flex-col
            overflow-hidden rounded-2xl ${ANCLAJES[anclaje]}`}
        >
          <header className="filo-luz flex shrink-0 items-center gap-2 px-3.5 py-2.5">
            <Rotulo>Notificaciones</Rotulo>
            {pendientes > 0 && (
              <span className="font-mono text-[10px] font-semibold tabular-nums text-accent">
                {pendientes}
              </span>
            )}
            <span className="h-px flex-1 bg-line/70" aria-hidden />
            {pendientes > 0 && (
              <Boton
                variante="fantasma"
                tamano="sm"
                icono={<CheckCheck size={12} />}
                onClick={async () => {
                  await api.post("/notifications/read-all").catch(() => {});
                  await cargar();
                }}
              >
                Marcar todas
              </Boton>
            )}
          </header>

          {items.length === 0 ? (
            <EstadoVacio
              icono={<BellOff size={18} />}
              titulo="Nada por ahora"
              pista="Aquí aterrizan las menciones, las tareas que te asignen y las invitaciones."
            />
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-line/50 overflow-y-auto">
              {items.map((item) => {
                const Icono = ICONOS[item.kind] ?? Bell;
                const leida = Boolean(item.readAt);
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
                      className={`presionable relative flex gap-2.5 px-3.5 py-2.5 hover:bg-raised/70 ${
                        leida ? "opacity-60" : "bg-accent/5"
                      }`}
                    >
                      {/* Rail encendido en el canto en vez de un punto de 6 px:
                          cuáles quedan por leer se ve recorriendo el borde, sin
                          tener que buscar nada dentro de cada fila. */}
                      {!leida && (
                        <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" aria-hidden />
                      )}

                      <span
                        className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border ${
                          leida
                            ? "border-line bg-canvas/50 text-faint"
                            : "border-accent/30 bg-accent-soft/60 text-accent"
                        }`}
                      >
                        <Icono size={13} />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                            {item.title}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                            {hace(item.createdAt)}
                          </span>
                        </span>
                        {item.body && (
                          <span className="mt-0.5 block truncate text-[11px] text-muted">
                            {item.body}
                          </span>
                        )}
                      </span>
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
