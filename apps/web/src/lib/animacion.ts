import type { CSSProperties } from "react";

/**
 * El escalonado de una entrada: cada elemento de una lista arranca un poco
 * después que el anterior.
 *
 * EL TOPE DE OCHO ES LO IMPORTANTE. Sin él, el elemento número veinte entra
 * setecientos milisegundos tarde y la lista parece que va cargando cuando ya
 * está cargada. A partir del noveno, todos entran juntos: el ojo ya ha leído
 * la cascada y lo que queda es esperar.
 *
 * ESTABA ESCRITA CUATRO VECES. Dos en los armazones (a 35 ms) y dos en pantallas
 * de contenido (a 40 ms), y las cuatro divergidas sin que nadie lo decidiera.
 * El paso va como parámetro justamente para que unificarlas no cambiara ningún
 * tiempo: quien usaba 40 sigue pidiendo 40.
 *
 * El valor sale como variable CSS y no como `animation-delay` directo porque
 * `globals.css` la consume dentro de `.devup-entrada`, donde vive la curva.
 */
export function retraso(indice: number, paso = 35): CSSProperties {
  return { "--retraso": `${Math.min(indice, 8) * paso}ms` } as CSSProperties;
}
