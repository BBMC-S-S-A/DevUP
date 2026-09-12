/**
 * Prueba de mover una tarjeta con el teclado.
 *
 * QUÉ SE PRUEBA, Y POR QUÉ MERECE PRUEBA algo de cuatro líneas: `drop` inserta
 * **después** de la tarea que se le pasa, así que subir una posición no es
 * «pasar la de arriba» sino «pasar la que está dos por encima». Es un error por
 * uno, y un error por uno aquí no se ve: la tarjeta se mueve, solo que a la
 * posición de al lado. Nadie lo reporta como fallo — lo reporta como «el
 * teclado hace cosas raras».
 *
 * Y se prueba la diferencia entre `null` y `undefined`, que es la otra trampa:
 * `null` significa «arriba del todo» y SÍ es un movimiento; `undefined`
 * significa «no hay a dónde ir». Confundirlos deja dos fallos opuestos — una
 * tarjeta que no se mueve al pulsar, o una que salta al primer puesto cuando ya
 * estaba ahí.
 *
 *   npm run test:tablero-teclado
 */
import { trasQuienInsertar } from "./tablero-teclado.js";

let total = 0;
let fallos = 0;

function check(nombre: string, real: string | null | undefined, esperado: string | null | undefined): void {
  total += 1;
  if (real === esperado) console.log(`  ✓ ${nombre}`);
  else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
    console.log(`      esperaba  ${String(esperado)}`);
    console.log(`      y llegó   ${String(real)}`);
  }
}

// Una columna de cuatro: a, b, c, d.
const COL = ["a", "b", "c", "d"];

console.log("\nBajar una posición");

// `b` baja: acaba detrás de `c`, que es quien ocupaba su destino.
check("b (1) baja → detrás de c", trasQuienInsertar(COL, 1, 1), "c");
check("a (0) baja → detrás de b", trasQuienInsertar(COL, 0, 1), "b");
check("c (2) baja → detrás de d", trasQuienInsertar(COL, 2, 1), "d");

console.log("\nSubir una posición");

// AQUÍ ESTÁ EL ERROR POR UNO. `c` sube al puesto de `b`, o sea que queda detrás
// de `a` — no detrás de `b`, que es lo que parece a primera vista.
check("c (2) sube → detrás de a, no de b", trasQuienInsertar(COL, 2, -1), "a");
check("d (3) sube → detrás de b", trasQuienInsertar(COL, 3, -1), "b");
// Y subir al primer puesto no tiene «anterior»: es `null`, que es como `drop`
// dice «arriba del todo».
check("b (1) sube → null, que es arriba del todo", trasQuienInsertar(COL, 1, -1), null);

console.log("\nLos bordes: undefined, que NO es lo mismo que null");

check("la primera no puede subir", trasQuienInsertar(COL, 0, -1), undefined);
check("la última no puede bajar", trasQuienInsertar(COL, 3, 1), undefined);

console.log("\nCasos que rompen si no se miran");

check("columna vacía", trasQuienInsertar([], 0, 1), undefined);
check("columna de una: no sube", trasQuienInsertar(["a"], 0, -1), undefined);
check("columna de una: no baja", trasQuienInsertar(["a"], 0, 1), undefined);
// Un índice que no existe —la tarjeta se movió desde otro sitio mientras
// tanto— no debe producir un movimiento inventado.
check("índice fuera de rango", trasQuienInsertar(COL, 9, -1), undefined);
check("índice negativo", trasQuienInsertar(COL, -1, 1), undefined);

console.log("\nDos pasos seguidos dejan la tarjeta donde toca");

// Se simula lo que hace `drop`: quitar y reinsertar después de `tras`.
function mover(ids: string[], id: string, tras: string | null): string[] {
  const sin = ids.filter((x) => x !== id);
  const en = tras === null ? 0 : sin.indexOf(tras) + 1;
  return [...sin.slice(0, en), id, ...sin.slice(en)];
}

let estado = [...COL];
// `d` sube dos veces: d,c,b,a → debería acabar en el puesto de b.
estado = mover(estado, "d", trasQuienInsertar(estado, estado.indexOf("d"), -1)!);
check("d sube una vez", estado.join(""), "abdc");
const tras2 = trasQuienInsertar(estado, estado.indexOf("d"), -1);
estado = mover(estado, "d", tras2 === undefined ? null : tras2);
check("y otra", estado.join(""), "adbc");

console.log(`\n${total} comprobaciones, ${fallos} fallidas`);
if (fallos > 0) process.exit(1);
