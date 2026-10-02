import { z } from "zod";
import type { ClienteApi } from "../api.js";
import { resolverEspacio } from "../espacios.js";

/**
 * Sesiones de trabajo: dejar escrito lo que se hizo, y recogerlo después.
 *
 * LAS DOS MITADES DE LO MISMO. Lo que se pidió fue poder decirle a cualquier
 * IA «recoge el contexto de lo que tenemos». `ver_sesiones` es esa mitad; pero
 * solo funciona si antes alguien escribió algo, y eso es `registrar_sesion`: al
 * terminar una sesión, la IA deja el resumen, las decisiones con su porqué,
 * los PRs y lo pendiente.
 *
 * NO SE MANDAN LOS HECHOS. Qué tareas se movieron o qué archivos se subieron
 * ya lo sabe DevUP por el registro de actividad; la API los junta sola al
 * pedir el detalle, por la ventana de tiempo de la sesión. Aquí solo va lo que
 * DevUP no puede ver: lo que se decidió y lo que pasó fuera (GitHub, archivos
 * en local).
 *
 * VAN MARCADAS COMO DE AGENTE. Se registran con `procedencia: "agente"`, igual
 * que lo que crea el MCP en el tablero: «lo resumió Claude por Ana» no se lee
 * igual que «lo escribió Ana».
 */

type Pr = { repo: string; numero?: number; url?: string; titulo?: string; estado?: string };

type Sesion = {
  id: string;
  titulo: string;
  resumen: string;
  decisiones: string[];
  pendientes: string[];
  prs: Pr[];
  archivos: string[];
  procedencia: "persona" | "agente";
  inicio: string;
  fin: string;
  autorNombre?: string | null;
};

type Hecho = { verbo: string; sujeto: string; sujetoNombre: string; cuando: string };
type Subido = { nombre: string; cuando: string };

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── registrar_sesion ─────────────────────────────────────────────────────────

export const esquemaRegistrarSesion = {
  titulo: z.string().trim().min(1).max(160).describe("Qué se hizo, en una línea: «Módulo 8 v2 de Lázaro»."),
  resumen: z
    .string()
    .trim()
    .max(8000)
    .optional()
    .describe("Lo que pasó en la sesión, en unos párrafos. Markdown vale."),
  decisiones: z
    .array(z.string().trim().min(1).max(500))
    .max(40)
    .optional()
    .describe("Cada decisión CON su porqué: «.NET 10, porque el Edge ya lo usa»."),
  pendientes: z.array(z.string().trim().min(1).max(500)).max(40).optional().describe("Lo que quedó abierto."),
  prs: z
    .array(
      z.object({
        repo: z.string().trim().min(1).max(200).describe("«organización/repositorio»."),
        numero: z.number().int().positive().optional(),
        url: z.string().url().optional(),
        titulo: z.string().trim().max(200).optional(),
        estado: z.string().trim().max(40).optional().describe("abierto, fusionado, cerrado…"),
      }),
    )
    .max(30)
    .optional(),
  archivos: z
    .array(z.string().trim().min(1).max(300))
    .max(60)
    .optional()
    .describe(
      "Archivos tocados que NO están en la biblioteca (rutas del repo, documentos en local). " +
        "Los subidos a la biblioteca en la sesión salen solos.",
    ),
  inicio: z
    .string()
    .describe(
      "Cuándo empezó la sesión, ISO 8601 con desfase (2026-09-24T09:00-05:00). Define la " +
        "ventana en la que se juntan los hechos, así que conviene acertarla.",
    ),
  fin: z.string().optional().describe("Cuándo terminó. Omitir para «ahora»."),
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Solo si pertenece a varias organizaciones."),
};

export const descripcionRegistrarSesion = [
  "Deja escrita una sesión de trabajo en el apartado Sesiones del espacio:",
  "resumen, decisiones con su porqué, PRs, pendientes y archivos tocados fuera",
  "de DevUP. Úsala AL CERRAR una sesión, para que la próxima —o la IA de otra",
  "persona— recoja el contexto con `ver_sesiones` en vez de empezar de cero.",
  "",
  "No hace falta listar lo que se hizo DENTRO de DevUP (tareas, archivos",
  "subidos): se junta solo por la ventana `inicio`–`fin`. Escribe como la",
  "persona y queda marcada como hecha por un agente.",
].join("\n");

