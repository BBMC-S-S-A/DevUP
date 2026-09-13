// Dibuja el grafo del proyecto leyendo el código, y lo escribe en GRAFO.md.
//
// QUÉ PREGUNTA CONTESTA. No «qué archivos hay» —eso ya lo enseña el árbol de
// carpetas— sino QUÉ SE TOCA CON QUÉ: qué pantalla llama a qué rutas, qué
// tablas escribe cada área, y sobre todo qué áreas comparten tabla. Eso último
// es lo único que las relaciona de verdad: dos áreas que escriben en la misma
// tabla están acopladas aunque sus archivos no se importen, y dos que no
// comparten ninguna son islas por mucho que estén en la misma barra lateral.
//
// DOS DIAGRAMAS Y NO UNO, porque no sirven para lo mismo. El primero enseña
// solo los CRUCES entre áreas: pocos nodos y pocas aristas, se lee de un
// vistazo y contesta «¿qué se rompe si toco esto?». El segundo es el mapa
// entero —pantallas, áreas, tablas y con quién se habla fuera—, que es grande
// por definición y sirve para buscar, no para mirar. Debajo va el detalle en
// tablas, que es donde el detalle se consulta bien.
//
// LO QUE ESTO NO PUEDE VER, y conviene decirlo porque un mapa que se cree
// completo engaña: SQL construido a trozos en tiempo de ejecución, tablas que
// solo tocan las funciones `security definer` desde dentro de Postgres, y
// cualquier llamada a la API hecha fuera de una pantalla (el MCP, por ejemplo).
// Se lee el texto, no se ejecuta nada — el mismo criterio que la pantalla de
// Base de datos aplica a las migraciones ajenas.
//
//   npm run grafo

import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function archivos(dir, filtro, encontrados = []) {
  for (const entrada of readdirSync(dir)) {
    const camino = join(dir, entrada);
    if (statSync(camino).isDirectory()) archivos(camino, filtro, encontrados);
    else if (filtro(camino)) encontrados.push(camino);
  }
  return encontrados;
}

/** Quita comentarios para no contar una tabla nombrada de pasada al explicarla. */
function sinComentarios(codigo) {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

// --- 1. Las tablas, de las migraciones ---------------------------------------

const migraciones = readdirSync(join(raiz, "db", "migrations"))
  .filter((n) => n.endsWith(".sql"))
  .sort();

/** tabla -> migración que la creó */
const tablas = new Map();
for (const nombre of migraciones) {
  const sql = readFileSync(join(raiz, "db", "migrations", nombre), "utf8");
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi)) {
    if (!tablas.has(m[1])) tablas.set(m[1], nombre);
  }
}

// --- 1b. Las funciones de la base de datos, y qué tablas tocan ---------------

/**
 * La mitad del sistema no escribe sus tablas desde una ruta, sino desde una
 * función `security definer` dentro de Postgres — y a propósito: es lo que
 * impide que una petición de usuario invente un despliegue o se emita un token
 * a nombre de otro.
 *
 * Sin mirar dentro de las funciones, esas tablas parecen muertas. Ya pasó: un
 * documento de este mismo repositorio llegó a decir que `user_tokens` no la
 * usaba nadie y que se podía borrar, y era falso —la escriben las funciones de
 * verificación de correo y de recuperar contraseña—. Por eso se leen.
 */
const funciones = new Map();
for (const nombre of migraciones) {
  const sql = sinComentarios(readFileSync(join(raiz, "db", "migrations", nombre), "utf8"));
  // Cada definición va desde su cabecera hasta el cierre del cuerpo (`$$;`),
  // que es el delimitador que usan todas las migraciones de este repositorio.
  for (const m of sql.matchAll(
    /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\$\$\s*;/gi,
  )) {
    const cuerpo = m[2];
    const tocadas = new Set();
    for (const patron of [
      /\bfrom\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
      /\bjoin\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
      /\binsert\s+into\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
      /\bupdate\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
      /\bdelete\s+from\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    ]) {
      for (const t of cuerpo.matchAll(patron)) if (tablas.has(t[1])) tocadas.add(t[1]);
    }
    if (tocadas.size > 0) funciones.set(m[1], { migracion: nombre, tablas: [...tocadas].sort() });
  }
}

