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
import { ETIQUETA_AGENTE, campoDeFicha, marcarHecha, resolverColumna } from "./escribir.js";
import type { ClienteApi } from "../api.js";

/** Las comprobaciones de abajo se contestan ANTES de salir a la red, que es
 *  justo lo que se quiere fijar: si alguna llegara a llamar, esto reventaria. */
const clienteQueNoSeUsa = {
  apiUrl: "http://localhost:4000",
  get: async () => {
    throw new Error("no deberia haber llamado a la API");
  },
  post: async () => {
    throw new Error("no deberia haber llamado a la API");
  },
  patch: async () => {
    throw new Error("no deberia haber llamado a la API");
  },
} as unknown as ClienteApi;

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

console.log("\nLa ficha: el modelo habla en palabras, la API en numeros");

// La prioridad se guarda como 0-3 porque se ordena, pero pedirle a un modelo
// «prioridad: 3» es pedirle que recuerde una tabla que no tiene delante, y
// cuando no la recuerda se la inventa. Si esta traduccion se descolocara, todo
// lo urgente entraria como bajo y nadie lo notaria: el numero seguiria siendo
// un numero valido.
check("normal es 1, que es el valor por defecto", campoDeFicha({ prioridad: "normal" }).prioridad === 1);
check("baja es 0", campoDeFicha({ prioridad: "baja" }).prioridad === 0);
check("alta es 2", campoDeFicha({ prioridad: "alta" }).prioridad === 2);
check("urgente es 3, el mas alto", campoDeFicha({ prioridad: "urgente" }).prioridad === 3);

// Lo que no se dice NO se manda: `actualizar_tarea` solo toca lo que se le
// pasa, y un `undefined` colado en el cuerpo pondria la prioridad a normal o
// borraria el contexto de alguien.
check("lo que no se dice no viaja", Object.keys(campoDeFicha({})).length === 0);
check(
  "y un texto vacio si viaja, porque borrar es una intencion",
  campoDeFicha({ contexto: "" }).contexto === "",
);
check(
  "el tipo va tal cual, que el vocabulario es el mismo arriba y abajo",
  campoDeFicha({ tipo: "deuda" }).tipo === "deuda",
);

console.log("\nCerrar una tarea");

// Cerrar es la unica escritura del agente que AFIRMA algo. Equivocarse de tarea
// aqui le dice al equipo que algo esta hecho cuando sigue roto, asi que el
// titulo no vale: hace falta el identificador.
const conTitulo = await marcarHecha(clienteQueNoSeUsa, { tarea: "arreglar el login" });
check("con un titulo en vez de un id, no cierra nada", conTitulo.includes("identificador"));

// Las dos formas de mandar una prueba a medias se contestan explicando que
// falta, en vez de dejar que la API devuelva un error de validacion que el
// modelo no puede convertir en nada util para la persona.
const prSinUrl = await marcarHecha(clienteQueNoSeUsa, {
  tarea: "11111111-2222-3333-4444-555555555555",
  prueba_tipo: "pr",
});
check("un PR sin enlace se explica, no se manda", prSinUrl.includes("prueba_url"));
const notaSinTexto = await marcarHecha(clienteQueNoSeUsa, {
  tarea: "11111111-2222-3333-4444-555555555555",
  prueba_tipo: "nota",
});
check("una nota sin texto, igual", notaSinTexto.includes("prueba_nota"));

console.log("\nProcedencia");
check("la etiqueta del agente es la que espera el tablero", ETIQUETA_AGENTE === "agente");

console.log(`\n${total - fallos} comprobaciones correctas, ${fallos} fallidas`);
if (fallos > 0) process.exit(1);
