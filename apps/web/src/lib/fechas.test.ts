/**
 * Pruebas de las fechas de calendario.
 *
 * LA QUE IMPORTA ES LA PRIMERA. Comprueba que una fecha sin hora se pinta con
 * el día que dice, y no con el anterior. Ese fallo estaba EN PRODUCCIÓN en el
 * embudo de ventas: `new Date("2026-09-11")` es medianoche UTC, y al oeste de
 * Greenwich —Colombia es UTC−5— eso cae el día diez. Se pintaba «10 sept».
 *
 * Por eso esta prueba fija la zona horaria a una del oeste antes de nada. Sin
 * eso pasaría en Madrid y seguiría fallando en Bogotá, que es exactamente lo
 * que hace que este fallo dure meses: en la máquina de quien lo escribe se ve
 * bien.
 *
 *   npm run test:fechas
 */

// Antes de cualquier otra cosa: lo que se está comprobando es precisamente el
// comportamiento que depende de esto.
process.env.TZ = "America/Bogota";

import { diasHasta, fechaCorta, fechaLarga, hoyLocal, iniciales } from "./fechas.js";

let total = 0;
let fallos = 0;

function check(nombre: string, real: unknown, esperado: unknown): void {
  total += 1;
  if (real === esperado) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
    console.log(`      esperaba  ${String(esperado)}`);
    console.log(`      y llegó   ${String(real)}`);
  }
}

console.log(`\nUna fecha de calendario se pinta con su día (TZ=${process.env.TZ})`);

// Si alguien vuelve a usar `new Date(iso)` aquí, esto dice «10 sep».
check("el once es el once, no el diez", fechaCorta("2026-09-11", "2026"), "11 sep");
check("y en texto largo también", fechaLarga("2026-09-11"), "11 de septiembre");
check("el primero de enero no se cae al año anterior", fechaCorta("2026-01-01", "2026"), "1 ene");
check("ni el primero de marzo a febrero", fechaLarga("2026-03-01"), "1 de marzo");

console.log("\nEl año solo aparece cuando no es el que corre");

check("este año se calla", fechaCorta("2026-08-17", "2026"), "17 ago");
check("otro año se dice, y en dos cifras", fechaCorta("2025-08-17", "2026"), "17 ago 25");

console.log("\nLo que no tiene forma de fecha se devuelve tal cual");

check("un texto cualquiera", fechaCorta("mañana", "2026"), "mañana");
check("y vacío", fechaLarga(""), "");

console.log("\nDías que faltan, sin que el horario de verano se cuele");

check("hoy es cero", diasHasta("2026-09-11", "2026-09-11"), 0);
check("mañana es uno", diasHasta("2026-09-12", "2026-09-11"), 1);
check("ayer es menos uno", diasHasta("2026-09-10", "2026-09-11"), -1);
check("cruzando el cambio de mes", diasHasta("2026-10-01", "2026-09-30"), 1);
check("cruzando el año", diasHasta("2027-01-01", "2026-12-31"), 1);
// Marzo y octubre son cuando cambia la hora en el hemisferio norte: restando
// instantes locales, uno de estos dos daría 0 o 2 en vez de 1.
check("el domingo del cambio de hora de marzo", diasHasta("2026-03-30", "2026-03-29"), 1);
check("y el de octubre", diasHasta("2026-10-26", "2026-10-25"), 1);
check("un mes entero", diasHasta("2026-10-11", "2026-09-11"), 30);

console.log("\nHoy, en calendario local");

const hoy = hoyLocal();
check("tiene la forma que guarda el servidor", /^\d{4}-\d{2}-\d{2}$/.test(hoy), true);
check(
  "y es el día local, no el UTC",
  hoy,
  `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(
    new Date().getDate(),
  ).padStart(2, "0")}`,
);

console.log("\nIniciales");

check("nombre y apellido", iniciales("Juan Medina"), "JM");
check("solo nombre", iniciales("Ana"), "A");
check("tres palabras se quedan en dos", iniciales("Ana María Pérez"), "AM");
check("espacios de más no cuentan", iniciales("  Juan   Medina  "), "JM");
check("vacío no rompe", iniciales(""), "?");
check("solo espacios tampoco", iniciales("   "), "?");

console.log(`\n${total} comprobaciones, ${fallos} fallida${fallos === 1 ? "" : "s"}`);
process.exit(fallos === 0 ? 0 : 1);
