import { z } from "zod";
import type { ClienteApi } from "../api.js";
import { resolverEspacio } from "../espacios.js";
import { resolverOrganizacion } from "../organizaciones.js";
import { zonaDe } from "./canales.js";

/**
 * Lo que tiene fecha o llega sin pedirlo: reuniones, anuncios y avisos.
 *
 * Tres cosas que el MCP no veía y que son justo lo que se pregunta a primera
 * hora —«¿qué reuniones tengo hoy?», «¿ha dicho algo la dirección?», «¿qué me
 * ha llegado?»—. Van juntas porque las tres contestan a «qué me espera».
 */

function fecha(iso: string, zona: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zona,
  });
}

// ── ver_reuniones ────────────────────────────────────────────────────────────

type Reunion = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  durationMinutes: number;
  channelName: string | null;
  attendeeCount: number;
  attending: boolean;
};

export const esquemaVerReuniones = {
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Solo si pertenece a varias organizaciones."),
  incluir_pasadas: z
    .boolean()
    .optional()
    .describe("Incluir las que ya terminaron. Por defecto NO: se pregunta por lo que viene."),
};

export const descripcionVerReuniones = [
  "Las reuniones con hora de un espacio de DevUP (las de DevCall): cuándo",
  "empiezan, cuánto duran, en qué sala, cuánta gente va y si la persona está",
  "apuntada.",
  "",
  "Las horas salen en la zona horaria que la persona tiene puesta en su cuenta.",
].join("\n");

export async function verReuniones(
  cliente: ClienteApi,
  entrada: { espacio?: string; organizacion?: string; incluir_pasadas?: boolean },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const [{ events }, zona] = await Promise.all([
    cliente.get<{ events: Reunion[] }>(`/workspaces/${espacio.id}/events`),
    zonaDe(cliente),
  ]);

  const ahora = Date.now();
  const vigentes = entrada.incluir_pasadas
    ? events
    : events.filter((e) => new Date(e.startsAt).getTime() + e.durationMinutes * 60_000 > ahora);

  if (vigentes.length === 0) {
    return entrada.incluir_pasadas
      ? `${espacio.name} no tiene reuniones.`
      : `${espacio.name} no tiene reuniones por delante.`;
  }

  const lineas = [`Reuniones de ${espacio.name} (hora de ${zona}):`, ""];
  for (const e of vigentes) {
    const sala = e.channelName ? ` en ${e.channelName}` : "";
    const voy = e.attending ? "vas" : "no estás apuntada/o";
    const enCurso =
      new Date(e.startsAt).getTime() <= ahora &&
      new Date(e.startsAt).getTime() + e.durationMinutes * 60_000 > ahora
        ? "  ← EN CURSO"
        : "";
    lineas.push(
      `· ${fecha(e.startsAt, zona)} · ${e.durationMinutes} min — «${e.title}»${sala} ` +
        `(${e.attendeeCount} apuntada(s); ${voy})${enCurso}`,
    );
    if (e.description) lineas.push(`    ${e.description}`);
  }
  return lineas.join("\n");
}

// ── crear_reunion ────────────────────────────────────────────────────────────

/**
 * La hora TIENE que llevar su zona. Sin ella, «a las tres» se interpreta en la
 * del servidor —UTC—, y alguien en Bogotá convoca una reunión cinco horas
 * antes de lo que quería sin que nada le avise.
 */
const CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export const esquemaCrearReunion = {
  titulo: z.string().trim().min(1).max(120),
  empieza: z
    .string()
    .regex(CON_ZONA, "la hora tiene que llevar su zona: 2026-09-30T15:00-05:00, o Z si es UTC")
    .describe(
      "Cuándo empieza, en ISO 8601 CON su desfase: 2026-09-30T15:00-05:00. " +
        "Usa la zona de la persona; si no la sabes, pregúntala.",
    ),
  minutos: z.number().int().min(1).max(1440).describe("Cuánto dura, en minutos."),
  descripcion: z.string().trim().max(2000).optional(),
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Solo si pertenece a varias organizaciones."),
};

export const descripcionCrearReunion = [
  "Convoca una reunión con hora en un espacio de DevUP. Escribe de verdad: la",
  "ve todo el equipo del espacio, y la persona queda apuntada.",
  "",
  "La hora va en ISO 8601 con su desfase (2026-09-30T15:00-05:00). Sin desfase",
  "se rechaza, porque se interpretaría en UTC y la reunión caería a otra hora.",
].join("\n");

export async function crearReunion(
  cliente: ClienteApi,
  entrada: {
    titulo: string;
    empieza: string;
    minutos: number;
    descripcion?: string;
    espacio?: string;
    organizacion?: string;
  },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const inicio = new Date(entrada.empieza);
  if (Number.isNaN(inicio.getTime())) throw new Error(`«${entrada.empieza}» no es una fecha.`);

  const [{ event }, zona] = await Promise.all([
    cliente.post<{ event: Reunion }>(`/workspaces/${espacio.id}/events`, {
      title: entrada.titulo,
      description: entrada.descripcion ?? "",
      // La API pide UTC. La conversión es aquí, con la zona que vino escrita.
      startsAt: inicio.toISOString(),
      durationMinutes: entrada.minutos,
    }),
    zonaDe(cliente),
  ]);
  return (
    `Convocada «${event.title}» en ${espacio.name}: ${fecha(event.startsAt, zona)} ` +
    `(hora de ${zona}), ${event.durationMinutes} min.`
  );
}

