import { createHash, randomInt } from "node:crypto";

/**
 * El código corto de invitación: generarlo, escribirlo y perdonar cómo se
 * teclea.
 *
 * PARA QUÉ EXISTE. El token de la invitación son 43 caracteres en base64url
 * distinguiendo mayúsculas, guiones y guiones bajos: no se puede dictar por
 * teléfono ni copiar a mano de una pantalla a otra. Esto es la otra puerta a la
 * misma invitación, pensada para decirla en voz alta.
 *
 * EL ALFABETO ES EL DE CROCKFORD, y está elegido, no heredado. Quita cuatro
 * letras: la I y la L porque al oído y a la vista son el 1, la O porque es el
 * 0, y la U porque sin ella es mucho más difícil que salga una palabra que
 * nadie quiera leerle a un compañero. Lo que queda son 32 símbolos que se
 * distinguen dichos y escritos.
 *
 * Y DEFINE CÓMO PERDONAR EL ERROR, que es la mitad del valor: quien teclea «O»
 * quería el cero, y quien teclea «I» o «l» quería el uno. Sin eso, el alfabeto
 * solo traslada la confusión de quien lo dice a quien lo escribe.
 */

/** Base32 de Crockford: sin I, L, O ni U. */
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Ocho símbolos: 32^8 ≈ 1,1 billones. Ver la cabecera de la migración 0040. */
const LARGO = 8;

/**
 * Genera un código nuevo.
 *
 * `randomInt` y no `Math.random()`: esto es una credencial, y la diferencia
 * entre las dos no se nota hasta que alguien predice la siguiente. Y por
 * rechazo dentro de `randomInt`, no por módulo, que sesgaría los primeros
 * símbolos del alfabeto.
 */
export function nuevoCodigo(): string {
  let salida = "";
  for (let i = 0; i < LARGO; i += 1) salida += ALFABETO[randomInt(ALFABETO.length)];
  return salida;
}

/**
 * Deja un código en su forma canónica, o devuelve null si no lo es.
 *
 * Se quita todo lo que no sea letra o número —el guion que ponemos al
 * enseñarlo, los espacios de quien lo escribe de tres en tres, el punto final
 * que a veces se cuela al pegarlo— antes de mirar los símbolos. Ese ruido es lo
 * que más rechazos falsos causa, y ninguno es un error de verdad.
 */
export function normalizarCodigo(entrada: string): string | null {
  const limpio = entrada
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    // Las cuatro que Crockford deja fuera, mapeadas a lo que quien las tecleó
    // estaba mirando. La U no se mapea: no se parece a ningún símbolo del
    // alfabeto, así que una U es un error de verdad y conviene decirlo.
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");

  if (limpio.length !== LARGO) return null;
  for (const c of limpio) if (!ALFABETO.includes(c)) return null;
  return limpio;
}

/**
 * Igual que el token: en la base vive el hash, nunca el código.
 *
 * Sin sal y con SHA-256 a secas, como `hashToken`, y es correcto aquí aunque
 * sonaría mal para una contraseña: esto no es un secreto elegido por una
 * persona —que sería adivinable por diccionario— sino 40 bits de azar de los
 * que además hay que encontrar la preimagen exacta. Lo que se busca es que leer
 * la tabla no dé llaves usables, y para eso basta.
 */
export function hashCodigo(codigo: string): string {
  return createHash("sha256").update(codigo).digest("hex");
}

/** Como se enseña: partido por la mitad, que es como se dicta. */
export function formatearCodigo(codigo: string): string {
  return `${codigo.slice(0, 4)}-${codigo.slice(4)}`;
}
