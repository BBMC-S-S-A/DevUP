import { z } from "zod";
import type { ClienteDevUP } from "../api.js";
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
async function etiquetaDeAgente(cliente: ClienteDevUP, organizacion?: string): Promise<string> {
  const org = await resolverOrganizacion(cliente, organizacion);
  const { tag } = await cliente.post<{ tag: Etiqueta }>(`/organizations/${org.id}/tags`, {
    name: ETIQUETA_AGENTE,
    color: "violet",
  });
  return tag.id;
}

/** El tablero del espacio, que hace falta para resolver columnas por nombre. */
async function tablero(cliente: ClienteDevUP, espacioId: string): Promise<Columna[]> {
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
async function resolverPersona(
  cliente: ClienteDevUP,
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
  vence: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Fecha límite en formato AAAA-MM-DD."),
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
  cliente: ClienteDevUP,
  entrada: {
    titulo: string;
    detalle?: string;
    columna?: string;
    espacio?: string;
    responsable?: string;
    vence?: string;
    organizacion?: string;
  },
): Promise<string> {
  const espacio: Espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const columna = resolverColumna(await tablero(cliente, espacio.id), entrada.columna);
  const etiqueta = await etiquetaDeAgente(cliente, entrada.organizacion);
  const responsable = entrada.responsable
    ? await resolverPersona(cliente, entrada.responsable, entrada.organizacion)
    : null;

  const { task } = await cliente.post<{ task: { id: string; title: string } }>(
    `/workspaces/${espacio.id}/tasks`,
    {
      columnId: columna.id,
      title: entrada.titulo,
      description: entrada.detalle ?? "",
      assigneeId: responsable,
      dueDate: entrada.vence ?? null,
      tagIds: [etiqueta],
    },
  );

  const trozos = [`en ${espacio.name} / ${columna.name}`];
  if (entrada.responsable) trozos.push(`para ${entrada.responsable}`);
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
  cliente: ClienteDevUP,
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
  cliente: ClienteDevUP,
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
  organizacion: z.string().optional(),
};

export const descripcionActualizarTarea = [
  "Cambia una tarea que ya existe: su título, su detalle, quién la tiene o",
  "cuándo vence. Solo se toca lo que se le pase; lo que se omite se queda como",
  "estaba.",
  "",
  "Pide el identificador, no el título, porque esto sobrescribe: equivocarse de",
  "tarea aquí borra el trabajo escrito de otra persona. Sácalo antes con",
  "`ver_tablero` o `mis_tareas`.",
].join("\n");

export async function actualizarTarea(
  cliente: ClienteDevUP,
  entrada: {
    tarea: string;
    titulo?: string;
    detalle?: string;
    responsable?: string;
    vence?: string;
    organizacion?: string;
  },
): Promise<string> {
  if (!ES_UUID.test(entrada.tarea.trim())) {
    return (
      "Para cambiar una tarea hace falta su identificador, no su título: esto " +
      "sobrescribe lo que hubiera escrito. Sácalo con `ver_tablero` o `mis_tareas`."
    );
  }

  const cambios: Record<string, unknown> = {};
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