// --- 2. Las áreas de la API --------------------------------------------------

/**
 * Un «área» es un archivo de rutas. Es la unidad correcta porque es la que
 * decide el equipo al escribir: lo que va junto en un archivo es lo que alguien
 * consideró el mismo asunto.
 */
const areas = [];
const dirRutas = join(raiz, "apps", "api", "src", "routes");

/**
 * Se baja a las subcarpetas, y todo lo que hay dentro de una cuenta como la
 * misma área.
 *
 * `spotify.ts` no declara ni una ruta: solo registra `spotify/conexion.ts` y
 * `spotify/sala.ts`. Mirando solo el primer nivel, Spotify entero desaparecía
 * del mapa y sus dos tablas salían como que no las escribe nadie — un mapa que
 * se deja fuera un área completa es peor que no tenerlo, porque nadie duda de
 * él.
 */
const porArea = new Map();
for (const camino of archivos(dirRutas, (c) => c.endsWith(".ts") && !c.includes(".test."))) {
  const rel = relative(dirRutas, camino).replace(/\\/g, "/");
  const area = rel.includes("/") ? rel.split("/")[0] : rel.replace(/\.ts$/, "");
  porArea.set(area, [...(porArea.get(area) ?? []), camino]);
}

/**
 * Las consultas que viven en `lib/`, atribuidas al área que las usa.
 *
 * SIN ESTO EL MAPA MIENTE, y miente del modo peor: en silencio y a favor. Un
 * área cuya SQL se sacó a un fichero de `lib/` —`panorama`, `puntos`, `ramas`,
 * `widgets`— aparecía SIN NINGUNA TABLA, y como el acoplamiento se calcula por
 * tablas compartidas, salía además marcada como «isla». O sea que el documento
 * afirmaba justo lo contrario de la verdad sobre ellas, con la misma cara con
 * la que dice el resto.
 *
 * Se sigue la importación, que es la relación real: si dos áreas usan el mismo
 * `lib`, comparten sus tablas de verdad y el cruce que aparezca es correcto.
 * No es recursivo a propósito —un `lib` que importa a otro es raro aquí— y si
 * el fichero no existe se ignora en vez de reventar: esto es un mapa, no un
 * compilador.
 */
const dirLib = join(raiz, "apps", "api", "src", "lib");
function conSusLibs(caminos) {
  const textos = caminos.map((c) => readFileSync(c, "utf8"));
  const vistos = new Set();
  for (const texto of [...textos]) {
    for (const m of texto.matchAll(/from\s+["'][^"']*\/lib\/([a-zA-Z0-9_-]+)\.js["']/g)) {
      if (vistos.has(m[1])) continue;
      vistos.add(m[1]);
      try {
        textos.push(readFileSync(join(dirLib, `${m[1]}.ts`), "utf8"));
      } catch {
        // Un lib que no está donde dice el import no es asunto de este mapa.
      }
    }
  }
  return textos.join("\n");
}

