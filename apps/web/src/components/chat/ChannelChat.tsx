"use client";

import {
  AlertTriangle,
  CornerUpLeft,
  ExternalLink,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { type Message, api } from "@/lib/api";
import { useChannelFeed } from "@/lib/chat/useChannelFeed";
import { downloadUrl, formatBytes } from "@/lib/files/upload";
import { useSession } from "@/lib/session";

/**
 * Conversación de un canal.
 *
 * El historial se pagina hacia atrás por marca de tiempo, no por número de
 * página: en una conversación viva la «página 2» cambia entre que se pide la 1
 * y la 2, y se acaban viendo mensajes repetidos o saltados.
 *
 * Es la superficie que más se mira de toda la aplicación, así que aquí el
 * sistema visual se aplica al revés que en el resto: casi nada llama la
 * atención. Un mensaje nuevo no entra deslizándose ni brilla — llegan cientos
 * al día y el movimiento que encanta la primera vez marea la número doscientos.
 * Lo único que se mueve es un fundido de opacidad de 200 ms (`devup-velo`).
 */
export function ChannelChat({ channelId }: { channelId: string }) {
  const { user } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);

  /**
   * Qué mensajes acaban de llegar, para señalarlos una vez.
   *
   * Hace falta distinguirlos de la historia porque la animación se dispara al
   * montar el elemento: marcar todos haría que el canal entero destellara al
   * abrirlo, que es justo lo contrario de señalar algo.
   *
   * El conjunto de «ya vistos» arranca NULO y no vacío, y solo se rellena con la
   * primera carga que traiga algo. Si se inicializara en el primer efecto —
   * cuando la lista todavía está vacía— la carga siguiente entraría entera como
   * novedad, y el destello sería el de todo el historial.
   */
  const yaVistos = useRef<Set<string> | null>(null);
  const [recienLlegados, setRecienLlegados] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (messages.length === 0) return;

    if (yaVistos.current === null) {
      yaVistos.current = new Set(messages.map((m) => m.id));
      return;
    }

    const nuevos = messages.filter((m) => !yaVistos.current!.has(m.id)).map((m) => m.id);
    if (nuevos.length === 0) return;
    for (const id of nuevos) yaVistos.current.add(id);
    setRecienLlegados(new Set(nuevos));
  }, [messages]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const load = useCallback(async () => {
    const { messages } = await api.get<{ messages: Message[] }>(
      `/channels/${channelId}/messages?limit=50`,
    );
    setMessages(messages);
    setLoading(false);
    setExhausted(messages.length < 50);
    await api.post(`/channels/${channelId}/read`).catch(() => {});
  }, [channelId]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setExhausted(false);
    void load();
  }, [load]);

  /** Un mensaje que llega por el socket. */
  const onIncoming = useCallback(
    (action: "created" | "updated" | "deleted", incoming: Message) => {
      setMessages((current) => {
        if (action === "deleted") return current.filter((m) => m.id !== incoming.id);
        if (current.some((m) => m.id === incoming.id)) {
          return current.map((m) => (m.id === incoming.id ? incoming : m));
        }
        return [...current, incoming];
      });
      if (action === "created") void api.post(`/channels/${channelId}/read`).catch(() => {});
    },
    [channelId],
  );

  useChannelFeed(channelId, onIncoming);

  // Antes de repintar se decide si hay que seguir abajo. Si se hiciera después,
  // el navegador ya habría movido el scroll y la comprobación miente.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    // Si estabas leyendo algo más arriba, un mensaje nuevo no debe arrastrarte
    // al final: es de las cosas que más molestan de un chat.
    if (atBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const loadOlder = async () => {
    const oldest = messages[0];
    if (!oldest || loadingMore || exhausted) return;
    setLoadingMore(true);
    try {
      const { messages: older } = await api.get<{ messages: Message[] }>(
        `/channels/${channelId}/messages?limit=50&before=${encodeURIComponent(oldest.createdAt)}`,
      );
      if (older.length === 0) setExhausted(true);
      // Conservar la posición de lectura: si no, insertar arriba desplaza todo
      // y se pierde el sitio donde estabas.
      const element = scroller.current;
      const previousHeight = element?.scrollHeight ?? 0;
      setMessages((current) => [...older, ...current]);
      requestAnimationFrame(() => {
        if (element) element.scrollTop = element.scrollHeight - previousHeight;
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (body.length === 0) return;
    setDraft("");

    try {
      if (editing) {
        await api.patch(`/messages/${editing.id}`, { body });
        setEditing(null);
      } else {
        atBottom.current = true;
        await api.post(`/channels/${channelId}/messages`, {
          body,
          replyTo: replyTo?.id ?? null,
        });
        setReplyTo(null);
      }
    } catch {
      setError("no se pudo enviar");
      setDraft(body);
    }
  };

  return (
    <Tarjeta className="relative flex h-[clamp(26rem,58vh,40rem)] flex-col overflow-hidden">
      {/* El aviso de «cargando anteriores» flota sobre la lista en vez de
          empujarla: al paginar hacia atrás se está midiendo la altura del
          scroll para no perder el sitio, y un elemento que aparece y
          desaparece dentro del flujo falsea esa medida. */}
      {loadingMore && (
        <span className="devup-velo pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line-strong bg-elevated px-3 py-1 text-[11px] text-muted shadow-[var(--sombra-panel)]">
          <Loader2 size={11} className="animate-spin" />
          Cargando anteriores
        </span>
      )}

      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (el.scrollTop < 40) void loadOlder();
        }}
        className="flex-1 overflow-y-auto px-3 py-3"
      >
        {loading ? (
          <EsqueletoConversacion />
        ) : messages.length === 0 ? (
          <div className="grid h-full place-items-center">
            <EstadoVacio
              icono={<MessageSquare size={20} />}
              titulo="Aquí no ha escrito nadie todavía"
              pista="Lo que se escriba queda guardado y se puede buscar más tarde desde la lupa de la barra lateral."
            />
          </div>
        ) : (
          <>
            {exhausted && (
              <p className="mb-2 flex items-center gap-3 px-2 pt-1">
                <span className="h-px flex-1 bg-line" />
                <Rotulo>Principio del canal</Rotulo>
                <span className="h-px flex-1 bg-line" />
              </p>
            )}
            {messages.map((message, index) => (
              <MessageRow
                key={message.id}
                message={message}
                recien={recienLlegados.has(message.id)}
                previous={messages[index - 1]}
                mine={message.authorId === user?.id}
                onReply={() => setReplyTo(message)}
                onEdit={() => {
                  setEditing(message);
                  setDraft(message.body);
                }}
                onDelete={async () => {
                  if (!window.confirm("¿Eliminar el mensaje?")) return;
                  await api.delete(`/messages/${message.id}`);
                  setMessages((current) => current.filter((m) => m.id !== message.id));
                }}
              />
            ))}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-canvas/40 p-3">
        {error && (
          <p className="mb-2 flex items-center gap-1.5 text-xs text-danger">
            <AlertTriangle size={12} className="shrink-0" />
            {error}
          </p>
        )}

        {(replyTo || editing) && (
          <div className="devup-velo mb-2 flex items-center gap-2 rounded-lg border-l-2 border-accent bg-accent-soft/40 py-1.5 pl-2.5 pr-1.5 text-xs">
            {editing ? (
              <Pencil size={11} className="shrink-0 text-accent" />
            ) : (
              <CornerUpLeft size={11} className="shrink-0 text-accent" />
            )}
            <span className="min-w-0 flex-1 truncate text-muted">
              {editing ? (
                "Editando tu mensaje"
              ) : (
                <>
                  Respondiendo a <span className="text-ink">{replyTo?.authorName}</span>
                </>
              )}
            </span>
            <BotonIcono
              etiqueta="Cancelar"
              onClick={() => {
                setReplyTo(null);
                setEditing(null);
                setDraft("");
              }}
            >
              <X size={12} />
            </BotonIcono>
          </div>
        )}

        {/* La caja de escribir es un control, no un campo suelto: el borde
            rodea al texto y a sus mandos, y el foco enciende el conjunto. */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="rounded-xl border border-line bg-canvas/60 transition-[border-color,box-shadow]
            duration-200 focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_rgb(91_140_255/0.14)]"
        >
          <label className="sr-only" htmlFor="devup-redactor">
            Mensaje
          </label>
          <textarea
            id="devup-redactor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter envía, Mayúsculas+Enter hace salto de línea. Es lo que
              // espera cualquiera que venga de Slack o de Discord.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
              if (event.key === "Escape") {
                setEditing(null);
                setReplyTo(null);
                setDraft("");
              }
            }}
            rows={1}
            placeholder="Escribe un mensaje"
            // `field-sizing` hace que la caja crezca con el texto sin una línea
            // de JavaScript; donde no exista todavía, queda el tirador de
            // siempre y el `min-h`. Progresivo, no obligatorio.
            className="max-h-40 min-h-12 w-full resize-y bg-transparent px-3.5 py-3 text-sm
              leading-relaxed outline-none [field-sizing:content] placeholder:text-faint"
          />

          <div className="flex items-center justify-between gap-3 px-2.5 pb-2">
            <p className="hidden items-center gap-1 text-[10px] text-faint sm:flex">
              <Tecla>Enter</Tecla> envía
              <span className="px-0.5">·</span>
              <Tecla>Mayús</Tecla>+<Tecla>Enter</Tecla> salto de línea
            </p>
            <Boton
              type="submit"
              variante="primario"
              tamano="sm"
              disabled={draft.trim().length === 0}
              icono={<Send size={13} />}
            >
              {editing ? "Guardar" : "Enviar"}
            </Boton>
          </div>
        </form>
      </div>
    </Tarjeta>
  );
}

/** Tecla física, para las dos que hay que saberse de memoria. */
function Tecla({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-raised px-1 py-px font-mono text-[9px] text-muted">
      {children}
    </kbd>
  );
}

/**
 * Tintes de autor.
 *
 * Un color estable por persona es lo que permite seguir quién habla sin leer
 * los nombres — y tiene que salir del propio identificador, no de la posición
 * en la lista, o cambiaría al paginar hacia atrás. Solo tiñe la ficha de las
 * iniciales: teñir el nombre entero convierte la conversación en un arcoíris.
 */
const TINTES = [
  "border-accent/30 bg-accent-soft/60 text-accent-bright",
  "border-cyan/25 bg-cyan/10 text-cyan",
  "border-violet/25 bg-violet/10 text-violet",
  "border-live/25 bg-live/10 text-live",
  "border-warn/25 bg-warn/10 text-warn",
] as const;

function tinteDe(clave: string): string {
  let suma = 0;
  for (let i = 0; i < clave.length; i += 1) suma = (suma * 31 + clave.charCodeAt(i)) % 9973;
  return TINTES[suma % TINTES.length];
}

/** «Hoy» y «Ayer» se leen de un vistazo; una fecha completa hay que descifrarla. */
function etiquetaDia(fecha: Date): string {
  const hoy = new Date();
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);

  if (fecha.toDateString() === hoy.toDateString()) return "Hoy";
  if (fecha.toDateString() === ayer.toDateString()) return "Ayer";
  return fecha.getFullYear() === hoy.getFullYear()
    ? fecha.toLocaleDateString("es", { day: "numeric", month: "long" })
    : fecha.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
}

