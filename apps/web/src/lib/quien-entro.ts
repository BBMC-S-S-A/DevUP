/**
 * Quién entró la última vez en este navegador.
 *
 * PARA QUÉ, Y NO ES AUTOCOMPLETAR. La pantalla de acceso de DevUP dedica media
 * ventana a explicar qué es DevUP: la máquina de escribir, los módulos, «todo
 * el equipo en un solo panel». Eso es lo correcto para alguien que llega por
 * primera vez y es ruido para quien entra cada mañana a su herramienta de
 * trabajo — y quien entra cada mañana es, en una herramienta de equipo,
 * prácticamente todo el mundo. Con esto se puede distinguir un caso del otro y
 * enseñar a cada uno lo suyo: al que llega, la explicación; al que vuelve, la
 * puerta de su casa.
 *
 * EN EL NAVEGADOR Y NO EN LA CUENTA, por el mismo motivo que
 * `ultimo-espacio.ts`: es una comodidad de ESTE navegador. Y por la misma
 * razón, todo pasa por `try`: acceder a `localStorage` no solo puede venir
 * vacío, puede LANZAR —ventana privada, almacenamiento bloqueado, captura de
 * miniaturas—, y eso no puede tumbar la pantalla de entrada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * LO QUE SE GUARDA Y LO QUE NO, que es la decisión que importa. Se guarda el
 * CORREO, que es lo que hace falta para saludar y para rellenar el campo. No se
 * guarda nada más: ni el nombre, ni el identificador, ni por supuesto nada
 * parecido a una credencial. El correo no abre ninguna puerta por sí solo —hay
 * que saber la contraseña igual— y es exactamente lo que guarda cualquier
 * cliente de correo del mundo.
 *
 * AUN ASÍ TIENE UN COSTE Y POR ESO EXISTE `olvidar`: en un ordenador
 * compartido, la siguiente persona vería de quién es la cuenta que se usó aquí.
 * Es poco, pero no es cero. La pantalla tiene que ofrecer SIEMPRE una salida
 * visible —«¿no eres tú?»— que llame a `olvidar()`, y no esconderla detrás de
 * un menú: quien necesita esa salida es justo quien no va a ir a buscarla.
 */
const CLAVE = "devup:ultimo-correo";

export function leerUltimoCorreo(): string | null {
  try {
    const valor = localStorage.getItem(CLAVE);
    // Una cadena vacía guardada por error se leería como «sí hay alguien» y
    // dejaría la pantalla saludando a nadie.
    return valor && valor.includes("@") ? valor : null;
  } catch {
    return null;
  }
}

export function recordarCorreo(correo: string): void {
  try {
    localStorage.setItem(CLAVE, correo.trim().toLowerCase());
  } catch {
    // Sin recuerdo se enseña la pantalla de quien llega por primera vez, que
    // es un buen valor por defecto. Nadie pidió que se guardara.
  }
}

export function olvidarCorreo(): void {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    // Si no se puede borrar tampoco se pudo guardar.
  }
}

/**
 * La parte del correo que se puede decir en voz alta sin gritar la dirección
 * entera: «juan.medina@hytrex.co» → «juan.medina».
 *
 * Se saluda con esto y no con el correo completo porque el dominio no aporta
 * nada al saludo y sí alarga la línea; el correo entero sigue estando visible
 * en su campo, que es donde se comprueba que es el correcto.
 */
export function nombreDeCorreo(correo: string): string {
  const antes = correo.split("@")[0] ?? correo;
  return antes.length > 24 ? `${antes.slice(0, 23)}…` : antes;
}
