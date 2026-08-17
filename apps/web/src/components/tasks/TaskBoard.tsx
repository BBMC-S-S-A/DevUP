"use client";

import { AlertTriangle, CalendarClock, KanbanSquare, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  type BoardColumn,
  type OrganizationMember,
  type Tag,
  type Task,
  api,
} from "@/lib/api";
import { TagBadge } from "@/components/files/TagBadge";
import { Boton } from "@/components/ui/Boton";
import { Dialogo, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * La fecha se parte a mano en vez de pasarla por `Date`: `new Date("2026-08-17")`
 * es medianoche UTC, así que al oeste de Greenwich un vencimiento se mostraría
 * el día anterior. Aquí solo se lee el trozo de calendario que llega y no se
 * reinterpreta nada.
 */
function fechaCorta(iso: string, anioActual: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  const nombre = MESES[Number(mes) - 1];
  if (!nombre || !dia) return iso;
  return `${Number(dia)} ${nombre}${anio === anioActual ? "" : ` ${anio.slice(2)}`}`;
}

/** Hoy en calendario local, en el mismo formato que llega del servidor. */
function hoyLocal(): string {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

/**
 * Dos letras del responsable. En una tarjeta de 300 px el nombre completo se
 * corta casi siempre; el disco con las iniciales es lo que de verdad se
 * reconoce de un vistazo, y el nombre queda al lado para desempatar.
 */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).slice(0, 2);
  return partes.map((parte) => parte[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Tono del vencimiento: vencido grita, hoy avisa, el resto solo informa. */
function tonoVencimiento(dueDate: string, hoy: string): string {
  const dia = dueDate.slice(0, 10);
  if (dia < hoy) return "border-danger/40 bg-danger/10 text-danger";
  if (dia === hoy) return "border-warn/40 bg-warn/10 text-warn";
  return "border-line text-muted";
}

/**
 * Tablero de tareas del workspace.
 *
 * El arrastre va con la API nativa de HTML5 en vez de una librería: mover
 * tarjetas entre columnas es lo único que hace falta, y una dependencia más
 * para eso no se paga sola.
 *
 * Al soltar se actualiza el estado local antes de llamar a la API. Si la
 * llamada falla se recarga el tablero entero y la tarjeta vuelve a su sitio:
 * es más honesto que dejarla donde el usuario la soltó fingiendo que se
 * guardó.
 *
 * Lo visual del arrastre se apoya en tres señales y no en una: la tarjeta que
 * viaja se levanta, la columna de destino enciende su borde, y una línea de luz
 * marca el hueco exacto donde va a caer. Esa última es la única forma de que la
 * posición entre dos tarjetas —lo que el servidor guarda como posición
 * fraccional— sea algo que se vea antes de soltar y no una sorpresa después.
 */
export function TaskBoard({
  workspaceId,
  organizationId,
}: {
  workspaceId: string;
  organizationId: string;
}) {
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Task | null>(null);
  const dragging = useRef<{ taskId: string; fromColumn: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Estado puramente visual del arrastre: qué tarjeta está en el aire y detrás
  // de cuál caería si se soltara ahora. No interviene en el movimiento — eso lo
  // sigue decidiendo `dragging` y el `afterTaskId` que se pasa a `drop`.
  const [enElAire, setEnElAire] = useState<string | null>(null);
  const [huecoTras, setHuecoTras] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [board, memberList, tagList] = await Promise.all([
        api.get<{ columns: BoardColumn[] }>(`/workspaces/${workspaceId}/board`),
        api.get<{ members: OrganizationMember[] }>(`/organizations/${organizationId}/members`),
        api.get<{ tags: Tag[] }>(`/organizations/${organizationId}/tags`),
      ]);
      setColumns(board.columns);
      setMembers(memberList.members);
      setTags(tagList.tags);
      setError(null);
    } catch {
      setError("no se pudo cargar el tablero");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const drop = async (columnId: string, afterTaskId: string | null) => {
    const info = dragging.current;
    dragging.current = null;
    setDropTarget(null);
    setEnElAire(null);
    setHuecoTras(null);
    if (!info) return;

    // Movimiento optimista: la tarjeta salta donde se soltó y la petición va
    // detrás.
    setColumns((current) => {
      const task = current.flatMap((c) => c.tasks).find((t) => t.id === info.taskId);
      if (!task) return current;
      return current.map((column) => {
        const without = column.tasks.filter((t) => t.id !== info.taskId);
        if (column.id !== columnId) return { ...column, tasks: without };
        const index = afterTaskId ? without.findIndex((t) => t.id === afterTaskId) + 1 : 0;
        return {
          ...column,
          tasks: [...without.slice(0, index), { ...task, columnId }, ...without.slice(index)],
        };
      });
    });

    try {
      await api.post(`/tasks/${info.taskId}/move`, { columnId, afterTaskId });
    } catch {
      setError("no se pudo mover la tarjeta");
      await load();
    }
  };

  if (loading) return <TableroEsqueleto />;

  const hoy = hoyLocal();
  const anioActual = hoy.slice(0, 4);
  // El medidor de cada columna se lee contra la columna más cargada: dice de un
  // vistazo dónde se está acumulando el trabajo, que es la pregunta que se le
  // hace a un tablero desde lejos.
  const carga = columns.reduce((maximo, columna) => Math.max(maximo, columna.tasks.length), 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {error && (
        <p className="flex shrink-0 items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertTriangle size={13} className="shrink-0" />
          {error}
        </p>
      )}

      {columns.length === 0 ? (
        <EstadoVacio
          icono={<KanbanSquare size={20} />}
          titulo="El tablero está vacío"
          pista="Una columna es un estado por el que pasa el trabajo: pendiente, en curso, hecho. Empieza por uno."
          accion={<NewColumn workspaceId={workspaceId} onCreated={load} compacto />}
        />
      ) : (
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2">
          {columns.map((column, indice) => {
            const sobrevolada = dropTarget === column.id;

            return (
              <Tarjeta
                key={column.id}
                viva={sobrevolada}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropTarget(column.id);
                  setHuecoTras(null);
                }}
                onDragLeave={() =>
                  setDropTarget((current) => (current === column.id ? null : current))
                }
                onDrop={(event) => {
                  event.preventDefault();
                  void drop(column.id, null);
                }}
                className="devup-entrada relative flex h-full w-[19rem] shrink-0 flex-col overflow-hidden"
                style={{ "--retraso": `${Math.min(indice, 8) * 50}ms` } as CSSProperties}
              >
                {/* El lavado de acento sobre toda la columna al sobrevolarla:
                    el borde solo se ve por los cantos y con seis columnas en
                    pantalla hace falta que el destino se reconozca de golpe. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-accent/[0.07] transition-opacity duration-[var(--dur-hover)] ease-[var(--ease-out)] motion-reduce:transition-none"
                  style={{ opacity: sobrevolada ? 1 : 0 }}
                />

                <header className="relative flex items-center gap-2 px-3.5 pb-2.5 pt-3">
                  <span
                    aria-hidden
                    className={`size-1.5 shrink-0 rounded-full transition-colors duration-[var(--dur-hover)] ${
                      sobrevolada ? "bg-accent" : "bg-line-strong"
                    }`}
                  />
                  <h3 className="min-w-0 flex-1 truncate font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                    {column.name}
                  </h3>
                  <span className="shrink-0 rounded-lg border border-line bg-canvas/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted">
                    {column.tasks.length}
                  </span>
                </header>

                {/* Medidor de carga. Se escala en lugar de cambiar de ancho:
                    animar `width` obliga al navegador a recalcular la columna
                    entera en cada fotograma. */}
                <div className="relative h-0.5 w-full shrink-0 bg-line/60">
                  <div
                    className="h-full origin-left bg-gradient-to-r from-accent to-cyan transition-transform duration-[var(--dur-panel)] ease-[var(--ease-out)] motion-reduce:transition-none"
                    style={{ transform: `scaleX(${carga ? column.tasks.length / carga : 0})` }}
                  />
                </div>

                <ul className="relative min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 py-2.5">
                  {column.tasks.length === 0 && (
                    <li
                      className={`grid h-20 place-items-center rounded-xl border border-dashed text-[11px] transition-colors duration-[var(--dur-hover)] ${
                        sobrevolada ? "border-accent/50 text-accent" : "border-line text-faint"
                      }`}
                    >
                      {sobrevolada ? "Soltar aquí" : "Sin tareas"}
                    </li>
                  )}

                  {column.tasks.map((task, posicion) => {
                    const viajando = enElAire === task.id;
                    // Soltar sobre la columna (y no sobre una tarjeta) mete la
                    // tarea al principio: la marca va encima de la primera.
                    const marcaArriba = sobrevolada && huecoTras === null && posicion === 0;
                    const marcaAbajo = sobrevolada && huecoTras === task.id && !viajando;

                    return (
                      <li
                        key={task.id}
                        draggable
                        onDragStart={() => {
                          dragging.current = { taskId: task.id, fromColumn: column.id };
                          // El navegador saca la foto del fantasma en cuanto
                          // termina este manejador. Si la tarjeta ya estuviera
                          // atenuada, el fantasma saldría atenuado también:
                          // se espera al siguiente fotograma.
                          requestAnimationFrame(() => setEnElAire(task.id));
                        }}
                        onDragEnd={() => {
                          setEnElAire(null);
                          setHuecoTras(null);
                        }}
                        onDrop={(event) => {
                          // Soltar sobre una tarjeta la coloca justo debajo de ella;
                          // sin esto solo se podría añadir al principio de la columna.
                          event.preventDefault();
                          event.stopPropagation();
                          void drop(column.id, task.id);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          // Se corta la propagación para que el manejador de la
                          // columna no borre el hueco justo después; a cambio,
                          // el destino se marca aquí mismo.
                          event.stopPropagation();
                          setDropTarget(column.id);
                          setHuecoTras(task.id);
                        }}
                        className="devup-entrada relative"
                      >
                        {marcaArriba && <Hueco lado="arriba" />}

                        <button
                          type="button"
                          onClick={() => setOpen(task)}
                          // Sin `presionable`: su hundido del 3 % se dispara
                          // mientras se arrastra (el botón sigue :active) y
                          // pelearía con el levantado, que es la señal que
                          // importa aquí.
                          className={`panel block w-full cursor-grab rounded-xl p-2.5 text-left
                            transition-[transform,opacity,filter] duration-[var(--dur-hover)] ease-[var(--ease-out)]
                            hover:brightness-125 active:cursor-grabbing motion-reduce:transition-none
                            ${viajando ? "panel-vivo scale-[1.03] opacity-45" : ""}`}
                        >
                          <span className="block text-[13px] font-medium leading-snug text-ink">
                            {task.title}
                          </span>

                          {task.tags.length > 0 && (
                            <span className="mt-2 flex flex-wrap gap-1">
                              {task.tags.map((tag) => (
                                <TagBadge key={tag.id} tag={tag} />
                              ))}
                            </span>
                          )}

                          {(task.assigneeName || task.dueDate) && (
                            <span className="mt-2.5 flex items-center gap-2">
                              {task.assigneeName && (
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="grid size-5 shrink-0 place-items-center rounded-full border border-line-strong bg-elevated font-display text-[9px] font-semibold text-muted">
                                    {iniciales(task.assigneeName)}
                                  </span>
                                  <span className="truncate text-[11px] text-muted">
                                    {task.assigneeName}
                                  </span>
                                </span>
                              )}
                              {task.dueDate && (
                                <span
                                  className={`flex shrink-0 items-center gap-1 rounded-lg border px-1.5 py-0.5 font-mono text-[10px] tabular-nums
                                    ${task.assigneeName ? "ml-auto" : ""}
                                    ${tonoVencimiento(task.dueDate, hoy)}`}
                                >
                                  <CalendarClock size={10} />
                                  {fechaCorta(task.dueDate, anioActual)}
                                </span>
                              )}
                            </span>
                          )}
                        </button>

                        {marcaAbajo && <Hueco lado="abajo" />}
                      </li>
                    );
                  })}
                </ul>

                <div className="relative shrink-0 border-t border-line/70 p-2">
                  <NewTask
                    workspaceId={workspaceId}
                    columnId={column.id}
                    onCreated={(task) =>
                      setColumns((current) =>
                        current.map((c) =>
                          c.id === column.id ? { ...c, tasks: [...c.tasks, task] } : c,
                        ),
                      )
                    }
                  />
                </div>
              </Tarjeta>
            );
          })}

          <NewColumn workspaceId={workspaceId} onCreated={load} />
        </div>
      )}

      {open && (
        <TaskDialog
          task={open}
          members={members}
          tags={tags}
          anioActual={anioActual}
          onClose={() => setOpen(null)}
          onSaved={async () => {
            setOpen(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

/**
 * La línea de luz que marca el hueco. Va en absoluto dentro del hueco de 8 px
 * que ya deja la lista: si se insertara como un elemento más, todas las
 * tarjetas de debajo darían un salto cada vez que el puntero cambia de fila.
 */
function Hueco({ lado }: { lado: "arriba" | "abajo" }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-accent
        shadow-[0_0_10px_rgb(91_140_255/0.7)] ${lado === "arriba" ? "-top-[5px]" : "-bottom-[5px]"}`}
    />
  );
}

/** Tres columnas en gris mientras llega el tablero: la forma de la página se
 *  reserva antes de tener los datos, para que nada salte al aparecer. */
function TableroEsqueleto() {
  return (
    <div className="flex h-full gap-4 overflow-hidden">
      {[0, 1, 2].map((indice) => (
        <div
          key={indice}
          className="panel devup-entrada flex h-full w-[19rem] shrink-0 flex-col gap-2 rounded-2xl p-3"
          style={{ "--retraso": `${indice * 70}ms` } as CSSProperties}
        >
          <div className="devup-esqueleto h-3 w-24 rounded" />
          <div className="devup-esqueleto mt-1 h-16 rounded-xl" />
          <div className="devup-esqueleto h-12 rounded-xl" />
          <div className="devup-esqueleto h-20 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

function NewTask({
  workspaceId,
  columnId,
  onCreated,
}: {
  workspaceId: string;
  columnId: string;
  onCreated: (task: Task) => void;
}) {
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="presionable flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-faint hover:bg-raised hover:text-muted"
      >
        <Plus size={13} />
        Nueva tarea
      </button>
    );
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const { task } = await api.post<{ task: Task }>(`/workspaces/${workspaceId}/tasks`, {
          columnId,
          title,
        });
        onCreated(task);
        setTitle("");
        setOpen(false);
      }}
      className="devup-emerge origin-bottom"
    >
      <textarea
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
          if (event.key === "Escape") setOpen(false);
        }}
        rows={2}
        placeholder="Qué hay que hacer"
        className="w-full resize-none rounded-xl border border-line bg-canvas/60 p-2.5 text-sm leading-snug outline-none
          transition-[border-color,box-shadow,background-color] duration-200
          placeholder:text-faint hover:border-line-strong
          focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_rgb(91_140_255/0.14)]"
      />
      <div className="mt-1.5 flex gap-1.5">
        <Boton
          type="submit"
          variante="primario"
          tamano="sm"
          disabled={title.trim().length === 0}
          className="flex-1"
        >
          Añadir
        </Boton>
        <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}

function NewColumn({
  workspaceId,
  onCreated,
  compacto = false,
}: {
  workspaceId: string;
  onCreated: () => Promise<void>;
  /** En el tablero vacío no hay columnas al lado que igualar en altura. */
  compacto?: boolean;
}) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  if (!open) {
    return compacto ? (
      <Boton variante="primario" icono={<Plus size={15} />} onClick={() => setOpen(true)}>
        Crear la primera columna
      </Boton>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="presionable grid h-full w-52 shrink-0 place-items-center rounded-2xl border border-dashed border-line text-faint hover:border-line-strong hover:text-muted"
      >
        <span className="flex flex-col items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl border border-line bg-raised/40">
            <Plus size={16} />
          </span>
          <Rotulo>Nueva columna</Rotulo>
        </span>
      </button>
    );
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        await api.post(`/workspaces/${workspaceId}/columns`, { name });
        setName("");
        setOpen(false);
        await onCreated();
      }}
      className={compacto ? "w-64" : "w-52 shrink-0"}
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder="Nombre de la columna"
        className="h-10 w-full rounded-xl border border-line bg-canvas/60 px-3.5 text-sm outline-none
          transition-[border-color,box-shadow,background-color] duration-200
          placeholder:text-faint hover:border-line-strong
          focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_rgb(91_140_255/0.14)]"
      />
      <p className="mt-1.5 px-1 text-[11px] text-faint">Intro para crearla, Esc para dejarlo.</p>
    </form>
  );
}

function TaskDialog({
  task,
  members,
  tags,
  anioActual,
  onClose,
  onSaved,
}: {
  task: Task;
  members: OrganizationMember[];
  tags: Tag[];
  anioActual: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [tagIds, setTagIds] = useState(task.tags.map((t) => t.id));
  const [busy, setBusy] = useState(false);

  // `color-scheme: dark` no es cosmético en los nativos: sin él, el desplegable
  // de responsables y el calendario del campo de fecha salen blancos de Windows
  // en mitad de una interfaz oscura.
  const nativo = `h-10 w-full rounded-xl border border-line bg-canvas/60 px-3 text-sm text-ink outline-none
    [color-scheme:dark] transition-[border-color,box-shadow] duration-200
    hover:border-line-strong focus:border-accent/60 focus:shadow-[0_0_0_3px_rgb(91_140_255/0.14)]`;

  return (
    <Dialogo
      titulo="Tarea"
      descripcion={`Creada el ${fechaCorta(task.createdAt, anioActual)}`}
      onCerrar={onClose}
      ancho="lg"
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await api.patch(`/tasks/${task.id}`, {
              title,
              description,
              assigneeId: assigneeId || null,
              dueDate: dueDate || null,
              tagIds,
            });
            await onSaved();
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-4"
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="Título de la tarea"
          className="w-full rounded-xl border border-transparent bg-transparent px-2 py-1.5 font-display text-base font-semibold tracking-tight text-ink outline-none
            transition-[border-color,background-color] duration-200
            hover:border-line focus:border-accent/60 focus:bg-canvas"
        />

        <div>
          <span className="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
            Detalle
          </span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            placeholder="Detalles, contexto, criterio de aceptación…"
            className="w-full resize-none rounded-xl border border-line bg-canvas/60 p-3 text-sm leading-relaxed outline-none
              transition-[border-color,box-shadow,background-color] duration-200
              placeholder:text-faint hover:border-line-strong
              focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_rgb(91_140_255/0.14)]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
              Responsable
            </span>
            <select
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              className={nativo}
            >
              <option value="">Sin asignar</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
              Fecha límite
            </span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className={`${nativo} font-mono tabular-nums`}
            />
          </label>
        </div>

        {tags.length > 0 && (
          <div>
            <span className="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
              Etiquetas
            </span>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <TagBadge
                  key={tag.id}
                  tag={tag}
                  active={tagIds.includes(tag.id)}
                  onClick={() =>
                    setTagIds((current) =>
                      current.includes(tag.id)
                        ? current.filter((id) => id !== tag.id)
                        : [...current, tag.id],
                    )
                  }
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <Boton
            type="button"
            variante="peligro"
            tamano="sm"
            icono={<Trash2 size={13} />}
            onClick={async () => {
              if (!window.confirm(`¿Eliminar «${task.title}»?`)) return;
              await api.delete(`/tasks/${task.id}`);
              await onSaved();
            }}
          >
            Eliminar
          </Boton>

          <Boton type="submit" variante="primario" cargando={busy}>
            Guardar
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
}
