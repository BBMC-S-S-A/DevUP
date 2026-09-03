/**
 * Un color estable por persona, del mismo sitio que el resto del tema.
 *
 * Sale del NOMBRE y no de la posición en una lista, ni de un id incremental:
 * por posición, entrar o salir alguien de una sala le cambiaría el color a
 * todos los demás, y el color de una persona es justo lo que se usa para
 * reconocerla sin leer. Vivía solo en `SalaEspacial` hasta que el embudo de
 * ventas necesitó lo mismo para los avatares de cada responsable.
 */
const TINTES = [
  "linear-gradient(150deg, var(--c-accent-bright), var(--c-accent))",
  "linear-gradient(150deg, var(--c-cyan), color-mix(in oklab, var(--c-cyan) 55%, #000))",
  "linear-gradient(150deg, var(--c-violet), color-mix(in oklab, var(--c-violet) 55%, #000))",
  "linear-gradient(150deg, var(--c-warn), color-mix(in oklab, var(--c-warn) 55%, #000))",
  "linear-gradient(150deg, var(--c-live), color-mix(in oklab, var(--c-live) 55%, #000))",
] as const;

export function tinte(nombre: string): string {
  let suma = 0;
  for (let i = 0; i < nombre.length; i += 1) suma = (suma * 31 + nombre.charCodeAt(i)) >>> 0;
  return TINTES[suma % TINTES.length]!;
}
