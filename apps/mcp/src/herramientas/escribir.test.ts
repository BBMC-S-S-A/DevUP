/**
 * Pruebas de las herramientas que escriben.
 *
 * QUE SE PRUEBA. Que la tarea llegue al tablero es de la API y ya lo cubre su
 * propio aislamiento; aqui se prueba lo que es propio de esta capa y donde una
 * escritura acaba en el sitio equivocado: resolver la columna. Un fallo ahi no
 * da un error, da una tarea en la columna de otro estado — que es peor, porque
 * nadie lo mira.
 *
 *   npm run test:mcp
 */
import { ETIQUETA_AGENTE, resolverColumna } from "./escribir.js";

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

function espera(nombre: string, fn: () => unknown, trozo: string): void {
  total += 1;
  try {
    fn();
    fallos += 1;
    console.log(`  ✗ ${nombre} (no fallo y tenia que fallar)`);
  } catch (fallo) {
    const mensaje = fallo instanceof Error ? fallo.message : String(fallo);
    if (mensaje.includes(trozo)) console.log(`  ✓ ${nombre}`);
    else {
      fallos += 1;
      console.log(`  ✗ ${nombre} (fallo con «${mensaje}»)`);
    }
  }
}

const columna = (name: string) => ({ id: `id-${name}`, name, tasks: [] });
const tablero = [columna("Por hacer"), columna("En curso"), columna("Hecho")];

console.log("\nDonde acaba la tarea");
check(
  "sin decir columna, la primera: es donde entra el trabajo nuevo",
  resolverColumna(tablero).name === "Por hacer",
);
check("por nombre exacto", resolverColumna(tablero, "Hecho").name === "Hecho");
check("sin importar mayusculas", resolverColumna(tablero, "en curso").name === "En curso");
check("por un trozo del nombre", resolverColumna(tablero, "curso").name === "En curso");

// Elegir por su cuenta cuando hay ambiguedad es como una tarea acaba en la
// columna equivocada sin que nadie se entere.
espera(
  "si encaja con varias, lo dice en vez de elegir",
  () => resolverColumna([columna("Revision tecnica"), columna("Revision de diseno")], "revision"),
  "encaja con varias",
);
espera(
  "si no existe, dice cuales hay",
  () => resolverColumna(tablero, "Backlog"),
  "Por hacer, En curso, Hecho",
);
espera(
  "con el tablero vacio manda a crear una columna",
  () => resolverColumna([], "Por hacer"),
  "crear_columna",
);

console.log("\nProcedencia");
check("la etiqueta del agente es la que espera el tablero", ETIQUETA_AGENTE === "agente");

console.log(`\n${total - fallos} comprobaciones correctas, ${fallos} fallidas`);
if (fallos > 0) process.exit(1);
