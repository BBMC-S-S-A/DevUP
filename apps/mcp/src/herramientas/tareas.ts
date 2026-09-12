import { z } from "zod";
import type { ClienteApi } from "../api.js";
import { resolverEspacio, todosLosEspacios, type Espacio } from "../espacios.js";
import { imagenesDeTarea, TOPE_POR_LLAMADA, type Bloque } from "../imagenes.js";

/**
 * El tablero y las tareas, con sus imágenes.
 *
 * La regla que gobierna estas tres herramientas: **una respuesta que obliga a
 * abrir el navegador no ha contestado**. Por eso las imágenes van incrustadas
 * y no como enlace, y por eso la lista de tareas trae ya lo que hace falta
 * para actuar —quién la tiene, cuándo vence, qué lleva pegado— en vez de un
 * índice de títulos.
 */

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Tarea = {
  id: string;
  workspaceId: string;
  columnId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  tags: { id: string; name: string }[];
  adjuntos: number;
  /** La ficha de desarrollo (0042). Opcionales porque un tablero de una API
   *  anterior al despliegue no los trae, y esto no debe reventar por eso. */
  tipo?: string | null;
  prioridad?: number;
  contexto?: string;
  criterio?: string;
  ramas?: { id: string; nombre: string; estado: string; repo: string | null }[];
  evidencias?: number;
};

const PRIORIDAD_EN_PALABRAS = ["baja", "normal", "alta", "urgente"] as const;

type Columna = {
  id: string;
  name: string;
  /** Si terminar aquí cuenta como terminar. Migración 0037. */
  isTerminal?: boolean;
  tasks: Tarea[];
};

/** Hoy en calendario local, como lo guarda el servidor. */
function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Una línea por tarea, con lo que se necesita para decidir algo. */
function linea(tarea: Tarea, columna?: string): string {
  const trozos: string[] = [];
  if (columna) trozos.push(columna);
  if (tarea.assigneeName) trozos.push(tarea.assigneeName);
  if (tarea.dueDate) {
    const dia = tarea.dueDate.slice(0, 10);
    trozos.push(dia < hoy() ? `VENCIDA el ${dia}` : `vence el ${dia}`);
  }
  if (tarea.tags.length > 0) trozos.push(tarea.tags.map((t) => t.name).join("/"));
  if (tarea.adjuntos > 0) {
    trozos.push(`${tarea.adjuntos} ${tarea.adjuntos === 1 ? "adjunto" : "adjuntos"}`);
  }
  return `- ${tarea.title}${trozos.length ? ` — ${trozos.join(", ")}` : ""}  [tarea ${tarea.id}]`;
}

// ---------------------------------------------------------------------------
// mis_tareas
// ---------------------------------------------------------------------------

export const esquemaMisTareas = {
  espacio: z
    .string()
    .optional()
    .describe("Nombre del espacio de trabajo. Omitir para mirar en todos los que tenga."),
  organizacion: z.string().optional().describe("Solo si pertenece a varias organizaciones."),
  con_imagenes: z
    .boolean()
    .optional()
    .describe("Traer las imágenes pegadas a cada tarea. Por defecto sí."),
  incluir_hechas: z
    .boolean()
    .optional()
    .describe(
      "Incluir también las que están en una columna de terminadas. Por defecto " +
        "NO: quien pregunta qué tiene pendiente no quiere ver lo que ya cerró.",
    ),
};

export const descripcionMisTareas = [
  "Las tareas que tiene asignadas la persona que conectó esta sesión, en todos",
  "sus espacios de trabajo o en uno concreto.",
  "",
  "Es la herramienta para «¿qué tareas tengo?», «¿qué me toca?», «¿qué tengo",
  "pendiente?» y «¿qué se me vence?». Deja fuera lo que está en una columna de",
  "terminadas, salvo que se pida `incluir_hechas`. Devuelve de cada tarea en qué columna",
  "está, cuándo vence —marcando las vencidas—, sus etiquetas y, salvo que se",
  "pida lo contrario, **las imágenes que lleva pegadas, una por una**, no un",
  "enlace a ellas.",
  "",
  "No inventa prioridades: el orden es el del tablero. Si hace falta el detalle",
  "completo de una, usar `ver_tarea` con el identificador que aparece al final",
  "de cada línea.",
].join("\n");

