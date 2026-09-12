/**
 * Dónde va cada caja cuando el diagrama no lo dibuja una persona.
 *
 * POR QUÉ ESTO VIVE EN EL SERVIDOR. Hay dos maneras de meter una arquitectura
 * sin dibujarla a mano —un agente por MCP (`dibujar_arquitectura`) y un
 * repositorio con Terraform (`importar/terraform`)— y las dos necesitan lo
 * mismo: colocar lo nuevo de forma legible sin tocar lo que ya estaba. Escrito
 * dos veces, el día que una de las dos aprenda algo la otra se queda atrás, y
 * el diagrama saldría distinto según por dónde entrara. Esto estuvo un tiempo
 * dentro del paquete MCP; se movió aquí cuando apareció el segundo camino.
 *
 * Es una función pura: se prueba sin base de datos ni servidor
 * (`arquitectura.test.ts`).
 */

/** Separación entre columnas y entre filas, en píxeles del lienzo. */
export const ANCHO_COLUMNA = 240;
export const ALTO_FILA = 120;

/** El margen desde el que se empieza a dibujar en un lienzo vacío. */
export const MARGEN = 40;

type ConexionLigera = { de: string; a: string };

/**
 * Reparte los componentes nuevos en columnas siguiendo las conexiones.
 *
 * Lo que nadie llama va en la primera columna, lo que solo llaman los de la
 * primera va en la segunda, y así. Es la forma en que se dibuja un sistema en
 * una pizarra —entra por la izquierda, acaba en la base de datos de la
 * derecha— y sale legible sin que nadie piense en píxeles.
 *
 * Los ciclos no rompen nada: al dejar de haber candidatos sin dependencias, lo
 * que queda se coloca en la columna siguiente y ya está. Un diagrama con un
 * ciclo es raro pero no es un error, y desde luego no es motivo para no
 * dibujarlo.
 */
export function repartirEnColumnas(
  nombres: string[],
  conexiones: ConexionLigera[],
): Map<string, number> {
  const pendientes = new Set(nombres.map((n) => n.toLowerCase()));
  const columna = new Map<string, number>();
  const entrantes = (nombre: string) =>
    conexiones.filter(
      (c) =>
        c.a.toLowerCase() === nombre &&
        pendientes.has(c.de.toLowerCase()) &&
        c.de.toLowerCase() !== nombre,
    ).length;

  let actual = 0;
  while (pendientes.size > 0) {
    const libres = [...pendientes].filter((n) => entrantes(n) === 0);
    const tanda = libres.length > 0 ? libres : [...pendientes];
    for (const n of tanda) {
      columna.set(n, actual);
      pendientes.delete(n);
    }
    actual += 1;
  }
  return columna;
}

/**
 * Desde qué altura se empieza a dibujar lo nuevo.
 *
 * Debajo de todo lo que ya hubiera, porque la disposición de un diagrama es
 * trabajo de alguien: colocar encima lo que llega taparía cajas que una
 * persona movió a propósito.
 */
export function alturaLibre(posiciones: number[]): number {
  return posiciones.length > 0 ? Math.max(...posiciones) + ALTO_FILA : MARGEN;
}
