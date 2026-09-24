import { z } from "zod";
import type { ClienteApi } from "../api.js";
import { resolverEspacio } from "../espacios.js";

/**
 * Los canales: leer lo que se ha hablado y escribir en ellos.
 *
 * ERA EL HUECO MÁS GRANDE DEL MCP. Un agente podía crear una tarea, moverla y
 * cerrarla, pero no podía leer el canal donde se decidió hacerla ni avisar en
 * él de que ya estaba. La mitad del trabajo de un equipo pasa por aquí, y un
 * asistente que no lo ve contesta sin contexto.
 *
 * LEER NO MARCA COMO LEÍDO, y es a propósito. Quien pregunta «¿qué se ha dicho
 * en #general?» no lo ha leído: lo ha leído su agente. Si esto moviera el
 * contador, la persona abriría DevUP y no sabría qué tiene pendiente, que es
 * justo lo que el contador existe para decirle.
 *
 * ESCRIBIR ESCRIBE COMO LA PERSONA, con su nombre. No hay «mensaje del agente»
 * aparte: el servidor no lo distingue, y quien lo lea tampoco. Por eso la
 * descripción dice que solo se escriba lo que la persona ha pedido escribir.
 */

type Canal = { id: string; name: string; kind: "text" | "voice"; isPrivate: boolean };

type Mensaje = {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  authorName: string;
  file: { name: string } | null;
  replyTo: { authorName: string; body?: string } | null;
};

/** Se busca como se escribe: con o sin almohadilla, con o sin mayúsculas. */
function limpiar(nombre: string): string {
  return nombre.trim().replace(/^#/, "").toLowerCase();
}

async function resolverCanal(
  cliente: ClienteApi,
  espacioId: string,
  nombre: string,
): Promise<Canal> {
  const { channels } = await cliente.get<{ channels: Canal[] }>(
    `/workspaces/${espacioId}/channels`,
  );
  const buscado = limpiar(nombre);
  const exacto = channels.find((c) => c.name.toLowerCase() === buscado);
  if (exacto) return exacto;
  const parciales = channels.filter((c) => c.name.toLowerCase().includes(buscado));
  if (parciales.length === 1) return parciales[0]!;
  throw new Error(
    parciales.length === 0
      ? `No hay ningún canal «${nombre}». Hay: ${channels.map((c) => `#${c.name}`).join(", ")}.`
      : `«${nombre}» encaja con varios: ${parciales.map((c) => `#${c.name}`).join(", ")}.`,
  );
}

/** «lun 22, 14:05». Con la zona de quien pregunta, no la del servidor. */
function hora(iso: string, zona: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    weekday: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zona,
  });
}

/**
 * La zona horaria de quien pregunta, o UTC si no la ha puesto.
 *
 * El servidor MCP remoto corre en UTC. Sin esto, alguien en Bogotá leería que
 * un mensaje de las nueve de la mañana se escribió a las dos de la tarde.
 */
export async function zonaDe(cliente: ClienteApi): Promise<string> {
  try {
    const { user } = await cliente.get<{ user: { timezone: string | null } }>("/auth/me");
    return user.timezone || "UTC";
  } catch {
    return "UTC";
  }
}

// ── ver_canales ──────────────────────────────────────────────────────────────

export const esquemaVerCanales = {
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Solo si pertenece a varias organizaciones."),
};

export const descripcionVerCanales = [
  "Los canales de un espacio de trabajo de DevUP: los de texto con cuántos",
  "mensajes tienes sin leer, y los de voz con quién hay dentro ahora mismo.",
  "",
  "Para «¿qué canales hay?», «¿dónde tengo cosas sin leer?» o «¿hay alguien en",
  "la sala de voz?». Para leer uno, `leer_canal` con su nombre.",
].join("\n");