export async function misTareas(
  cliente: ClienteApi,
  entrada: {
    espacio?: string;
    organizacion?: string;
    con_imagenes?: boolean;
    incluir_hechas?: boolean;
  },
): Promise<Bloque[]> {
  const { user } = await cliente.get<{ user: { id: string } }>("/auth/me");
  const userId = user?.id;
  if (!userId) throw new Error("no pude saber quién eres: la sesión no devolvió usuario");

  const espacios: Espacio[] = entrada.espacio
    ? [await resolverEspacio(cliente, entrada.espacio, entrada.organizacion)]
    : (await todosLosEspacios(cliente, entrada.organizacion)).espacios;

  const conImagenes = entrada.con_imagenes ?? true;
  const incluirHechas = entrada.incluir_hechas ?? false;
  let cupo = conImagenes ? TOPE_POR_LLAMADA : 0;
  let omitidas = 0;
  const bloques: Bloque[] = [];
  let total = 0;

  for (const espacio of espacios) {
    const { columns } = await cliente
      .get<{ columns: Columna[] }>(`/workspaces/${espacio.id}/board`)
      .catch(() => ({ columns: [] as Columna[] }));

    // Lo terminado se deja fuera salvo que se pida. Antes no se podía: una
    // columna solo tenía nombre, así que esto devolvía también lo ya cerrado y
    // preguntar «qué tengo pendiente» listaba lo hecho. Ver la migración 0037.
    const mias = columns
      .filter((c) => incluirHechas || !c.isTerminal)
      .flatMap((c) =>
        c.tasks.filter((t) => t.assigneeId === userId).map((t) => ({ tarea: t, columna: c.name })),
      );
    if (mias.length === 0) continue;

    total += mias.length;
    bloques.push({
      type: "text",
      text: `\n${espacio.name} — ${mias.length} ${mias.length === 1 ? "tarea" : "tareas"}:`,
    });

    for (const { tarea, columna } of mias) {
      bloques.push({ type: "text", text: linea(tarea, columna) });
      if (conImagenes && tarea.adjuntos > 0) {
        const r = await imagenesDeTarea(cliente, tarea.id, cupo);
        bloques.push(...r.bloques);
        cupo = r.cupo;
        omitidas += r.omitidas;
      }
    }
  }

  if (total === 0) {
    const donde = entrada.espacio ? `en ${entrada.espacio}` : "en ninguno de tus espacios";
    // Se dice que hay un filtro puesto. Sin esto, «no tienes ninguna» se lee
    // como que el tablero está vacío cuando puede estar lleno de terminadas.
    const filtro = incluirHechas ? "" : " sin terminar";
    return [{ type: "text", text: `No tienes ninguna tarea asignada${filtro} ${donde}.` }];
  }

  bloques.unshift({
    type: "text",
    text: `Tienes ${total} ${total === 1 ? "tarea asignada" : "tareas asignadas"}.`,
  });
  if (omitidas > 0) {
    bloques.push({
      type: "text",
      text:
        `\n(${omitidas} ${omitidas === 1 ? "imagen" : "imágenes"} más sin enseñar: ` +
        `el tope por llamada son ${TOPE_POR_LLAMADA}. Pide una tarea concreta con ` +
        "`ver_tarea` para verlas.)",
    });
  }
  return bloques;
}

// ---------------------------------------------------------------------------
// ver_tablero
// ---------------------------------------------------------------------------

export const esquemaVerTablero = {
  espacio: z.string().optional().describe("Nombre del espacio. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Solo si pertenece a varias organizaciones."),
};

export const descripcionVerTablero = [
  "El tablero completo de un espacio de trabajo: sus columnas en orden y las",
  "tareas de cada una, con responsable, vencimiento, etiquetas y cuántos",
  "adjuntos lleva.",
  "",
  "Para «¿en qué anda el equipo?», «¿qué hay en curso?» o «¿qué está",
  "bloqueado?». No trae las imágenes —serían demasiadas de golpe—: para eso",
  "está `ver_tarea` con el identificador de la que interese.",
].join("\n");

