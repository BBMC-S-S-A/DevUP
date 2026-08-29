import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARCHIVOS_DE_INTERES, diagnosticar } from "./integraciones.js";

/**
 * Pruebas del diagnóstico de integraciones guiadas.
 *
 * LO QUE MÁS IMPORTA COMPROBAR NO ES QUE ACIERTE, ES QUE SE CALLE. Una
 * recomendación equivocada gasta la confianza de todas las siguientes, y esta
 * pantalla vale lo que valga su primera recomendación. Por eso hay tantos casos
 * de «esto NO debe salir» como de «esto sí».
 *
 * Y al final, el banco de pruebas honesto: este mismo repositorio. Lo que salga
 * ahí tiene que ser verdad, y si sale algo falso es un fallo del diagnóstico.
 *
 *   npm run test:integraciones
 */

let fallos = 0;
let total = 0;

function check(nombre: string, condicion: boolean, detalle?: string): void {
  total++;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos++;
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

const ids = (rutas: string[], archivos: Record<string, string> = {}) =>
  diagnosticar({ rutas, archivos: new Map(Object.entries(archivos)) }).map((r) => r.id);

const paquete = (deps: string[]) =>
  JSON.stringify({ dependencies: Object.fromEntries(deps.map((d) => [d, "^1.0.0"])) });

console.log("\nLo que sí debe detectar");

check(
  "un .env de verdad en el repositorio",
  ids([".env", "src/index.ts"]).includes("env-en-el-repo"),
);
check(
  "también un .env.production",
  ids([".env.production", "src/index.ts"]).includes("env-en-el-repo"),
);
check(
  "autenticación a mano por sus dependencias",
  ids(["package.json"], { "package.json": paquete(["bcrypt", "jsonwebtoken"]) }).includes(
    "auth-a-mano",
  ),
);
check(
  "archivos en el disco del servidor",
  ids(["package.json"], { "package.json": paquete(["express", "multer"]) }).includes(
    "archivos-en-disco",
  ),
);
check(
  "base de datos sin migraciones",
  ids(["package.json", "src/db.ts"], { "package.json": paquete(["pg"]) }).includes("sin-migraciones"),
);
check("sin integración continua", ids(["src/index.ts"]).includes("sin-ci"));
check(
  "tareas periódicas dentro del proceso web",
  ids(["package.json", "src/app.ts"], {
    "package.json": paquete(["fastify"]),
    "src/app.ts": "const t = setInterval(limpiar, 60000);",
  }).includes("cron-en-el-proceso"),
);

console.log("\nLo que NO debe decir, que importa más");

check(
  "un .env.example NO es un .env",
  !ids([".env.example", ".github/workflows/ci.yml"]).includes("env-en-el-repo"),
);
check(
  "con migraciones no se recomienda ponerlas",
  !ids(["package.json", "db/migrations/0001_a.sql"], { "package.json": paquete(["pg"]) }).includes(
    "sin-migraciones",
  ),
);
check(
  "sin base de datos no se echa de menos una migración",
  !ids(["package.json", "src/index.ts"], { "package.json": paquete(["express"]) }).includes(
    "sin-migraciones",
  ),
);
check(
  "con integración continua no se recomienda tenerla",
  !ids([".github/workflows/ci.yml"]).includes("sin-ci"),
);
check(
  "un setInterval en algo que no atiende peticiones no se señala",
  !ids(["package.json", "scripts/tarea.ts"], {
    "package.json": paquete(["typescript"]),
    "scripts/tarea.ts": "setInterval(hacer, 1000);",
  }).includes("cron-en-el-proceso"),
);
check(
  "un repositorio vacío no genera nada",
  ids([]).length === 0,
  "un árbol vacío es «no pude leer», no «no tienes nada»",
);

console.log("\nToda recomendación llega con su prueba");

const todas = diagnosticar({
  rutas: [".env", "package.json", "src/app.ts"],
  archivos: new Map([
    ["package.json", paquete(["fastify", "bcrypt", "multer", "pg"])],
    ["src/app.ts", "setInterval(limpiar, 1000);"],
  ]),
});
check(
  `las ${todas.length} recomendaciones nombran un archivo`,
  todas.every((r) => r.pruebas.length > 0 && r.pruebas.every((p) => p.archivo.length > 0)),
);
check(
  "y ninguna repite identificador",
  new Set(todas.map((r) => r.id)).size === todas.length,
);

console.log("\nEste mismo repositorio");

const raiz = join(process.cwd(), "..", "..");
const rutas = execFileSync("git", ["ls-files"], { cwd: raiz, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const archivos = new Map<string, string>();
for (const nombre of ARCHIVOS_DE_INTERES) {
  if (!rutas.includes(nombre)) continue;
  archivos.set(nombre, readFileSync(join(raiz, nombre), "utf8"));
}
// Y los de los subproyectos, que es donde viven las dependencias de verdad en
// un monorepo. Es lo mismo que hace la ruta HTTP con un repositorio ajeno.
for (const ruta of rutas.filter((r) => r.endsWith("package.json") && r !== "package.json").slice(0, 6)) {
  archivos.set(ruta, readFileSync(join(raiz, ruta), "utf8"));
}
// El diagnóstico también mira código: se le dan los mismos archivos que le
// daría la ruta HTTP para un repositorio ajeno.
for (const ruta of rutas.filter((r) => r.startsWith("apps/api/src/realtime/")).slice(0, 6)) {
  archivos.set(ruta, readFileSync(join(raiz, ruta), "utf8"));
}

const propio = diagnosticar({ rutas, archivos });
console.log(`  · dice: ${propio.length === 0 ? "nada" : propio.map((r) => r.id).join(", ")}`);

check("no encuentra un .env commiteado, porque no lo hay", !propio.some((r) => r.id === "env-en-el-repo"));
check("no echa de menos migraciones, porque las hay", !propio.some((r) => r.id === "sin-migraciones"));
check("no echa de menos integración continua, porque la hay", !propio.some((r) => r.id === "sin-ci"));
check(
  "no dice que subamos archivos al disco, porque van a un almacén S3",
  !propio.some((r) => r.id === "archivos-en-disco"),
);

// Esta sí es verdad y conviene que salga: el reparto del mundo corre con
// setInterval dentro del proceso de la API. Con dos instancias, dos relojes.
check(
  "sí señala el setInterval del reparto del mundo, que es cierto",
  propio.some((r) => r.id === "cron-en-el-proceso"),
);

console.log(`\n${total - fallos} comprobaciones correctas, ${fallos} fallidas`);
process.exit(fallos === 0 ? 0 : 1);
