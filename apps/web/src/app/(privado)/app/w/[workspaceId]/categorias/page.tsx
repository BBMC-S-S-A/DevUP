"use client";

import { Check, Loader2, Network, Pencil, Plus, Trash2, UserRound, Users, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  ApiError,
  type DetalleDeRama,
  type OrganizationMember,
  type Rama,
  api,
} from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useOrgId, useWorkspaceId } from "@/lib/workspace-context";
import { useRecurso } from "@/lib/datos";
import { iniciales } from "@/lib/fechas";

/**
 * Las ramas de trabajo de un espacio.
 *
 * ESTA PANTALLA ESTUVO MIRANDO LA TABLA EQUIVOCADA, y no se veía desde la
 * pantalla: se veía comparando dos ficheros. Se titulaba «las ramas de trabajo»
 * y por dentro trabajaba sobre `tags` —las etiquetas de la 0002, las de cruzar—
 * mientras que las ramas de verdad son `task_categories`: lo que lleva el
 * tablero, lo que crea `crear_area` desde el MCP y lo que el guión de reordenar
 * repartió entre Workflow, DevVerse y Funcionalidades. Dos tablas distintas con
 * dos listas distintas de nombres, y quien abría esto veía la que no era.
 *
 * Peor todavía: su selector de «Jefe de rama» escribía en `tags.owner_id`, que
 * la 0050 marcó como OBSOLETA con un comentario en la propia columna. Elegir un
 * jefe aquí no hacía absolutamente nada en ninguna otra parte del producto — se
 * guardaba, y no lo leía nadie.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRES PAPELES QUE SE LLAMAN PARECIDO Y NO SON EL MISMO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  · **GERENTE** — responde de la rama y REPARTE su trabajo. Puede no tener ni
 *    una tarea suya. Y son VARIOS (0050): con uno solo, unas vacaciones dejan la
 *    rama sin nadie que responda.
 *  · **DELEGADO** — quien hace la tarea. El responsable de siempre.
 *  · **QUIEN CARGA AHORA** — una cuenta, no un cargo: quién tiene tareas sin
 *    terminar. Dice dónde está el trabajo, no quién manda.
 *
 * Archivar una tarea en una rama NO asigna a nadie. Por eso «por repartir» es
 * una lista de verdad y no un adorno — es lo que el gerente viene a mirar.
 *
 * EL PANEL VA A LA DERECHA Y NO EN OTRA PANTALLA. Lo que contesta —qué espera
 * sin repartir, y quién ha andado por aquí— es lo que se pregunta MIENTRAS se
 * mira la lista. En una pantalla aparte habría que acordarse de ir, y a una
 * pantalla que hay que acordarse de abrir no va nadie.
 */
export default function CategoriasPage() {
  const orgId = useOrgId();
  const workspaceId = useWorkspaceId();

  const ramas = useRecurso<{ dias: number; ramas: Rama[] }>(
    `/workspaces/${workspaceId}/ramas?dias=7`,
  );
  const miembros = useRecurso<{ members: OrganizationMember[] }>(
    `/organizations/${orgId}/members`,
  );

  const lista = ramas.datos?.ramas ?? [];

  /** Qué rama está abierta en el panel de la derecha. */
  const [abierta, setAbierta] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  // La primera se abre sola: un panel vacío al entrar hace pensar que no hay
  // nada que ver, y lo que enseña es justo lo que se viene a buscar.
  const elegida = lista.find((r) => r.id === abierta) ?? lista[0] ?? null;

  return (
    <Pagina
      titulo="Ramas de trabajo"
      rotulo="de dónde cuelga cada cosa, y quién responde de ella"
      icono={<Network size={18} />}
      ancho="xl"
      acciones={
        lista.length > 0 && !creando ? (
          <Boton
            variante="fantasma"
            tamano="sm"
            icono={<Plus size={14} />}
            onClick={() => setCreando(true)}
          >
            Nueva rama
          </Boton>
        ) : null
      }
    >
      {ramas.error ? (
        <Fallo onReintentar={() => void ramas.recargar()}>{ramas.error}</Fallo>
      ) : ramas.cargando ? (
        <Cargando etiqueta="Cargando ramas" />
      ) : lista.length === 0 && !creando ? (
        <EstadoVacio
          icono={<Network size={20} />}
          titulo="Todavía no hay ninguna rama"
          pista="Una rama es de dónde cuelga el trabajo: «Frontend», «Infraestructura», «DevVerse». Cada tarea vive en una sola, y quien la gerencia responde de que avance."
          accion={
            <Boton variante="primario" tamano="sm" icono={<Plus size={14} />} onClick={() => setCreando(true)}>
              Crear la primera
            </Boton>
          }
        />
      ) : (
        /* Dos columnas en pantalla ancha, apiladas en móvil: el panel sigue
           siendo lo segundo que se lee, no algo que desaparece. */
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-2.5">
            {creando && (
              <NuevaRama
                workspaceId={workspaceId}
                onListo={() => {
                  setCreando(false);
                  void ramas.recargar();
                }}
                onCancelar={() => setCreando(false)}
              />
            )}
            {lista.map((rama) => (
              <FichaDeRama
                key={rama.id}
                rama={rama}
                abierta={elegida?.id === rama.id}
                miembros={miembros.datos?.members ?? []}
                onAbrir={() => setAbierta(rama.id)}
                onCambiada={() => void ramas.recargar()}
              />
            ))}
          </div>

          {elegida && <PanelDeRama rama={elegida} />}
        </div>
      )}
    </Pagina>
  );
}

