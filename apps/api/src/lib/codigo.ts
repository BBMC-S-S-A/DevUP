import { randomInt } from "node:crypto";

/**
 * El código corto que se puede dictar por teléfono.
 *
 * EL ALFABETO ES EL DISEÑO. Fuera `O` y `0`, fuera `I`, `L` y `1`: son los
 * pares que hacen que un código dictado llegue mal. Y llegar mal aquí no se
 * parece a un error de tecleo — la persona lo prueba, falla, y concluye que la
 * invitación está rota o que quien la invitó se equivocó. Quitar cinco
 * símbolos cuesta un 13 % del espacio y ahorra esa conversación entera.
 *
 * Solo mayúsculas: un código que distingue mayúsculas de minúsculas no se
 * puede dictar, porque nadie dice «be minúscula».
 */
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Ocho posiciones: 31^8, unas 850.000 millones de combinaciones. */
const LARGO = 8;

/** Dónde va el guion. Solo para leerlo; se ignora al canjear. */
const CORTE = 4;

/**
 * Un código nuevo.
 *
 * `randomInt` del módulo `crypto` y no `Math.random`: esto es una credencial,
 * y `Math.random` no promete nada sobre lo predecible que es. El sesgo del
 * módulo también importa —31 no divide a 256— y `randomInt` con un tope ya lo
 * evita por dentro, que es justo por lo que existe.
 */
export function nuevoCodigo(): string {
  let salida = "";
  for (let i = 0; i < LARGO; i++) salida += ALFABETO[randomInt(ALFABETO.length)];
  return `${salida.slice(0, CORTE)}-${salida.slice(CORTE)}`;
}

/**
 * Lo que alguien escribe, convertido en lo que se compara.
 *
 * Quita guiones y espacios, y sube a mayúsculas: quien lo recibe dictado lo
 * escribe como le sale —con guion o sin él, en minúsculas, con un espacio en
 * medio— y todas esas formas son el mismo código. Rechazar por la forma sería
 * hacerle repetir algo que ya dijo bien.
 *
 * NO SE CORRIGEN CONFUSIONES. Sería tentador convertir un `0` en `O` o un `1`
 * en `I`, ya que esos símbolos no existen en el alfabeto. No se hace: aceptar
 * códigos que nadie emitió multiplica las combinaciones que valen y convierte
 * una ayuda en un agujero. Si llega mal, se vuelve a dictar.
 */
export function normalizarCodigo(entrada: string): string | null {
  const limpio = entrada.toUpperCase().replace(/[\s-]/g, "");
  if (limpio.length !== LARGO) return null;
  for (const c of limpio) if (!ALFABETO.includes(c)) return null;
  return limpio;
}

/** Si lo que llega tiene forma de código corto y no de token largo. */
export function pareceCodigo(entrada: string): boolean {
  return normalizarCodigo(entrada) !== null;
}
