/**
 * Pruebas de «¿qué ha pasado aquí desde…?».
 *
 * LO QUE SE PRUEBA AQUÍ ES LO QUE EL MODELO VA A LEER. Que las filas existan y
 * que nadie vea las de un espacio ajeno ya lo cubren `isolation.test.ts` y
 * `actividad.test.ts` contra una base de verdad. Lo propio de esta capa son dos
 * cosas, y las dos fallan en silencio:
 *
 *   1. ENTENDER «DESDE CUÁNDO». Si «la semana pasada» se interpretara mal, la
 *      herramienta contestaría «no ha pasado nada» —una frase perfectamente
 *      creíble— sobre una semana llena de trabajo. Y lo contrario: un «2026»
 *      colado como «2026 días» traería un año entero. Por eso lo que no se
 *      entiende se DICE en vez de elegir un periodo por defecto.
 *
 *   2. CONTAR LA HISTORIA HACIA ADELANTE. La API devuelve lo más reciente
 *      primero porque eso es lo que necesita una pantalla. Si se devolviera así,
 *      el modelo leería la semana al revés y resumiría el revés sin notarlo:
 *      no hay ningún error que se dispare cuando una historia se cuenta de
 *      atrás para adelante.
 *
 * Y la tercera, la que da sentido a la columna `origen` de la 0038: que lo que
 * hizo el asistente de alguien no se lea como si lo hubiera tecleado esa
 * persona.
 *
 *   npm run test:mcp
 */
import type { ClienteApi } from "../api.js";
import { diasDesde, queHaPasado } from "./historia.js";

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

console.log("\nEntender «desde cuándo»");

const ahora = new Date("2026-09-12T10:00:00Z");

check("«ayer» son dos días, para que ayer entre entero", diasDesde("ayer", ahora) === 2);
check("«hoy» es uno", diasDesde("hoy", ahora) === 1);
check("«la semana pasada» son siete", diasDesde("la semana pasada", ahora) === 7);
check("«este mes» son treinta", diasDesde("este mes", ahora) === 30);
check("«14 días» son catorce", diasDesde("14 días") === 14);
check("«hace 3 dias», sin tilde, también", diasDesde("hace 3 dias") === 3);
check("«7d» también", diasDesde("7d") === 7);
check("mayúsculas y espacios dan igual", diasDesde("  AYER  ", ahora) === 2);

// La fecha se cuenta hasta hoy: del 1 de septiembre al 12 son 11 días y
// pico, y se redondea a 12 para que el día 1 entre COMPLETO — con 11 el
// corte caería a las diez de la mañana del día 1 y se perdería esa mañana.
check("una fecha se convierte en días", diasDesde("2026-09-01", ahora) === 12);
// Y la trampa real: «2026-09-01» acaba en dígitos. Si el patrón de «N días»
// se probara antes y sin anclar, se quedaría con el «01» y contestaría «un
// día» —una respuesta creíble del periodo equivocado—.
check("una fecha no se lee como «N días» por acabar en números", diasDesde("2026-09-01", ahora) !== 1);
check("una fecha de hoy es un día, no cero", diasDesde("2026-09-12", ahora) === 1);

// Lo que NO se entiende se dice. Un año suelto es el caso real: «desde 2026»
// se leería como 2026 días si el número se aceptara sin más.
check("un año suelto no es un periodo", diasDesde("2026") === null);
check("una fecha futura no se acepta como periodo raro", diasDesde("2027-01-01", ahora) === 1);
check("una fecha demasiado antigua se rechaza", diasDesde("2020-01-01", ahora) === null);
check("y lo que no se parece a nada, tampoco", diasDesde("cuando quieras") === null);

console.log("\nLa respuesta que lee el modelo");

const ORG = { id: "org-1", name: "Hytrex", slug: "hytrex" };

