import { trazarEnlace, type Caja } from "./Enlaces.js";

/**
 * Prueba del trazado de los enlaces del diagrama.
 *
 * POR QUÉ ESTO SÍ SE PRUEBA. El resto del lienzo es pintar; esto es geometría,
 * y la geometría se rompe callada: una flecha que sale por el lado equivocado
 * no lanza ningún error, solo hace que el diagrama se lea mal — y quien lo mire
 * pensará que la arquitectura es rara, no que el dibujo lo es.
 *
 * Lo que fija son las dos decisiones que no se ven leyendo el código: que el
 * lado se elige en PROPORCIÓN a la caja (si no, una caja el doble de ancha que
 * alta mandaría casi todo por arriba y por abajo) y que el punto de la etiqueta
 * está sobre la curva y no en la media de los extremos.
 *
 *   npm run test:trazado
 */

let fallos = 0;
let total = 0;

function check(nombre: string, condicion: boolean, detalle?: string): void {
  total++;
  if (condicion) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos++;
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

/** Una caja del tamaño real de las del lienzo. */
const caja = (x: number, y: number): Caja => ({ x, y, ancho: 180, alto: 84 });

/** El primer punto del trazo, que es por donde sale. */
function salida(d: string) {
  const m = /^M ([\d.-]+) ([\d.-]+)/.exec(d)!;
  return { x: +m[1]!, y: +m[2]! };
}
/** El último, que es por donde entra. */
function llegada(d: string) {
  const m = /C .* ([\d.-]+) ([\d.-]+)$/.exec(d)!;
  return { x: +m[1]!, y: +m[2]! };
}

console.log("\nPor qué lado sale y por cuál entra");

{
  // Dos cajas en fila, que es como las coloca el reparto en columnas.
  const a = caja(0, 0);
  const b = caja(400, 0);
  const { d } = trazarEnlace(a, b);
  check("una a la derecha de otra: sale por el costado derecho", salida(d).x === 180);
  check("y entra por el costado izquierdo del destino", llegada(d).x === 400);
  check(
    "a media altura de cada una",
    salida(d).y === 42 && llegada(d).y === 42,
    `salida ${JSON.stringify(salida(d))}`,
  );
}

{
  const { d } = trazarEnlace(caja(400, 0), caja(0, 0));
  check("al revés, sale por la izquierda", salida(d).x === 400);
  check("y entra por la derecha", llegada(d).x === 180);
}

{
  // El caso de un diagrama dado con coordenadas propias, apilado en vertical.
  const { d } = trazarEnlace(caja(0, 0), caja(0, 400));
  check("una encima de otra: sale por abajo", salida(d).y === 84 && salida(d).x === 90);
  check("y entra por arriba", llegada(d).y === 400 && llegada(d).x === 90);
}

{
  // La caja mide 180×84: más del doble de ancha que de alta. Con un desnivel
  // de 60 px y un desplazamiento lateral de 100, comparar dx con dy a secas
  // diría «a la derecha»; en proporción a la caja gana la vertical, que es lo
  // que se ve. Este es el caso que justifica dividir por el tamaño.
  const { d } = trazarEnlace(caja(0, 0), caja(100, 60));
  check("el lado se decide en proporción a la caja, no en píxeles", salida(d).y === 84);
}

console.log("\nDónde cae la etiqueta");

{
  const { d, medio } = trazarEnlace(caja(0, 0), caja(400, 0));
  check("en horizontal, a media altura", medio.y === 42);
  check(
    "y entre las dos cajas, no encima de ninguna",
    medio.x > 180 && medio.x < 400,
    `medio.x = ${medio.x}`,
  );
  check("el trazo es una curva, no una recta", d.includes(" C "));
}

{
  // Dos cajas pegadas no pueden sacar un lazo enorme, y dos lejanas no pueden
  // salir con una curva plana: el tirón va con la distancia, con tope.
  const cerca = trazarEnlace(caja(0, 0), caja(200, 0));
  const lejos = trazarEnlace(caja(0, 0), caja(1600, 0));
  const anchoDelLazo = (t: { d: string }) => {
    const c = /C ([\d.-]+) /.exec(t.d)!;
    return +c[1]!;
  };
  check(
    "la curva de dos cajas lejanas se abre más que la de dos pegadas",
    anchoDelLazo(lejos) > anchoDelLazo(cerca),
  );
  check(
    "pero con tope, para que no salga un lazo absurdo",
    anchoDelLazo(lejos) - 180 <= 110,
    `se abrió ${anchoDelLazo(lejos) - 180}`,
  );
}

console.log("\nCasos que no pueden reventar");

{
  const { d, medio } = trazarEnlace(caja(100, 100), caja(100, 100));
  check(
    "dos cajas en el mismo sitio dan un trazo válido",
    d.startsWith("M ") && Number.isFinite(medio.x) && Number.isFinite(medio.y),
  );
}

console.log(
  `\n${total - fallos} comprobaciones correctas, ${fallos} fallida${fallos === 1 ? "" : "s"}\n`,
);
if (fallos > 0) process.exit(1);
