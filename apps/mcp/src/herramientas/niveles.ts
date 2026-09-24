import { z } from "zod";
import type { ClienteApi } from "../api.js";
import { resolverEspacio } from "../espacios.js";
import { resolverOrganizacion } from "../organizaciones.js";
import { COMO_SE_DICE } from "./pasado.js";

/**
 * Los tres niveles de DevUP, cada uno con su portada: la persona, la
 * organización y el espacio de trabajo.
 *
 * POR QUÉ VAN JUNTAS. La decisión del 20-sep es que la organización es un
 * NIVEL y no una carpeta: persona → organización → espacio, y la mayoría de
 * las funciones existen en más de uno con distinto alcance. El MCP solo sabía
 * mirar dentro de un espacio. Sin la portada de la persona no puede contestar
 * «¿qué hice esta semana?», y sin la de la organización no puede contestar
 * «¿qué está atascado en toda la empresa?» sin recorrer los espacios uno a uno.
 */

// ── mi_inicio: el nivel de la persona ────────────────────────────────────────

type Inicio = {
  dias: number;
  tareas: {
    title: string;
    vence: string | null;
    columna: string;
    espacio: string;
    organizacion: string;
    area: string | null;
  }[];
  resumen: { verbo: string; origen: string; veces: number }[];
  ultimos: { verbo: string; sujetoNombre: string | null; ocurridoEn: string; espacio: string | null }[];
};

export const esquemaMiInicio = {
  dias: z.number().int().min(1).max(365).optional().describe("Cuántos días hacia atrás. Por defecto 7."),
};

export const descripcionMiInicio = [
  "La portada de la persona en DevUP, cruzando TODAS sus organizaciones: lo",
  "que tiene entre manos, cuánto ha hecho en los últimos días y qué fue lo",
  "último.",
  "",
  "Para «¿qué hice esta semana?», «¿cómo voy?» o para empezar el día. Es el",
  "nivel de la persona; para el de una organización, `ver_organizacion`.",
].join("\n");

export async function miInicio(cliente: ClienteApi, entrada: { dias?: number }): Promise<string> {
  const dias = entrada.dias ?? 7;
  const inicio = await cliente.get<Inicio>(`/me/inicio?dias=${dias}`);

  const lineas: string[] = [];
  const hoy = new Date().toISOString().slice(0, 10);

  lineas.push(`Lo que tienes entre manos (${inicio.tareas.length}):`);
  if (inicio.tareas.length === 0) lineas.push("· nada asignado ahora mismo");
  for (const t of inicio.tareas.slice(0, 15)) {
    const vence = t.vence ? (t.vence < hoy ? `, VENCIDA el ${t.vence}` : `, vence el ${t.vence}`) : "";
    const area = t.area ? ` · ${t.area}` : "";
    lineas.push(`· «${t.title}» — ${t.columna}${area} [${t.organizacion} / ${t.espacio}]${vence}`);
  }
  if (inicio.tareas.length > 15) lineas.push(`  (y ${inicio.tareas.length - 15} más: \`mis_tareas\` las lista todas)`);

  lineas.push("", `Lo que has hecho en ${dias} día(s):`);
  if (inicio.resumen.length === 0) lineas.push("· nada registrado");
  for (const r of inicio.resumen) {
    const origen = r.origen === "agente" ? " (por un agente)" : r.origen === "regla" ? " (automático)" : "";
    lineas.push(`· ${COMO_SE_DICE[r.verbo] ?? r.verbo} ${r.veces} vez/veces${origen}`);
  }

  if (inicio.ultimos.length > 0) {
    lineas.push("", "Lo último:");
    for (const u of inicio.ultimos.slice(0, 8)) {
      const donde = u.espacio ? ` en ${u.espacio}` : "";
      lineas.push(`· ${COMO_SE_DICE[u.verbo] ?? u.verbo} «${u.sujetoNombre ?? "algo"}»${donde}`);
    }
  }
  return lineas.join("\n");
}

// ── ver_organizacion: el nivel de la organización ────────────────────────────

type Panorama = {
  espacios: { nombre: string; pendientes: number; cerradasReciente: number; personas: number }[];
  gente: { nombre: string; oficio: string | null; permiso: string; estado: string; enQue: string[] | null }[];
  enMarcha: { titulo: string; espacio: string; columna: string; responsable: string | null }[];
  atascadas: { titulo: string; espacio: string; responsable: string | null; ultimoToque: string | null }[];
  sinDuenio: { titulo: string; espacio: string; creada: string }[];
};

export const esquemaVerOrganizacion = {
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
  dias: z.number().int().min(1).max(90).optional().describe("Ventana para «cerradas» y «atascadas». Por defecto 14."),
};

export const descripcionVerOrganizacion = [
  "La portada de una organización de DevUP, sumando todos sus espacios: cómo",
  "va cada proyecto, quién está en qué, lo que está en marcha, lo ATASCADO",
  "(sin tocar hace días) y lo que NO TIENE DUEÑO.",
  "",
  "Para «¿cómo va la empresa?», «¿qué se nos está quedando parado?» o «¿qué",
  "hay sin asignar?». Es el nivel de la organización; dentro de un espacio,",
  "`ver_tablero`.",
].join("\n");