// ---------------------------------------------------------------------------
// La ficha de una rama
// ---------------------------------------------------------------------------

function FichaDeRama({
  rama,
  abierta,
  miembros,
  onAbrir,
  onCambiada,
}: {
  rama: Rama;
  abierta: boolean;
  miembros: OrganizationMember[];
  onAbrir: () => void;
  onCambiada: () => void;
}) {
  const confirmar = useConfirmar();
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(rama.nombre);
  const [ocupado, setOcupado] = useState(false);

  const conError = (mensaje: string) => (fallo: unknown) =>
    toast.error(fallo instanceof ApiError ? fallo.message : mensaje);

  const renombrar = async () => {
    const limpio = nombre.trim();
    setEditando(false);
    if (!limpio || limpio === rama.nombre) {
      setNombre(rama.nombre);
      return;
    }
    setOcupado(true);
    try {
      await api.patch(`/categories/${rama.id}`, { name: limpio });
      onCambiada();
    } catch (fallo) {
      setNombre(rama.nombre);
      conError("no se pudo renombrar la rama")(fallo);
    } finally {
      setOcupado(false);
    }
  };

  /**
   * Poner y quitar gerentes, uno a uno.
   *
   * Y NO MANDANDO LA LISTA ENTERA, que era lo que hacía el selector viejo. El
   * gesto real es «añade a este» o «quita a este»; mandar la lista completa
   * convierte a dos personas editando a la vez en una que borra a la otra sin
   * enterarse.
   */
  const gerente = async (userId: string, poner: boolean) => {
    setOcupado(true);
    try {
      if (poner) await api.put(`/categories/${rama.id}/gerentes/${userId}`, {});
      else await api.delete(`/categories/${rama.id}/gerentes/${userId}`);
      onCambiada();
    } catch (fallo) {
      // Los dos rechazos no son el mismo, y se nota: 403 es «tú no puedes
      // nombrar aquí», 400 es «esa persona no está en este espacio». Un mismo
      // mensaje para los dos haría que invitar a alguien nuevo se leyera como
      // falta de permisos propios.
      conError("no se pudo cambiar quién gerencia la rama")(fallo);
    } finally {
      setOcupado(false);
    }
  };

  const borrar = async () => {
    const seguro = await confirmar({
      titulo: `¿Borrar la rama «${rama.nombre}»?`,
      // Decirlo quita el miedo que hace que nadie ordene nunca el tablero.
      descripcion:
        rama.pendientes > 0
          ? `Sus ${rama.pendientes} tarea(s) sin terminar NO se borran: se quedan sin rama, en el tablero, y se pueden volver a clasificar.`
          : "Sus tareas no se borran: se quedan sin rama y se pueden volver a clasificar.",
      accion: "Borrar la rama",
      peligro: true,
    });
    if (!seguro) return;
    setOcupado(true);
    try {
      await api.delete(`/categories/${rama.id}`);
      onCambiada();
    } catch (fallo) {
      conError("no se pudo borrar la rama")(fallo);
    } finally {
      setOcupado(false);
    }
  };

  const esGerente = (userId: string) => rama.gerentes.some((g) => g.id === userId);

  return (
    <Tarjeta
      className={`p-4 transition-colors ${
        abierta ? "border-accent/40 bg-accent-soft/10" : "hover:border-line-strong"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {editando ? (
          <input
            autoFocus
            value={nombre}
            maxLength={40}
            aria-label="Nombre de la rama"
            onChange={(e) => setNombre(e.target.value)}
            onBlur={() => void renombrar()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setNombre(rama.nombre);
                setEditando(false);
              }
            }}
            className="min-w-0 flex-1 rounded-lg border border-accent/50 bg-canvas px-2 py-1 text-sm font-semibold text-ink outline-none"
          />
        ) : (
          <>
            <button
              type="button"
              onClick={onAbrir}
              className="min-w-0 truncate text-left text-sm font-semibold text-ink hover:text-accent-bright"
            >
              {rama.nombre}
            </button>
            <button
              type="button"
              onClick={() => setEditando(true)}
              title="Renombrar la rama"
              aria-label={`Renombrar «${rama.nombre}»`}
              className="presionable shrink-0 rounded-lg p-0.5 text-line-strong transition-colors hover:text-muted"
            >
              {ocupado ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
            </button>
          </>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* POR REPARTIR VA PRIMERO Y EN TONO DE AVISO. Es lo único de esta
              fila sobre lo que hay que hacer algo hoy; lo demás es estado. */}
          {rama.porRepartir > 0 && <Chip tono="warn">{rama.porRepartir} por repartir</Chip>}
          {rama.pendientes > 0 && <Chip>{rama.pendientes} sin terminar</Chip>}
          {rama.cerradasReciente > 0 && (
            <Chip tono="live">
              <Check size={10} />
              {rama.cerradasReciente}
            </Chip>
          )}
          {rama.pendientes === 0 && rama.cerradasReciente === 0 && (
            <span className="text-[11px] text-faint">sin movimiento</span>
          )}
          <button
            type="button"
            onClick={() => void borrar()}
            title="Borrar la rama"
            aria-label={`Borrar «${rama.nombre}»`}
            className="presionable rounded-lg p-0.5 text-line-strong transition-colors hover:text-danger"
          >
            <Trash2 size={12} />
          </button>
        </span>
      </div>

      {/* LOS GERENTES, EN PLURAL Y EDITABLES AQUÍ MISMO.
          Van separados de todo lo demás a propósito: quien gerencia una rama
          REPARTE su trabajo, así que puede no tener ni una tarea suya y seguir
          respondiendo por ella. */}
      <div className="mt-3 border-t border-line pt-3">
        <div className="flex items-center gap-1.5">
          <UserRound size={11} className="text-faint" />
          <Rotulo>{rama.gerentes.length === 1 ? "Gerente" : "Gerentes"}</Rotulo>
          {rama.gerentes.length === 0 && (
            <span className="text-[11px] text-warn">nadie responde de esta rama</span>
          )}
        </div>

        <ul className="mt-2 flex flex-wrap gap-1.5">
          {rama.gerentes.map((g) => (
            <li
              key={g.id}
              className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent-soft/40 py-0.5 pl-1 pr-1.5"
            >
              <span
                aria-hidden
                className="grid size-5 shrink-0 place-items-center rounded-full border border-line-strong bg-raised font-display text-[9px] font-semibold text-muted"
              >
                {iniciales(g.nombre ?? "?")}
              </span>
              <span className="text-[11px] text-ink">{g.nombre ?? "alguien"}</span>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void gerente(g.id, false)}
                title={`Quitar a ${g.nombre ?? "esta persona"} como gerente`}
                aria-label={`Quitar a ${g.nombre ?? "esta persona"} como gerente de ${rama.nombre}`}
                className="presionable rounded p-0.5 text-faint transition-colors hover:text-danger"
              >
                <X size={11} />
              </button>
            </li>
          ))}

          <li>
            <select
              value=""
              disabled={ocupado}
              aria-label={`Añadir gerente a ${rama.nombre}`}
              onChange={(e) => {
                if (e.target.value) void gerente(e.target.value, true);
              }}
              className="rounded-lg border border-dashed border-line-strong bg-canvas/60 px-2 py-1 text-[11px] text-muted"
            >
              <option value="">+ añadir</option>
              {miembros
                .filter((m) => !esGerente(m.userId))
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
            </select>
          </li>
        </ul>
      </div>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// El panel de la derecha
// ---------------------------------------------------------------------------

/** Los verbos del registro, en castellano. Sin esto se leen como claves. */
const VERBOS: Record<string, string> = {
  creo: "creó",
  movio: "movió",
  cerro: "cerró",
  asigno: "asignó",
  edito: "editó",
  comento: "comentó",
  adjunto: "adjuntó",
};

function cuandoFue(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function PanelDeRama({ rama }: { rama: Rama }) {
  const detalle = useRecurso<DetalleDeRama & { dias: number }>(
    `/categories/${rama.id}/rama?dias=30`,
  );

  const porRepartir = detalle.datos?.porRepartir ?? [];
  const gente = detalle.datos?.quienHaTrabajado ?? [];

  return (
    <Tarjeta className="h-fit p-4 lg:sticky lg:top-4">
      <Rotulo className="block">Rama</Rotulo>
      <h2 className="mt-0.5 truncate text-base font-semibold">{rama.nombre}</h2>

      {detalle.error ? (
        <Fallo onReintentar={() => void detalle.recargar()}>{detalle.error}</Fallo>
      ) : detalle.cargando ? (
        <div className="mt-4 space-y-2" aria-busy="true">
          <div className="h-8 animate-pulse rounded-lg bg-line/50" />
          <div className="h-8 animate-pulse rounded-lg bg-line/30" />
        </div>
      ) : (
        <>
          {/* LO PRIMERO ES LO ÚNICO ACCIONABLE. Archivar en una rama no asigna
              a nadie, así que esto es trabajo parado esperando un nombre — y
              es exactamente a lo que viene el gerente. */}
          <section className="mt-4">
            <div className="flex items-center gap-1.5">
              <Rotulo>Por repartir</Rotulo>
              <span className="font-mono text-[10px] tabular-nums text-faint">
                {porRepartir.length}
              </span>
              <span className="h-px flex-1 bg-line/70" aria-hidden />
            </div>

            {porRepartir.length === 0 ? (
              <p className="mt-2 text-[11px] text-faint">
                Todo lo de esta rama tiene delegado.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {porRepartir.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-lg border border-warn/25 bg-warn/5 px-2.5 py-1.5"
                  >
                    <p className="truncate text-xs text-ink">{t.titulo}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-faint">{t.columna}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-4 border-t border-line pt-3">
            <div className="flex items-center gap-1.5">
              <Users size={11} className="text-faint" />
              <Rotulo>Quién ha trabajado aquí</Rotulo>
              <span className="h-px flex-1 bg-line/70" aria-hidden />
            </div>

            {gente.length === 0 ? (
              <p className="mt-2 text-[11px] text-faint">
                Nadie ha tocado nada de esta rama en {detalle.datos?.dias ?? 30} días.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {gente.map((p) => (
                  <li key={p.id} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-line-strong bg-raised font-display text-[9px] font-semibold text-muted"
                    >
                      {iniciales(p.nombre ?? "?")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-ink">{p.nombre ?? "alguien"}</p>
                      <p className="mt-0.5 text-[10px] text-faint">
                        {Object.entries(p.porVerbo)
                          .map(([verbo, veces]) => `${VERBOS[verbo] ?? verbo} ${veces}`)
                          .join(" · ")}
                        {" — "}
                        {cuandoFue(p.ultimaVez)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* EL MATIZ QUE LA FRASE CORTA ESCONDE, y sin él este panel se lee
                como una medida de esfuerzo que no es. Se dice aquí, donde se
                está mirando, y no en una ayuda que nadie abre. */}
            <p className="mt-3 text-[10px] leading-relaxed text-faint">
              Cuenta las tareas que HOY están en esta rama: mudar una tarea se
              lleva su historia con ella.
            </p>
          </section>
        </>
      )}
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// Crear una rama
// ---------------------------------------------------------------------------

function NuevaRama({
  workspaceId,
  onListo,
  onCancelar,
}: {
  workspaceId: string;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);

  const crear = async () => {
    const limpio = nombre.trim();
    if (!limpio) return;
    setGuardando(true);
    try {
      await api.post(`/workspaces/${workspaceId}/categories`, { name: limpio });
      onListo();
    } catch (fallo) {
      toast.error(fallo instanceof ApiError ? fallo.message : "no se pudo crear la rama");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Tarjeta className="devup-entrada p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void crear();
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          autoFocus
          value={nombre}
          maxLength={40}
          placeholder="Frontend, Infraestructura, DevVerse…"
          aria-label="Nombre de la rama nueva"
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancelar();
          }}
          className="min-w-0 flex-1 rounded-lg border border-accent/50 bg-canvas px-2.5 py-1.5 text-sm text-ink outline-none"
        />
        <Boton type="submit" variante="primario" tamano="sm" cargando={guardando} disabled={!nombre.trim()}>
          Crear
        </Boton>
        <Boton type="button" variante="fantasma" tamano="sm" onClick={onCancelar}>
          Cancelar
        </Boton>
      </form>
      {/* Se dice al crearla, que es cuando se decide mal: una rama no es una
          etiqueta, y quien espere poner dos en una tarea se va a llevar una
          sorpresa al archivarla. */}
      <p className="mt-2 text-[11px] text-faint">
        Cada tarea vive en UNA rama. Para lo que cruza —«urgente», «cliente X»—
        están las etiquetas.
      </p>
    </Tarjeta>
  );
}