/** Un cliente de mentira: contesta a las dos rutas que esta herramienta usa. */
function clienteFalso(actividad: unknown[], capturar?: (camino: string) => void): ClienteApi {
  return {
    apiUrl: "http://localhost:4000",
    get: async (camino: string) => {
      capturar?.(camino);
      if (camino === "/organizations") return { organizations: [ORG] };
      if (camino.includes("/activity")) return { actividad };
      throw new Error(`el cliente falso no sabe de ${camino}`);
    },
    post: async () => ({}),
    patch: async () => ({}),
  } as unknown as ClienteApi;
}

const hecho = (
  resumen: string,
  ocurridoEn: string,
  actorNombre: string | null,
  origen: "persona" | "regla" | "agente" = "persona",
  workspaceNombre: string | null = "Producto",
) => ({ verbo: "tarea.movida", origen, resumen, actorNombre, ocurridoEn, workspaceNombre });

// Como la devuelve la API: lo más reciente primero.
const comoVieneDeLaApi = [
  hecho("cerró «el 415 del túnel»", "2026-09-11T16:20:00Z", "Ana"),
  hecho("creó «revisar el TURN»", "2026-09-11T09:05:00Z", "Ana", "agente"),
  hecho("creó «el 415 del túnel»", "2026-09-10T11:00:00Z", "Juan"),
];

const salida = await queHaPasado(clienteFalso(comoVieneDeLaApi), { desde: "7 días" });

check("dice cuántos hechos y dónde", salida.includes("3 hechos en Hytrex"));

// El corazón de la herramienta: leído de arriba abajo, tiene que ser la
// secuencia real. Si esto se rompe, el modelo resume la semana al revés y no
// hay nada que lo delate.
const diezAntesQueOnce = salida.indexOf("10 de septiembre") < salida.indexOf("11 de septiembre");
check("los días van en el orden en que ocurrieron", diezAntesQueOnce);
const creoAntesQueCerro =
  salida.indexOf("creó «revisar el TURN»") < salida.indexOf("cerró «el 415 del túnel»");
check("y dentro de un día, también", creoAntesQueCerro);

check("cada hecho lleva su hora", salida.includes("16:20") && salida.includes("09:05"));
check("y el día se escribe como se dice", salida.includes("**11 de septiembre**"));

// La distinción que justifica la columna `origen` de la 0038.
check(
  "lo que hizo el asistente de alguien se dice así",
  salida.includes("el asistente de Ana creó «revisar el TURN»"),
);
check("y lo que tecleó la persona, sin adorno", salida.includes("Ana cerró «el 415 del túnel»"));

// Mirando toda la organización, el espacio de cada hecho es información: sin
// él, dos tableros distintos se leen como uno solo.
check("mirando la organización entera, cada hecho dice de qué espacio es", salida.includes("· Producto"));

console.log("\nLos filtros llegan a la API");

const caminos: string[] = [];
await queHaPasado(clienteFalso([], (c) => caminos.push(c)), { desde: "3 días", solo: "tarea.cerrada" });
const consulta = caminos.find((c) => c.includes("/activity")) ?? "";
check("el periodo viaja como días", consulta.includes("dias=3"));
check("y el filtro de verbo, tal cual", consulta.includes("verbo=tarea.cerrada"));

console.log("\nCuando no hay nada, y cuando no se entiende");

const vacio = await queHaPasado(clienteFalso([]), { desde: "ayer" });
// Un «no hay nada» pelado se lee como «esto está roto». La mitad de las veces
// lo que pasó es que se preguntó por el sitio equivocado, así que la respuesta
// tiene que decir dónde se miró.
check("un «no hay nada» dice dónde se miró", vacio.includes("Hytrex"));
check("y desde cuándo", vacio.includes("2 días"));

const confuso = await queHaPasado(clienteFalso([]), { desde: "el otro día" });
check("un periodo que no se entiende se dice, no se adivina", confuso.includes("No entendí"));
check("y explica qué sí vale", confuso.includes("2026-09-01"));

console.log(`\n${total - fallos} comprobaciones, ${fallos} fallidas`);
if (fallos > 0) process.exit(1);
