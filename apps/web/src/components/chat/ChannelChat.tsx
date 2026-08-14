"use client";

import { CornerUpLeft, Loader2, Paperclip, Pencil, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
 */
export function ChannelChat({ channelId }: { channelId: string }) {
  const { user } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
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
    <div className="flex h-[32rem] flex-col rounded-2xl border border-line bg-surface/60">
      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (el.scrollTop < 40) void loadOlder();
        }}
        className="flex-1 space-y-1 overflow-y-auto px-4 py-4"
      >
        {loading ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="animate-spin text-faint" size={18} />
          </div>
        ) : messages.length === 0 ? (
          <p className="grid h-full place-items-center text-sm text-faint">
            Aquí no ha escrito nadie todavía.
          </p>
        ) : (
          <>
            {loadingMore && (
              <p className="pb-2 text-center text-xs text-faint">Cargando anteriores…</p>
            )}
            {messages.map((message, index) => (
              <MessageRow
                key={message.id}
                message={message}
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

      <div className="border-t border-line p-3">
        {error && <p className="mb-2 text-xs text-danger">{error}</p>}

        {(replyTo || editing) && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-raised px-3 py-1.5 text-xs text-muted">
            <CornerUpLeft size={12} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {editing ? "Editando tu mensaje" : `Respondiendo a ${replyTo?.authorName}`}
            </span>
            <button
              type="button"
              onClick={() => {
                setReplyTo(null);
                setEditing(null);
                setDraft("");
              }}
              className="text-faint hover:text-ink"
            >
              <X size={13} />
            </button>
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="flex items-end gap-2"
        >
          <textarea
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
            className="max-h-32 min-h-10 flex-1 resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-accent/60"
          />
          <button
            type="submit"
            disabled={draft.trim().length === 0}
            className="rounded-lg bg-accent p-2.5 text-canvas transition hover:brightness-110 disabled:opacity-40"
            aria-label="Enviar"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  previous,
  mine,
  onReply,
  onEdit,
  onDelete,
}: {
  message: Message;
  previous: Message | undefined;
  mine: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  // Mensajes seguidos de la misma persona en pocos minutos se agrupan: repetir
  // el nombre en cada línea convierte una conversación en una lista.
  const grouped =
    previous?.authorId === message.authorId &&
    new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;

  const hora = new Date(message.createdAt).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`group flex gap-3 rounded-lg px-2 py-1 hover:bg-raised/60 ${grouped ? "" : "mt-3"}`}>
      <div className="w-9 shrink-0 pt-0.5">
        {grouped ? (
          <span className="hidden text-[10px] text-faint group-hover:block">{hora}</span>
        ) : (
          <span className="grid size-8 place-items-center rounded-full bg-raised text-[11px] text-muted">
            {message.authorName.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped && (
          <p className="mb-0.5 flex items-baseline gap-2">
            <span className="text-sm font-medium">{message.authorName}</span>
            <span className="text-[10px] text-faint">{hora}</span>
          </p>
        )}

        {message.replyPreview && (
          <p className="mb-1 flex items-center gap-1.5 truncate border-l-2 border-line pl-2 text-xs text-faint">
            <CornerUpLeft size={10} className="shrink-0" />
            <span className="font-medium">{message.replyPreview.authorName}:</span>
            {message.replyPreview.body}
          </p>
        )}

        <p className="whitespace-pre-wrap break-words text-sm text-ink">
          {message.body}
          {message.editedAt && <span className="ml-1.5 text-[10px] text-faint">(editado)</span>}
        </p>

        {message.file && <Attachment file={message.file} />}
      </div>

      <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={onReply}
          title="Responder"
          className="rounded p-1 text-faint hover:text-ink"
        >
          <CornerUpLeft size={13} />
        </button>
        {mine && (
          <>
            <button
              type="button"
              onClick={onEdit}
              title="Editar"
              className="rounded p-1 text-faint hover:text-ink"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              onClick={() => void onDelete()}
              title="Eliminar"
              className="rounded p-1 text-faint hover:text-danger"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
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
      className="mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted transition hover:border-line-strong hover:text-ink"
    >
      <Paperclip size={13} />
      {file.name}
      <span className="text-faint">{formatBytes(file.sizeBytes)}</span>
    </button>
  );
}