function MessageRow({
  message,
  recien,
  previous,
  mine,
  onReply,
  onEdit,
  onDelete,
}: {
  message: Message;
  /** Llegó DESPUÉS de abrir el canal, no es historia. */
  recien: boolean;
  previous: Message | undefined;
  mine: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const fecha = new Date(message.createdAt);

  // Un día nuevo siempre rompe el grupo: el separador ya cuenta que ha pasado
  // el tiempo, y dos mensajes a caballo de la medianoche no son una ráfaga.
  const nuevoDia = !previous || new Date(previous.createdAt).toDateString() !== fecha.toDateString();

  // Mensajes seguidos de la misma persona en pocos minutos se agrupan: repetir
  // el nombre en cada línea convierte una conversación en una lista.
  const grouped =
    !nuevoDia &&
    previous?.authorId === message.authorId &&
    fecha.getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;

  const hora = fecha.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  const tinte = tinteDe(message.authorId ?? message.authorName);

  return (
    <>
      {nuevoDia && (
        <p className="my-3 flex items-center gap-3 px-2">
          <span className="h-px flex-1 bg-line" />
          <Rotulo>{etiquetaDia(fecha)}</Rotulo>
          <span className="h-px flex-1 bg-line" />
        </p>
      )}

      <div
        className={`devup-velo group relative flex gap-3 rounded-xl px-2 py-1 transition-colors
          duration-150 hover:bg-raised/50 ${grouped ? "" : "mt-2.5"}
          ${recien ? "devup-llega" : ""}`}
      >
        <div className="w-8 shrink-0 pt-0.5">
          {grouped ? (
            <span className="block pt-0.5 text-right font-mono text-[10px] tabular-nums text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {hora}
            </span>
          ) : (
            <span
              className={`grid size-8 place-items-center rounded-xl border font-display text-[11px] font-semibold ${tinte}`}
            >
              {message.authorName.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {!grouped && (
            <p className="mb-0.5 flex items-baseline gap-2">
              <span className="text-sm font-semibold text-ink">{message.authorName}</span>
              <span className="font-mono text-[10px] tabular-nums text-faint">{hora}</span>
            </p>
          )}

          {message.replyPreview && (
            <p className="mb-1 flex items-center gap-1.5 truncate rounded-r-md border-l-2 border-accent/40 bg-accent/5 py-0.5 pl-2 pr-2 text-xs text-faint">
              <CornerUpLeft size={10} className="shrink-0 text-accent/70" />
              <span className="font-medium text-muted">{message.replyPreview.authorName}:</span>
              <span className="truncate">{message.replyPreview.body}</span>
            </p>
          )}

          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
            {message.body}
            {message.editedAt && (
              <span className="ml-1.5 align-baseline text-[10px] text-faint">(editado)</span>
            )}
          </p>

          {message.file && <Attachment file={message.file} />}
        </div>

        {/* Los mandos flotan sobre el canto superior de la fila, como en
            cualquier chat: dentro del flujo robarían ancho al texto en las
            cientos de filas donde nadie los va a usar. */}
        <div
          className="pointer-events-none absolute -top-3 right-2 flex items-center gap-0.5 rounded-xl
            border border-line-strong bg-elevated p-0.5 opacity-0 shadow-[var(--sombra-panel)]
            transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100
            group-hover:pointer-events-auto group-hover:opacity-100"
        >
          <BotonIcono etiqueta="Responder" onClick={onReply}>
            <CornerUpLeft size={13} />
          </BotonIcono>
          {mine && (
            <>
              <BotonIcono etiqueta="Editar" onClick={onEdit}>
                <Pencil size={13} />
              </BotonIcono>
              {/* El `!` gana al hover gris que trae el botón por defecto: en el
                  único mando que borra algo, el color tiene que avisar. */}
              <BotonIcono
                etiqueta="Eliminar"
                className="hover:text-danger!"
                onClick={() => void onDelete()}
              >
                <Trash2 size={13} />
              </BotonIcono>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Attachment({ file }: { file: NonNullable<Message["file"]> }) {
  return (
    <button
      type="button"
      onClick={async () => {
        const url = await downloadUrl(file.id, "inline");
        window.open(url, "_blank", "noopener");
      }}
      className="presionable group/adjunto mt-1.5 flex max-w-full items-center gap-2.5 rounded-xl
        border border-line bg-surface py-1.5 pl-1.5 pr-3 text-left hover:border-line-strong"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-raised text-faint">
        <Paperclip size={13} />
      </span>
      <span className="min-w-0 truncate text-xs text-muted group-hover/adjunto:text-ink">
        {file.name}
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
        {formatBytes(file.sizeBytes)}
      </span>
      <ExternalLink
        size={11}
        className="shrink-0 text-faint opacity-0 transition-opacity duration-150 group-hover/adjunto:opacity-100"
      />
    </button>
  );
}

/** Cuatro filas fantasma con la forma real de la conversación. */
function EsqueletoConversacion() {
  const anchos = ["w-3/5", "w-2/5", "w-4/5", "w-1/2"];
  return (
    <div className="space-y-4 px-2 py-2">
      {anchos.map((ancho, index) => (
        <div key={ancho} className="flex gap-3" style={{ opacity: 1 - index * 0.18 }}>
          <span className="devup-esqueleto size-8 shrink-0 rounded-xl" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="devup-esqueleto block h-2.5 w-24 rounded-lg" />
            <span className={`devup-esqueleto block h-3 rounded-lg ${ancho}`} />
          </span>
        </div>
      ))}
    </div>
  );
}