const ESTADO: Record<string, string> = {
  available: "disponible",
  busy_open: "ocupado/a",
  do_not_disturb: "no molestar",
};

export async function verOrganizacion(
  cliente: ClienteApi,
  entrada: { organizacion?: string; dias?: number },
): Promise<string> {
  const organizacion = await resolverOrganizacion(cliente, entrada.organizacion);
  const dias = entrada.dias ?? 14;
  const p = await cliente.get<Panorama>(`/organizations/${organizacion.id}/panorama?dias=${dias}`);

  const lineas = [`${organizacion.name} — últimos ${dias} día(s)`, "", "Proyectos:"];
  for (const e of p.espacios) {
    lineas.push(
      `· ${e.nombre}: ${e.pendientes} pendiente(s), ${e.cerradasReciente} cerrada(s), ${e.personas} persona(s)`,
    );
  }

  lineas.push("", "Gente:");
  for (const g of p.gente) {
    const oficio = g.oficio ? ` · ${g.oficio}` : "";
    const en = g.enQue && g.enQue.length > 0 ? ` — en ${g.enQue.join(", ")}` : "";
    lineas.push(`· ${g.nombre}${oficio} (${ESTADO[g.estado] ?? g.estado})${en}`);
  }

  // Lo que pide que alguien haga algo va con su cabecera propia y en el orden
  // de urgencia: primero lo parado, después lo que nadie ha cogido.
  if (p.atascadas.length > 0) {
    lineas.push("", `Atascadas (${p.atascadas.length}):`);
    for (const t of p.atascadas.slice(0, 10)) {
      const quien = t.responsable ? ` — ${t.responsable}` : " — sin responsable";
      const cuando = t.ultimoToque ? `, último movimiento ${t.ultimoToque.slice(0, 10)}` : "";
      lineas.push(`· «${t.titulo}» [${t.espacio}]${quien}${cuando}`);
    }
  }
  if (p.sinDuenio.length > 0) {
    lineas.push("", `Sin dueño (${p.sinDuenio.length}), las más viejas primero:`);
    for (const t of p.sinDuenio.slice(0, 10)) {
      lineas.push(`· «${t.titulo}» [${t.espacio}], creada ${t.creada.slice(0, 10)}`);
    }
  }
  if (p.enMarcha.length > 0) {
    lineas.push("", `En marcha (${p.enMarcha.length}):`);
    for (const t of p.enMarcha.slice(0, 10)) {
      lineas.push(`· «${t.titulo}» [${t.espacio} · ${t.columna}] — ${t.responsable ?? "sin responsable"}`);
    }
  }
  return lineas.join("\n");
}

// ── ver_equipo ───────────────────────────────────────────────────────────────

type Miembro = {
  displayName: string;
  role: "owner" | "admin" | "member";
  title: string | null;
  presence: string;
  joinedAt: string;
};

const ROL: Record<Miembro["role"], string> = { owner: "propietario/a", admin: "admin", member: "miembro" };

export const esquemaVerEquipo = {
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
};

export const descripcionVerEquipo = [
  "Quién está en una organización de DevUP: su nombre, a qué se dedica, qué",
  "permiso tiene (propietario, admin, miembro) y si está disponible ahora.",
  "",
  "Para «¿quién lleva el backend?», «¿a quién le pregunto esto?» o antes de",
  "asignar una tarea, para usar el nombre exacto.",
].join("\n");

export async function verEquipo(cliente: ClienteApi, entrada: { organizacion?: string }): Promise<string> {
  const organizacion = await resolverOrganizacion(cliente, entrada.organizacion);
  const { members } = await cliente.get<{ members: Miembro[] }>(
    `/organizations/${organizacion.id}/members`,
  );
  const lineas = [`${organizacion.name} — ${members.length} persona(s):`, ""];
  for (const m of members) {
    const oficio = m.title ? ` · ${m.title}` : "";
    lineas.push(`· ${m.displayName}${oficio} — ${ROL[m.role]}, ${ESTADO[m.presence] ?? m.presence}`);
  }
  return lineas.join("\n");
}

// ── ver_ramas: el nivel del espacio ──────────────────────────────────────────

type Rama = {
  nombre: string;
  gerentes: { nombre: string | null }[];
  pendientes: number;
  cerradasReciente: number;
  porRepartir: number;
};

export const esquemaVerRamas = {
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Solo si pertenece a varias organizaciones."),
};

export const descripcionVerRamas = [
  "Las ramas de trabajo de un espacio de DevUP (las áreas: backend, diseño…):",
  "quién responde de cada una, cuánto tiene pendiente y cuánto está POR",
  "REPARTIR —archivado en la rama y sin nadie que lo haga—.",
  "",
  "Archivar en una rama NO asigna a nadie: lo por repartir espera a que su",
  "gerente lo reparta. Para crear una rama, `crear_area`.",
].join("\n");

