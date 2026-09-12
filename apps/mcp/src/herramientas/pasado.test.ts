import { momentoDesde } from "./pasado.js";

/**
 * Prueba de «desde cuándo» de `que_ha_pasado`.
 *
 * POR QUÉ ESTO Y NO EL RESTO. Casi toda la herramienta es pedirle al registro y
 * redactar lo que vuelve. Lo que sí puede fallar callado es interpretar el
 * «desde»: si «8h» se entendiera mal, la herramienta contestaría con toda
 * seguridad sobre un periodo equivocado — y nadie lo notaría, porque la
 * respuesta se ve igual de bien. Es peor que un error.
 *
 * Y lo que NO puede hacer: reventar. Un «desde» que no se entiende cae al día
 * por defecto, porque convertir una pregunta en un error por una coma mal
 * puesta es la forma más tonta de que una herramienta deje de usarse.
 *
 *   npm run test:mcp
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

/** Un momento fijo, para que la prueba no dependa de cuándo se corre. */
const AHORA = new Date("2026-09-12T15:00:00.000Z");
const HORA = 3_600_000;

console.log("\nDesde cuándo mira «que_ha_pasado»");

check(
  "sin decir nada, el último día",
  momentoDesde(undefined, AHORA).getTime() === AHORA.getTime() - 24 * HORA,
);
check("una cadena vacía es lo mismo que no decir nada", momentoDesde("  ", AHORA).getTime() === AHORA.getTime() - 24 * HORA);

check("«8h» son ocho horas atrás", momentoDesde("8h", AHORA).getTime() === AHORA.getTime() - 8 * HORA);
check("«8H» también, que nadie escribe en minúsculas siempre", momentoDesde("8H", AHORA).getTime() === AHORA.getTime() - 8 * HORA);
check("«3 h» con espacio, igual", momentoDesde("3 h", AHORA).getTime() === AHORA.getTime() - 3 * HORA);
check("«7d» son siete días atrás", momentoDesde("7d", AHORA).getTime() === AHORA.getTime() - 7 * 24 * HORA);

// Una fecha suelta es el día ENTERO: quien escribe 2026-09-10 quiere lo que
// pasó ese día, no lo que pasó desde las tres de la tarde.
check(
  "una fecha suelta empieza a las cero de ese día",
  momentoDesde("2026-09-10", AHORA).toISOString() === "2026-09-10T00:00:00.000Z",
);

check(
  "un instante ISO completo se respeta tal cual",
  momentoDesde("2026-09-11T09:30:00.000Z", AHORA).toISOString() === "2026-09-11T09:30:00.000Z",
);

console.log("\nLo que no puede reventar");

for (const basura of ["el lunes pasado", "ayer", "12/09/2026", "8 horas", "-5h", "", "????"]) {
  const r = momentoDesde(basura, AHORA);
  check(
    `«${basura}» da una fecha válida y no un fallo`,
    r instanceof Date && !Number.isNaN(r.getTime()),
  );
}

// Y el caso que importa de los de arriba: lo que no se entiende NO se inventa,
// se cae al día por defecto. Si alguna vez se acepta «ayer», que sea a
// propósito y con su prueba, no por accidente de `new Date()`.
check(
  "lo que no se entiende cae al día por defecto",
  momentoDesde("el lunes pasado", AHORA).getTime() === AHORA.getTime() - 24 * HORA,
);

console.log(`\n${total - fallos} comprobaciones correctas, ${fallos} fallida${fallos === 1 ? "" : "s"}\n`);
if (fallos > 0) process.exit(1);
