"use client";

import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  KanbanSquare,
  GitBranch,
  Paperclip,
  Plus,
  ShieldCheck,
  CircleCheck,
  Pencil,
  Trash2,
  UserPlus,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { fechaCorta, hoyLocal, iniciales } from "@/lib/fechas";
import {
  ApiError,
  type AreaDeTablero,
  type BoardColumn,
  type OrganizationMember,
  type Tag,
  type Task,
  type TipoDeTarea,
  api,
} from "@/lib/api";
import { FichaDeTarea, FormularioDeEvidencia, type CamposDeFicha } from "./FichaDeTarea";
import { IconoDeTipo, TIPO_EN_PALABRAS, tonoDePrioridad } from "./ficha";
import { TagBadge } from "@/components/files/TagBadge";
import { AdjuntosTarea } from "./AdjuntosTarea";
import { uploadFile } from "@/lib/files/upload";
import { Boton } from "@/components/ui/Boton";
import { Dialogo, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useConfirmar } from "@/components/ui/Confirmar";
import { AreaTexto, Desplegable } from "@/components/ui/Field";
import { invalidar, useRecurso } from "@/lib/datos";

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
  /**
   * El tablero, ya por la capa de datos.
   *
   * LO QUE SE GANA, Y NO ES SOLO MENOS CÓDIGO: al volver de otra pantalla el
   * tablero aparece puesto en vez de en blanco medio segundo, dos componentes
   * que pidan la misma clave piden una sola vez, y al volver a la pestaña se
   * comprueba solo. Antes esto eran tres `useState`, un `load` y un efecto en
   * cada pantalla que quisiera lo mismo.
   */
  const claveTablero = `/workspaces/${workspaceId}/board`;
  const tablero = useRecurso<{ columns: BoardColumn[]; categories: AreaDeTablero[] }>(claveTablero);
  const equipo = useRecurso<{ members: OrganizationMember[] }>(
    `/organizations/${organizationId}/members`,
  );
  const etiquetas = useRecurso<{ tags: Tag[] }>(`/organizations/${organizationId}/tags`);

  /**
   * El tablero tal y como se está viendo MIENTRAS una acción va por la red.
   *
   * POR QUÉ HACE FALTA UNA CAPA ENCIMA DE LA CACHÉ. Arrastrar una tarjeta tiene
   * que verse en el sitio nuevo antes de que el servidor conteste; si no, la
   * tarjeta se queda quieta medio segundo y el arrastre se siente roto. Eso es
   * estado local por definición: no es lo que el servidor dice, es lo que
   * estamos apostando a que va a decir.
   *
   * Se suelta en cuanto llega la respuesta de verdad (`useEffect` de abajo), y
   * esa es la regla que lo hace seguro: **lo optimista nunca sobrevive a un
   * dato fresco**. Si la apuesta era mala, el servidor gana sin que nadie
   * tenga que acordarse de deshacerla.
   */
  const [optimista, setOptimista] = useState<BoardColumn[] | null>(null);
  const servidor = tablero.datos?.columns;
  useEffect(() => {
    if (servidor) setOptimista(null);
  }, [servidor]);

  const columns = optimista ?? servidor ?? [];
  const areas = tablero.datos?.categories ?? [];
  const members = equipo.datos?.members ?? [];
  const tags = etiquetas.datos?.tags ?? [];
  const loading = tablero.cargando;
  const error = tablero.error;

  /** Cambia lo que se ve ahora, sin tocar lo que dice el servidor. */
  const pintar = (cambio: (previas: BoardColumn[]) => BoardColumn[]) =>
    setOptimista((previas) => cambio(previas ?? servidor ?? []));

  /** Vuelve a pedir el tablero y suelta lo optimista. Es lo que se llama
   *  después de cualquier escritura que no se haya pintado a mano. */
  const load = useCallback(async () => {
    setOptimista(null);
    await tablero.recargar();
  }, [tablero]);

  /**
   * Por qué área se está mirando el tablero, o `null` por todas.
   *
   * ES UN FILTRO Y NO UNA AGRUPACIÓN, y es la decisión de esta pantalla. Agrupar
   * por área dentro de cada columna partiría el tablero en una cuadrícula de
   * áreas × columnas donde arrastrar una tarjeta ya no significa una sola cosa
   * —¿la cambio de estado, o de área?— y donde el tablero deja de leerse de un
   * vistazo, que era justo para lo que servían las áreas. Filtrando, el tablero
   * sigue siendo el tablero y se puede mirar «solo lo de DevVerse» en un clic.
   */
  const [area, setArea] = useState<string | null>(null);
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
  /**
   * Categorías seleccionadas. Vacío = todas.
   *
   * EN MEMORIA Y NO GUARDADO, a propósito. Un filtro que sobrevive a la recarga
   * se convierte en «mis tareas desaparecieron» la próxima vez que se abra el
   * tablero sin acordarse de que estaba puesto. Mientras no haya un sitio donde
   * se vea con claridad qué filtro hay activo desde fuera, se olvida al salir.
   */
  const [categorias, setCategorias] = useState<string[]>([]);

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
    pintar((previas) => previas.map((c) => (c.id === column.id ? { ...c, name: nombre } : c)));
    try {
      await api.patch(`/columns/${column.id}`, { name: nombre });
      invalidar(claveTablero);
    } catch {
      pintar((previas) =>
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
    pintar((previas) =>
      previas.map((c) => (c.id === column.id ? { ...c, isTerminal: valor } : c)),
    );
    try {
      await api.patch(`/columns/${column.id}`, { isTerminal: valor });
      invalidar(claveTablero);
    } catch {
      pintar((previas) =>
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
    pintar((current) => {
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
      // INVALIDAR AUNQUE HAYA SALIDO BIEN, y es lo que el cambio a la caché
      // obliga a recordar: antes `columns` era estado local y moría con la
      // pantalla, así que pintar a mano bastaba. Ahora lo que se pintó vive
      // encima de algo GUARDADO, y si no se marca viejo, volver al tablero
      // dentro de la ventana de frescura enseñaría el orden de antes del
      // arrastre. Lo optimista sigue en pantalla hasta que llegue lo fresco.
      invalidar(claveTablero);
    } catch {
      // La apuesta salió mal: se suelta lo optimista y manda el servidor. Un
      // aviso flotante y no un cartel fijo, siguiendo la regla: el error de un
      // CAMPO va junto al campo; el de una ACCIÓN, flotando.
      toast.error("no se pudo mover la tarjeta");
      await load();
    }
  };

  if (loading) return <TableroEsqueleto />;

  const hoy = hoyLocal();
  const anioActual = hoy.slice(0, 4);
  // El medidor de cada columna se lee contra la columna más cargada: dice de un
  // vistazo dónde se está acumulando el trabajo, que es la pregunta que se le
  // hace a un tablero desde lejos.
  // DOS EJES QUE SE CRUZAN, Y SE CRUZAN CON «Y». El área dice DÓNDE VIVE la
  // tarea —una sola, con dueño— y las etiquetas dicen QUÉ LA CRUZA —varias,
  // sin dueño—. Entre etiquetas se suma («enséñame urgente o deuda»); entre el
  // área y las etiquetas se multiplica («de DevVerse, lo urgente»). Sumarlo
  // todo haría que elegir un área ENSANCHARA el tablero, que es lo contrario
  // de lo que hace un filtro.
  //
  // Y se aplica ANTES de contar: si no, el medidor de carga y los contadores
  // de cada columna seguirían hablando del tablero entero mientras la pantalla
  // enseña un trozo — un tablero diciendo «7» encima de una columna con dos
  // tarjetas. Todo lo de debajo trabaja sobre `visibles`.
  const filtra = (t: Task) =>
    (area === null || t.categoryId === area) &&
    (categorias.length === 0 || t.tags.some((g) => categorias.includes(g.id)));

  const visibles =
    area === null && categorias.length === 0
      ? columns
      : columns.map((c) => ({ ...c, tasks: c.tasks.filter(filtra) }));

  const carga = visibles.reduce((maximo, columna) => Math.max(maximo, columna.tasks.length), 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {error && (
        <p className="flex shrink-0 items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertTriangle size={13} className="shrink-0" />
          {error}
        </p>
      )}

      {/* UNA SOLA BARRA CON LOS DOS EJES, y no dos barras apiladas. Dos filas
          de chips encima de un tablero es la forma más rápida de que nadie use
          ninguna de las dos: ocupan la altura de una columna entera y no se
          distingue cuál hace qué. Aquí van en la misma fila, cada grupo con su
          rótulo, y envuelven cuando no caben. */}
      {(areas.length > 0 || tags.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5">
          {areas.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Rotulo className="mr-0.5">Área</Rotulo>
              <BotonDeArea activa={area === null} onClick={() => setArea(null)}>
                Todas
                <span className="ml-1.5 font-mono tabular-nums opacity-60">
                  {columns.reduce((n, c) => n + c.tasks.length, 0)}
                </span>
              </BotonDeArea>
              {areas.map((a) => (
                <BotonDeArea key={a.id} activa={area === a.id} onClick={() => setArea(a.id)}>
                  {a.name}
                  {/* Quién la lleva, en el propio filtro: es la mitad de lo que
                      un área significa, y esconderlo obliga a abrir los ajustes
                      para contestar «¿de quién es esto?». */}
                  {a.ownerName && <span className="ml-1.5 opacity-60">{a.ownerName}</span>}
                  <span className="ml-1.5 font-mono tabular-nums opacity-60">{a.tareas ?? 0}</span>
                </BotonDeArea>
              ))}
            </div>
          )}

          <BarraCategorias
            tags={tags}
            columnas={columns}
            elegidas={categorias}
            onElegir={setCategorias}
            organizationId={organizationId}
            onCreada={load}
          />
        </div>
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
          {visibles.map((column, indice) => {
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
                    const prioridad = tonoDePrioridad(task.prioridad);
                    const areaDe = task.categoryId
                      ? areas.find((a) => a.id === task.categoryId)
                      : undefined;

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

                          {/* La segunda línea de la tarjeta: qué clase de
                              trabajo es, cuánto corre y de qué área. Solo se
                              dibuja lo que tiene algo que decir — una tarjeta
                              sin tipo, normal y sin área no gasta ni un píxel
                              en decir tres veces «nada». */}
                          {(task.tipo || prioridad || areaDe) && (
                            <span className="mt-1.5 flex flex-wrap items-center gap-1">
                              {prioridad && (
                                <span
                                  className={`inline-flex items-center rounded-full border px-1.5 py-0.5
                                    font-display text-[9px] font-semibold uppercase tracking-wider ${prioridad.clase}`}
                                >
                                  {prioridad.texto}
                                </span>
                              )}
                              {task.tipo && (
                                <span
                                  title={TIPO_EN_PALABRAS[task.tipo]}
                                  className="inline-flex items-center gap-1 text-[10px] text-faint"
                                >
                                  <IconoDeTipo tipo={task.tipo} size={10} />
                                  {TIPO_EN_PALABRAS[task.tipo]}
                                </span>
                              )}
                              {areaDe && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                                  <span className="size-1.5 rounded-full bg-accent/70" />
                                  {areaDe.name}
                                </span>
                              )}
                            </span>
                          )}

                          {(task.tags.length > 0 ||
                            task.adjuntos > 0 ||
                            task.ramas.length > 0 ||
                            task.evidencias > 0) && (
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
                              {/* La rama con nombre y no solo contada: «¿quién
                                  está tocando pagos?» se contesta desde el
                                  tablero o no se contesta. Si hay varias, la
                                  primera y cuántas más. */}
                              {task.ramas[0] && (
                                <span
                                  title={task.ramas.map((r) => r.nombre).join("\n")}
                                  className="inline-flex min-w-0 items-center gap-1 text-[10px] text-faint"
                                >
                                  <GitBranch size={10} className="shrink-0" />
                                  <span className="max-w-[9rem] truncate font-mono">
                                    {task.ramas[0].nombre}
                                  </span>
                                  {task.ramas.length > 1 && <span>+{task.ramas.length - 1}</span>}
                                </span>
                              )}
                              {task.evidencias > 0 && (
                                <span
                                  title={`${task.evidencias} ${task.evidencias === 1 ? "prueba" : "pruebas"} de que se hizo`}
                                  className="inline-flex items-center gap-1 text-[10px] text-live"
                                >
                                  <ShieldCheck size={10} className="shrink-0" />
                                  <span className="font-mono tabular-nums">{task.evidencias}</span>
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
          areas={areas}
          anioActual={anioActual}
          onRecargar={async () => {
            // Las ramas y la evidencia se guardan solas, así que hay que
            // refrescar las dos cosas: el tablero —de eso se encarga ya la
            // caché— y la tarjeta abierta, que el tablero no trae entera.
            // Sin lo segundo, el diálogo seguiría enseñando la lista de antes
            // y parecería que no se guardó nada.
            invalidar(claveTablero);
            if (open) {
              const { task: completa } = await api.get<{ task: Task }>(`/tasks/${open.id}`);
              setOpen(completa);
            }
          }}
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
 * Un botón del filtro por área.
 *
 * Chips y no un desplegable: las áreas son tres o cuatro y se cambian mucho —
 * un desplegable convierte cada cambio en dos clics y esconde cuántas hay. Con
 * seis o siete dejaría de caber, y entonces tocará replantearlo; hoy no las
 * hay.
 */
function BotonDeArea({
  activa,
  onClick,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`presionable inline-flex items-center rounded-full border px-2.5 py-1
        font-display text-[10px] font-semibold uppercase tracking-wider transition-colors
        ${
          activa
            ? "border-accent/40 bg-accent-soft/60 text-accent"
            : "border-line text-faint hover:text-muted"
        }`}
    >
      {children}
    </button>
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
  areas,
  anioActual,
  onClose,
  onSaved,
  onRecargar,
}: {
  /** `null` cuando se está creando: entonces manda `crearEn`. */
  task: Task | null;
  /** Columna donde nace la tarea nueva. */
  crearEn: { id: string; nombre: string } | null;
  workspaceId: string;
  members: OrganizationMember[];
  tags: Tag[];
  areas: AreaDeTablero[];
  anioActual: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  /** Para lo que se guarda solo: ramas y evidencia. */
  onRecargar: () => Promise<void>;
}) {
  const confirmar = useConfirmar();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [tagIds, setTagIds] = useState(task?.tags.map((t) => t.id) ?? []);
  const [ficha, setFicha] = useState<CamposDeFicha>({
    tipo: task?.tipo ?? "",
    prioridad: task?.prioridad ?? 1,
    categoryId: task?.categoryId ?? "",
    contexto: task?.contexto ?? "",
    criterio: task?.criterio ?? "",
  });
  /**
   * Si la ficha de desarrollo está desplegada.
   *
   * Cerrada al crear y abierta al editar, y es deliberado: al crear se está
   * sacando algo de la cabeza y el único campo que importa es el título; al
   * abrir una tarjeta que ya existe se está trabajando en ella. Un formulario
   * que pide tipo, prioridad, área y criterio antes de dejar escribir «arreglar
   * el login» consigue que la gente deje de usar el tablero.
   */
  const [fichaAbierta, setFichaAbierta] = useState(task !== null);
  const [cerrando, setCerrando] = useState(false);
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
              tipo: ficha.tipo || null,
              prioridad: ficha.prioridad,
              categoryId: ficha.categoryId || null,
              contexto: ficha.contexto,
              criterio: ficha.criterio,
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

        {/* La ficha de desarrollo, plegable. El resumen dice lo que hay dentro
            aunque esté cerrada: un desplegable que no dice qué esconde es un
            desplegable que nadie abre. */}
        <div className="rounded-xl border border-line">
          <button
            type="button"
            onClick={() => setFichaAbierta((abierta) => !abierta)}
            aria-expanded={fichaAbierta}
            className="presionable flex w-full items-center gap-2 px-3 py-2 text-left"
          >
            <span className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
              Ficha de desarrollo
            </span>
            {!fichaAbierta && (
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                {resumenDeFicha(ficha, areas, task)}
              </span>
            )}
            <ChevronDown
              size={13}
              className={`ml-auto shrink-0 text-faint transition-transform duration-[var(--dur-hover)]
                ${fichaAbierta ? "rotate-180" : ""}`}
            />
          </button>
          {fichaAbierta && (
            <div className="border-t border-line p-3">
              <FichaDeTarea
                task={task}
                areas={areas}
                campos={ficha}
                onCampos={setFicha}
                onRecargar={onRecargar}
              />
            </div>
          )}
        </div>

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

          <div className="flex items-center gap-2">
            {task && (
              <Boton
                type="button"
                variante="secundario"
                icono={<CircleCheck size={13} />}
                onClick={() => setCerrando(true)}
              >
                Marcar como hecha
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
        </div>
      </form>

      {cerrando && task && (
        <Dialogo
          titulo="Marcar como hecha"
          descripcion={task.title}
          onCerrar={() => setCerrando(false)}
        >
          <div className="space-y-4">
            {/* El criterio se enseña AQUÍ y en ningún otro sitio, que es el
                único momento en que sirve: se escribió al empezar para leerse
                al terminar. Si solo viviera en la ficha, nadie volvería a él. */}
            {task.criterio ? (
              <div className="rounded-xl border border-line bg-canvas/60 p-3">
                <span className="mb-1 block font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
                  Estaba hecha cuando
                </span>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink">
                  {task.criterio}
                </p>
              </div>
            ) : (
              <p className="text-xs text-faint">
                Esta tarea no dijo cuándo estaría hecha. No pasa nada: se puede cerrar igual.
              </p>
            )}

            <div>
              <span className="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
                Deja la prueba (opcional)
              </span>
              <FormularioDeEvidencia
                textoBoton="Cerrar con esto"
                ocupado={busy}
                onEnviar={async (evidencia) => {
                  setBusy(true);
                  try {
                    await api.post(`/tasks/${task.id}/hecha`, { evidencia });
                    setCerrando(false);
                    await onSaved();
                  } catch {
                    toast.error("no se pudo cerrar la tarea");
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              {/* Se OFRECE, no se exige. Hacerla obligatoria convertiría la
                  primera tarea sin PR —una decisión, una llamada, algo que se
                  resolvió hablando— en un callejón sin salida, y la respuesta
                  de la gente a un campo obligatorio que estorba es escribir
                  «ok» y seguir. */}
              <p className="mt-2 text-[11px] text-faint">
                El PR que la cierra, el enlace donde se ve, o lo que comprobaste. Queda con tu
                nombre y la fecha.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
              <Boton
                type="button"
                variante="fantasma"
                tamano="sm"
                onClick={() => setCerrando(false)}
              >
                Cancelar
              </Boton>
              <Boton
                type="button"
                variante="primario"
                cargando={busy}
                icono={<CircleCheck size={13} />}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.post(`/tasks/${task.id}/hecha`, {});
                    setCerrando(false);
                    await onSaved();
                  } catch {
                    toast.error("no se pudo cerrar la tarea");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Cerrar sin prueba
              </Boton>
            </div>
          </div>
        </Dialogo>
      )}
    </Dialogo>
  );
}

/**
 * Lo que dice la ficha cuando está plegada.
 *
 * Un desplegable que no adelanta qué esconde es un desplegable que nadie abre,
 * y peor: uno que hace que la gente no sepa que esa tarea YA tiene tipo, área y
 * criterio puestos, y los vuelva a preguntar por el chat.
 */
function resumenDeFicha(
  ficha: CamposDeFicha,
  areas: AreaDeTablero[],
  task: Task | null,
): string {
  const trozos: string[] = [];
  if (ficha.tipo) trozos.push(TIPO_EN_PALABRAS[ficha.tipo as TipoDeTarea]);
  const prioridad = tonoDePrioridad(ficha.prioridad);
  if (prioridad) trozos.push(prioridad.texto.toLowerCase());
  const area = areas.find((a) => a.id === ficha.categoryId);
  if (area) trozos.push(area.name);
  if (task && task.ramas.length > 0) {
    trozos.push(`${task.ramas.length} ${task.ramas.length === 1 ? "rama" : "ramas"}`);
  }
  if (task && task.evidencias > 0) {
    trozos.push(`${task.evidencias} ${task.evidencias === 1 ? "prueba" : "pruebas"}`);
  }
  return trozos.length > 0 ? trozos.join(" · ") : "sin clasificar";
}

/**
 * Las etiquetas del tablero, y el filtro por ellas.
 *
 * SON LAS ETIQUETAS QUE YA EXISTÍAN. `tags` está en la base desde la 0002, es
 * de la organización, tiene color y ya se podía poner en una tarea desde su
 * diálogo. Lo que no había era **filtrar por ellas**, así que poner una
 * etiqueta no servía para nada: se veía, y ya.
 *
 * Y había un callejón sin salida: la sección de etiquetas del diálogo solo
 * aparece si ya existe alguna (`tags.length > 0`), y el único sitio donde se
 * podía crear la primera era la biblioteca de archivos. Desde el tablero no se
 * podía empezar. Por eso el «+» está aquí.
 *
 * VARIAS A LA VEZ SUMAN, no restan: elegir «workflow» y «devverse» enseña las
 * de las dos. Es lo que se espera de un filtro de categorías —«enséñame estas
 * dos áreas»— y no lo que se espera de uno de propiedades, donde sumar daría
 * cero resultados casi siempre.
 *
 * EL CONTADOR DE CADA CATEGORÍA ES SU NÚMERO DE TAREAS SIN TERMINAR, no el
 * total. Un «12» que incluye lo cerrado hace meses no dice nada sobre dónde
 * está el trabajo ahora.
 */
function BarraCategorias({
  tags,
  columnas,
  elegidas,
  onElegir,
  organizationId,
  onCreada,
}: {
  tags: Tag[];
  columnas: BoardColumn[];
  elegidas: string[];
  onElegir: (ids: string[]) => void;
  organizationId: string;
  onCreada: () => Promise<void>;
}) {
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Pendientes por categoría, contra las columnas que no terminan nada.
  const pendientes = new Map<string, number>();
  for (const columna of columnas) {
    if (columna.isTerminal) continue;
    for (const tarea of columna.tasks) {
      for (const tag of tarea.tags) {
        pendientes.set(tag.id, (pendientes.get(tag.id) ?? 0) + 1);
      }
    }
  }

  const alternar = (id: string) =>
    onElegir(elegidas.includes(id) ? elegidas.filter((x) => x !== id) : [...elegidas, id]);

  const crear = async () => {
    const limpio = nombre.trim();
    if (!limpio) return;
    setGuardando(true);
    try {
      await api.post(`/organizations/${organizationId}/tags`, { name: limpio });
      setNombre("");
      setCreando(false);
      await onCreada();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "no se pudo crear la categoría");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <Rotulo className="mr-0.5">Etiquetas</Rotulo>

      <button
        type="button"
        onClick={() => onElegir([])}
        aria-pressed={elegidas.length === 0}
        className={`presionable rounded-lg border px-2 py-0.5 text-[11px] transition-colors ${
          elegidas.length === 0
            ? "border-accent/50 bg-accent-soft/60 text-accent-bright"
            : "border-line text-faint hover:text-muted"
        }`}
      >
        Todas
      </button>

      {tags.map((tag) => {
        const activa = elegidas.includes(tag.id);
        const cuantas = pendientes.get(tag.id) ?? 0;
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => alternar(tag.id)}
            aria-pressed={activa}
            className={`presionable flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px]
              transition-colors ${
                activa
                  ? "border-accent/50 bg-accent-soft/60 text-accent-bright"
                  : "border-line text-muted hover:border-line-strong"
              }`}
          >
            {tag.name}
            {cuantas > 0 && (
              <span className="font-mono text-[10px] tabular-nums text-faint">{cuantas}</span>
            )}
          </button>
        );
      })}

      {creando ? (
        <input
          autoFocus
          value={nombre}
          maxLength={40}
          placeholder="Nombre de la categoría"
          aria-label="Nombre de la categoría"
          onChange={(e) => setNombre(e.target.value)}
          onBlur={() => (nombre.trim() ? void crear() : setCreando(false))}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setNombre("");
              setCreando(false);
            }
          }}
          disabled={guardando}
          className="w-44 rounded-lg border border-accent/50 bg-canvas px-2 py-0.5 text-[11px] text-ink outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreando(true)}
          title="Crear una categoría"
          aria-label="Crear una categoría"
          className="presionable grid size-5 place-items-center rounded-lg border border-dashed
            border-line-strong text-faint transition-colors hover:border-accent hover:text-accent-bright"
        >
          <Plus size={11} />
        </button>
      )}
    </div>
  );
}