// ── ver_anuncios ─────────────────────────────────────────────────────────────

type Anuncio = { id: string; title: string; body: string; createdAt: string; authorName: string };

export const esquemaVerAnuncios = {
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
  cuantos: z.number().int().min(1).max(50).optional().describe("Cuántos, los más recientes. Por defecto 10."),
};

export const descripcionVerAnuncios = [
  "El tablón de anuncios de una organización de DevUP: lo que se ha publicado",
  "para todo el mundo, con quién lo publicó y cuándo.",
].join("\n");

export async function verAnuncios(
  cliente: ClienteApi,
  entrada: { organizacion?: string; cuantos?: number },
): Promise<string> {
  const organizacion = await resolverOrganizacion(cliente, entrada.organizacion);
  const [{ announcements }, zona] = await Promise.all([
    cliente.get<{ announcements: Anuncio[] }>(`/organizations/${organizacion.id}/announcements`),
    zonaDe(cliente),
  ]);
  if (announcements.length === 0) return `${organizacion.name} no ha publicado ningún anuncio.`;

  const lineas = [`Anuncios de ${organizacion.name}:`, ""];
  for (const a of announcements.slice(0, entrada.cuantos ?? 10)) {
    lineas.push(`■ «${a.title}» — ${a.authorName}, ${fecha(a.createdAt, zona)}`, `  ${a.body}`, "");
  }
  return lineas.join("\n").trimEnd();
}

// ── publicar_anuncio ─────────────────────────────────────────────────────────

export const esquemaPublicarAnuncio = {
  titulo: z.string().trim().min(1).max(140),
  texto: z.string().trim().min(1).max(4000),
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
};

export const descripcionPublicarAnuncio = [
  "Publica un anuncio en el tablón de una organización de DevUP. AVISA A TODAS",
  "las personas de la organización, con una notificación cada una: es lo más",
  "ruidoso que se puede hacer desde aquí.",
  "",
  "Solo cuando la persona lo pida con esas palabras. Si lo que vas a publicar",
  "no te lo ha dictado, enséñaselo antes y pregunta.",
].join("\n");

export async function publicarAnuncio(
  cliente: ClienteApi,
  entrada: { titulo: string; texto: string; organizacion?: string },
): Promise<string> {
  const organizacion = await resolverOrganizacion(cliente, entrada.organizacion);
  await cliente.post(`/organizations/${organizacion.id}/announcements`, {
    title: entrada.titulo,
    body: entrada.texto,
  });

  /**
   * UNA VEZ PUBLICADO, NADA DE AQUÍ ABAJO PUEDE DECIR QUE FALLÓ.
   *
   * Un agente que lee «No pude» lo reintenta, y cada reintento de esto avisa a
   * la organización entera otra vez. Así que el recuento de a quién le llegó
   * va aparte y, si no se puede saber, se publica igual y se dice sin número.
   *
   * La ruta avisa a todos los miembros menos a quien publica; por eso el
   * recuento se saca de la lista de miembros y no de la respuesta, que no lo
   * trae.
   */
  let avisadas = "avisada toda la organización";
  try {
    const { members } = await cliente.get<{ members: unknown[] }>(
      `/organizations/${organizacion.id}/members`,
    );
    avisadas = `avisadas ${Math.max(0, members.length - 1)} persona(s)`;
  } catch {
    /* publicado igual; solo no se sabe cuántas */
  }
  return `Publicado «${entrada.titulo}» en ${organizacion.name}; ${avisadas}.`;
}

// ── mis_avisos ───────────────────────────────────────────────────────────────

type Aviso = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
  actorName: string;
};

const CLASES: Record<string, string> = {
  mention: "te nombraron",
  task_assigned: "tarea para ti",
  recording: "grabación lista",
  announcement: "anuncio",
  invitation: "invitación",
};

export const esquemaMisAvisos = {
  todos: z
    .boolean()
    .optional()
    .describe("Incluir también los ya leídos. Por defecto solo los que no has leído."),
};

export const descripcionMisAvisos = [
  "La campana de la persona en DevUP: menciones, tareas que le asignaron,",
  "grabaciones listas, anuncios e invitaciones. Por defecto solo lo no leído.",
  "",
  "No los marca como leídos: lo has visto tú, no ella.",
].join("\n");

export async function misAvisos(cliente: ClienteApi, entrada: { todos?: boolean }): Promise<string> {
  const [{ notifications, unread }, zona] = await Promise.all([
    cliente.get<{ notifications: Aviso[]; unread: number }>(
      `/notifications?limit=30${entrada.todos ? "" : "&unreadOnly=true"}`,
    ),
    zonaDe(cliente),
  ]);
  if (notifications.length === 0) {
    return entrada.todos ? "No tienes avisos." : "No tienes avisos sin leer.";
  }
  const lineas = [`${unread} aviso(s) sin leer.`, ""];
  for (const n of notifications) {
    const quien = n.actorName ? `${n.actorName} · ` : "";
    const leido = n.readAt ? "" : "● ";
    lineas.push(
      `${leido}[${CLASES[n.kind] ?? n.kind}] ${quien}${n.title} — ${fecha(n.createdAt, zona)}` +
        (n.body ? `\n    ${n.body}` : ""),
    );
  }
  return lineas.join("\n");
}
