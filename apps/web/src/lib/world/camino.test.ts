import { buscarCamino, libreMasCercana, type Rejilla, seguirCamino } from "./camino.js";

/**
 * Tocar el suelo y que el personaje vaya solo.
 *
 * LA QUE JUSTIFICA EL FICHERO ES LA DE LA ESQUINA. El bucle mueve cada eje por
 * separado para deslizarse por las paredes; un camino que corte una esquina en
 * diagonal deja al personaje clavado contra ella, con el camino a medias y sin
 * ningún error. Se ve en la oficina como «a veces no llega», que es de los
 * fallos que nadie sabe describir.
 *
 * Y DOS QUE SE LEEN BIEN ESTANDO MAL:
 *
 *   · **Tocar un mueble lleva a su lado.** Si devolviera «no se puede», tocar la
 *     pizarra para abrir el tablero no haría nada, y eso es lo primero que
 *     intenta quien entra.
 *   · **Seguir el camino llega y para.** Si no parase, el personaje temblaría
 *     sobre el destino para siempre.
 *
 *   npm run test:camino --workspace apps/web
 */

let total = 0;
let fallos = 0;
function check(nombre: string, condicion: boolean): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
  }
}

/** Una rejilla dibujada: `#` es muro, `.` es suelo. */
function rejilla(filas: string[]): Rejilla {
  const width = filas[0]!.length;
  return {
    width,
    height: filas.length,
    blocked: filas.flatMap((f) => [...f].map((c) => c === "#")),
  };
}

/** ¿Pasa el camino por alguna casilla bloqueada? */
function pisaMuro(r: Rejilla, camino: { x: number; y: number }[]): boolean {
  return camino.some((p) => r.blocked[Math.floor(p.y) * r.width + Math.floor(p.x)]);
}

console.log("\nLo sencillo");

const abierta = rejilla(["......", "......", "......"]);
const recto = buscarCamino(abierta, { x: 0.5, y: 0.5 }, { x: 5.5, y: 0.5 });
check("en línea recta hay camino", recto !== null && recto.length >= 1);
check("y llega a donde se tocó", recto?.at(-1)?.x === 5.5 && recto?.at(-1)?.y === 0.5);
check("un pasillo recto es un solo tramo, no una parada por casilla", recto?.length === 1);
check("tocar donde ya se está no mueve", buscarCamino(abierta, { x: 2.3, y: 1.7 }, { x: 2.9, y: 1.1 })?.length === 0);

console.log("\nLas paredes");

// Dos habitaciones unidas por una puerta abajo a la derecha.
const dos = rejilla([
  "...#...",
  "...#...",
  "...#...",
  ".......",
]);
const porLaPuerta = buscarCamino(dos, { x: 0.5, y: 0.5 }, { x: 6.5, y: 0.5 });
check("se rodea la pared hasta la puerta", porLaPuerta !== null);
check("sin pisar la pared", porLaPuerta !== null && !pisaMuro(dos, porLaPuerta));

const cerrada = rejilla(["...#...", "...#...", "...#..."]);
check("sin puerta no hay camino, y lo dice", buscarCamino(cerrada, { x: 0.5, y: 0.5 }, { x: 6.5, y: 0.5 }) === null);

console.log("\nLas esquinas no se cortan");

// El camino más corto en diagonal pasaría rozando la esquina del muro.
const esquina = rejilla([
  "..",
  "#.",
]);
const rodeo = buscarCamino(esquina, { x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 });
check("hay camino", rodeo !== null && rodeo.length > 0);
check("no va en diagonal por encima de la esquina", rodeo !== null && rodeo.length === 2);

console.log("\nTocar un mueble");

const conMesa = rejilla([
  ".....",
  "..#..",
  ".....",
]);
const alLado = libreMasCercana(conMesa, 2, 1);
check("la casilla libre más cercana está al lado", alLado !== null && Math.abs(alLado.x - 2) + Math.abs(alLado.y - 1) === 1);
const haciaLaMesa = buscarCamino(conMesa, { x: 0.5, y: 0.5 }, { x: 2.5, y: 1.5 });
check("tocar la mesa lleva a su lado, no a «no se puede»", haciaLaMesa !== null && haciaLaMesa.length > 0);
check("y no se mete dentro", haciaLaMesa !== null && !pisaMuro(conMesa, haciaLaMesa));

console.log("\nSeguir el camino");

const camino = [{ x: 3.5, y: 0.5 }];
const ir = seguirCamino({ x: 0.5, y: 0.5 }, camino);
check("hacia la derecha pulsa la derecha", ir.direccion.right && !ir.direccion.left);
check("y no pulsa arriba ni abajo si va recto", !ir.direccion.up && !ir.direccion.down);

const casi = seguirCamino({ x: 3.45, y: 0.52 }, camino);
check("al llegar se para", !casi.direccion.right && !casi.direccion.left && !casi.direccion.up && !casi.direccion.down);
check("y el camino se vacía", casi.camino.length === 0);

// Simular el bucle: avanzar un poco hacia donde diga, hasta llegar.
let yo = { x: 0.5, y: 0.5 };
let queda = buscarCamino(dos, yo, { x: 6.5, y: 0.5 }) ?? [];
let pasos = 0;
while (queda.length > 0 && pasos < 2000) {
  const s = seguirCamino(yo, queda);
  queda = s.camino;
  const dx = (s.direccion.right ? 1 : 0) - (s.direccion.left ? 1 : 0);
  const dy = (s.direccion.down ? 1 : 0) - (s.direccion.up ? 1 : 0);
  const f = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
  // Como el bucle de verdad: cada eje por separado, y solo si se puede pisar.
  const nx = yo.x + dx * f * 0.05;
  if (!dos.blocked[Math.floor(yo.y) * dos.width + Math.floor(nx)]) yo = { ...yo, x: nx };
  const ny = yo.y + dy * f * 0.05;
  if (!dos.blocked[Math.floor(ny) * dos.width + Math.floor(yo.x)]) yo = { ...yo, y: ny };
  pasos += 1;
}
check("recorriéndolo como el bucle, se llega a la otra habitación", Math.floor(yo.x) === 6 && Math.floor(yo.y) === 0);
check("sin quedarse atascado por el camino", pasos < 2000);

console.log(`\n${total - fallos} de ${total} comprobaciones\n`);
process.exit(fallos > 0 ? 1 : 0);
