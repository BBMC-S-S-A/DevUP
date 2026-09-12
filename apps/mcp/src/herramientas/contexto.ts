import { z } from "zod";
import type { ClienteApi } from "../api.js";
import { resolverEspacio, todosLosEspacios } from "../espacios.js";

/**
 * Reconstruir el contexto de una tarea: por qué se hizo así.
 *
 * QUÉ SE PIERDE AL VOLVER A ALGO DE HACE TRES SEMANAS. No el código —el código
 * está—, sino la decisión: por qué esa rama y no otra, qué se probó antes, quién
 * dijo que valía. Esa respuesta existe repartida en cinco sitios y juntarla a
 * mano es media hora, así que nadie la junta: se vuelve a decidir desde cero, a
 * veces al revés de como se decidió la primera vez.
 *
 * EN QUÉ SE DIFERENCIA DE `ver_tarea`, porque si no sobraría una. `ver_tarea`
 * enseña la tarea: su ficha, su columna, sus imágenes. Esto enseña **lo que
 * pasó alrededor de ella** —su historia en orden, las ramas donde se tocó, las
 * pruebas que dejó, lo que tiene enlazado— y la ficha solo como encabezado.
 * Una contesta «¿de qué va esto?»; la otra, «¿cómo llegamos aquí?».
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * LO QUE NO ESTÁ ENLAZADO NO SE INVENTA, Y ADEMÁS SE DICE. Aquí es donde una
 * herramienta así se estropea: rellenando. Buscar mensajes que mencionen el
 * título, grabaciones de esa semana, archivos del mismo espacio — todo eso son
 * conjeturas, y una conjetura metida entre hechos se lee con la misma confianza
 * que un hecho y decide igual. Peor: quien la recibe no tiene forma de saber
 * cuál era cuál.
 *
 * Así que sale lo que hay, y cuando falta una pieza se nombra. «No hay ninguna
 * conversación enlazada» es una respuesta útil —dice dónde mirar a mano— y
 * «esto es todo lo que hubo» dicho sobre un contexto a medias es una mentira
 * que nadie puede detectar desde fuera.
 */

export const esquemaContexto = {
  tarea: z
    .string()
    .describe("El identificador de la tarea, o su título tal y como lo escribiría alguien."),
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir para buscar en todos."),
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
};

export const descripcionContexto = [
  "Reconstruye el contexto de una tarea: su historia en orden, quién la tocó y",
  "cuándo, en qué ramas se trabajó, qué pruebas dejó y qué tiene enlazado",
  "(archivos, repositorios, conversaciones).",
  "",
  "ÚSALA ANTES DE RETOMAR ALGO que lleva semanas parado, antes de cambiar una",
  "decisión que ya se tomó, o cuando alguien pregunte «¿por qué se hizo así?».",
  "Es la forma de no volver a decidir desde cero —a veces al revés— lo que ya",
  "se decidió una vez.",
  "",
  "NO es `ver_tarea`: aquella enseña la ficha de la tarea, esta enseña lo que",
  "pasó alrededor de ella.",
  "",
  "Solo cuenta lo que está enlazado de verdad. Si algo falta lo dice en vez de",
  "rellenarlo: un contexto a medias que se presenta como completo es peor que",
  "no tenerlo.",
].join("\n");

type Vecino = {
  etiqueta: string;
  direccion: "sale" | "entra";
  tipo: string;
  nombre: string | null;
  procedencia: "persona" | "regla" | "agente";
};

type Hecho = {
  verbo: string;
  detalle: Record<string, unknown> | null;
  procedencia: "persona" | "regla" | "agente";
  cuando: string;
  actorNombre: string | null;
};

type Tarea = {
  id: string;
  title: string;
  description: string | null;
  tipo: string | null;
  prioridad: number | null;
  contexto: string | null;
  criterio: string | null;
  assigneeName: string | null;
  ramas: { nombre: string; estado: string; repo: string | null }[];
  evidencia: { tipo: string; url: string | null; titulo: string; nota: string; autor: string | null }[];
};

const COMO_SE_DICE: Record<string, string> = {
  creo: "la creó",
  movio: "la movió",
  cerro: "la cerró",
  reabrio: "la reabrió",
  asigno: "la asignó",
  desasigno: "la dejó sin responsable",
  renombro: "la renombró",
  comento: "comentó",
  adjunto: "adjuntó algo",
  etiqueto: "la etiquetó",
  evidencio: "dejó una prueba",
  enlazo: "enlazó una rama",
};

const PRIORIDAD = ["baja", "normal", "alta", "urgente"];

/** El día, sin la hora. La misma raya que en `que_ha_pasado`: qué se hizo, no a
 *  qué hora trabaja cada quien. */
function dia(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long" });
}

