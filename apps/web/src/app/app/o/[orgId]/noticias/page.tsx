"use client";

import { ArrowLeft, Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { AreaTexto, Entrada } from "@/components/ui/Field";
import { Dialogo, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { type Announcement, type OrganizationMember, ApiError, api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useConfirmar } from "@/components/ui/Confirmar";

function retraso(indice: number): CSSProperties {
  return { "--retraso": `${Math.min(indice, 8) * 40}ms` } as CSSProperties;
}

/**
 * El sistema de noticias.
 *
 * Publicar y editar viven en «Administración» en el sentido de que solo los
 * ve quien administra la organización — no hay una pantalla aparte para eso,
 * los mandos aparecen o no en esta misma página según el rol. Leer es de
 * todo el equipo: el sentido de una noticia es que la vea quien no la
 * escribió, así que esconderla detrás de un permiso sería quitarle la mitad
 * del propósito.
 */
export default function AnnouncementsPage() {
  const confirmar = useConfirmar();
  const { orgId } = useParams<{ orgId: string }>();
  const { user } = useSession();

  const [items, setItems] = useState<Announcement[] | null>(null);
  const [administro, setAdministro] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Announcement | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ announcements }, { members }] = await Promise.all([
        api.get<{ announcements: Announcement[] }>(`/organizations/${orgId}/announcements`),
        api.get<{ members: OrganizationMember[] }>(`/organizations/${orgId}/members`),
      ]);
      setItems(announcements);
      const yo = members.find((m) => m.userId === user?.id);
      setAdministro(yo ? yo.role === "owner" || yo.role === "admin" : false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "no se pudo cargar");
    }
  }, [orgId, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen">
      <header className="filo-luz relative bg-surface/40">
        <div className="rejilla pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-2xl px-6 pb-7 pt-5">
          <div className="mt-5 flex items-center gap-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-line-strong bg-raised text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
              <Megaphone size={20} />
            </span>
            <div>
              <h1 className="text-xl font-semibold">Noticias</h1>
              <Rotulo className="mt-1 block">Lo que publica quien administra</Rotulo>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        {error && (
          <p className="mb-5 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        {administro && (
          <div className="mb-5">
            <NuevaNoticia
              orgId={orgId}
              onPublished={(noticia) => setItems((prev) => [noticia, ...(prev ?? [])])}
            />
          </div>
        )}

        {items === null ? (
          <div className="space-y-3">
            <div className="devup-esqueleto h-28 rounded-2xl" />
            <div className="devup-esqueleto h-28 rounded-2xl" />
          </div>
        ) : items.length === 0 ? (
          <EstadoVacio
            icono={<Megaphone size={20} />}
            titulo="Nada publicado todavía"
            pista={
              administro
                ? "Escribe la primera noticia arriba: todo el equipo la verá y recibirá un aviso."
                : "Cuando quien administra publique algo, aparecerá aquí."
            }
          />
        ) : (
          <div className="space-y-3">
            {items.map((noticia, indice) => (
              <NoticiaCard
                key={noticia.id}
                noticia={noticia}
                indice={indice}
                puedeEditar={administro}
                onEditar={() => setEditando(noticia)}
                onBorrar={async () => {
                  if (
                    !(await confirmar({
                      titulo: `¿Borrar «${noticia.title}»?`,
                      accion: "Borrar",
                      peligro: true,
                    }))
                  )
                    return;
                  try {
                    await api.delete(`/announcements/${noticia.id}`);
                    setItems((prev) => prev?.filter((n) => n.id !== noticia.id) ?? null);
                  } catch (caught) {
                    toast.error(caught instanceof ApiError ? caught.message : "no se pudo borrar");
                  }
                }}
              />
            ))}
          </div>
        )}
      </main>

      {editando && (
        <EditarNoticia
          noticia={editando}
          onCerrar={() => setEditando(null)}
          onGuardada={(actualizada) => {
            setItems((prev) => prev?.map((n) => (n.id === actualizada.id ? actualizada : n)) ?? null);
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}

function NoticiaCard({
  noticia,
  indice,
  puedeEditar,
  onEditar,
  onBorrar,
}: {
  noticia: Announcement;
  indice: number;
  puedeEditar: boolean;
  onEditar: () => void;
  onBorrar: () => void;
}) {
  return (
    <Tarjeta className="devup-entrada p-4" style={retraso(indice)}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{noticia.title}</h2>
          <p className="mt-0.5 text-[11px] text-faint">
            {noticia.authorName} ·{" "}
            {new Date(noticia.createdAt).toLocaleDateString("es", { day: "numeric", month: "long" })}
          </p>
        </div>
        {puedeEditar && (
          <div className="flex shrink-0 items-center gap-1">
            <BotonIcono etiqueta="Editar" onClick={onEditar}>
              <Pencil size={13} />
            </BotonIcono>
            <BotonIcono etiqueta="Borrar" onClick={onBorrar} className="hover:!text-danger">
              <Trash2 size={13} />
            </BotonIcono>
          </div>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{noticia.body}</p>
    </Tarjeta>
  );
}

function NuevaNoticia({
  orgId,
  onPublished,
}: {
  orgId: string;
  onPublished: (noticia: Announcement) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="presionable flex w-full items-center gap-2 rounded-xl border border-dashed border-line px-3.5 py-3 text-sm text-faint hover:border-accent/40 hover:bg-accent-soft/20 hover:text-muted"
      >
        <Plus size={15} />
        Publicar una noticia
      </button>
    );
  }

  return (
    <Tarjeta className="devup-emerge origin-top p-3.5">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            const { announcement } = await api.post<{ announcement: Announcement }>(
              `/organizations/${orgId}/announcements`,
              { title, body },
            );
            onPublished(announcement);
            toast.success("Noticia publicada — se avisó a toda la organización");
            setTitle("");
            setBody("");
            setAbierto(false);
          } catch (caught) {
            toast.error(caught instanceof ApiError ? caught.message : "no se pudo publicar");
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-2.5"
      >
        <Entrada
          autoFocus
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Título"
        />
        <AreaTexto
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          placeholder="Qué hay que saber"
        />
        <div className="flex items-center gap-1.5">
          <div className="flex-1">
            <Boton
              type="submit"
              variante="primario"
              cargando={busy}
              disabled={busy || title.trim().length === 0 || body.trim().length === 0}
              className="w-full"
            >
              Publicar
            </Boton>
          </div>
          <Boton type="button" variante="fantasma" onClick={() => setAbierto(false)}>
            Cancelar
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}

function EditarNoticia({
  noticia,
  onCerrar,
  onGuardada,
}: {
  noticia: Announcement;
  onCerrar: () => void;
  onGuardada: (noticia: Announcement) => void;
}) {
  const [title, setTitle] = useState(noticia.title);
  const [body, setBody] = useState(noticia.body);
  const [busy, setBusy] = useState(false);

  return (
    <Dialogo titulo="Editar noticia" onCerrar={onCerrar}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            const { announcement } = await api.patch<{ announcement: Announcement }>(
              `/announcements/${noticia.id}`,
              { title, body },
            );
            onGuardada(announcement);
            toast.success("Noticia actualizada");
          } catch (caught) {
            toast.error(caught instanceof ApiError ? caught.message : "no se pudo guardar");
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-2.5"
      >
        <Entrada
          autoFocus
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Título"
        />
        <AreaTexto
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
        />
        <div className="flex items-center gap-1.5 pt-1">
          <div className="flex-1">
            <Boton type="submit" variante="primario" cargando={busy} className="w-full">
              Guardar
            </Boton>
          </div>
          <Boton type="button" variante="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
}
