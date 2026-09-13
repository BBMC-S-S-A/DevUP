/**
 * Prueba de quién manda en el borde de abajo.
 *
 * QUÉ SE PRUEBA Y POR QUÉ MERECE PRUEBA una función de una línea: la usan LAS
 * DOS barras de abajo para apartarse dentro de DevVerse, y si se equivoca el
 * daño no se parece a un error de lógica — se parece a un fallo de dibujo. Una
 * barra tapando la pista de «Muévete con WASD» se busca en el CSS durante un
 * rato largo antes de que a alguien se le ocurra mirar una comparación de
 * rutas.
 *
 * Y fija la forma de la ruta, que es lo que de verdad se puede romper: DevVerse
 * vive bajo el espacio de trabajo con el identificador EN MEDIO, así que un
 * `===` no valdría y un `startsWith` tampoco.
 *
 *   npm run test:barras
 */
import { enDevVerse } from "./barras-de-abajo.js";

let total = 0;
let fallos = 0;

function check(nombre: string, real: boolean, esperado: boolean): void {
  total += 1;
  if (real === esperado) console.log(`  ✓ ${nombre}`);
  else {
    fallos += 1;
    console.log(`  ✗ ${nombre} — esperaba ${esperado} y llegó ${real}`);
  }
}

console.log("\nDentro de DevVerse, que es donde las barras se apartan");

// La ruta de verdad, con el uuid del espacio en medio.
check(
  "la ruta real del mundo",
  enDevVerse("/app/w/8f2c1a4e-0b7d-4c3a-9e1f-5a6b7c8d9e0f/devverse"),
  true,
);
check("con una barra al final", enDevVerse("/app/w/abc/devverse/"), true);

console.log("\nFuera, donde las barras se quedan");

check("el tablero", enDevVerse("/app/w/abc/board"), false);
check("un canal", enDevVerse("/app/w/abc/c/def"), false);
check("la raíz del espacio", enDevVerse("/app/w/abc"), false);
check("la lista de organizaciones", enDevVerse("/app"), false);
check("la landing", enDevVerse("/"), false);

console.log("\nLo que no se puede dar por hecho");

// `usePathname` devuelve null antes de montar. Sin esto, la barra se apartaría
// —o no— por un tropiezo en vez de por la ruta.
check("sin ruta todavía (null)", enDevVerse(null), false);
check("sin ruta todavía (undefined)", enDevVerse(undefined), false);
check("cadena vacía", enDevVerse(""), false);

console.log(`\n${total} comprobaciones, ${fallos} fallidas`);
if (fallos > 0) process.exit(1);
