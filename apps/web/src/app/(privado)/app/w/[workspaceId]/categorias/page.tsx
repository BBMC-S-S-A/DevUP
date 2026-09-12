"use client";

import { Check, Loader2, Network, Pencil, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, type BoardColumn, type Tag, api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useOrgId, useWorkspaceId } from "@/lib/workspace-context";
import { useRecurso } from "@/lib/datos";
import { iniciales } from "@/lib/fechas";
import { RedDeTrabajo } from "@/components/categorias/RedDeTrabajo";

/**
 * Las categorías como ramas de trabajo, no como etiquetas de color.
 *
 * DE DÓNDE SALE. Las categorías son las etiquetas que ya existían (`tags`,
 * migración 0002), y desde el filtro del tablero sirven para quedarse con un
 * área. Lo que faltaba era poder tratarlas como ramas: cambiarles el nombre sin
 * perder lo que llevan, y ver de un vistazo quién anda en cada una.
 *
 * RENOMBRAR NO ERA POSIBLE, y pesaba. La única salida para una errata era
 * borrar la categoría — y borrarla se lleva por delante su vínculo con todas
 * las tareas y archivos que la llevaban. Perder trabajo por arreglar una letra.
 *
 * QUIÉN ANDA EN CADA UNA: lo que se puede contestar HOY es quién tiene tareas
 * de esa categoría, y cuántas le quedan sin terminar. No es lo mismo que quién
 * ha trabajado en ella —para eso hace falta el registro de actividad, que
 * todavía no existe— y por eso el rótulo dice «quién la lleva» y no «quién ha
 * trabajado». Decirlo mal aquí sería inventarse un dato que nadie ha medido.
 *
 * EL JEFE DE RAMA TAMPOCO ESTÁ TODAVÍA: `tags` no tiene columna para él, y eso
 * es una migración. Está delegado como tarea. Mientras tanto, quien más tareas
 * lleva sale primero, que es la aproximación honesta.
 */
