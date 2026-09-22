/**
 * Prueba de lo que dice `/health` sobre sí mismo (ARQ-04).
 *
 * LO QUE HAY QUE FIJAR NO ES QUE SEPA EL COMMIT: es que SIGA CONTESTANDO
 * CUANDO NO LO SABE. `/health` es la comprobación de vida que usa el propio
 * hosting para decidir si el contenedor arrancó. Si un día el commit no llega
 * —en desarrollo no llega nunca, y en producción bastaría con que alguien
 * borrara la variable— y esto reventara, el resultado sería un servicio sano
 * marcado como caído y reiniciado en bucle. Cambiar un dato que falta por una
 * caída es exactamente el intercambio que no se puede hacer aquí.
 *
 * La otra mitad es el formato: el commit se enseña abreviado a siete
 * caracteres porque es como se nombra un commit al hablar, pero se guarda
 * entero porque es lo que hace falta para compararlo con una rama.
 *
 *   npm run test:version
 */
import { version } from "./version.js";

let total = 0;
const fallos: string[] = [];

function check(nombre: string, condicion: boolean): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos.push(nombre);
    console.log(`  ✗ ${nombre}`);
  }
}

/** Corre algo con unas variables puestas y deja el entorno como estaba. */
function con<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const antes: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    antes[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const SHA = "13e5ce9a7b4c2d1e0f9a8b7c6d5e4f3a2b1c0d9e";
const VACIO = {
  DEVUP_COMMIT: undefined,
  RAILWAY_ENVIRONMENT_NAME: undefined,
  RAILWAY_REPLICA_REGION: undefined,
};

function main(): void {
  console.log("\nSin saber nada, contesta igual");
  const nada = con(VACIO, version);
  check("el commit es null, no revienta", nada.commit === null);
  check("el abreviado también", nada.commitCorto === null);
  check("el entorno es null", nada.entorno === null);
  check("la región es null", nada.region === null);

  console.log("\nCon lo que inyecta el despliegue");
  const lleno = con(
    { DEVUP_COMMIT: SHA, RAILWAY_ENVIRONMENT_NAME: "production", RAILWAY_REPLICA_REGION: "us-west2" },
    version,
  );
  check("devuelve el commit entero, que es lo que se compara", lleno.commit === SHA);
  check("y abreviado a siete, que es lo que se lee", lleno.commitCorto === "13e5ce9");
  check("el entorno", lleno.entorno === "production");
  // Esta es la que contesta «¿dónde están los datos?» de la política sin que
  // nadie tenga que mirar un panel y transcribirlo bien.
  check("y la región, que no está en las variables guardadas", lleno.region === "us-west2");

  console.log("\nLo que llega raro no se enseña como si fuera bueno");
  const espacios = con({ ...VACIO, DEVUP_COMMIT: "   " }, version);
  check("una variable con solo espacios cuenta como no saberlo", espacios.commit === null);

  const vacia = con({ ...VACIO, DEVUP_COMMIT: "" }, version);
  check("y una vacía también", vacia.commit === null);

  // Si alguien pone ahí algo que no es un sha —una etiqueta, un número de
  // versión— se enseña tal cual en vez de cortarlo por la mitad y fingir que
  // es un commit.
  const etiqueta = con({ ...VACIO, DEVUP_COMMIT: "v2.1.0" }, version);
  check("lo que no es un sha no se recorta", etiqueta.commitCorto === "v2.1.0");

  console.log(`\n${total - fallos.length} comprobaciones correctas, ${fallos.length} fallidas`);
  if (fallos.length > 0) {
    console.error("\nFallaron:\n" + fallos.map((f) => `  · ${f}`).join("\n"));
    process.exit(1);
  }
}

main();
