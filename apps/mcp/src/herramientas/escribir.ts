import { z } from "zod";
import type { ClienteApi } from "../api.js";
import { resolverEspacio, type Espacio } from "../espacios.js";
import { resolverOrganizacion } from "../organizaciones.js";

/**
 * Las herramientas que ESCRIBEN en DevUP.
 *
 * Hasta aquí el agente solo miraba. Esto es lo que le permite convertir «hazme
 * un plan para esta función» en tareas de verdad en el tablero del equipo, y
 * por eso las decisiones de abajo importan más que en las de lectura: un fallo
 * de lectura da una respuesta pobre, y uno de escritura deja basura en el
 * tablero de otras personas.
 *
 * PROCEDENCIA, Y POR QUÉ CON UNA ETIQUETA. Todo lo que crea el agente lleva la
 * etiqueta `agente`. No es decoración: es la condición para que dejar escribir
 * a un modelo sea aceptable. Con ella, lo que hizo se ve de un vistazo en el
 * tablero, se filtra, se revisa en bloque y se puede deshacer entero. Sin
 * ella, un tablero con cuarenta tareas inventadas solo se puede vaciar a mano
 * —y con él se van las que sí valían.
 *
 * Se resuelve con una etiqueta y no con una columna nueva en la base a
 * propósito: las etiquetas ya existen, ya se pintan en la tarjeta, ya filtran
 * y ya se borran en bloque. Una migración habría dado lo mismo a cambio de una
 * política de RLS más, un caso de aislamiento más y otro despliegue.
 *
 * LO QUE NO HAY, Y ES DELIBERADO: nada de borrar. Ni tareas, ni columnas, ni
 * archivos. Un agente que se equivoca creando deja trabajo que revisar; uno
 * que se equivoca borrando deja trabajo perdido. Borrar sigue siendo de
 * personas.
 *
 * Y el agente escribe CON LA SESIÓN DE QUIEN LO CONECTÓ, así que no puede
 * tocar nada que su dueño no pudiera tocar a mano: la frontera sigue siendo
 * RLS, no la buena educación del modelo.
 */

export const ETIQUETA_AGENTE = "agente";

type Columna = { id: string; name: string; tasks: { id: string; title: string }[] };
type Miembro = { userId: string; displayName: string };
type Etiqueta = { id: string; name: string };

/**
 * Se asegura de que exista la etiqueta de procedencia y devuelve su id.
 *
 * El alta de etiquetas ya es idempotente en la API (`on conflict do update`),
 * así que esto es una llamada y no una comprobación previa.
 */
async function etiquetaDeAgente(cliente: ClienteApi, organizacion?: string): Promise<string> {
  const org = await resolverOrganizacion(cliente, organizacion);
  const { tag } = await cliente.post<{ tag: Etiqueta }>(`/organizations/${org.id}/tags`, {
    name: ETIQUETA_AGENTE,
    color: "violet",
  });
  return tag.id;
}

/** El tablero del espacio, que hace falta para resolver columnas por nombre. */
async function tablero(cliente: ClienteApi, espacioId: string): Promise<Columna[]> {
  const { columns } = await cliente.get<{ columns: Columna[] }>(
    `/workspaces/${espacioId}/board`,
  );
  return columns;
}

/**
 * Resuelve la columna por nombre. Sin nombre, la primera — que es donde entra
 * el trabajo nuevo en cualquier tablero.
 */
export function resolverColumna(columnas: Columna[], nombre?: string): Columna {
  const primera = columnas[0];
  if (columnas.length === 0) {
    throw new Error(
      "Ese tablero no tiene ninguna columna todavía. Créala con `crear_columna` antes de poner tareas.",
    );
  }
  if (!nombre) return primera!;

  const buscado = nombre.trim().toLowerCase();
  const exacta = columnas.find((c) => c.name.toLowerCase() === buscado);
  if (exacta) return exacta;
  const parciales = columnas.filter((c) => c.name.toLowerCase().includes(buscado));
  if (parciales.length === 1) return parciales[0]!;
  throw new Error(
    parciales.length === 0
      ? `No hay ninguna columna «${nombre}». Hay: ${columnas.map((c) => c.name).join(", ")}.`
      : `«${nombre}» encaja con varias: ${parciales.map((c) => c.name).join(", ")}.`,
  );
}