export async function registrarSesion(
  cliente: ClienteApi,
  entrada: {
    titulo: string;
    resumen?: string;
    decisiones?: string[];
    pendientes?: string[];
    prs?: Pr[];
    archivos?: string[];
    inicio: string;
    fin?: string;
    espacio?: string;
    organizacion?: string;
  },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const { sesion } = await cliente.post<{ sesion: Sesion }>(`/workspaces/${espacio.id}/sesiones`, {
    titulo: entrada.titulo,
    resumen: entrada.resumen ?? "",
    decisiones: entrada.decisiones ?? [],
    pendientes: entrada.pendientes ?? [],
    prs: entrada.prs ?? [],
    archivos: entrada.archivos ?? [],
    inicio: entrada.inicio,
    fin: entrada.fin,
    procedencia: "agente",
  });
  const partes = [
    `${(sesion.decisiones ?? []).length} decisión(es)`,
    `${(sesion.prs ?? []).length} PR(s)`,
    `${(sesion.pendientes ?? []).length} pendiente(s)`,
  ];
  return `Sesión «${sesion.titulo}» guardada en ${espacio.name} (${partes.join(", ")}).  [sesion ${sesion.id}]`;
}

// ── ver_sesiones ─────────────────────────────────────────────────────────────

export const esquemaVerSesiones = {
  sesion: z
    .string()
    .optional()
    .describe("Identificador de una sesión para verla entera, con sus hechos. Omitir para las últimas."),
  cuantas: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Cuántas de las últimas, completas. Por defecto 5."),
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Solo si pertenece a varias organizaciones."),
};

export const descripcionVerSesiones = [
  "El contexto de un proyecto en DevUP: las últimas sesiones de trabajo, cada",
  "una con su resumen, decisiones y porqué, PRs y pendientes. Úsala AL EMPEZAR",
  "una conversación sobre un proyecto —«recoge el contexto de lo que tenemos»—",
  "para no repetir decisiones ni rehacer lo hecho.",
  "",
  "Con `sesion` enseña una entera, junto con lo que esa persona hizo en DevUP",
  "durante la sesión (tareas movidas, archivos subidos). Para los hechos sueltos",
  "del equipo, sin resumen, está `que_ha_pasado`.",
].join("\n");

function fecha(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

function lista(titulo: string, cosas: string[]): string[] {
  return cosas.length > 0 ? [`${titulo}:`, ...cosas.map((c) => `  - ${c}`)] : [];
}

function describirPr(pr: Pr): string {
  const cual = pr.numero ? `${pr.repo}#${pr.numero}` : pr.repo;
  return [cual, pr.titulo, pr.estado ? `(${pr.estado})` : "", pr.url ?? ""].filter(Boolean).join(" ");
}

function describirSesion(s: Sesion): string[] {
  const quien = s.autorNombre ?? "alguien";
  const via = s.procedencia === "agente" ? ", por agente" : "";
  return [
    `## ${s.titulo}`,
    `${quien}${via} · ${fecha(s.inicio)} → ${fecha(s.fin)}  [sesion ${s.id}]`,
    ...(s.resumen ? ["", s.resumen] : []),
    ...lista("Decisiones", s.decisiones ?? []),
    ...lista("PRs", (s.prs ?? []).map(describirPr)),
    ...lista("Pendientes", s.pendientes ?? []),
    ...lista("Archivos", s.archivos ?? []),
  ];
}

export async function verSesiones(
  cliente: ClienteApi,
  entrada: { sesion?: string; cuantas?: number; espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);

  if (entrada.sesion) {
    if (!ES_UUID.test(entrada.sesion.trim())) {
      return "El identificador de sesión no es válido: es el que sale entre corchetes en `ver_sesiones`.";
    }
    const { sesion } = await cliente.get<{ sesion: Sesion & { espacioId: string; hechos: Hecho[]; archivosSubidos: Subido[] } }>(
      `/sesiones/${entrada.sesion.trim()}`,
    );
    // RLS dejaría leer una sesión de otro espacio de la misma organización;
    // quien preguntó por ESTE espacio no debe recibirla sin darse cuenta.
    if (sesion.espacioId !== espacio.id) return `Esa sesión no es de ${espacio.name}.`;
    const lineas = describirSesion(sesion);
    if (sesion.hechos.length > 0) {
      lineas.push("", "Lo que hizo en DevUP durante la sesión:");
      for (const h of sesion.hechos) lineas.push(`  - ${fecha(h.cuando)} ${h.verbo} ${h.sujeto} «${h.sujetoNombre}»`);
    }
    if (sesion.archivosSubidos.length > 0) {
      lineas.push("", "Archivos subidos a la biblioteca:");
      for (const f of sesion.archivosSubidos) lineas.push(`  - ${f.nombre}`);
    }
    return lineas.join("\n");
  }

  const cuantas = entrada.cuantas ?? 5;
  const { sesiones } = await cliente.get<{ sesiones: Sesion[] }>(
    `/workspaces/${espacio.id}/sesiones?limite=${cuantas}`,
  );
  if (sesiones.length === 0) {
    return `${espacio.name} todavía no tiene sesiones registradas. Se dejan con \`registrar_sesion\` al cerrar una.`;
  }
  const lineas = [`# Últimas ${sesiones.length} sesión(es) de ${espacio.name}`, ""];
  for (const s of sesiones) lineas.push(...describirSesion(s), "");
  return lineas.join("\n").trimEnd();
}
