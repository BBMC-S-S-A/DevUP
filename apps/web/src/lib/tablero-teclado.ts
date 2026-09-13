/**
 * La aritmética de mover una tarjeta con el teclado.
 *
 * POR QUÉ VIVE FUERA DEL COMPONENTE. Es la única parte con lógica de verdad, y
 * es de las que salen mal por uno: `drop` inserta **después** de la tarea que
 * se le pasa, así que subir una posición no es «pasar la de arriba», es «pasar
 * la que está dos por encima». Metido dentro de un componente con referencias
 * mutables y un lienzo, eso no se puede probar sin montar media pantalla; aquí
 * son cuatro líneas y una prueba que las fija.
 */

/**
 * Detrás de qué tarea hay que insertar para que la de `desde` acabe una
 * posición más arriba (`paso` −1) o más abajo (`paso` +1).
 *
 * Devuelve `null` cuando el destino es el primer puesto, que es como `drop`
 * expresa «arriba del todo». Devuelve `undefined` cuando no hay a dónde ir —el
 * borde de la columna— y entonces no hay que mover nada: distinto de `null`, y
 * la diferencia importa, porque `null` sí es un movimiento.
 */
export function trasQuienInsertar(
  ids: string[],
  desde: number,
  paso: -1 | 1,
): string | null | undefined {
  const destino = desde + paso;
  if (desde < 0 || desde >= ids.length) return undefined;
  if (destino < 0 || destino >= ids.length) return undefined;

  // Bajando, el hueco queda detrás de la que ahora ocupa el destino.
  if (paso === 1) return ids[destino]!;

  // Subiendo, detrás de la anterior a la del destino. Si el destino es el
  // primer puesto no hay anterior, y eso es «arriba del todo».
  return destino - 1 >= 0 ? ids[destino - 1]! : null;
}