/** Resuelve una persona por nombre, para asignar sin pedir uuid. */
export async function resolverPersona(
  cliente: ClienteApi,
  nombre: string,
  organizacion?: string,
): Promise<string> {
  const org = await resolverOrganizacion(cliente, organizacion);
  const { members } = await cliente.get<{ members: Miembro[] }>(
    `/organizations/${org.id}/members`,
  );
  const buscado = nombre.trim().toLowerCase();
  const exacto = members.find((m) => m.displayName.toLowerCase() === buscado);
  if (exacto) return exacto.userId;
  const parciales = members.filter((m) => m.displayName.toLowerCase().includes(buscado));
  if (parciales.length === 1) return parciales[0]!.userId;
  throw new Error(
    parciales.length === 0
      ? `No hay nadie que se llame «${nombre}» en ${org.name}. Hay: ` +
        `${members.map((m) => m.displayName).join(", ")}.`
      : `«${nombre}» encaja con varias personas: ${parciales.map((m) => m.displayName).join(", ")}.`,
  );
}

/**
 * La ficha de desarrollo, compartida por crear y actualizar.
 *
 * EL MODELO HABLA EN PALABRAS, LA API EN NÚMEROS. La prioridad se guarda como
 * 0-3 porque se ordena (ver la 0042), pero pedirle a un modelo «prioridad: 3»
 * es pedirle que recuerde una tabla que no tiene delante — y cuando no la
 * recuerda, se la inventa. Aquí entra «urgente» y sale 3.
 *
 * Y LOS TIPOS LLEVAN SU EXPLICACIÓN EN EL PROPIO ESQUEMA. Una lista de ocho
 * palabras sueltas se rellena a ojo; una que dice en qué se diferencia «mejora»
 * de «deuda», no. Es la misma decisión que en el desplegable de la interfaz, y
 * por el mismo motivo: la descripción ES la documentación que lee quien elige.
 */
const PRIORIDADES = ["baja", "normal", "alta", "urgente"] as const;

export const esquemaFicha = {
  tipo: z
    .enum([
      "funcionalidad",
      "arreglo",
      "mejora",
      "deuda",
      "investigacion",
      "documentacion",
      "diseno",
      "infraestructura",
    ])
    .optional()
    .describe(
      "Qué clase de trabajo es: funcionalidad (algo que antes no se podía hacer), " +
        "arreglo (algo que no funciona como dice), mejora (funciona pero no lo " +
        "bastante bien), deuda (funciona y hay que rehacerlo igualmente), " +
        "investigacion (todavía no se sabe qué hay que hacer), documentacion, " +
        "diseno, infraestructura. Omitir si no está claro: sin clasificar es " +
        "mejor que mal clasificado.",
    ),
  prioridad: z
    .enum(PRIORIDADES)
    .optional()
    .describe("baja, normal, alta o urgente. Por defecto normal; marcar solo lo que no lo es."),
  contexto: z
    .string()
    .max(4000)
    .optional()
    .describe("De dónde sale esto, qué se intentó antes, con qué no hay que romper. Se lee al empezar."),
  criterio: z
    .string()
    .max(4000)
    .optional()
    .describe("Cómo sabremos que está hecha. Se lee al terminar, y se enseña al cerrarla."),
};

export type Ficha = {
  tipo?: string;
  prioridad?: (typeof PRIORIDADES)[number];
  contexto?: string;
  criterio?: string;
};

/** Lo que de la ficha se manda a la API, con la prioridad ya en número. */
export function campoDeFicha(entrada: Ficha): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  if (entrada.tipo) salida.tipo = entrada.tipo;
  if (entrada.prioridad) salida.prioridad = PRIORIDADES.indexOf(entrada.prioridad);
  if (entrada.contexto !== undefined) salida.contexto = entrada.contexto;
  if (entrada.criterio !== undefined) salida.criterio = entrada.criterio;
  return salida;
}

export type Area = { id: string; name: string; ownerName: string | null };

async function areas(cliente: ClienteApi, espacioId: string): Promise<Area[]> {
  const { categories } = await cliente.get<{ categories: Area[] }>(
    `/workspaces/${espacioId}/categories`,
  );
  return categories;
}

/**
 * Resuelve un área por nombre, sin pedirle un identificador al modelo.
 *
 * Es el mismo criterio que las columnas y las personas: coincidencia exacta
 * primero, parcial después, y si encaja con varias se DICE en vez de elegir.
 * Adivinar aquí archivaría trabajo en el frente equivocado, y eso no se ve
 * hasta que alguien busca su tarea y no está.
 */
