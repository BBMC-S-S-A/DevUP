/**
 * Qué micrófono y qué cámara usa esta persona, en ESTE navegador.
 *
 * POR QUÉ EN EL NAVEGADOR Y NO EN LA CUENTA. Un micrófono no es una propiedad
 * de quien eres: es una propiedad de la mesa en la que estás sentado. Guardar
 * la elección en el servidor haría que elegir los cascos del portátil cambiara
 * el micrófono del ordenador de la oficina, y peor: el identificador de un
 * dispositivo **no significa nada en otra máquina**, así que el otro equipo
 * recibiría un `deviceId` que no existe y se quedaría sin micrófono por
 * obedecer. Mismo criterio que `ultimo-espacio.ts`.
 *
 * LO QUE SE GUARDA NO ES DE FIAR, y quien lo lea tiene que contar con ello. Un
 * `deviceId` deja de valer al desenchufar los cascos, al reiniciar el navegador
 * en algunos casos, y al borrar los permisos del sitio. Por eso `elegirDe()`
 * comprueba contra la lista REAL antes de devolver nada: preferir un
 * dispositivo que ya no está es peor que no recordar ninguno — el navegador
 * falla con `OverconstrainedError` en vez de coger el que haya.
 *
 * Y SE GUARDA TAMBIÉN LA ETIQUETA, no solo el identificador. Es lo que permite
 * volver a encontrar «Jabra Evolve» cuando se reconecta con otro `deviceId`,
 * que es lo que pasa de verdad con los USB. Sin eso, desenchufar y volver a
 * enchufar los mismos cascos se lee como un dispositivo nuevo.
 */

export type ClaseDeDispositivo = "microfono" | "camara";

/** Lo mínimo de un `MediaDeviceInfo`, para poder probar esto sin navegador. */
export type Dispositivo = { deviceId: string; label: string };

type Recordado = { id: string; etiqueta: string };

const CLAVES: Record<ClaseDeDispositivo, string> = {
  microfono: "devup:microfono",
  camara: "devup:camara",
};

export function leerDispositivo(clase: ClaseDeDispositivo): Recordado | null {
  try {
    const crudo = localStorage.getItem(CLAVES[clase]);
    if (!crudo) return null;
    const leido: unknown = JSON.parse(crudo);
    // Se comprueba la forma en vez de confiar: lo que hay en `localStorage` lo
    // pudo escribir una versión anterior de esto, o una pestaña de otra rama.
    if (
      typeof leido === "object" &&
      leido !== null &&
      typeof (leido as Recordado).id === "string" &&
      typeof (leido as Recordado).etiqueta === "string"
    ) {
      return leido as Recordado;
    }
    return null;
  } catch {
    // Ni JSON roto ni almacenamiento bloqueado pueden dejar a nadie sin entrar
    // a una llamada.
    return null;
  }
}

export function guardarDispositivo(clase: ClaseDeDispositivo, dispositivo: Dispositivo): void {
  try {
    localStorage.setItem(
      CLAVES[clase],
      JSON.stringify({ id: dispositivo.deviceId, etiqueta: dispositivo.label }),
    );
  } catch {
    // Sin recuerdo se usa el del sistema, que es un valor por defecto
    // razonable. Nadie pidió que se guardara.
  }
}

export function olvidarDispositivo(clase: ClaseDeDispositivo): void {
  try {
    localStorage.removeItem(CLAVES[clase]);
  } catch {
    // Si no se pudo borrar tampoco se pudo guardar.
  }
}

/**
 * Cuál de los dispositivos que HAY AHORA es el elegido.
 *
 * Tres intentos, en este orden, y el orden es el diseño entero:
 *
 *  1. **El identificador exacto.** Es el caso normal: nada ha cambiado.
 *  2. **La misma etiqueta.** Es el caso de los USB: los cascos se
 *     desenchufaron y al volver traen otro identificador. Sin este paso, cada
 *     reconexión se lee como un dispositivo nuevo y la elección se pierde
 *     justo cuando más se nota.
 *  3. **Nada.** Y nada significa «que decida el sistema», NO «coge el
 *     primero»: el primero de la lista es arbitrario, y forzarlo puede acabar
 *     eligiendo el micrófono de la webcam que nadie quería.
 *
 * Devuelve `null` en el tercer caso a propósito, para que quien llame pida el
 * medio sin restricción de dispositivo en vez de inventarse una.
 */
export function elegirDe(
  clase: ClaseDeDispositivo,
  disponibles: readonly Dispositivo[],
): Dispositivo | null {
  const recordado = leerDispositivo(clase);
  if (!recordado) return null;

  const porId = disponibles.find((d) => d.deviceId === recordado.id);
  if (porId) return porId;

  // Las etiquetas vacías no valen para reconocer nada: el navegador las oculta
  // hasta que se concede permiso, y entonces TODAS son «». Compararlas
  // emparejaría dispositivos al azar.
  const etiqueta = recordado.etiqueta.trim();
  if (!etiqueta) return null;

  return disponibles.find((d) => d.label.trim() === etiqueta) ?? null;
}

/**
 * Lo que hay que pedirle a `getUserMedia` para una clase de dispositivo.
 *
 * `ideal` Y NO `exact`, y es la diferencia entre que funcione y que no. Con
 * `exact`, un dispositivo que ya no está hace que la llamada FALLE entera: la
 * persona se queda fuera por haber elegido bien hace un mes. Con `ideal`, el
 * navegador lo intenta y, si no puede, coge otro — que es lo que cualquiera
 * espera.
 *
 * Aquí ya se ha comprobado que el dispositivo existe (`elegirDe`), así que
 * `ideal` es red de seguridad y no pereza: entre comprobar y pedir caben unos
 * milisegundos, y desenchufar unos cascos cabe de sobra ahí.
 */
export function restriccionPara(
  clase: ClaseDeDispositivo,
  elegido: Dispositivo | null,
): MediaTrackConstraints {
  const base: MediaTrackConstraints =
    clase === "microfono"
      ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : {};
  if (!elegido) return base;
  return { ...base, deviceId: { ideal: elegido.deviceId } };
}

/**
 * Un nombre legible para un dispositivo.
 *
 * Las etiquetas vienen vacías mientras no se concede permiso, y una lista de
 * cuatro huecos en blanco no se puede usar para elegir. Decir que hace falta
 * permiso es información; un desplegable mudo es una avería aparente.
 */
export function nombreDe(dispositivo: Dispositivo, clase: ClaseDeDispositivo): string {
  const etiqueta = dispositivo.label.trim();
  if (etiqueta) return etiqueta;
  return clase === "microfono" ? "Micrófono sin nombre" : "Cámara sin nombre";
}
