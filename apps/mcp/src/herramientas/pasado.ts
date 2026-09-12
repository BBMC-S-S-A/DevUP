import { z } from "zod";
import type { ClienteApi } from "../api.js";
import { resolverEspacio } from "../espacios.js";

/**
 * «¿Qué ha pasado aquí desde…?», que es la herramienta del contexto compartido.
 *
 * QUÉ RESUELVE, Y ES LA PETICIÓN ENTERA. Lo que se pidió fue que varias
 * personas puedan trabajar en remoto sin pisarse y que la IA pueda tomar el
 * contexto de lo que hay. Eso no es una pantalla: es poder preguntar qué ha
 * pasado en un espacio desde un momento, y que conteste.
 *
 * POR QUÉ PREGUNTAR Y NO QUE CADA AGENTE EMITA LO SUYO. Un agente mandando su
 * contexto cada pocos minutos es ruido caro que crece sin que crezca la
 * utilidad, y obliga a decidir qué se manda — que es justo donde se acaba
 * filtrando lo que nadie quería compartir. Con los hechos ya escritos
 * (`0038_registro_de_actividad.sql`) no hace falta que nadie emita nada.
 *
 * DÓNDE ESTÁ LA LÍNEA, y se decide aquí a propósito. Lo que se hizo, sí.
 * **Cuánto se tardó y a qué hora trabaja cada quien, no.** Con el registro se
 * podría —lleva la marca de tiempo de cada hecho— y por eso hay que elegir:
 * esto agrupa por día y cuenta los hechos en orden, SIN la hora de cada uno.
 * Contesta entera la pregunta de quien vuelve el lunes y no sirve para saber
 * quién estaba conectado a las once de la noche. Es la diferencia entre una
 * herramienta de trabajo y una de vigilancia, y es la misma línea que ya se
 * puso en la ficha de una persona.
 */

/** Cuánto se mira hacia atrás si nadie lo dice. Un día es «desde ayer». */
const HORAS_POR_DEFECTO = 24;

export const esquemaQueHaPasado = {
  desde: z
    .string()
    .trim()
    .optional()
    .describe(
      "Desde cuándo. Una fecha «AAAA-MM-DD», un instante completo en ISO, o " +
        "un número de horas como «8h». Si se omite, el último día.",
    ),
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
};

export const descripcionQueHaPasado = [
  "Cuenta qué ha pasado en un espacio de trabajo de DevUP desde un momento:",
  "qué tareas se crearon, se movieron, se cerraron o se asignaron, quién lo",
  "hizo y si salió de una persona, de una regla del producto o de un agente.",
  "",
  "ÚSALA AL EMPEZAR A TRABAJAR en un proyecto que llevas un rato sin tocar, o",
  "cuando alguien pregunte «¿qué me he perdido?», «¿en qué anda el equipo?» o",
  "«¿qué ha cambiado desde ayer?». Es la forma barata de tomar el contexto de",
  "lo que han hecho los demás sin que nadie tenga que contártelo.",
  "",
  "Agrupa por día y NO dice la hora de cada hecho: sirve para saber qué se",
  "hizo, no para saber a qué hora trabaja cada quien.",
  "",
  "Si no ha pasado nada, lo dice. Un espacio tranquilo es una respuesta.",
].join("\n");

type Renglon = {
  verbo: string;
  sujeto: string;
  sujetoNombre: string;
  detalle: Record<string, unknown> | null;
  procedencia: "persona" | "regla" | "agente";
  cuando: string;
  actorNombre: string | null;
};

/**
 * Cómo se lee cada verbo.
 *
 * Se guardan en pasado y sin tilde porque son valores que se comparan; la
 * frase que lee una persona se compone aquí. Un verbo que no esté en el mapa
 * se enseña tal cual en vez de desaparecer: preferible un «etiqueto» soso a un
 * hecho que no se cuenta.
 */