export function resolverArea(lista: Area[], nombre: string): Area | string {
  const limpio = nombre.trim().toLowerCase();
  const exacta = lista.find((a) => a.name.toLowerCase() === limpio);
  if (exacta) return exacta;
  const parciales = lista.filter((a) => a.name.toLowerCase().includes(limpio));
  if (parciales.length === 1) return parciales[0]!;
  if (parciales.length === 0) {
    return lista.length === 0
      ? "Este tablero no tiene áreas todavía. Créala con `crear_area`."
      : `No hay ningún área que se llame «${nombre}». Hay: ${lista.map((a) => a.name).join(", ")}.`;
  }
  return `«${nombre}» encaja con varias áreas: ${parciales.map((a) => a.name).join(", ")}.`;
}

// ---------------------------------------------------------------------------
// crear_area
// ---------------------------------------------------------------------------

export const esquemaCrearArea = {
  nombre: z.string().trim().min(1).max(40).describe("Cómo se llama el área de trabajo."),
  responsable: z
    .string()
    .optional()
    .describe("Quién la lleva. Las tareas que se archiven aquí se le asignan solas."),
  espacio: z.string().optional(),
  organizacion: z.string().optional(),
};

export const descripcionCrearArea = [
  "Crea un área en el tablero: el otro eje, el de «de qué trata esto».",
  "",
  "Una COLUMNA dice en qué estado está algo —por hacer, en curso, hecho—. Un",
  "ÁREA dice de qué trata y de quién es: «DevVerse», «Flujos», «Infraestructura».",
  "Sirve para que un tablero de cuarenta tarjetas se pueda leer.",
  "",
  "Lo que la hace útil es el responsable: las tareas que se archiven en un área",
  "se asignan solas a quien la lleva, salvo que se diga otra cosa. Así se deja",
  "de repartir tarea por tarea.",
  "",
  "Pocas y estables. Un tablero con ocho áreas que nadie usa es peor que uno",
  "con tres.",
].join("\n");