export default function CategoriasPage() {
  const orgId = useOrgId();
  const workspaceId = useWorkspaceId();

  const etiquetas = useRecurso<{ tags: Tag[] }>(`/organizations/${orgId}/tags`);
  const tablero = useRecurso<{ columns: BoardColumn[] }>(`/workspaces/${workspaceId}/board`);

  const columnas = tablero.datos?.columns ?? [];
  const lista = etiquetas.datos?.tags ?? [];

  /** Qué categorías están señaladas en la red. Vacío = todas por igual. */
  const [senaladas, setSenaladas] = useState<string[]>([]);

  return (
    <Pagina
      titulo="Categorías"
      rotulo="las ramas de trabajo de este espacio"
      icono={<Network size={18} />}
      ancho="xl"
    >
      {etiquetas.error ? (
        <Fallo onReintentar={() => void etiquetas.recargar()}>{etiquetas.error}</Fallo>
      ) : etiquetas.cargando || tablero.cargando ? (
        <Cargando etiqueta="Cargando categorías" />
      ) : lista.length === 0 ? (
        <EstadoVacio
          icono={<Network size={20} />}
          titulo="Todavía no hay ninguna categoría"
          pista="Se crean desde el tablero, en la barra de categorías. Sirven para separar áreas de trabajo y filtrar por ellas."
        />
      ) : (
        <div className="space-y-4">
          {/* LA RED PRIMERO. Es lo que contesta «cómo está repartido esto» de
              un vistazo; la lista de abajo es para cambiar una rama concreta.
              Poner la lista arriba haría que el mapa solo lo viera quien se
              desplaza. */}
          <Tarjeta className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <Rotulo className="mr-1">Red de trabajo</Rotulo>
              <button
                type="button"
                onClick={() => setSenaladas([])}
                aria-pressed={senaladas.length === 0}
                className={`presionable rounded-lg border px-2 py-0.5 text-[11px] transition-colors ${
                  senaladas.length === 0
                    ? "border-accent/50 bg-accent-soft/60 text-accent-bright"
                    : "border-line text-faint hover:text-muted"
                }`}
              >
                Todas
              </button>
              {lista.map((tag) => {
                const activa = senaladas.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() =>
                      setSenaladas((previas) =>
                        previas.includes(tag.id)
                          ? previas.filter((x) => x !== tag.id)
                          : [...previas, tag.id],
                      )
                    }
                    aria-pressed={activa}
                    className={`presionable rounded-lg border px-2 py-0.5 text-[11px] transition-colors ${
                      activa
                        ? "border-accent/50 bg-accent-soft/60 text-accent-bright"
                        : "border-line text-muted hover:border-line-strong"
                    }`}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>

            <RedDeTrabajo columnas={columnas} tags={lista} elegidas={senaladas} />
          </Tarjeta>

          <div className="space-y-2.5">
            {lista.map((tag) => (
              <Rama
                key={tag.id}
                tag={tag}
                columnas={columnas}
                onCambiada={() => void etiquetas.recargar()}
              />
            ))}
          </div>
        </div>
      )}
    </Pagina>
  );
}

/** Una categoría con lo que lleva dentro y quién la lleva. */
function Rama({
  tag,
  columnas,
  onCambiada,
}: {
  tag: Tag;
  columnas: BoardColumn[];
  onCambiada: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(tag.name);
  const [guardando, setGuardando] = useState(false);

  // Las tareas de esta categoría, separadas por si su columna termina algo.
  const suyas = columnas.flatMap((c) =>
    c.tasks.filter((t) => t.tags.some((g) => g.id === tag.id)).map((t) => ({ t, terminal: c.isTerminal })),
  );
  const pendientes = suyas.filter((x) => !x.terminal);
  const hechas = suyas.filter((x) => x.terminal);

  // Quién la lleva: por tareas SIN TERMINAR, que es lo que dice dónde está el
  // trabajo ahora. Contar las cerradas mezclaría «quién la lleva» con «quién la
  // llevó», y son dos preguntas distintas.
  const porPersona = new Map<string, { nombre: string; cuantas: number }>();
  for (const { t } of pendientes) {
    if (!t.assigneeId || !t.assigneeName) continue;
    const previo = porPersona.get(t.assigneeId);
    porPersona.set(t.assigneeId, {
      nombre: t.assigneeName,
      cuantas: (previo?.cuantas ?? 0) + 1,
    });
  }
  const gente = [...porPersona.values()].sort((a, b) => b.cuantas - a.cuantas);
  const sinDueno = pendientes.filter((x) => !x.t.assigneeId).length;

  const guardar = async () => {
    const limpio = nombre.trim();
    setEditando(false);
    if (!limpio || limpio === tag.name) {
      setNombre(tag.name);
      return;
    }
    setGuardando(true);
    try {
      await api.patch(`/tags/${tag.id}`, { name: limpio });
      onCambiada();
    } catch (e) {
      setNombre(tag.name);
      toast.error(e instanceof ApiError ? e.message : "no se pudo renombrar la categoría");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Tarjeta className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        {editando ? (
          <input
            autoFocus
            value={nombre}
            maxLength={40}
            aria-label="Nombre de la categoría"
            onChange={(e) => setNombre(e.target.value)}
            onBlur={() => void guardar()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setNombre(tag.name);
                setEditando(false);
              }
            }}
            className="min-w-0 flex-1 rounded-lg border border-accent/50 bg-canvas px-2 py-1 text-sm font-semibold text-ink outline-none"
          />
        ) : (
          <>
            <h2 className="text-sm font-semibold text-ink">{tag.name}</h2>
            <button
              type="button"
              onClick={() => setEditando(true)}
              title="Renombrar la categoría"
              aria-label={`Renombrar «${tag.name}»`}
              className="presionable shrink-0 rounded-lg p-0.5 text-line-strong transition-colors hover:text-muted"
            >
              {guardando ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
            </button>
          </>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {pendientes.length > 0 && <Chip tono="warn">{pendientes.length} sin terminar</Chip>}
          {hechas.length > 0 && (
            <Chip tono="live">
              <Check size={10} />
              {hechas.length}
            </Chip>
          )}
          {suyas.length === 0 && <span className="text-[11px] text-faint">sin tareas todavía</span>}
        </span>
      </div>

      {(gente.length > 0 || sinDueno > 0) && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex items-center gap-1.5">
            <Users size={11} className="text-faint" />
            {/* «Quién la lleva» y no «quién ha trabajado»: lo que se puede
                contestar hoy es quién tiene tareas asignadas sin terminar. Lo
                segundo pide el registro de actividad, que está delegado. */}
            <Rotulo>Quién la lleva</Rotulo>
          </div>

          <ul className="mt-2 flex flex-wrap gap-1.5">
            {gente.map((p) => (
              <li
                key={p.nombre}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-canvas/60 py-0.5 pl-1 pr-2"
              >
                <span
                  aria-hidden
                  className="grid size-5 shrink-0 place-items-center rounded-full border border-line-strong bg-raised font-display text-[9px] font-semibold text-muted"
                >
                  {iniciales(p.nombre)}
                </span>
                <span className="text-[11px] text-muted">{p.nombre}</span>
                <span className="font-mono text-[10px] tabular-nums text-faint">{p.cuantas}</span>
              </li>
            ))}
            {sinDueno > 0 && (
              <li className="rounded-lg border border-dashed border-line-strong px-2 py-0.5 text-[11px] text-faint">
                {sinDueno} sin responsable
              </li>
            )}
          </ul>
        </div>
      )}
    </Tarjeta>
  );
}
