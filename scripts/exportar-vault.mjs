// Empaqueta la documentación de DevUP como una carpeta lista para soltar dentro
// de una bóveda de Obsidian.
//
// QUÉ PROBLEMA RESUELVE. Hay dos bóvedas —la local y la del repositorio de la
// bóveda— y la documentación vive en una tercera parte: este repositorio. Tres
// copias a mano se desincronizan la primera semana, y entonces cada una dice
// algo distinto sin que ninguna avise. Con esto hay UNA fuente —`docs/`— y las
// bóvedas reciben una copia marcada como generada, que se puede volver a
// generar encima sin pensar.
//
// POR QUÉ COPIAR Y NO ENLAZAR. Un enlace simbólico se rompe al clonar en otra
// máquina y no sobrevive a Git; un submódulo mete el repositorio de código
// entero dentro de una bóveda de notas. La copia es lo único que funciona igual
// en las dos bóvedas y en los dos sistemas operativos.
//
// CÓMO SE USA:
//
//   npm run vault -- /ruta/a/la/boveda/DevUP
//
// Y lo mismo apuntando a la otra bóveda. Lo que había antes en ese destino se
// reemplaza: la carpeta es de esta herramienta, no un sitio donde escribir a
// mano — para eso está `docs/` en el repositorio, que es la fuente.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const destino = process.argv[2];
if (!destino) {
  console.error(
    "Falta a dónde exportar.\n\n" +
      "  npm run vault -- /ruta/a/la/boveda/DevUP\n\n" +
      "Se puede correr dos veces, una por bóveda: la carpeta se regenera entera.",
  );
  process.exit(1);
}
const salida = resolve(destino);

// No dejar que un destino equivocado se lleve por delante algo que no es nuestro.
// `rmSync` recursivo sobre la carpeta equivocada borra el trabajo de alguien, y
// eso no se deshace.
if (salida === raiz || raiz.startsWith(salida + "/")) {
  console.error(`Ese destino (${salida}) contiene al propio repositorio. No.`);
  process.exit(1);
}

/** Todos los .md de una carpeta, bajando a sus subcarpetas. */
function notas(dir, base = dir) {
  const encontradas = [];
  for (const entrada of readdirSync(dir)) {
    const camino = join(dir, entrada);
    if (statSync(camino).isDirectory()) {
      encontradas.push(...notas(camino, base));
    } else if (entrada.endsWith(".md")) {
      encontradas.push(relative(base, camino).replace(/\\/g, "/"));
    }
  }
  return encontradas;
}

const dirDocs = join(raiz, "docs");
const ficheros = notas(dirDocs);

/**
 * La cabecera que lleva cada nota exportada.
 *
 * ES LA MITAD DEL VALOR DE ESTO. Sin ella, dentro de un mes alguien edita una
 * nota en la bóveda, la siguiente exportación se la lleva, y el trabajo
 * desaparece sin que nada lo diga. Decir de dónde viene y que se regenera es lo
 * que impide esa pérdida — y de paso, dónde hay que ir a arreglarlo.
 */
function cabecera(relativo) {
  const fecha = new Date().toISOString().slice(0, 10);
  return [
    "---",
    "origen: bbmc-s-s-a/devup",
    `fuente: docs/${relativo}`,
    `exportado: ${fecha}`,
    "tags: [devup, generado]",
    "---",
    "",
    `> [!warning] Copia generada — no editar aquí`,
    `> Sale de \`docs/${relativo}\` en el repositorio de DevUP y se regenera con`,
    "> `npm run vault`. Lo que se escriba en esta copia se pierde en la siguiente",
    "> pasada; el sitio donde se corrige es el repositorio.",
    // Dos saltos y no uno: sin la línea en blanco, el aviso y el título de la
    // nota se pegan y Obsidian deja de pintar el callout.
    "",
    "",
  ].join("\n");
}

rmSync(salida, { recursive: true, force: true });
mkdirSync(salida, { recursive: true });

for (const relativo of ficheros) {
  const contenido = readFileSync(join(dirDocs, relativo), "utf8");
  const camino = join(salida, relativo);
  mkdirSync(dirname(camino), { recursive: true });
  writeFileSync(camino, cabecera(relativo) + contenido);
}

// GRAFO.md vive en la raíz y no en `docs/`, pero es la nota que más se consulta:
// dejarla fuera obligaría a saltar al repositorio justo para lo que se mira más.
// El índice la enlaza como `../GRAFO`, así que aquí se copia con ese nombre para
// que el enlace siga resolviendo dentro de la bóveda.
const grafo = readFileSync(join(raiz, "GRAFO.md"), "utf8");
writeFileSync(join(salida, "GRAFO.md"), cabecera("../GRAFO.md") + grafo);

// El índice enlaza `[[../GRAFO|GRAFO]]` porque en el repositorio está un nivel
// más arriba. Aquí ya no: si se dejara, Obsidian buscaría fuera de la carpeta y
// crearía un nodo fantasma — justo el ruido que el índice existe para quitar.
const indice = join(salida, "INDICE.md");
writeFileSync(indice, readFileSync(indice, "utf8").replaceAll("[[../GRAFO|GRAFO]]", "[[GRAFO]]"));

console.log(
  `Exportadas ${ficheros.length + 1} notas a ${salida}.\n` +
    "Ábrela en Obsidian; la nota de entrada es INDICE.",
);