const COMO_SE_DICE: Record<string, string> = {
  creo: "creó",
  movio: "movió",
  cerro: "cerró",
  reabrio: "reabrió",
  asigno: "asignó",
  desasigno: "dejó sin responsable",
  renombro: "renombró",
  comento: "comentó en",
  adjunto: "adjuntó a",
  etiqueto: "etiquetó",
  borro: "borró",
};

/** Lo que se añade entre paréntesis cuando no lo hizo una persona. */
const DE_DONDE: Record<string, string> = { regla: " (automático)", agente: " (agente)" };

/** «AAAA-MM-DD», «8h» o un instante ISO, a un instante de verdad. */
export function momentoDesde(entrada: string | undefined, ahora = new Date()): Date {
  const texto = (entrada ?? "").trim();
  if (!texto) return new Date(ahora.getTime() - HORAS_POR_DEFECTO * 3_600_000);

  const horas = /^(\d+)\s*h$/i.exec(texto);
  if (horas) return new Date(ahora.getTime() - Number(horas[1]) * 3_600_000);

  const dias = /^(\d+)\s*d$/i.exec(texto);
  if (dias) return new Date(ahora.getTime() - Number(dias[1]) * 86_400_000);

  // Una fecha suelta es «desde que empezó ese día», no «desde las 00:00 UTC de
  // ayer por la tarde»: quien escribe 2026-09-10 quiere el día entero.
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return new Date(`${texto}T00:00:00.000Z`);

  const fecha = new Date(texto);
  if (!Number.isNaN(fecha.getTime())) return fecha;

  // Lo que no se entiende no se inventa: se cae al día por defecto. Devolver
  // «fecha inválida» habría convertido una pregunta en un error por una coma.
  return new Date(ahora.getTime() - HORAS_POR_DEFECTO * 3_600_000);
}

/** El día de un instante, en texto corto y legible. */
function dia(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export async function queHaPasado(
  cliente: ClienteApi,
  entrada: { desde?: string; espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const desde = momentoDesde(entrada.desde);

  const { actividad, hayMas } = await cliente.get<{ actividad: Renglon[]; hayMas: boolean }>(
    `/workspaces/${espacio.id}/actividad?desde=${encodeURIComponent(desde.toISOString())}`,
  );

  if (actividad.length === 0) {
    return `No ha pasado nada en «${espacio.name}» desde ${dia(desde.toISOString())}.`;
  }

  // Vienen del más reciente al más antiguo, que es lo correcto para una lista
  // paginada. Para contar una historia se leen al revés.
  const enOrden = [...actividad].reverse();

  const lineas: string[] = [
    `${actividad.length} cosa(s) en «${espacio.name}» desde ${dia(desde.toISOString())}:`,
  ];

  // Si todo cayó el mismo día, la cabecera ya lo dijo: repetirlo debajo sobra.
  const variosDias = new Set(enOrden.map((r) => dia(r.cuando))).size > 1;

  let diaActual = "";
  for (const r of enOrden) {
    const suDia = dia(r.cuando);
    if (variosDias && suDia !== diaActual) {
      diaActual = suDia;
      lineas.push("", `${suDia}:`);
    }
    const quien = r.actorNombre ?? "Alguien";
    const verbo = COMO_SE_DICE[r.verbo] ?? r.verbo;
    const procedencia = DE_DONDE[r.procedencia] ?? "";

    // El detalle solo cuando añade algo: «de Por hacer a En curso» es la mitad
    // de lo que se quiere saber al leer que algo se movió.
    const d = r.detalle ?? {};
    const salto =
      typeof d["de"] === "string" && typeof d["a"] === "string" ? ` (de ${d["de"]} a ${d["a"]})` : "";

    lineas.push(`- ${quien} ${verbo} ${r.sujeto} «${r.sujetoNombre}»${salto}${procedencia}`);
  }

  if (hayMas) {
    lineas.push(
      "",
      "Hay más de lo que cabe en una respuesta: pregunta por un periodo más corto para verlo todo.",
    );
  }

  return lineas.join("\n");
}