export async function verTablero(
  cliente: ClienteApi,
  entrada: { espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const { columns } = await cliente.get<{ columns: Columna[] }>(
    `/workspaces/${espacio.id}/board`,
  );

  if (columns.length === 0) return `El tablero de ${espacio.name} no tiene columnas todavía.`;

  const total = columns.reduce((n, c) => n + c.tasks.length, 0);
  const lineas = [`Tablero de ${espacio.name} — ${total} ${total === 1 ? "tarea" : "tareas"}.`];
  for (const columna of columns) {
    lineas.push("", `${columna.name.toUpperCase()} (${columna.tasks.length})`);
    if (columna.tasks.length === 0) lineas.push("  (vacía)");
    for (const tarea of columna.tasks) lineas.push(linea(tarea));
  }
  return lineas.join("\n");
}

// ---------------------------------------------------------------------------
// ver_tarea
// ---------------------------------------------------------------------------

export const esquemaVerTarea = {
  tarea: z
    .string()
    .describe(
      "El identificador que devolvieron `mis_tareas` o `ver_tablero`, o el " +
        "título de la tarea si no se tiene.",
    ),
  espacio: z.string().optional().describe("Dónde buscarla, si se dio un título y hay varios."),
  organizacion: z.string().optional(),
};

export const descripcionVerTarea = [
  "Todo lo de una tarea: su detalle escrito, en qué columna está, quién la",
  "tiene, cuándo vence, sus etiquetas y **todas sus imágenes, una por una**.",
  "",
  "Acepta el identificador que devuelven las otras herramientas o, si no se",
  "tiene, el título tal como lo escribiría alguien del equipo — lo busca por",
  "los tableros. Es el paso siguiente natural a `mis_tareas` cuando hay que",
  "ver de qué va algo de verdad.",
].join("\n");

export async function verTarea(
  cliente: ClienteApi,
  entrada: { tarea: string; espacio?: string; organizacion?: string },
): Promise<Bloque[]> {
  // POR QUE SE RECORREN LOS TABLEROS EN VEZ DE PEDIR LA TAREA POR SU ID: la
  // API no tiene `GET /tasks/:id` —solo el tablero entero—, y anadirlo
  // obligaria a desplegar la API para una herramienta de solo lectura. El
  // tablero ya trae todo lo que hace falta, asi que el mismo recorrido sirve
  // para buscar por identificador y por titulo.
  const espacios = entrada.espacio
    ? [await resolverEspacio(cliente, entrada.espacio, entrada.organizacion)]
    : (await todosLosEspacios(cliente, entrada.organizacion)).espacios;

  const buscado = entrada.tarea.trim();
  const porId = ES_UUID.test(buscado);
  const enMinusculas = buscado.toLowerCase();
  const encontradas: { tarea: Tarea; columna: string; espacio: string }[] = [];

  for (const espacio of espacios) {
    const { columns } = await cliente
      .get<{ columns: Columna[] }>(`/workspaces/${espacio.id}/board`)
      .catch(() => ({ columns: [] as Columna[] }));
    for (const c of columns) {
      for (const t of c.tasks) {
        const encaja = porId ? t.id === buscado : t.title.toLowerCase().includes(enMinusculas);
        if (encaja) encontradas.push({ tarea: t, columna: c.name, espacio: espacio.name });
      }
    }
  }

  if (encontradas.length === 0) {
    return [
      {
        type: "text",
        text: porId
          ? "No encontre ninguna tarea con ese identificador. Puede que la hayan borrado, o que este en un espacio al que no llegas."
          : `No encontre ninguna tarea que sea «${buscado}».`,
      },
    ];
  }

  // Varias solo puede pasar buscando por titulo. No elige el modelo: se
  // devuelven con su identificador para que pida la que quiera.
  if (encontradas.length > 1) {
    return [
      {
        type: "text",
        text:
          `«${buscado}» encaja con ${encontradas.length} tareas:\n` +
          encontradas
            .map((e) => `- ${e.tarea.title} (${e.espacio}/${e.columna})  [tarea ${e.tarea.id}]`)
            .join("\n"),
      },
    ];
  }

  const { tarea, columna, espacio } = encontradas[0]!;
  const dia = tarea.dueDate ? tarea.dueDate.slice(0, 10) : null;

  const ficha =
    `${espacio} / ${columna}` +
    (tarea.assigneeName ? ` · ${tarea.assigneeName}` : " · sin asignar") +
    (tarea.tipo ? ` · ${tarea.tipo}` : "") +
    // La prioridad normal no se nombra: es el valor por defecto, y decirlo en
    // todas las tareas haria que la palabra dejara de significar nada cuando
    // de verdad pone «urgente».
    (tarea.prioridad !== undefined && tarea.prioridad !== 1
      ? ` · prioridad ${PRIORIDAD_EN_PALABRAS[tarea.prioridad] ?? tarea.prioridad}`
      : "") +
    (dia ? (dia < hoy() ? ` · VENCIDA el ${dia}` : ` · vence el ${dia}`) : "") +
    (tarea.tags.length > 0 ? ` · ${tarea.tags.map((t) => t.name).join("/")}` : "");

  // Las cuatro cosas que hacen que esto sirva para EMPEZAR A TRABAJAR y no solo
  // para saber que la tarea existe. Cada una solo aparece si tiene algo dentro:
  // seis encabezados vacios esconden el unico que si dice algo.
  const partes = [
    tarea.title,
    "",
    ficha,
    "",
    tarea.description?.trim() ? tarea.description.trim() : "(sin detalle escrito)",
  ];
  if (tarea.contexto?.trim()) partes.push("", "De donde sale:", tarea.contexto.trim());
  if (tarea.criterio?.trim()) partes.push("", "Esta hecha cuando:", tarea.criterio.trim());
  if (tarea.ramas && tarea.ramas.length > 0) {
    partes.push(
      "",
      "Ramas:",
      ...tarea.ramas.map(
        (r) => `- ${r.nombre}${r.repo ? ` en ${r.repo}` : ""} (${r.estado})`,
      ),
    );
  }
  if (tarea.evidencias) {
    partes.push("", `${tarea.evidencias} ${tarea.evidencias === 1 ? "prueba" : "pruebas"} de que se hizo.`);
  }

  const cabecera = partes.join("\n");

  const bloques: Bloque[] = [{ type: "text", text: cabecera }];

  if (tarea.adjuntos > 0) {
    bloques.push({
      type: "text",
      text: `\n${tarea.adjuntos} ${tarea.adjuntos === 1 ? "adjunto" : "adjuntos"}:`,
    });
    const r = await imagenesDeTarea(cliente, tarea.id, TOPE_POR_LLAMADA);
    bloques.push(...r.bloques);
    if (r.omitidas > 0) {
      bloques.push({ type: "text", text: `\n(${r.omitidas} sin ensenar: tope de la llamada.)` });
    }
  }

  return bloques;
}