export async function verCanales(
  cliente: ClienteApi,
  entrada: { espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const [{ channels }, { unread }, voz] = await Promise.all([
    cliente.get<{ channels: Canal[] }>(`/workspaces/${espacio.id}/channels`),
    cliente.get<{ unread: Record<string, number> }>(`/workspaces/${espacio.id}/unread`),
    cliente
      .get<{ salas: Record<string, { displayName: string; muted: boolean }[]> }>(
        `/workspaces/${espacio.id}/voz`,
      )
      // Quién está en voz vive en memoria del servidor de señalización; si no
      // contesta, los canales de texto se enseñan igual.
      .catch(() => ({ salas: {} as Record<string, { displayName: string; muted: boolean }[]> })),
  ]);

  if (channels.length === 0) return `${espacio.name} no tiene canales todavía.`;

  const lineas = [`Canales de ${espacio.name}:`, ""];
  const texto = channels.filter((c) => c.kind === "text");
  const salas = channels.filter((c) => c.kind === "voice");

  for (const c of texto) {
    const n = unread[c.id] ?? 0;
    const privado = c.isPrivate ? " (privado)" : "";
    lineas.push(`· #${c.name}${privado}${n > 0 ? ` — ${n} sin leer` : ""}`);
  }
  if (salas.length > 0) {
    lineas.push("", "Salas de voz:");
    for (const c of salas) {
      const dentro = voz.salas[c.id] ?? [];
      lineas.push(
        `· ${c.name} — ${
          dentro.length === 0
            ? "vacía"
            : dentro.map((p) => `${p.displayName}${p.muted ? " (silenciado)" : ""}`).join(", ")
        }`,
      );
    }
  }
  return lineas.join("\n");
}

// ── leer_canal ───────────────────────────────────────────────────────────────

export const esquemaLeerCanal = {
  canal: z.string().trim().min(1).describe("Nombre del canal, con o sin #."),
  cuantos: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Cuántos mensajes, los más recientes. Por defecto 30."),
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Solo si pertenece a varias organizaciones."),
};

export const descripcionLeerCanal = [
  "Los últimos mensajes de un canal de DevUP, del más viejo al más nuevo, con",
  "quién escribió cada uno y cuándo.",
  "",
  "Para «¿qué se ha dicho en #general?», «¿qué decidieron sobre X?» o para",
  "tener el contexto de una conversación antes de contestar.",
  "",
  "NO los marca como leídos: los has leído tú, no la persona. Su contador de",
  "pendientes se queda como estaba.",
].join("\n");

export async function leerCanal(
  cliente: ClienteApi,
  entrada: { canal: string; cuantos?: number; espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const canal = await resolverCanal(cliente, espacio.id, entrada.canal);
  if (canal.kind === "voice") {
    return `#${canal.name} es una sala de voz: no tiene mensajes. Para ver quién hay dentro, \`ver_canales\`.`;
  }

  const cuantos = entrada.cuantos ?? 30;
  const [{ messages }, zona] = await Promise.all([
    cliente.get<{ messages: Mensaje[] }>(`/channels/${canal.id}/messages?limit=${cuantos}`),
    zonaDe(cliente),
  ]);

  if (messages.length === 0) return `#${canal.name} no tiene mensajes todavía.`;

  const lineas = [`#${canal.name} en ${espacio.name} — últimos ${messages.length}:`, ""];
  for (const m of messages) {
    const respuesta = m.replyTo ? ` (respondiendo a ${m.replyTo.authorName})` : "";
    const adjunto = m.file ? ` [adjunto: ${m.file.name}]` : "";
    const editado = m.editedAt ? " (editado)" : "";
    lineas.push(`[${hora(m.createdAt, zona)}] ${m.authorName}${respuesta}: ${m.body}${adjunto}${editado}`);
  }
  if (messages.length === cuantos) {
    lineas.push("", `(hay más atrás; pide más con «cuantos», hasta 100)`);
  }
  return lineas.join("\n");
}

// ── escribir_en_canal ────────────────────────────────────────────────────────

export const esquemaEscribirEnCanal = {
  canal: z.string().trim().min(1).describe("Nombre del canal, con o sin #."),
  texto: z.string().trim().min(1).max(8000).describe("Lo que se publica, tal cual."),
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Solo si pertenece a varias organizaciones."),
};

export const descripcionEscribirEnCanal = [
  "Publica un mensaje en un canal de DevUP. Escribe de verdad y COMO LA PERSONA:",
  "sale con su nombre, y el equipo no puede distinguirlo de uno suyo.",
  "",
  "Úsalo solo para lo que la persona ha pedido decir —«avisa en #general de",
  "que el despliegue ya está»—, nunca por iniciativa propia. Si lo que vas a",
  "escribir no te lo han dictado, enséñaselo antes y pregunta.",
].join("\n");

export async function escribirEnCanal(
  cliente: ClienteApi,
  entrada: { canal: string; texto: string; espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const canal = await resolverCanal(cliente, espacio.id, entrada.canal);
  if (canal.kind === "voice") {
    throw new Error(`#${canal.name} es una sala de voz: no admite mensajes escritos.`);
  }
  await cliente.post(`/channels/${canal.id}/messages`, { body: entrada.texto });
  return `Publicado en #${canal.name} de ${espacio.name}.`;
}
