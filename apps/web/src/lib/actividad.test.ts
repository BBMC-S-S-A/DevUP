/**
 * Cómo se lee un renglón del registro.
 *
 * QUÉ FIJAN ESTAS COMPROBACIONES, que no es el formato de una frase. Son tres
 * afirmaciones que, si se rompen, rompen la confianza en el historial — y un
 * historial en el que no se confía no se mira:
 *
 *  1. Un verbo que esta capa no conoce NO deja la pantalla en blanco. El
 *     vocabulario está hecho para crecer sin migración, así que la web va a ver
 *     palabras nuevas antes de saber traducirlas.
 *  2. Lo que no se sabe no se inventa: sin nombre de actor se dice que fue
 *     alguien que ya no está, no se deja un hueco ni se pone un nombre por
 *     defecto.
 *  3. El salto entre columnas sale del detalle y no del verbo, y un detalle
 *     incompleto no produce «de undefined a undefined».
 *
 *   npm run test:actividad --workspace apps/web
 */
import {
  actorLegible,
  fraseDeRenglon,
  saltoDeColumna,
  verboLegible,
  type Renglon,
} from "./actividad.js";

let total = 0;
let fallos = 0;

function check(nombre: string, real: unknown, esperado: unknown): void {
  total += 1;
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a === b) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
    console.log(`      esperaba  ${b}`);
    console.log(`      y llegó   ${a}`);
  }
}

function renglon(parcial: Partial<Renglon> = {}): Renglon {
  return {
    id: "r1",
    verbo: "movio",
    sujeto: "tarea",
    sujetoId: "t1",
    sujetoNombre: "Arreglar el riel",
    detalle: { de: "Por hacer", a: "En curso" },
    procedencia: "persona",
    cuando: "2026-09-12T10:00:00.000Z",
    actorId: "u1",
    actorNombre: "Ana",
    actorAvatar: null,
    ...parcial,
  };
}

console.log("\nVerbos");

check("el pasado sin tilde de la base se lee con tilde", verboLegible("movio"), "movió");

check(
  "un verbo que esta capa todavía no conoce se devuelve tal cual, no vacío",
  verboLegible("desplego"),
  "desplego",
);

console.log("\nQuién lo hizo");

check("una persona con nombre es su nombre", actorLegible(renglon()), "Ana");

check(
  "sin nombre no se deja un hueco ni se inventa: la persona se dio de baja",
  actorLegible(renglon({ actorId: null, actorNombre: null })),
  "Alguien que ya no está",
);

check(
  "lo que escribe el producto solo no finge ser nadie",
  actorLegible(renglon({ procedencia: "regla", actorId: null, actorNombre: null })),
  "DevUP",
);

check(
  "un agente sin nombre se dice agente, y no «alguien que ya no está»",
  actorLegible(renglon({ procedencia: "agente", actorNombre: null })),
  "Un agente",
);

console.log("\nEl salto entre columnas");

check("sale del detalle", saltoDeColumna(renglon()), { de: "Por hacer", a: "En curso" });

check(
  "un detalle a medias no produce «de undefined a undefined»",
  saltoDeColumna(renglon({ detalle: { a: "En curso" } })),
  null,
);

check(
  "y el detalle de una asignación tampoco es un salto: `a` es un identificador",
  saltoDeColumna(renglon({ verbo: "asigno", detalle: { a: "u2" } })),
  // Se cuela como texto, sí — pero abajo se comprueba lo que de verdad
  // importa: que la frase de «asigno» no lo pinta como si fuera una columna.
  null,
);

check("sin detalle ninguno", saltoDeColumna(renglon({ detalle: null })), null);

console.log("\nLa frase");

check(
  "dentro de la propia tarea no se repite su nombre",
  fraseDeRenglon(renglon(), false),
  "movió la tarea de Por hacer a En curso",
);

check(
  "fuera, el nombre es lo único que dice de qué se habla",
  fraseDeRenglon(renglon()),
  "movió la tarea «Arreglar el riel» de Por hacer a En curso",
);

check(
  "cerrar es el mismo salto contado de otra manera, y se cuenta igual",
  fraseDeRenglon(renglon({ verbo: "cerro", detalle: { de: "En curso", a: "Hecho" } }), false),
  "cerró la tarea de En curso a Hecho",
);

check(
  "asignar no inventa a quién: el detalle trae un identificador, no un nombre",
  fraseDeRenglon(renglon({ verbo: "asigno", detalle: { a: "u2" } }), false),
  "asignó la tarea",
);

check(
  "crear no tiene salto y no lo finge",
  fraseDeRenglon(renglon({ verbo: "creo", detalle: {} }), false),
  "creó la tarea",
);

check(
  "una tarea borrada sigue leyéndose por el nombre que se copió al escribir",
  fraseDeRenglon(renglon({ verbo: "borro", sujetoId: null, detalle: {} })),
  "borró la tarea «Arreglar el riel»",
);

check(
  "un sujeto que esta capa no conoce se lee, no rompe la frase",
  fraseDeRenglon(renglon({ verbo: "creo", sujeto: "despliegue", detalle: {} })),
  "creó el despliegue «Arreglar el riel»",
);

console.log(`\n${total} comprobaciones, ${fallos} fallida${fallos === 1 ? "" : "s"}`);
process.exit(fallos === 0 ? 0 : 1);
