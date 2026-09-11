import { nombreDeRepo } from "./github.js";

/**
 * Pruebas del analizador de enlaces de GitHub.
 *
 * ES UNA FUNCIÓN PURA Y ES LA PUERTA DE ENTRADA AL PRODUCTO: lo primero que
 * hace alguien que llega es pegar aquí lo que tenga. Si esto rechaza una forma
 * legítima, la persona se queda fuera pensando que escribió mal algo que estaba
 * bien.
 *
 * La segunda mitad importa más que la primera: lo que NO debe aceptar. Un
 * enlace de GitLab que colara acabaría en un 404 de GitHub y en un mensaje que
 * no explica nada.
 *
 *   npm run test:github
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

function igual(entrada: string, esperado: string): void {
  const obtenido = nombreDeRepo(entrada);
  check(entrada, obtenido === esperado, `esperaba «${esperado}» y salió «${obtenido}»`);
}

function nulo(entrada: string): void {
  const obtenido = nombreDeRepo(entrada);
  check(`rechaza «${entrada}»`, obtenido === null, `salió «${obtenido}»`);
}

console.log("\nLo que alguien pega de verdad");

igual("https://github.com/BBMC-S-S-A/DevUP", "BBMC-S-S-A/DevUP");
igual("https://github.com/BBMC-S-S-A/DevUP/", "BBMC-S-S-A/DevUP");
igual("http://github.com/BBMC-S-S-A/DevUP", "BBMC-S-S-A/DevUP");
igual("https://www.github.com/BBMC-S-S-A/DevUP", "BBMC-S-S-A/DevUP");
igual("github.com/BBMC-S-S-A/DevUP", "BBMC-S-S-A/DevUP");
igual("BBMC-S-S-A/DevUP", "BBMC-S-S-A/DevUP");
igual("  BBMC-S-S-A/DevUP  ", "BBMC-S-S-A/DevUP");

console.log("\nLos botones de copiar de GitHub");

igual("https://github.com/BBMC-S-S-A/DevUP.git", "BBMC-S-S-A/DevUP");
igual("git@github.com:BBMC-S-S-A/DevUP.git", "BBMC-S-S-A/DevUP");
igual("git@github.com:BBMC-S-S-A/DevUP", "BBMC-S-S-A/DevUP");

console.log("\nDirecciones de dentro del repositorio, que apuntan al mismo sitio");

igual("https://github.com/BBMC-S-S-A/DevUP/tree/main/src", "BBMC-S-S-A/DevUP");
igual("https://github.com/BBMC-S-S-A/DevUP/pull/41", "BBMC-S-S-A/DevUP");
igual("https://github.com/BBMC-S-S-A/DevUP/blob/main/README.md", "BBMC-S-S-A/DevUP");
igual("https://github.com/BBMC-S-S-A/DevUP?tab=readme-ov-file", "BBMC-S-S-A/DevUP");

console.log("\nNombres con puntos, guiones y números, que son legales");

igual("https://github.com/vercel/next.js", "vercel/next.js");
igual("https://github.com/1password/agent-sdk", "1password/agent-sdk");

console.log("\nLo que NO debe aceptar, que importa más");

nulo("");
nulo("   ");
nulo("BBMC-S-S-A");
nulo("https://gitlab.com/grupo/proyecto");
nulo("https://bitbucket.org/equipo/repo");
nulo("https://github.com/");
nulo("https://github.com/soloeldueno");
nulo("no es una url ni un nombre");
// Un nombre con espacios en medio no es un repositorio, aunque tenga barra.
nulo("mi organización/mi repo");

console.log(
  `\n${total - fallos} comprobaciones correctas, ${fallos} fallida${fallos === 1 ? "" : "s"}\n`,
);
if (fallos > 0) process.exit(1);