/** Busca la tarea por identificador o por título, recorriendo los tableros. */
async function encontrarTarea(
  cliente: ClienteApi,
  entrada: { tarea: string; espacio?: string; organizacion?: string },
): Promise<string> {
  const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (esUuid.test(entrada.tarea.trim())) return entrada.tarea.trim();

  const espacios = entrada.espacio
    ? [await resolverEspacio(cliente, entrada.espacio, entrada.organizacion)]
    : (await todosLosEspacios(cliente, entrada.organizacion)).espacios;

  const buscado = entrada.tarea.trim().toLowerCase();
  const encontradas: { id: string; title: string; donde: string }[] = [];

  for (const espacio of espacios) {
    const { columns } = await cliente.get<{
      columns: { tasks: { id: string; title: string }[] }[];
    }>(`/workspaces/${espacio.id}/board`);
    for (const columna of columns) {
      for (const t of columna.tasks) {
        if (t.title.toLowerCase().includes(buscado)) {
          encontradas.push({ id: t.id, title: t.title, donde: espacio.name });
        }
      }
    }
  }

  const unica = encontradas[0];
  if (!unica) throw new Error(`No encuentro ninguna tarea que se llame «${entrada.tarea}».`);

  // Con varias no se elige por su cuenta: reconstruir el contexto de la tarea
  // equivocada es peor que no reconstruir ninguno, porque se lee como si fuera
  // el bueno.
  if (encontradas.length > 1) {
    throw new Error(
      `«${entrada.tarea}» encaja con varias: ` +
        encontradas.map((t) => `«${t.title}» (${t.donde})`).join(", ") +
        ". Dime cuál, o pásame su identificador.",
    );
  }

  return unica.id;
}

export async function contextoDeTarea(
  cliente: ClienteApi,
  entrada: { tarea: string; espacio?: string; organizacion?: string },
): Promise<string> {
  const id = await encontrarTarea(cliente, entrada);

  const { task, historia, enlaces } = await cliente.get<{
    task: Tarea;
    historia: Hecho[];
    enlaces: Vecino[];
  }>(`/tasks/${id}/contexto`);

  const lineas: string[] = [`# ${task.title}`];

  const cabecera = [
    task.tipo,
    task.prioridad !== null && task.prioridad !== 1 ? `prioridad ${PRIORIDAD[task.prioridad]}` : null,
    task.assigneeName ? `de ${task.assigneeName}` : "sin responsable",
  ].filter(Boolean);
  if (cabecera.length > 0) lineas.push(cabecera.join(" · "));

  // Lo escrito a mano va primero y entero: es lo único del contexto que alguien
  // redactó a propósito para quien viniera después.
  if (task.contexto) lineas.push("", "## Por qué", task.contexto);
  if (task.criterio) lineas.push("", "## Cuándo está hecha", task.criterio);
  else if (task.description) lineas.push("", "## Descripción", task.description);

  if (task.ramas.length > 0) {
    lineas.push("", "## Dónde se tocó");
    for (const r of task.ramas) {
      lineas.push(`- \`${r.nombre}\`${r.repo ? ` en ${r.repo}` : ""} — ${r.estado}`);
    }
  }

  if (task.evidencia.length > 0) {
    lineas.push("", "## Lo que quedó probado");
    for (const e of task.evidencia) {
      const que = e.titulo || e.nota || e.url || e.tipo;
      lineas.push(`- ${que}${e.url ? ` (${e.url})` : ""}${e.autor ? ` — ${e.autor}` : ""}`);
    }
  }

  if (enlaces.length > 0) {
    lineas.push("", "## Enlazado");
    for (const v of enlaces) {
      const flecha = v.direccion === "sale" ? "→" : "←";
      // De quién salió el enlace importa al leerlo: lo que puso una persona es
      // una afirmación suya, y lo que dedujo una regla se puede volver a deducir.
      const quien = v.procedencia === "persona" ? " (a mano)" : "";
      lineas.push(`- ${flecha} ${v.etiqueta || "relacionado con"} ${v.tipo} «${v.nombre ?? "?"}»${quien}`);
    }
  }

  if (historia.length > 0) {
    lineas.push("", "## Cómo llegó hasta aquí");
    for (const h of historia) {
      const quien = h.actorNombre ?? "Alguien";
      const verbo = COMO_SE_DICE[h.verbo] ?? h.verbo;
      const d = h.detalle ?? {};
      const salto =
        typeof d["de"] === "string" && typeof d["a"] === "string"
          ? ` (de ${d["de"]} a ${d["a"]})`
          : "";
      const marca = h.procedencia === "agente" ? " [agente]" : h.procedencia === "regla" ? " [automático]" : "";
      lineas.push(`- ${dia(h.cuando)}: ${quien} ${verbo}${salto}${marca}`);
    }
  }

  /**
   * Y lo que NO hay, dicho en voz alta.
   *
   * Es la mitad que hace honesta a la otra. Un contexto que solo enseña lo que
   * encontró se lee como completo, y quien lo lea dejará de buscar — que es
   * justo lo contrario de lo que hace falta cuando la pieza que falta es la que
   * explica la decisión.
   */
  const falta = [
    historia.length === 0 ? "no hay historia anotada (es anterior al registro, o nadie la tocó desde entonces)" : null,
    task.ramas.length === 0 ? "ninguna rama apuntada" : null,
    task.evidencia.length === 0 ? "ninguna prueba" : null,
    enlaces.some((v) => v.tipo === "mensaje") ? null : "ninguna conversación enlazada",
  ].filter(Boolean);

  if (falta.length > 0) {
    lineas.push("", `_De esta tarea ${falta.join(", ")}. Lo de arriba es todo lo que hay enlazado._`);
  }

  return lineas.join("\n");
}
