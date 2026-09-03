"use client";

import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { retraso } from "@/lib/animacion";
import { AreaTexto, Entrada } from "@/components/ui/Field";
import { Dialogo, EstadoVacio, Tarjeta } from "@/components/ui/Superficies";
import type { Announcement, OrganizationMember } from "@/lib/api";
import { ApiError, api, sembrar, useRecurso } from "@/lib/datos";
import { useSession } from "@/lib/session";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Fallo, Pagina } from "@/components/ui/Pagina";

// `retraso` vivía aquí duplicado. Ahora es de `@/lib/animacion`, y el paso va
// explícito porque aquí siempre fue 40 ms y no los 35 de la barra.

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

  const [editando, setEditando] = useState<Announcement | null>(null);

  // Dos recursos y no uno: los miembros los piden también ajustes y el tablero
  // de tareas, así que pedirlos por su propia clave hace que los tres compartan
  // la misma respuesta en vez de traerla tres veces. Es lo que la caché existe
  // para hacer, y no funciona si cada pantalla los envuelve en una clave suya.
  const noticias = useRecurso<{ announcements: Announcement[] }>(
    `/organizations/${orgId}/announcements`,
  );
  const miembros = useRecurso<{ members: OrganizationMember[] }>(
    `/organizations/${orgId}/members`,
  );

  const items = noticias.datos?.announcements ?? null;
  const error = noticias.error ?? miembros.error;
  const yo = miembros.datos?.members.find((m) => m.userId === user?.id);
  const administro = yo ? yo.role === "owner" || yo.role === "admin" : false;
  const clave = `/organizations/${orgId}/announcements`;

  return (
    <>
      <Pagina
        titulo="Noticias"
        rotulo="Lo que publica quien administra"
        icono={<Megaphone size={20} />}
        ancho="sm"
      >
        {error && (
          <Fallo className="mb-5" onReintentar={() => void noticias.recargar()}>
            {error}
          </Fallo>
        )}

        {administro && (
          <div className="mb-5">
            <NuevaNoticia
              orgId={orgId}
                            onPublished={(noticia) =>
                sembrar(clave, { announcements: [noticia, ...(items ?? [])] })
              }
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
                    sembrar(clave, {
                      announcements: (items ?? []).filter((n) => n.id !== noticia.id),
                    });
                  } catch (caught) {
                    toast.error(caught instanceof ApiError ? caught.message : "no se pudo borrar");
                  }
                }}
              />
            ))}
          </div>
        )}
      </Pagina>

      {editando && (
        <EditarNoticia
          noticia={editando}
          onCerrar={() => setEditando(null)}
          onGuardada={(actualizada) => {
            sembrar(clave, {
              announcements: (items ?? []).map((n) =>
                n.id === actualizada.id ? actualizada : n,
              ),
            });
            setEditando(null);
          }}
        />
      )}
    </>
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
    <Tarjeta className="devup-entrada p-4" style={retraso(indice, 40)}>
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
