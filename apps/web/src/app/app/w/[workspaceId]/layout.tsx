"use client";

import { ArrowLeft, Files, Hash, Loader2, Lock, Plus, Volume2 } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError, type Channel, type Workspace, api } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const pathname = usePathname();
  const { user, signOut } = useSession();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [{ workspace }, { channels }] = await Promise.all([
        api.get<{ workspace: Workspace }>(`/workspaces/${workspaceId}`),
        api.get<{ channels: Channel[] }>(`/workspaces/${workspaceId}/channels`),
      ]);
      setWorkspace(workspace);
      setChannels(channels);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "no se pudo cargar el workspace");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="animate-spin text-faint" size={20} />
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <p className="mb-2 text-sm text-danger">{error ?? "workspace no encontrado"}</p>
          <Link href="/app" className="text-xs text-muted underline">
            Volver
          </Link>
        </div>
      </div>
    );
  }

  const voice = channels.filter((c) => c.kind === "voice");
  const text = channels.filter((c) => c.kind === "text");

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-surface">
        <div className="border-b border-line px-4 py-4">
          <Link
            href="/app"
            className="mb-3 flex items-center gap-1.5 text-xs text-faint transition hover:text-muted"
          >
            <ArrowLeft size={13} />
            Workspaces
          </Link>
          <h1 className="truncate text-sm font-semibold">{workspace.name}</h1>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-2 py-4">
          <Link
            href={`/app/w/${workspaceId}`}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition ${
              pathname === `/app/w/${workspaceId}`
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-raised hover:text-ink"
            }`}
          >
            <Files size={15} />
            Biblioteca
          </Link>

          <ChannelGroup
            title="Voz"
            channels={voice}
            workspaceId={workspaceId}
            pathname={pathname}
          />
          {text.length > 0 && (
            <ChannelGroup
              title="Texto"
              channels={text}
              workspaceId={workspaceId}
              pathname={pathname}
              disabled
            />
          )}

          <NewChannel workspaceId={workspaceId} onCreated={load} />
        </nav>

        <div className="border-t border-line px-4 py-3">
          <p className="truncate text-xs text-muted">{user?.displayName}</p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-1 text-xs text-faint transition hover:text-danger"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

function ChannelGroup({
  title,
  channels,
  workspaceId,
  pathname,
  disabled = false,
}: {
  title: string;
  channels: Channel[];
  workspaceId: string;
  pathname: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <h2 className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
        {title}
      </h2>
      <ul className="space-y-0.5">
        {channels.map((channel) => {
          const href = `/app/w/${workspaceId}/c/${channel.id}`;
          const active = pathname === href;
          const content = (
            <>
              {channel.kind === "voice" ? <Volume2 size={15} /> : <Hash size={15} />}
              <span className="min-w-0 flex-1 truncate">{channel.name}</span>
              {channel.isPrivate && <Lock size={11} className="shrink-0 text-faint" />}
            </>
          );

          return (
            <li key={channel.id}>
              {disabled ? (
                // Los canales de texto existen en el esquema pero la mensajería
                // no entra en esta iteración. Se enseñan apagados en vez de
                // ocultarlos: así se ve que el canal está creado.
                <span
                  title="La mensajería llega en una iteración posterior"
                  className="flex cursor-not-allowed items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-faint/60"
                >
                  {content}
                </span>
              ) : (
                <Link
                  href={href}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${
                    active ? "bg-accent-soft text-accent" : "text-muted hover:bg-raised hover:text-ink"
                  }`}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NewChannel({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-faint transition hover:bg-raised hover:text-muted"
      >
        <Plus size={15} />
        Nuevo canal
      </button>
    );
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await api.post(`/workspaces/${workspaceId}/channels`, {
            name,
            kind: "voice",
            isPrivate,
          });
          setName("");
          setIsPrivate(false);
          setOpen(false);
          await onCreated();
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-2 px-2.5"
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="nombre-del-canal"
        className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus:border-accent/60"
      />
      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(event) => setIsPrivate(event.target.checked)}
          className="accent-[var(--color-accent)]"
        />
        Privado
      </label>
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={busy || name.trim().length === 0}
          className="flex-1 rounded-lg bg-accent px-2 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
        >
          Crear
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-line px-2 py-1.5 text-xs text-muted"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