for (const [area, caminos] of porArea) {
  const codigo = sinComentarios(conSusLibs(caminos));

  const puntos = [];
  for (const m of codigo.matchAll(/\bapp\.(get|post|patch|put|delete)\s*\(\s*["'`]([^"'`]+)/g)) {
    puntos.push({ metodo: m[1].toUpperCase(), ruta: m[2] });
  }

  const tocadas = new Set();
  const patrones = [
    /\bfrom\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    /\bjoin\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    /\binsert\s+into\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    /\bupdate\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    /\bdelete\s+from\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
  ];
  for (const patron of patrones) {
    for (const m of codigo.matchAll(patron)) {
      // Cruzar contra las tablas reales es lo que quita los falsos positivos:
      // un `from "fastify"` de un import o el nombre de una función no están
      // en la lista, así que se caen solos.
      if (tablas.has(m[1])) tocadas.add(m[1]);
    }
  }

  // Con qué habla fuera de la máquina. Es la otra mitad del mapa: una tabla
  // dice dónde se guarda algo, y un conector dice de quién dependemos para que
  // ese algo exista.
  const conectores = new Set();
  for (const m of codigo.matchAll(/from\s+["']\.\.\/connectors\/([a-z_-]+)\.js["']/gi)) {
    conectores.add(m[1]);
  }

  // Y qué funciones de la base llama, que es como toca las tablas que no
  // nombra nunca.
  const llamadas = new Set();
  for (const m of codigo.matchAll(/public\.([a-z_][a-z0-9_]*)\s*\(/gi)) {
    if (funciones.has(m[1])) llamadas.add(m[1]);
  }

  if (puntos.length > 0 || tocadas.size > 0) {
    areas.push({
      area,
      archivos: caminos.map((c) => relative(raiz, c).replace(/\\/g, "/")),
      puntos,
      tablas: [...tocadas].sort(),
      conectores: [...conectores].sort(),
      funciones: [...llamadas].sort(),
    });
  }
}

// --- 3. Las pantallas, y a qué rutas llaman ----------------------------------

/** Deja `/organizations/${orgId}/x` y `/organizations/:orgId/x` en la misma forma. */
const normalizar = (ruta) =>
  ruta
    .replace(/\$\{[^}]*\}/g, ":id")
    .replace(/:[a-zA-Z]+/g, ":id")
    .replace(/\?.*$/, "")
    .replace(/\/+$/, "");

const porRuta = new Map();
for (const a of areas) {
  for (const p of a.puntos) {
    const clave = normalizar(p.ruta);
    if (!porRuta.has(clave)) porRuta.set(clave, a.area);
  }
}

/**
 * Se miran las pantallas Y los componentes.
 *
 * Con solo `page.tsx` salían 17 de 34, y no porque las otras no hablen con la
 * API: es que media docena de superficies —el tablero, la biblioteca, el chat—
 * llaman desde su componente, no desde la página. Un mapa que se deja fuera la
 * mitad del frontend no es un mapa incompleto, es uno que engaña.
 */
const pantallas = [];
const dirWeb = join(raiz, "apps", "web", "src");
const dirApp = join(dirWeb, "app");
const fuentesWeb = [
  ...archivos(dirApp, (c) => c.endsWith("page.tsx")),
  ...archivos(join(dirWeb, "components"), (c) => c.endsWith(".tsx") && !c.includes(".test.")),
];

for (const camino of fuentesWeb) {
  const codigo = sinComentarios(readFileSync(camino, "utf8"));
  // Una pantalla que solo reexporta otra (`export { default } from …`) no es
  // una pantalla más: es la misma montada en otra URL.
  if (/export\s*\{\s*default\s*\}\s*from/.test(codigo)) continue;

  const llamadas = new Set();
  const patrones = [
    /\bapi\.(?:get|post|patch|put|delete)\s*(?:<[^>]*>)?\s*\(\s*[`"']([^`"']+)/g,
    /\buseRecurso\s*(?:<[^>]*>)?\s*\(\s*[`"']([^`"']+)/g,
  ];
  for (const patron of patrones) {
    for (const m of codigo.matchAll(patron)) {
      if (m[1].startsWith("/")) llamadas.add(normalizar(m[1]));
    }
  }

  const esPagina = camino.endsWith("page.tsx");
  const ruta = esPagina
    ? `/${relative(dirApp, camino).replace(/\\/g, "/").replace(/\/page\.tsx$/, "")}`
        // `(privado)` es un grupo de rutas de Next, no un tramo de la URL: no
        // sale en la barra de direcciones y aquí solo estorba. Y los corchetes
        // de `[orgId]` rompen el parser de mermaid aun entre comillas, así que
        // se escriben como el `:orgId` que ya usa la API.
        .replace(/\/\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]/g, ":$1")
    : relative(join(dirWeb, "components"), camino).replace(/\\/g, "/").replace(/\.tsx$/, "");

  const tocadas = new Set();
  for (const llamada of llamadas) {
    const area = porRuta.get(llamada);
    if (area) tocadas.add(area);
  }

  if (llamadas.size > 0) {
    pantallas.push({
      ruta,
      esPagina,
      archivo: relative(raiz, camino).replace(/\\/g, "/"),
      llamadas: [...llamadas].sort(),
      areas: [...tocadas].sort(),
    });
  }
}

// --- 4. Los cruces: áreas que comparten tabla --------------------------------

const cruces = [];
for (let i = 0; i < areas.length; i++) {
  for (let j = i + 1; j < areas.length; j++) {
    const comunes = areas[i].tablas.filter((t) => areas[j].tablas.includes(t));
    if (comunes.length > 0) cruces.push({ a: areas[i].area, b: areas[j].area, tablas: comunes });
  }
}

/**
 * El armazón se deduce, no se escribe a mano.
 *
 * `organizations`, `users` o `profiles` las toca medio producto: son el
 * andamiaje sobre el que se apoya todo, no un acoplamiento entre dos áreas
 * concretas. Con ellas dentro salían 64 cruces entre 22 áreas —es decir, todo
 * con todo— y un diagrama así no dice nada.
 *
 * La regla es que una tabla que tocan CUATRO O MÁS áreas ya no distingue a
 * nadie. Se calcula en vez de listarse porque una lista escrita a mano acierta
 * hoy y miente dentro de tres migraciones, justo cuando nadie se acuerda de
 * que existe.
 */
const UMBRAL_ARMAZON = 4;
const areasPorTabla = new Map();
for (const a of areas) {
  for (const t of a.tablas) areasPorTabla.set(t, (areasPorTabla.get(t) ?? 0) + 1);
}
const ARMAZON = new Set(
  [...areasPorTabla.entries()].filter(([, n]) => n >= UMBRAL_ARMAZON).map(([t]) => t),
);
const crucesReales = cruces
  .map((c) => ({ ...c, tablas: c.tablas.filter((t) => !ARMAZON.has(t)) }))
  .filter((c) => c.tablas.length > 0);

const conCruce = new Set(crucesReales.flatMap((c) => [c.a, c.b]));
const islas = areas.filter((a) => !conCruce.has(a.area)).map((a) => a.area);

// --- 5. El documento ---------------------------------------------------------

const id = (s) => s.replace(/[^a-zA-Z0-9]/g, "_");
const hoy = new Date().toISOString().slice(0, 10);

const lineas = [];
lineas.push("# El grafo de DevUP");
lineas.push("");
lineas.push(
  "> Generado leyendo el código con `npm run grafo`. **No se edita a mano**: lo que se escriba aquí",
  "> desaparece en la siguiente pasada. Última: " + hoy + ".",
);
lineas.push("");
lineas.push(
  `Hoy el proyecto tiene **${areas.length} áreas de API**, ` +
    `**${pantallas.filter((p) => p.esPagina).length} pantallas**, ` +
    `**${pantallas.filter((p) => !p.esPagina).length} componentes que hablan con la API** y ` +
    `**${tablas.size} tablas** repartidas en ${migraciones.length} migraciones.`,
);
lineas.push("");
lineas.push("## Qué áreas se tocan de verdad");
lineas.push("");
lineas.push(
  "Dos áreas están acopladas cuando escriben en la misma tabla, se importen o no entre ellas.",
  "Ese es el único parentesco que cuenta, y es el que enseña este diagrama.",
  "",
  `Las tablas que tocan ${UMBRAL_ARMAZON} áreas o más quedan fuera: son el armazón del producto y no`,
  "distinguen a nadie —con ellas dentro, todo aparece conectado con todo—. Hoy son " +
    [...ARMAZON].sort().map((t) => `\`${t}\``).join(", ") +
    ".",
);
lineas.push("");
lineas.push("```mermaid");
lineas.push("graph LR");
for (const area of areas) {
  const marca = conCruce.has(area.area) ? "" : ":::isla";
  lineas.push(`  ${id(area.area)}["${area.area}"]${marca}`);
}
for (const c of crucesReales) {
  const etiqueta = c.tablas.length <= 2 ? c.tablas.join(", ") : `${c.tablas.length} tablas`;
  lineas.push(`  ${id(c.a)} --- |${etiqueta}| ${id(c.b)}`);
}
lineas.push("  classDef isla stroke-dasharray: 4 3;");
lineas.push("```");
lineas.push("");
if (islas.length > 0) {
  lineas.push(
    `**Islas** (con el borde punteado): ${islas.map((i) => `\`${i}\``).join(", ")}. No comparten con nadie ` +
      "ninguna tabla PROPIA: si se cruzan con otra área, es solo en el armazón de arriba, que es " +
      "donde se cruzan todas. Decir «no comparten ninguna tabla» a secas sería falso —`actividad` y " +
      "`tasks` escriben las dos en `activity`— y el matiz importa: una isla de verdad se puede mover " +
      "sola, y una que solo toca el armazón, no. No es necesariamente un defecto —hay áreas que " +
      "deben bastarse solas— pero sí es lo que hace que el producto se sienta como varias " +
      "herramientas en la misma barra lateral.",
  );
  lineas.push("");
}

lineas.push("## El mapa completo");
lineas.push("");
lineas.push(
  "Todo a la vez: cada pantalla, el área a la que llama, las tablas que esa área escribe y con qué",
  "habla fuera. Es grande a propósito —es el proyecto entero— y se lee mejor abriéndolo a pantalla",
  "completa. Para entender cómo encaja algo concreto, el diagrama de arriba y las tablas de abajo",
  "dicen lo mismo en pequeño.",
);
lineas.push("");
lineas.push("```mermaid");
lineas.push("graph LR");

lineas.push("  subgraph Pantallas_y_componentes");
for (const p of pantallas) lineas.push(`    P_${id(p.ruta)}["${p.ruta}"]`);
lineas.push("  end");

lineas.push("  subgraph API");
for (const a of areas) lineas.push(`    A_${id(a.area)}["${a.area}"]`);
lineas.push("  end");

const conTabla = [...tablas.keys()].filter((t) => areas.some((a) => a.tablas.includes(t)));
lineas.push("  subgraph Tablas");
for (const t of conTabla) lineas.push(`    T_${id(t)}[("${t}")]`);
lineas.push("  end");

const todosConectores = [...new Set(areas.flatMap((a) => a.conectores))].sort();
if (todosConectores.length > 0) {
  lineas.push("  subgraph Fuera");
  for (const c of todosConectores) lineas.push(`    C_${id(c)}{{"${c}"}}`);
  lineas.push("  end");
}

for (const p of pantallas) {
  for (const a of p.areas) lineas.push(`  P_${id(p.ruta)} --> A_${id(a)}`);
}
for (const a of areas) {
  for (const t of a.tablas) lineas.push(`  A_${id(a.area)} --> T_${id(t)}`);
  for (const c of a.conectores) lineas.push(`  A_${id(a.area)} -.-> C_${id(c)}`);
}
lineas.push("```");
lineas.push("");

lineas.push("## Cada área: qué expone, qué escribe y con quién habla fuera");
lineas.push("");
lineas.push("| Área | Puntos de entrada | Tablas que toca | Fuera |");
lineas.push("|---|---|---|---|");
for (const a of [...areas].sort((x, y) => x.area.localeCompare(y.area))) {
  const tablasTexto = a.tablas.length > 0 ? a.tablas.map((t) => `\`${t}\``).join(", ") : "—";
  const fuera = a.conectores.length > 0 ? a.conectores.map((c) => `\`${c}\``).join(", ") : "—";
  lineas.push(`| \`${a.area}\` | ${a.puntos.length} | ${tablasTexto} | ${fuera} |`);
}
lineas.push("");

lineas.push("## Cada punto de entrada");
lineas.push("");
lineas.push("| Método | Ruta | Área |");
lineas.push("|---|---|---|");
for (const a of [...areas].sort((x, y) => x.area.localeCompare(y.area))) {
  for (const p of a.puntos) lineas.push(`| ${p.metodo} | \`${p.ruta}\` | \`${a.area}\` |`);
}
lineas.push("");

lineas.push("## Cada tabla: quién la toca y de qué migración salió");
lineas.push("");
lineas.push("| Tabla | Migración | Áreas que la nombran |");
lineas.push("|---|---|---|");
for (const t of [...tablas.keys()].sort()) {
  const quien = areas.filter((a) => a.tablas.includes(t)).map((a) => `\`${a.area}\``);
  lineas.push(`| \`${t}\` | \`${tablas.get(t)}\` | ${quien.length > 0 ? quien.join(", ") : "—"} |`);
}
lineas.push("");

lineas.push("## Cada pantalla y componente: a qué áreas llama");
lineas.push("");
lineas.push("| Pantalla o componente | Áreas que consume |");
lineas.push("|---|---|");
for (const p of [...pantallas].sort((x, y) => x.ruta.localeCompare(y.ruta))) {
  const areasTexto = p.areas.length > 0 ? p.areas.map((a) => `\`${a}\``).join(", ") : "—";
  lineas.push(`| \`${p.ruta}\` | ${areasTexto} |`);
}
lineas.push("");

lineas.push("## Las funciones de la base, y quién las llama");
lineas.push("");
lineas.push(
  "Buena parte del sistema no escribe sus tablas desde una ruta sino desde una función",
  "`security definer` dentro de Postgres, y es deliberado: es lo que impide que una petición de",
  "usuario invente un despliegue o emita un token a nombre de otro. Estas son esas funciones y las",
  "tablas que tocan por dentro.",
);
lineas.push("");
lineas.push("| Función | Tablas que toca | Áreas que la llaman |");
lineas.push("|---|---|---|");
for (const nombre of [...funciones.keys()].sort()) {
  const f = funciones.get(nombre);
  const quien = areas.filter((a) => a.funciones.includes(nombre)).map((a) => `\`${a.area}\``);
  lineas.push(
    `| \`${nombre}\` | ${f.tablas.map((t) => `\`${t}\``).join(", ")} | ${quien.length > 0 ? quien.join(", ") : "— (solo desde dentro)"} |`,
  );
}
lineas.push("");

const huerfanas = [...tablas.keys()]
  .filter((t) => !areas.some((a) => a.tablas.includes(t)))
  .sort();
if (huerfanas.length > 0) {
  lineas.push("## Tablas que ninguna ruta nombra");
  lineas.push("");
  lineas.push(
    "Ninguna ruta de la API las menciona en su SQL. La columna de la derecha dice por qué: casi",
    "siempre porque las escribe una función desde dentro de Postgres. **Una tabla sin función y sin",
    "área es la única que de verdad habría que mirar** — es donde aparecería algo que quedó sin usar.",
    "",
    "Esta distinción no es teórica: un documento de este mismo repositorio llegó a dar `user_tokens`",
    "por muerta y a proponer borrarla, y resultó que la escriben las funciones de verificar el correo",
    "y recuperar la contraseña.",
  );
  lineas.push("");
  lineas.push("| Tabla | Migración | Quién la escribe |");
  lineas.push("|---|---|---|");
  for (const t of huerfanas) {
    const suyas = [...funciones.entries()]
      .filter(([, f]) => f.tablas.includes(t))
      .map(([n]) => `\`${n}\``);
    lineas.push(
      `| \`${t}\` | \`${tablas.get(t)}\` | ${suyas.length > 0 ? suyas.join(", ") : "**nadie que este mapa vea**"} |`,
    );
  }
  lineas.push("");
}

writeFileSync(join(raiz, "GRAFO.md"), lineas.join("\n") + "\n", "utf8");

console.log(
  `GRAFO.md escrito: ${areas.length} áreas, ${pantallas.length} pantallas, ${tablas.size} tablas, ` +
    `${crucesReales.length} cruces, ${islas.length} islas.`,
);
