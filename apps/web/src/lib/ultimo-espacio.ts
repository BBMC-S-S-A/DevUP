/**
 * El último espacio de trabajo que se abrió, en este navegador.
 *
 * POR QUÉ EN EL NAVEGADOR Y NO EN LA CUENTA. La misma persona en el portátil y
 * en el ordenador de la oficina está en cosas distintas; guardarlo en el
 * servidor haría que abrir uno cambiara dónde entra el otro. Esto es una
 * comodidad de este navegador, y ese es exactamente el tipo de dato que va a
 * `localStorage`.
 *
 * TODO PASA POR `try`. `localStorage` no solo puede venir vacío —ventana
 * privada, datos borrados, otro navegador—: el propio acceso LANZA en algunos
 * contextos, como la captura de miniaturas o un navegador configurado para
 * bloquear el almacenamiento del sitio. Un error ahí tiraría la puerta de
 * entrada de la aplicación por no recordar una preferencia.
 *
 * Y lo que devuelve NO ES DE FIAR: es un identificador que estaba aquí la
 * última vez. Quien lo lea tiene que comprobar que ese espacio siga existiendo
 * y siga siendo suyo antes de mandar a nadie allí.
 */
export const CLAVE_ULTIMO_ESPACIO = "devup:ultimo-espacio";

export function leerUltimoEspacio(): string | null {
  try {
    return localStorage.getItem(CLAVE_ULTIMO_ESPACIO);
  } catch {
    return null;
  }
}

export function guardarUltimoEspacio(workspaceId: string): void {
  try {
    localStorage.setItem(CLAVE_ULTIMO_ESPACIO, workspaceId);
  } catch {
    // Sin recuerdo se entra al primer espacio, que es un buen valor por
    // defecto. No hay nada que avisar: nadie pidió que se guardara.
  }
}

/**
 * Olvidar el recuerdo, cuando resulta que ya no vale.
 *
 * `/app` manda al espacio recordado sin comprobarlo antes, a propósito:
 * comprobarlo cuesta una ronda de peticiones en el gesto más repetido de la
 * aplicación. El precio de esa decisión es este: cuando el recuerdo es malo
 * —te sacaron del espacio, o se borró— hay que olvidarlo AL DESCUBRIRLO, o
 * cada vez que se abra la aplicación se volverá a entrar al mismo error.
 *
 * Sin esto, la decisión de no comprobar deja de ser «se paga la vez que falla»
 * y pasa a ser «se paga siempre a partir de esa vez».
 */
export function olvidarUltimoEspacio(): void {
  try {
    localStorage.removeItem(CLAVE_ULTIMO_ESPACIO);
  } catch {
    // Si no se puede borrar tampoco se pudo guardar, así que no había nada que
    // olvidar.
  }
}