export async function crearArea(
  cliente: ClienteApi,
  entrada: { nombre: string; responsable?: string; espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio: Espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const responsable = entrada.responsable
    ? await resolverPersona(cliente, entrada.responsable, entrada.organizacion)
    : null;

  const { category } = await cliente.post<{ category: { id: string; name: string } }>(
    `/workspaces/${espacio.id}/categories`,
    { name: entrada.nombre, ownerId: responsable },
  );

  const quien = entrada.responsable ? `, que lleva ${entrada.responsable}` : ", sin responsable";
  return `Creada el área «${category.name}» en ${espacio.name}${quien}.  [area ${category.id}]`;
}

// ---------------------------------------------------------------------------
// crear_tarea
// ---------------------------------------------------------------------------

export const esquemaCrearTarea = {
  titulo: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("Qué hay que hacer, en una línea. Como lo escribiría una persona del equipo."),
  detalle: z
    .string()
    .max(4000)
    .optional()
    .describe("El contexto, el criterio de aceptación, lo que haga falta para empezar."),
  columna: z.string().optional().describe("En qué columna. Por defecto, la primera del tablero."),
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  responsable: z.string().optional().describe("Nombre de la persona a la que se asigna."),
  area: z
    .string()
    .optional()
    .describe("En qué área se archiva. Si el área tiene responsable, se asigna a esa persona."),
  vence: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Fecha límite en formato AAAA-MM-DD."),
  ...esquemaFicha,
  organizacion: z.string().optional(),
};

export const descripcionCrearTarea = [
  "Crea una tarea en el tablero de un espacio de trabajo. Escribe de verdad: la",
  "van a ver todas las personas del equipo.",
  "",
  "Para convertir un plan en trabajo repartido. Se llama una vez por tarea, y",
  "conviene que cada una sea algo que alguien pueda terminar — no «hacer el",
  "módulo de pagos», sino los pasos en los que eso se parte.",
  "",
  "Todo lo que se cree por aquí queda con la etiqueta «agente», para que el",
  "equipo vea de un vistazo qué salió de un modelo y pueda revisarlo o",
  "deshacerlo en bloque. No se puede desactivar, y es lo que hace aceptable que",
  "un modelo escriba en el tablero de otros.",
  "",
  "Si el tablero no tiene columnas, primero `crear_columna`.",
].join("\n");

export async function crearTarea(
  cliente: ClienteApi,
  entrada: {
    titulo: string;
    detalle?: string;
    columna?: string;
    espacio?: string;
    responsable?: string;
    area?: string;
    vence?: string;
    organizacion?: string;
  } & Ficha,
): Promise<string> {
  const espacio: Espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const columna = resolverColumna(await tablero(cliente, espacio.id), entrada.columna);
  const etiqueta = await etiquetaDeAgente(cliente, entrada.organizacion);
  const responsable = entrada.responsable
    ? await resolverPersona(cliente, entrada.responsable, entrada.organizacion)
    : null;

  let area: Area | null = null;
  if (entrada.area) {
    const resuelta = resolverArea(await areas(cliente, espacio.id), entrada.area);
    if (typeof resuelta === "string") return resuelta;
    area = resuelta;
  }

  const { task } = await cliente.post<{ task: { id: string; title: string } }>(
    `/workspaces/${espacio.id}/tasks`,
    {
      columnId: columna.id,
      title: entrada.titulo,
      description: entrada.detalle ?? "",
      assigneeId: responsable,
      dueDate: entrada.vence ?? null,
      tagIds: [etiqueta],
      categoryId: area?.id ?? null,
      ...campoDeFicha(entrada),
    },
  );

  const trozos = [`en ${espacio.name} / ${columna.name}`];
  if (entrada.tipo) trozos.push(entrada.tipo);
  if (entrada.prioridad && entrada.prioridad !== "normal") {
    trozos.push(`prioridad ${entrada.prioridad}`);
  }
  if (area) trozos.push(`área ${area.name}`);
  // Quien la lleva puede venir del área sin que nadie lo dijera: se nombra
  // igual, porque enterarse después de a quién se le asignó es peor.
  if (entrada.responsable) trozos.push(`para ${entrada.responsable}`);
  else if (area?.ownerName) trozos.push(`para ${area.ownerName}, que lleva el área`);
  if (entrada.vence) trozos.push(`vence el ${entrada.vence}`);
  return `Creada «${task.title}» ${trozos.join(", ")}, con la etiqueta «${ETIQUETA_AGENTE}».  [tarea ${task.id}]`;
}

// ---------------------------------------------------------------------------
// crear_columna
// ---------------------------------------------------------------------------

export const esquemaCrearColumna = {
  nombre: z.string().trim().min(1).max(60).describe("Cómo se llama la columna."),
  espacio: z.string().optional(),
  organizacion: z.string().optional(),
};

export const descripcionCrearColumna = [
  "Crea una columna en el tablero. Se usa solo cuando el tablero está vacío o",
  "cuando el plan de verdad necesita una etapa que no existe.",
  "",
  "No inventes columnas por gusto: un tablero con ocho columnas que nadie usa",
  "es peor que uno con tres. Si ya hay dónde poner la tarea, usa esa.",
].join("\n");

export async function crearColumna(
  cliente: ClienteApi,
  entrada: { nombre: string; espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  await cliente.post(`/workspaces/${espacio.id}/columns`, { name: entrada.nombre });
  return `Columna «${entrada.nombre}» creada en ${espacio.name}.`;
}

// ---------------------------------------------------------------------------
// mover_tarea
// ---------------------------------------------------------------------------

export const esquemaMoverTarea = {
  tarea: z.string().describe("El identificador de la tarea, o su título."),
  columna: z.string().describe("A qué columna se mueve."),
  espacio: z.string().optional(),
  organizacion: z.string().optional(),
};

export const descripcionMoverTarea = [
  "Mueve una tarea de columna: es cómo se marca que algo empezó, se terminó o",
  "se quedó bloqueado.",
  "",
  "Acepta el identificador que devuelven las otras herramientas o el título. Si",
  "el título encaja con varias, lo dice en vez de elegir.",
].join("\n");

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function moverTarea(
  cliente: ClienteApi,
  entrada: { tarea: string; columna: string; espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const columnas = await tablero(cliente, espacio.id);
  const destino = resolverColumna(columnas, entrada.columna);

  const buscado = entrada.tarea.trim();
  const porId = ES_UUID.test(buscado);
  const candidatas = columnas.flatMap((c) =>
    c.tasks
      .filter((t) => (porId ? t.id === buscado : t.title.toLowerCase().includes(buscado.toLowerCase())))
      .map((t) => ({ ...t, columna: c.name })),
  );

  if (candidatas.length === 0) {
    return porId
      ? "No encontré ninguna tarea con ese identificador en este espacio."
      : `No encontré ninguna tarea que sea «${buscado}».`;
  }
  if (candidatas.length > 1) {
    return (
      `«${buscado}» encaja con ${candidatas.length} tareas. Dime cuál:\n` +
      candidatas.map((t) => `- ${t.title} (${t.columna})  [tarea ${t.id}]`).join("\n")
    );
  }

  const tarea = candidatas[0]!;
  if (tarea.columna === destino.name) {
    return `«${tarea.title}» ya estaba en ${destino.name}.`;
  }
  await cliente.post(`/tasks/${tarea.id}/move`, { columnId: destino.id, afterTaskId: null });
  return `«${tarea.title}» movida de ${tarea.columna} a ${destino.name}.`;
}

// ---------------------------------------------------------------------------
// actualizar_tarea
// ---------------------------------------------------------------------------

export const esquemaActualizarTarea = {
  tarea: z.string().describe("El identificador de la tarea."),
  titulo: z.string().trim().min(1).max(200).optional(),
  detalle: z.string().max(4000).optional().describe("Reemplaza el detalle escrito."),
  responsable: z
    .string()
    .optional()
    .describe("Nombre de la persona. Cadena vacía para dejarla sin asignar."),
  vence: z
    .string()
    .optional()
    .describe("AAAA-MM-DD, o cadena vacía para quitar la fecha."),
  ...esquemaFicha,
  organizacion: z.string().optional(),
};

export const descripcionActualizarTarea = [
  "Cambia una tarea que ya existe: su título, su detalle, quién la tiene, cuándo",
  "vence, qué clase de trabajo es, cuánto corre, de dónde sale o cuándo estará",
  "hecha. Solo se toca lo que se le pase; lo que se omite se queda como estaba.",
  "",
  "Pide el identificador, no el título, porque esto sobrescribe: equivocarse de",
  "tarea aquí borra el trabajo escrito de otra persona. Sácalo antes con",
  "`ver_tablero` o `mis_tareas`.",
].join("\n");

export async function actualizarTarea(
  cliente: ClienteApi,
  entrada: {
    tarea: string;
    titulo?: string;
    detalle?: string;
    responsable?: string;
    vence?: string;
    organizacion?: string;
  } & Ficha,
): Promise<string> {
  if (!ES_UUID.test(entrada.tarea.trim())) {
    return (
      "Para cambiar una tarea hace falta su identificador, no su título: esto " +
      "sobrescribe lo que hubiera escrito. Sácalo con `ver_tablero` o `mis_tareas`."
    );
  }

  const cambios: Record<string, unknown> = campoDeFicha(entrada);
  if (entrada.titulo !== undefined) cambios.title = entrada.titulo;
  if (entrada.detalle !== undefined) cambios.description = entrada.detalle;
  if (entrada.vence !== undefined) cambios.dueDate = entrada.vence === "" ? null : entrada.vence;
  if (entrada.responsable !== undefined) {
    cambios.assigneeId =
      entrada.responsable === ""
        ? null
        : await resolverPersona(cliente, entrada.responsable, entrada.organizacion);
  }

  if (Object.keys(cambios).length === 0) return "No me dijiste qué cambiar.";

  const { task } = await cliente.patch<{ task: { id: string; title: string } }>(
    `/tasks/${entrada.tarea.trim()}`,
    cambios,
  );
  return `«${task.title}» actualizada: ${Object.keys(cambios).join(", ")}.`;
}

// ---------------------------------------------------------------------------
// enlazar_rama
// ---------------------------------------------------------------------------

export const esquemaEnlazarRama = {
  tarea: z.string().describe("El identificador de la tarea."),
  rama: z.string().trim().min(1).max(255).describe("El nombre de la rama, tal cual."),
  estado: z
    .enum(["abierta", "fusionada", "descartada"])
    .optional()
    .describe(
      "abierta por defecto. «descartada» para un camino que se probó y se " +
        "abandonó: se deja apuntado en vez de borrarlo, porque quien lo vuelva " +
        "a pensar merece saber que ya se intentó.",
    ),
  organizacion: z.string().optional(),
};

export const descripcionEnlazarRama = [
  "Apunta en una tarea la rama donde se está trabajando, o cambia su estado.",
  "",
  "Una tarea puede tener varias: si el trabajo se parte en dos caminos —la API",
  "por un lado y la interfaz por otro, o una prueba de concepto en paralelo—,",
  "son dos ramas de la misma tarea y no dos tareas.",
  "",
  "Es para lo que el equipo no puede saber de otra forma: mirando el tablero,",
  "«¿quién está tocando pagos?» solo se contesta si la rama está apuntada. No",
  "hace falta tener el repositorio conectado — se guarda el nombre tal cual.",
].join("\n");

export async function enlazarRama(
  cliente: ClienteApi,
  entrada: { tarea: string; rama: string; estado?: string; organizacion?: string },
): Promise<string> {
  if (!ES_UUID.test(entrada.tarea.trim())) {
    return (
      "Para enlazar una rama hace falta el identificador de la tarea, no su " +
      "título. Sácalo con `ver_tablero` o `mis_tareas`."
    );
  }

  const { task } = await cliente.post<{ task: { title: string } }>(
    `/tasks/${entrada.tarea.trim()}/ramas`,
    { nombre: entrada.rama, estado: entrada.estado ?? "abierta" },
  );
  const estado = entrada.estado && entrada.estado !== "abierta" ? ` (${entrada.estado})` : "";
  return `Rama ${entrada.rama}${estado} enlazada a «${task.title}».`;
}

// ---------------------------------------------------------------------------
// marcar_hecha
// ---------------------------------------------------------------------------

export const esquemaMarcarHecha = {
  tarea: z.string().describe("El identificador de la tarea."),
  prueba_tipo: z
    .enum(["pr", "commit", "enlace", "nota"])
    .optional()
    .describe("Qué clase de prueba se deja. Omitir para cerrar sin dejar ninguna."),
  prueba_url: z
    .string()
    .optional()
    .describe("El enlace, para pr, commit o enlace. No se usa con nota."),
  prueba_nota: z
    .string()
    .max(2000)
    .optional()
    .describe("Para una nota: qué se comprobó y dónde."),
  organizacion: z.string().optional(),
};

export const descripcionMarcarHecha = [
  "Cierra una tarea: la mueve a la columna final del tablero y, si se le pasa,",
  "deja en ella la prueba de que se hizo.",
  "",
  "No hay que decir a qué columna: la busca. Y las dos cosas —cerrar y dejar la",
  "prueba— caen juntas, así que o se cerró con su prueba o no se cerró.",
  "",
  "DEJA LA PRUEBA SIEMPRE QUE LA TENGAS. Si acabas de abrir un PR que cierra",
  "esta tarea, ese PR es la prueba; si comprobaste algo a mano, dilo como",
  "`nota`. La evidencia queda con el nombre de quien conectó esta sesión y su",
  "fecha, y no se puede editar después. Cerrar sin prueba está permitido —hay",
  "trabajo que no deja rastro en ningún sitio— pero es lo segundo mejor.",
  "",
  "Pide el identificador, no el título: cerrar la tarea equivocada le dice al",
  "equipo que algo está hecho cuando no lo está.",
].join("\n");

export async function marcarHecha(
  cliente: ClienteApi,
  entrada: {
    tarea: string;
    prueba_tipo?: "pr" | "commit" | "enlace" | "nota";
    prueba_url?: string;
    prueba_nota?: string;
    organizacion?: string;
  },
): Promise<string> {
  if (!ES_UUID.test(entrada.tarea.trim())) {
    return (
      "Para cerrar una tarea hace falta su identificador, no su título: cerrar " +
      "la equivocada le dice al equipo que algo está hecho cuando no lo está. " +
      "Sácalo con `ver_tablero` o `mis_tareas`."
    );
  }

  // Las dos formas de mandar una prueba incompleta se contestan explicando qué
  // falta, no dejando que la API devuelva un error de validación que el modelo
  // no puede convertir en nada útil para la persona.
  if (entrada.prueba_tipo && entrada.prueba_tipo !== "nota" && !entrada.prueba_url) {
    return `Una prueba de tipo «${entrada.prueba_tipo}» tiene que apuntar a algo: falta prueba_url.`;
  }
  if (entrada.prueba_tipo === "nota" && !entrada.prueba_nota) {
    return "Una nota sin texto no prueba nada: falta prueba_nota.";
  }

  const evidencia = entrada.prueba_tipo
    ? {
        tipo: entrada.prueba_tipo,
        url: entrada.prueba_tipo === "nota" ? null : entrada.prueba_url,
        nota: entrada.prueba_nota ?? "",
      }
    : undefined;

  const { task } = await cliente.post<{ task: { title: string; evidencias: number } }>(
    `/tasks/${entrada.tarea.trim()}/hecha`,
    evidencia ? { evidencia } : {},
  );

  return evidencia
    ? `«${task.title}» cerrada, con su prueba adjunta.`
    : `«${task.title}» cerrada. No se dejó ninguna prueba de que se hizo.`;
}
