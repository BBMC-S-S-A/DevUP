/**
 * Cómo se lee un renglón del registro de actividad.
 *
 * POR QUÉ ESTO ES UN MÓDULO Y NO UNAS LÍNEAS DENTRO DEL COMPONENTE. La misma
 * frase hace falta en tres sitios distintos —el historial de una tarea, el
 * «qué ha pasado aquí» del espacio y la ficha de una persona—, y esa es
 * exactamente la forma que tenía el fallo de `enlaces.ts`: la misma regla
 * escrita dos veces y ya divergida entre las dos copias. Se escribe una vez,
 * aquí, y se prueba.
 *
 * LA BASE GUARDA EL VERBO EN PASADO Y SIN TILDE —«movio», «cerro»— porque es
 * un valor que se compara, no un texto que se enseña. Traducirlo es trabajo de
 * esta capa, y el acento entra aquí.
 *
 * LO QUE NO SE SABE, NO SE INVENTA. `asigno` guarda en el detalle el
 * identificador de la persona, no su nombre; así que la frase dice «asignó la
 * tarea» y no «se la asignó a Fulano». Un nombre inventado en un historial es
 * peor que un historial escueto: el historial existe para poder fiarse de él.
 *
 * Y UN VERBO DESCONOCIDO NO ROMPE NADA. El vocabulario está pensado para
 * crecer sin migración (ver `apps/api/src/lib/actividad.ts`), así que esta capa
 * tiene que sobrevivir a una palabra que todavía no conoce: devuelve el verbo
 * tal cual antes que una pantalla en blanco.
 */

/** Un renglón tal y como llega de la API. */
export type Renglon = {
  id: string;
  verbo: string;
  sujeto: string;
  sujetoId: string | null;
  sujetoNombre: string;
  detalle: Record<string, unknown> | null;
  procedencia: "persona" | "regla" | "agente";
  cuando: string;
  actorId: string | null;
  actorNombre: string | null;
  actorAvatar: string | null;
};

/**
 * Los verbos en pasado y con tilde, para leerlos.
 *
 * Van en tercera persona porque el sujeto de la frase siempre es otro —«Ana
 * movió», «un agente cerró»—, incluso cuando quien lee es quien lo hizo: un
 * registro cuenta lo que pasó, no le habla a nadie.
 */
const VERBOS: Record<string, string> = {
  creo: "creó",
  movio: "movió",
  cerro: "cerró",
  reabrio: "reabrió",
  asigno: "asignó",
  desasigno: "quitó el responsable de",
  renombro: "renombró",
  comento: "comentó",
  adjunto: "adjuntó",
  etiqueto: "etiquetó",
  borro: "borró",
};

export function verboLegible(verbo: string): string {
  return VERBOS[verbo] ?? verbo;
}

/** Quién lo hizo, cuando puede no saberse. */
export function actorLegible(renglon: Renglon): string {
  if (renglon.procedencia === "agente") return renglon.actorNombre ?? "Un agente";
  if (renglon.procedencia === "regla") return "DevUP";
  // Sin nombre y de una persona: la fila se queda cuando alguien se da de baja
  // —`actor_id` pasa a null a propósito, para no perder la historia por una
  // baja—, y entonces lo honesto es decir que fue alguien que ya no está.
  return renglon.actorNombre ?? "Alguien que ya no está";
}

/**
 * El movimiento entre columnas, si el renglón lo trae.
 *
 * Se lee del detalle y no se deduce del verbo: `cerro` y `movio` son el mismo
 * salto contado de dos maneras, y cuál de los dos es depende de si la columna
 * de destino es terminal (migración 0037), no de dónde venía.
 */
export function saltoDeColumna(renglon: Renglon): { de: string; a: string } | null {
  const de = renglon.detalle?.de;
  const a = renglon.detalle?.a;
  if (typeof de !== "string" || typeof a !== "string") return null;
  if (!de.trim() || !a.trim()) return null;
  return { de, a };
}

/**
 * La frase completa de un renglón, sin el nombre de quien lo hizo.
 *
 * Va sin el actor a propósito: en el historial de una tarea el nombre se pinta
 * aparte con su avatar, y meterlo también en la frase lo diría dos veces.
 *
 * Y SIN EL NOMBRE DE LA TAREA cuando el renglón se enseña dentro de esa misma
 * tarea (`conSujeto: false`). «Movió "Arreglar el riel"» dentro de la pantalla
 * de «Arreglar el riel» es ruido; fuera, es lo único que identifica de qué se
 * habla.
 */
export function fraseDeRenglon(renglon: Renglon, conSujeto = true): string {
  const verbo = verboLegible(renglon.verbo);
  const salto = saltoDeColumna(renglon);

  const cosa = conSujeto
    ? `${sujetoLegible(renglon.sujeto)} «${renglon.sujetoNombre}»`
    : sujetoLegible(renglon.sujeto);

  if (salto && (renglon.verbo === "movio" || renglon.verbo === "cerro" || renglon.verbo === "reabrio")) {
    return `${verbo} ${cosa} de ${salto.de} a ${salto.a}`;
  }
  return `${verbo} ${cosa}`;
}

function sujetoLegible(sujeto: string): string {
  const SUJETOS: Record<string, string> = {
    tarea: "la tarea",
    columna: "la columna",
    categoria: "la categoría",
    nodo: "el nodo",
    entorno: "el entorno",
    repositorio: "el repositorio",
  };
  return SUJETOS[sujeto] ?? `el ${sujeto}`;
}
