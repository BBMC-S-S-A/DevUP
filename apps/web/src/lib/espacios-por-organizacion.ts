/**
 * Pedir los espacios de varias organizaciones sin que una tumbe a las demás.
 *
 * POR QUÉ ESTO VIVE FUERA DE LA PANTALLA. Porque el fallo que evita no se ve
 * al leer la pantalla: `Promise.all` sin red por dentro es una línea normal y
 * corriente, y lo que provoca cuando una sola petición falla tampoco parece un
 * error — todas las organizaciones se pintan con CERO espacios, con su botón
 * de «crea el primero» incluido. Una mentira tranquila es peor que una avería
 * visible, y para fijarla hace falta poder probarla sin montar el navegador.
 */

/** Lo mínimo que necesita saber de una organización: cuál es. */
export type ConId = { id: string };

export type EspaciosPorOrganizacion<W> = {
  /** Solo las que contestaron. Una que falló NO aparece aquí con lista vacía:
      «no llegó» y «no tiene» son cosas distintas y se pintan distinto. */
  espacios: Record<string, W[]>;
  /** El motivo, por organización, de las que no contestaron. */
  fallaron: Record<string, string>;
};

/**
 * @param organizaciones a cuáles preguntar
 * @param pedir          la petición de una sola, que puede rechazar
 * @param motivo         cómo leer el fallo; si no devuelve nada, se usa uno genérico
 */
export async function cargarEspaciosPorOrganizacion<O extends ConId, W>(
  organizaciones: readonly O[],
  pedir: (organizacionId: string) => Promise<W[]>,
  motivo: (fallo: unknown) => string | null = () => null,
): Promise<EspaciosPorOrganizacion<W>> {
  const resultados = await Promise.all(
    organizaciones.map(async (organizacion) => {
      try {
        return { id: organizacion.id, espacios: await pedir(organizacion.id), fallo: null };
      } catch (fallo) {
        return {
          id: organizacion.id,
          espacios: null,
          fallo: motivo(fallo) ?? "sin respuesta del servidor",
        };
      }
    }),
  );

  const espacios: Record<string, W[]> = {};
  const fallaron: Record<string, string> = {};
  for (const resultado of resultados) {
    if (resultado.espacios) espacios[resultado.id] = resultado.espacios;
    else fallaron[resultado.id] = resultado.fallo!;
  }
  return { espacios, fallaron };
}
