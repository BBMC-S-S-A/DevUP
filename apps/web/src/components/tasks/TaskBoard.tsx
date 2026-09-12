"use client";

import {
  AlertTriangle,
  CalendarClock,
  KanbanSquare,
  Paperclip,
  Plus,
  CircleCheck,
  Pencil,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { fechaCorta, hoyLocal, iniciales } from "@/lib/fechas";
import {
  type BoardColumn,
  type OrganizationMember,
  type Tag,
  type Task,
  api,
} from "@/lib/api";
import { TagBadge } from "@/components/files/TagBadge";
import { AdjuntosTarea } from "./AdjuntosTarea";
import { uploadFile } from "@/lib/files/upload";
import { Boton } from "@/components/ui/Boton";
import { Dialogo, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useConfirmar } from "@/components/ui/Confirmar";
import { AreaTexto, Desplegable } from "@/components/ui/Field";

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
  /** Columna donde se está creando una tarea, si es que se está creando. */
  const [creandoEn, setCreandoEn] = useState<{ id: string; nombre: string } | null>(null);
  const dragging = useRef<{ taskId: string; fromColumn: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Estado puramente visual del arrastre: qué tarjeta está en el aire y detrás
  // de cuál caería si se soltara ahora. No interviene en el movimiento — eso lo
  // sigue decidiendo `dragging` y el `afterTaskId` que se pasa a `drop`.
  const [enElAire, setEnElAire] = useState<string | null>(null);
  const [huecoTras, setHuecoTras] = useState<string | null>(null);
  /** Qué columna se está renombrando ahora mismo, si alguna. */
  const [renombrando, setRenombrando] = useState<string | null>(null);

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

  const confirmarEnTablero = useConfirmar();

  /**
   * Renombrar una columna.
   *
   * `PATCH /columns/:id` acepta el nombre desde que se escribió y **no lo
   * llamaba nadie**: una columna mal escrita se quedaba así para siempre, o
   * había que borrarla con sus tareas dentro y rehacerla. Ahora que una columna
   * puede además significar «aquí se termina», cómo se llama importa más.
   *
   * Se edita EN EL SITIO y no en un diálogo: renombrar una columna es cambiar
   * una palabra, y abrir una ventana encima para eso interrumpe más de lo que
   * ayuda. Un `prompt` del navegador habría sido más corto de escribir y se ve
   * como lo que es — una pieza de otra aplicación metida dentro de esta.
   */
  const renombrarColumna = async (column: BoardColumn, propuesto: string) => {
    const nombre = propuesto.trim();
    if (!nombre || nombre === column.name) return;
    setColumns((previas) => previas.map((c) => (c.id === column.id ? { ...c, name: nombre } : c)));
    try {
      await api.patch(`/columns/${column.id}`, { name: nombre });
    } catch {
      setColumns((previas) =>
        previas.map((c) => (c.id === column.id ? { ...c, name: column.name } : c)),
      );
      toast.error("no se pudo renombrar la columna");
    }
  };

  /**
   * Borrar una columna, con sus tareas dentro.
   *
   * `DELETE /columns/:id` tampoco lo llamaba nadie, así que una columna creada
   * por error no se podía quitar. La ruta avisa en su comentario de que las
   * tareas caen por la cascada de la clave foránea y de que «la interfaz avisa
   * antes» — esa interfaz no existía, y aquí está: se dice cuántas tareas se
   * lleva por delante, porque «¿eliminar columna?» no deja claro que se borra
   * también lo que hay dentro.
   */
  const borrarColumna = async (column: BoardColumn) => {
    const cuantas = column.tasks.length;
    const ok = await confirmarEnTablero({
      titulo: `¿Eliminar la columna «${column.name}»?`,
      descripcion:
        cuantas > 0
          ? cuantas === 1
            ? "Se borra también la tarea que tiene dentro. No se puede deshacer."
            : `Se borran también sus ${cuantas} tareas. No se puede deshacer.`
          : "Está vacía, así que no se pierde ninguna tarea.",
      accion: "Eliminar",
      peligro: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/columns/${column.id}`);
      await load();
    } catch {
      toast.error("no se pudo eliminar la columna");
    }
  };

  /**
   * Marca o desmarca una columna como «aquí se termina».
   *
   * Optimista y sin recargar el tablero: es un interruptor y devolverlo a su
   * sitio si falla se nota menos que esperar una vuelta entera de la red para
   * ver moverse un icono.
   */
  const marcarTerminal = async (column: BoardColumn) => {
    const valor = !column.isTerminal;
    setColumns((previas) =>
      previas.map((c) => (c.id === column.id ? { ...c, isTerminal: valor } : c)),
    );
    try {
      await api.patch(`/columns/${column.id}`, { isTerminal: valor });
    } catch {
      setColumns((previas) =>
        previas.map((c) => (c.id === column.id ? { ...c, isTerminal: !valor } : c)),
      );
      toast.error("no se pudo cambiar la columna");
    }
  };

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
              // `flotante`: el tablero se escribió (a18d42f) antes de que
              // existieran los tokens de Sala y se quedó con el material
              // opaco de siempre, que corta la atmósfera justo donde empieza
              // cada columna. El resto de la composición del mock —el punto
              // de estado por columna, el contador en mono, la barra de
              // carga— ya es la de aquí, no la del mock: no hacía falta
              // rehacerla, solo dejarla flotar.
              <Tarjeta
                key={column.id}
                flotante
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
                  {renombrando === column.id ? (
                    <input
                      autoFocus
                      defaultValue={column.name}
                      maxLength={40}
                      aria-label="Nombre de la columna"
                      onBlur={(e) => {
                        setRenombrando(null);
                        void renombrarColumna(column, e.target.value);
                      }}
                      onKeyDown={(e) => {
                        // Intro guarda y Escape cancela, que es lo que espera
                        // cualquiera que haya renombrado algo alguna vez. El
                        // guardado real lo hace `onBlur`, y quitar el foco es
                        // lo que hacen las dos teclas.
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          e.currentTarget.value = column.name;
                          e.currentTarget.blur();
                        }
                      }}
                      className="min-w-0 flex-1 rounded-md border border-accent/50 bg-canvas px-1.5
                        py-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.18em]
                        text-ink outline-none"
                    />
                  ) : (
                    <h3
                      onDoubleClick={() => setRenombrando(column.id)}
                      title="Doble clic para renombrar"
                      className="min-w-0 flex-1 truncate font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-muted"
                    >
                      {column.name}
                    </h3>
                  )}
                  {/* Que esta columna cierra tareas se dice aquí y se cambia
                      aquí. Antes «hecho» era solo el nombre que alguien
                      escribió, y nada del producto podía leerlo: el MCP
                      devolvía las terminadas al preguntar qué queda pendiente.
                      Es un botón y no un ajuste escondido porque es la clase
                      de cosa que hay que poder corregir en el sitio — la
                      migración la adivina por el nombre y puede fallar. */}
                  <button
                    type="button"
                    onClick={() => void marcarTerminal(column)}
                    title={
                      column.isTerminal
                        ? "Las tareas que llegan aquí cuentan como terminadas. Pulsa para quitarlo."
                        : "Marcar esta columna como «terminadas»"
                    }
                    aria-pressed={column.isTerminal}
                    className={`presionable shrink-0 rounded-lg p-0.5 transition-colors ${
                      column.isTerminal
                        ? "text-live"
                        : "text-line-strong hover:text-muted"
                    }`}
                  >
                    <CircleCheck size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenombrando(column.id)}
                    title="Renombrar la columna"
                    aria-label={`Renombrar «${column.name}»`}
                    className="presionable shrink-0 rounded-lg p-0.5 text-line-strong
                      transition-colors hover:text-muted"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void borrarColumna(column)}
                    title="Eliminar la columna"
                    aria-label={`Eliminar «${column.name}»`}
                    className="presionable shrink-0 rounded-lg p-0.5 text-line-strong
                      transition-colors hover:text-danger"
                  >
                    <Trash2 size={12} />
                  </button>
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
                          // Las dos cosas que se pueden hacer con una tarjeta
                          // solo se descubrían probando: el cursor `grab` pide
                          // arrastrar pero no dice a dónde, y que abra un
                          // diálogo con responsable y fecha no lo anuncia nada.
                          title="Abrir para editar · arrastrar para cambiarla de columna"
                          // Sin `presionable`: su hundido del 3 % se dispara
                          // mientras se arrastra (el botón sigue :active) y
                          // pelearía con el levantado, que es la señal que
                          // importa aquí.
                          // `capa` y no `panel`: esta tarjeta va DENTRO de la
                          // columna, que ya es `capa-flotante` — lleva la
                          // sombra que la levanta sobre la atmósfera. Repetirla
                          // aquí apilaría dos sombras iguales sin necesidad;
                          // `.capa` es justo el material pensado para ir
                          // anidado dentro de otro cristal (ver su comentario
                          // en globals.css), y de paso es el mismo que ya usa
                          // el propio menú lateral para sus entradas (Armazon).
                          className={`capa block w-full cursor-grab rounded-xl p-2.5 text-left
                            transition-[transform,opacity,filter] duration-[var(--dur-hover)] ease-[var(--ease-out)]
                            hover:brightness-125 active:cursor-grabbing motion-reduce:transition-none
                            ${viajando ? "panel-vivo scale-[1.03] opacity-45" : ""}`}
                        >
                          {/* Terminada se ve terminada. Tachado y apagada, no
                              escondida: sigue estando en su columna porque el
                              tablero cuenta una historia, y borrarla de la
                              vista haría que «¿esto se hizo?» dejara de tener
                              respuesta. */}
                          <span
                            className={`block text-[13px] font-medium leading-snug ${
                              column.isTerminal ? "text-muted line-through" : "text-ink"
                            }`}
                          >
                            {task.title}
                          </span>

                          {(task.tags.length > 0 || task.adjuntos > 0) && (
                            <span className="mt-2 flex flex-wrap items-center gap-1">
                              {task.tags.map((tag) => (
                                <TagBadge key={tag.id} tag={tag} />
                              ))}
                              {/* Que la tarjeta diga que hay imágenes sin
                                  tener que abrirla: si no se ve desde fuera,
                                  nadie sabe que están. */}
                              {task.adjuntos > 0 && (
                                <span
                                  title={`${task.adjuntos} ${task.adjuntos === 1 ? "adjunto" : "adjuntos"}`}
                                  className="inline-flex items-center gap-1 text-[10px] text-faint"
                                >
                                  <Paperclip size={10} className="shrink-0" />
                                  <span className="font-mono tabular-nums">{task.adjuntos}</span>
                                </span>
                              )}
                            </span>
                          )}

                          {/* Este bloque ya no se condiciona a que haya
                              responsable o fecha: una tarjeta sin responsable
                              no dibujaba nada, y por eso nadie descubría que
                              asignar existe. El uso real dio la función por
                              ausente estando construida desde hace meses. */}
                          <span className="mt-2.5 flex items-center gap-2">
                            {task.assigneeName ? (
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="grid size-5 shrink-0 place-items-center rounded-full border border-line-strong bg-elevated font-display text-[9px] font-semibold text-muted">
                                  {iniciales(task.assigneeName)}
                                </span>
                                <span className="truncate text-[11px] text-muted">
                                  {task.assigneeName}
                                </span>
                              </span>
                            ) : (
                              // Hueco discreto, no una llamada a la acción: la
                              // mayoría de las tarjetas de un tablero vivo no
                              // tienen responsable, y gritarlo en todas sería
                              // peor que callarlo. El borde discontinuo es el
                              // idioma de «esto se rellena».
                              <span className="flex min-w-0 items-center gap-1.5 text-faint">
                                <span className="grid size-5 shrink-0 place-items-center rounded-full border border-dashed border-line-strong">
                                  <UserPlus size={10} />
                                </span>
                                <span className="truncate text-[11px]">Sin responsable</span>
                              </span>
                            )}
                            {task.dueDate && (
                              <span
                                className={`ml-auto flex shrink-0 items-center gap-1 rounded-lg border px-1.5 py-0.5 font-mono text-[10px] tabular-nums
                                  ${tonoVencimiento(task.dueDate, hoy)}`}
                              >
                                <CalendarClock size={10} />
                                {fechaCorta(task.dueDate, anioActual)}
                              </span>
                            )}
                          </span>
                        </button>

                        {marcaAbajo && <Hueco lado="abajo" />}
                      </li>
                    );
                  })}
                </ul>

                <div className="relative shrink-0 border-t border-line/70 p-2">
                  <NewTask onAbrir={() => setCreandoEn({ id: column.id, nombre: column.name })} />
                </div>
              </Tarjeta>
            );
          })}

          <NewColumn workspaceId={workspaceId} onCreated={load} />
        </div>
      )}

      {(open || creandoEn) && (
        <TaskDialog
          // La clave obliga a montar de nuevo al cambiar de tarea o de columna:
          // los campos del formulario se inician del `task`, y sin esto abrir
          // otra tarea reutilizaría el estado de la anterior.
          key={open?.id ?? `nueva:${creandoEn?.id}`}
          task={open}
          crearEn={open ? null : creandoEn}
          workspaceId={workspaceId}
          members={members}
          tags={tags}
          anioActual={anioActual}
          onClose={() => {
            setOpen(null);
            setCreandoEn(null);
          }}
          onSaved={async () => {
            setOpen(null);
            setCreandoEn(null);
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
        shadow-[0_0_10px_rgb(124_58_237/0.7)] ${lado === "arriba" ? "-top-[5px]" : "-bottom-[5px]"}`}
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
          // El mismo material que la columna real (`capa-flotante`): si el
          // esqueleto fuera opaco y la columna real translúcida, el tablero
          // cambiaría de material al llegar los datos y la pantalla se
          // sentiría como que "acaba de aparecer algo distinto".
          className="capa-flotante devup-entrada flex h-full w-[19rem] shrink-0 flex-col gap-2 rounded-2xl p-3"
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

/**
 * «Nueva tarea» abre EL MISMO diálogo que se abre al pulsar una tarea.
 *
 * Antes era un formulario en línea de solo título, y eso partía el trabajo en
 * dos: crear la tarea, volver a entrar, y ahí sí poner responsable, fecha o
 * imágenes. Con el tablero vacío las imágenes ni se veían —no había ninguna
 * tarea que abrir—, así que la función existía sin ser encontrable. Un solo
 * formulario para crear y para editar quita ese segundo paso y hace que lo que
 * una tarea puede llevar se vea desde el primer momento.
 */
function NewTask({ onAbrir }: { onAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="presionable flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-faint hover:bg-raised hover:text-muted"
    >
      <Plus size={13} />
      Nueva tarea
    </button>
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
          focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_var(--anillo-foco)]"
      />
      <p className="mt-1.5 px-1 text-[11px] text-faint">Intro para crearla, Esc para dejarlo.</p>
    </form>
  );
}

function TaskDialog({
  task,
  crearEn,
  workspaceId,
  members,
  tags,
  anioActual,
  onClose,
  onSaved,
}: {
  /** `null` cuando se está creando: entonces manda `crearEn`. */
  task: Task | null;
  /** Columna donde nace la tarea nueva. */
  crearEn: { id: string; nombre: string } | null;
  workspaceId: string;
  members: OrganizationMember[];
  tags: Tag[];
  anioActual: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const confirmar = useConfirmar();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [tagIds, setTagIds] = useState(task?.tags.map((t) => t.id) ?? []);
  const [busy, setBusy] = useState(false);
  /** Imágenes elegidas antes de que la tarea exista. Ver `AdjuntosTarea`. */
  const [pendientes, setPendientes] = useState<File[]>([]);
  const creando = task === null;

  // El calendario del campo de fecha lo pinta el sistema; que salga en el tema
  // correcto lo decide `color-scheme`, que ahora vive en globals.css junto a la
  // paleta en vez de clavado aquí a oscuro.
  const nativo = `h-10 w-full rounded-xl border border-line bg-canvas/60 px-3 text-sm text-ink outline-none
    transition-[border-color,box-shadow] duration-200
    hover:border-line-strong focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--anillo-foco)]`;

  return (
    <Dialogo
      titulo={creando ? "Nueva tarea" : "Tarea"}
      descripcion={
        task
          ? `Creada el ${fechaCorta(task.createdAt, anioActual)}`
          : `En ${crearEn?.nombre ?? "el tablero"}`
      }
      onCerrar={onClose}
      ancho="lg"
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (title.trim().length === 0) return;
          setBusy(true);
          try {
            const campos = {
              title,
              description,
              assigneeId: assigneeId || null,
              dueDate: dueDate || null,
              tagIds,
            };
            if (task) {
              await api.patch(`/tasks/${task.id}`, campos);
            } else {
              const { task: nueva } = await api.post<{ task: Task }>(
                `/workspaces/${workspaceId}/tasks`,
                { columnId: crearEn?.id, ...campos },
              );
              // Las imágenes van DESPUÉS y de una en una: cada archivo se
              // cuelga de un `task_id`, y hasta esta línea no existía ninguno.
              for (const archivo of pendientes) {
                await uploadFile(workspaceId, archivo, { taskId: nueva.id });
              }
            }
            await onSaved();
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-4"
      >
        <input
          autoFocus={creando}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Qué hay que hacer"
          aria-label="Título de la tarea"
          className="w-full rounded-xl border border-transparent bg-transparent px-2 py-1.5 font-display text-base font-semibold tracking-tight text-ink outline-none
            transition-[border-color,background-color] duration-200
            hover:border-line focus:border-accent/60 focus:bg-canvas"
        />

        <div>
          <span className="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
            Detalle
          </span>
          <AreaTexto
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            placeholder="Detalles, contexto, criterio de aceptación…"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
              Responsable
            </span>
            <Desplegable
              contenedor="w-full"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">Sin asignar</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </Desplegable>
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

        <AdjuntosTarea
          taskId={task?.id ?? null}
          workspaceId={task?.workspaceId ?? workspaceId}
          pendientes={pendientes}
          onPendientes={setPendientes}
        />

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          {task ? (
            <Boton
              type="button"
              variante="peligro"
              tamano="sm"
              icono={<Trash2 size={13} />}
              onClick={async () => {
                if (
                  !(await confirmar({
                    titulo: `¿Eliminar «${task.title}»?`,
                    accion: "Eliminar",
                    peligro: true,
                  }))
                )
                  return;
                await api.delete(`/tasks/${task.id}`);
                await onSaved();
              }}
            >
              Eliminar
            </Boton>
          ) : (
            <Boton type="button" variante="fantasma" tamano="sm" onClick={onClose}>
              Cancelar
            </Boton>
          )}

          <Boton
            type="submit"
            variante="primario"
            cargando={busy}
            disabled={title.trim().length === 0}
          >
            {creando ? "Crear tarea" : "Guardar"}
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
}
