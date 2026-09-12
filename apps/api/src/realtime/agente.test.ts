/**
 * Prueba de qué dice el muñeco del agente, y durante cuánto.
 *
 * QUÉ SE PRUEBA. Solo la precedencia y la caducidad — que es donde está toda
 * la decisión. No hay base de datos ni servidor: `agente.ts` es un mapa en
 * memoria, y `ahora` entra por parámetro justamente para que esto no tenga
 * que esperar cinco minutos de reloj real.
 *
 * POR QUÉ MERECE PRUEBA algo tan pequeño. Las dos reglas que codifica son
 * afirmaciones sobre la verdad de lo que se pinta: que una frase declarada
 * gana a una deducida (quien dijo «estoy migrando la base» sigue migrando la
 * base aunque consulte el tablero de paso), y que todo caduca (un agente que
 * se murió a mitad no puede seguir diciendo que trabaja). Si la segunda se
 * rompe, la sala miente y nada se pone rojo.
 *
 *   npm run test:agente
 */
import { anotarLatido, faenaDelAgente, olvidarTodo } from "./agente.js";

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

const T0 = 1_000_000;
const MINUTO = 60_000;

console.log("\nSin latidos no hay faena");

olvidarTodo();
check("nadie que no haya latido está haciendo algo", faenaDelAgente("ana", T0) === null);

console.log("\nUna herramienta se deduce");

olvidarTodo();
anotarLatido("ana", "herramienta", "mirando el tablero", T0);
check("se ve la frase de la herramienta", faenaDelAgente("ana", T0) === "mirando el tablero");
check(
  "sigue viéndose un minuto después",
  faenaDelAgente("ana", T0 + MINUTO) === "mirando el tablero",
);
check("a los tres minutos ya no", faenaDelAgente("ana", T0 + 3 * MINUTO) === null);

console.log("\nLo declarado gana");

olvidarTodo();
anotarLatido("ana", "declarada", "estoy migrando la base de datos", T0);
// El caso que importa: la herramienta llega DESPUÉS, y aun así no manda. Es
// un paso de la faena declarada, no una faena nueva.
anotarLatido("ana", "herramienta", "mirando el tablero", T0 + 10_000);
check(
  "la declarada manda aunque la herramienta sea más reciente",
  faenaDelAgente("ana", T0 + 10_000) === "estoy migrando la base de datos",
);
// A los seis minutos la declarada (5 min) ya no vale y la herramienta (2 min,
// sellada en T0+10s) tampoco: silencio.
check("pasados seis minutos no queda nada", faenaDelAgente("ana", T0 + 6 * MINUTO) === null);

console.log("\nCuando la declarada caduca, se cae a la deducida");

// El reparto de tiempos importa: la declarada vence a los 5 min desde T0, y la
// herramienta a los 2 min desde T0+4min —o sea, a los 6—, así que entre el
// minuto 5 y el 6 hay una ventana en la que solo queda la deducida. Ahí es
// donde se ve que el respaldo existe de verdad.
olvidarTodo();
anotarLatido("ana", "declarada", "estoy migrando la base de datos", T0);
anotarLatido("ana", "herramienta", "mirando el tablero", T0 + 4 * MINUTO);
check(
  "antes del minuto cinco manda la declarada",
  faenaDelAgente("ana", T0 + 4 * MINUTO + 30_000) === "estoy migrando la base de datos",
);
check(
  "pasado el minuto cinco queda la de la herramienta",
  faenaDelAgente("ana", T0 + 5 * MINUTO + 30_000) === "mirando el tablero",
);
check("y pasado el seis, nada", faenaDelAgente("ana", T0 + 6 * MINUTO + 30_000) === null);

console.log("\nUna declarada nueva sustituye a la anterior");

olvidarTodo();
anotarLatido("ana", "declarada", "estoy migrando la base de datos", T0);
anotarLatido("ana", "declarada", "ahora reviso el diseño", T0 + MINUTO);
check(
  "se ve la última, no la primera",
  faenaDelAgente("ana", T0 + MINUTO) === "ahora reviso el diseño",
);

console.log("\nCada persona ve su propio agente");

olvidarTodo();
anotarLatido("ana", "declarada", "estoy migrando la base de datos", T0);
check("la de ana es la suya", faenaDelAgente("ana", T0) === "estoy migrando la base de datos");
// Esto no es un detalle de implementación: es lo que evita que la frase de
// una persona —que puede llevar el nombre de un cliente— se le enseñe al resto.
check("beto no ve la de ana", faenaDelAgente("beto", T0) === null);

console.log("\nEl mapa se limpia solo");

olvidarTodo();
anotarLatido("ana", "herramienta", "mirando el tablero", T0);
// Un latido de otra persona mucho después es lo que dispara la poda. Que ana
// haya desaparecido del mapa no se puede observar desde fuera sin exponer el
// mapa, así que lo que se comprueba es lo que sí importa: que no la afecta.
anotarLatido("beto", "herramienta", "buscando en el proyecto", T0 + 10 * MINUTO);
check("ana ya no dice nada", faenaDelAgente("ana", T0 + 10 * MINUTO) === null);
check(
  "y beto sí",
  faenaDelAgente("beto", T0 + 10 * MINUTO) === "buscando en el proyecto",
);

console.log(`\n${total} comprobaciones, ${fallos} fallidas`);
if (fallos > 0) process.exit(1);
