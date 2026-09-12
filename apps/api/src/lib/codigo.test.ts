import { normalizarCodigo, nuevoCodigo, pareceCodigo } from "./codigo.js";

/**
 * Prueba del código corto de invitación.
 *
 * QUÉ SE FIJA AQUÍ, Y POR QUÉ NO ES UNA TONTERÍA. Todo el valor de este código
 * está en que se pueda DICTAR: si el alfabeto deja colarse una `O` y un `0`,
 * quien lo recibe por teléfono lo escribe mal, falla, y concluye que la
 * invitación está rota o que quien le invitó se equivocó. No se parece a un
 * error de tecleo, así que nadie lo reporta como tal.
 *
 * Y la otra mitad: que normalizar NO se pase de listo. Convertir un `0` en `O`
 * sería de ayuda por un lado y un agujero por el otro — aceptaría códigos que
 * nadie emitió y multiplicaría las combinaciones válidas.
 *
 *   npm run test:codigo
 */

let total = 0;
let fallos = 0;

function check(nombre: string, condicion: boolean, detalle?: string): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos += 1;
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

console.log("\nCómo se genera");

const cien = Array.from({ length: 100 }, () => nuevoCodigo());

check("tiene la forma ABCD-EFGH", cien.every((c) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)));

// El corazón del asunto: los cinco símbolos que se confunden al dictar.
const PROHIBIDOS = ["O", "0", "I", "1", "L"];
for (const malo of PROHIBIDOS) {
  check(
    `nunca sale «${malo}», que es lo que hace que un código dictado llegue mal`,
    !cien.some((c) => c.includes(malo)),
  );
}

check("no se repiten entre cien seguidos", new Set(cien).size === 100);
check("todo en mayúsculas: nadie dicta «be minúscula»", cien.every((c) => c === c.toUpperCase()));

console.log("\nCómo se acepta lo que escribe quien lo recibe");

const CODIGO = "ABCD-EFGH";

check("tal cual", normalizarCodigo(CODIGO) === "ABCDEFGH");
check("sin el guion", normalizarCodigo("ABCDEFGH") === "ABCDEFGH");
check("en minúsculas, que es como se teclea deprisa", normalizarCodigo("abcd-efgh") === "ABCDEFGH");
check("con un espacio en medio", normalizarCodigo("ABCD EFGH") === "ABCDEFGH");
check("con espacios alrededor de pegarlo", normalizarCodigo("  abcd-efgh  ".trim()) === "ABCDEFGH");

console.log("\nLo que NO se acepta");

// Si esto dejara de fallar, valdrían códigos que nadie emitió.
check("un cero, que no está en el alfabeto", normalizarCodigo("ABCD-EFG0") === null);
check("una O donde iría un cero: NO se corrige", normalizarCodigo("0BCD-EFGH") === null);
check("una I", normalizarCodigo("IBCD-EFGH") === null);
check("una L", normalizarCodigo("LBCD-EFGH") === null);
check("de siete", normalizarCodigo("ABCD-EFG") === null);
check("de nueve", normalizarCodigo("ABCD-EFGHI") === null);
check("vacío", normalizarCodigo("") === null);
check("un símbolo raro", normalizarCodigo("ABCD-EF@H") === null);

console.log("\nDistinguirlo de un token largo");

check("un código lo parece", pareceCodigo("ABCD-EFGH"));
check(
  "un token de 32 bytes no",
  !pareceCodigo("Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4"),
);
// Importa porque las dos cosas entran por el mismo campo: si un token se
// tomara por código, se normalizaría —perdiendo mayúsculas y guiones— y su
// hash dejaría de coincidir con el guardado. La invitación existiría y no se
// podría canjear.
check("y por eso un token nunca se normaliza", normalizarCodigo("abcdefgh-ijklmnop") === null);

console.log(`\n${total - fallos} comprobaciones correctas, ${fallos} fallida${fallos === 1 ? "" : "s"}\n`);
if (fallos > 0) process.exit(1);