export async function verRamas(
  cliente: ClienteApi,
  entrada: { espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const { ramas } = await cliente.get<{ ramas: Rama[] }>(`/workspaces/${espacio.id}/ramas`);
  if (ramas.length === 0) return `${espacio.name} no tiene ramas todavía. Se crean con \`crear_area\`.`;

  const lineas = [`Ramas de ${espacio.name}:`, ""];
  for (const r of ramas) {
    const gerentes = r.gerentes.map((g) => g.nombre ?? "alguien").join(", ") || "SIN GERENTE";
    const repartir = r.porRepartir > 0 ? `, ${r.porRepartir} por repartir` : "";
    lineas.push(
      `· ${r.nombre} — responde: ${gerentes}. ${r.pendientes} pendiente(s)${repartir}, ` +
        `${r.cerradasReciente} cerrada(s) hace poco`,
    );
  }
  return lineas.join("\n");
}

// ── ver_repositorios ─────────────────────────────────────────────────────────

type Repo = {
  fullName: string;
  refreshedAt: string | null;
  lastError: string | null;
  data: {
    defaultBranch: string;
    openPullRequests: number;
    openIssues: number;
    recentCommits: { sha: string; message: string; author: string; date: string }[];
    latestRun: { status: string; conclusion: string | null } | null;
  } | null;
};

export const esquemaVerRepositorios = {
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Solo si pertenece a varias organizaciones."),
};

export const descripcionVerRepositorios = [
  "Los repositorios de GitHub conectados a un espacio de DevUP: PRs e issues",
  "abiertos, el estado del último CI y los últimos commits.",
  "",
  "Es lo que DevUP guardó en su última lectura, no GitHub en vivo: la fecha de",
  "esa lectura va en cada uno.",
].join("\n");

export async function verRepositorios(
  cliente: ClienteApi,
  entrada: { espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const { repos } = await cliente.get<{ repos: Repo[] }>(`/workspaces/${espacio.id}/github/repos`);
  if (repos.length === 0) return `${espacio.name} no tiene repositorios de GitHub conectados.`;

  const lineas = [`Repositorios de ${espacio.name}:`];
  for (const r of repos) {
    lineas.push("", `■ ${r.fullName}${r.refreshedAt ? ` (leído ${r.refreshedAt.slice(0, 16).replace("T", " ")} UTC)` : ""}`);
    if (r.lastError) lineas.push(`  ⚠ la última lectura falló: ${r.lastError}`);
    if (!r.data) {
      lineas.push("  todavía sin leer");
      continue;
    }
    const ci = r.data.latestRun
      ? `CI: ${r.data.latestRun.conclusion ?? r.data.latestRun.status}`
      : "sin CI";
    lineas.push(
      `  rama ${r.data.defaultBranch} · ${r.data.openPullRequests} PR · ${r.data.openIssues} issue(s) · ${ci}`,
    );
    for (const c of r.data.recentCommits.slice(0, 5)) {
      lineas.push(`  ${c.sha.slice(0, 7)} ${c.message.split("\n")[0]} — ${c.author}, ${c.date.slice(0, 10)}`);
    }
  }
  return lineas.join("\n");
}

// ── ver_embudo ───────────────────────────────────────────────────────────────

type Oportunidad = {
  title: string;
  stage: "lead" | "qualified" | "proposal" | "won" | "lost";
  clientName: string | null;
  ownerName: string | null;
  expectedClose: string | null;
  amountCents: number;
};

const ETAPAS: [Oportunidad["stage"], string][] = [
  ["lead", "Contacto"],
  ["qualified", "Calificada"],
  ["proposal", "Propuesta"],
  ["won", "Ganada"],
  ["lost", "Perdida"],
];

export const esquemaVerEmbudo = {
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
};

export const descripcionVerEmbudo = [
  "El embudo de ventas de una organización de DevUP: las oportunidades por",
  "etapa, con cliente, responsable, cierre previsto e importe.",
].join("\n");

function dinero(centimos: number): string {
  return (centimos / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 });
}

export async function verEmbudo(cliente: ClienteApi, entrada: { organizacion?: string }): Promise<string> {
  const organizacion = await resolverOrganizacion(cliente, entrada.organizacion);
  const { opportunities } = await cliente.get<{ opportunities: Oportunidad[] }>(
    `/organizations/${organizacion.id}/pipeline`,
  );
  if (opportunities.length === 0) return `${organizacion.name} no tiene oportunidades en el embudo.`;

  const lineas = [`Embudo de ${organizacion.name}:`];
  for (const [etapa, nombre] of ETAPAS) {
    const suyas = opportunities.filter((o) => o.stage === etapa);
    if (suyas.length === 0) continue;
    const suma = suyas.reduce((s, o) => s + o.amountCents, 0);
    lineas.push("", `${nombre} — ${suyas.length}, ${dinero(suma)}:`);
    for (const o of suyas) {
      const cierre = o.expectedClose ? `, cierre ${o.expectedClose}` : "";
      lineas.push(
        `· «${o.title}» — ${o.clientName ?? "sin cliente"}, ${o.ownerName ?? "sin responsable"}, ` +
          `${dinero(o.amountCents)}${cierre}`,
      );
    }
  }
  return lineas.join("\n");
}
