/**
 * Pruebas de la puerta MCP.
 *
 * QUÉ SE PRUEBA Y QUÉ NO. Que la búsqueda encuentre cosas es cosa de
 * `global_search` y de las políticas RLS, y eso ya lo cubre
 * `isolation.test.ts` contra una base de verdad. Aquí se prueba lo que es
 * propio de esta capa y donde se rompe de verdad:
 *
 *   1. Sacar el token de refresco rotado de `set-cookie`. Si esto falla, la
 *      conexión de agente se muere a los quince minutos y el síntoma —«ya no
 *      vale, crea otra»— no señala a la causa.
 *   2. Resolver la organización sin pedirle un uuid al modelo, incluida la
 *      ambigüedad, que es cuando la herramienta tiene que explicar y no elegir.
 *   3. Dar formato a los resultados, porque es lo que el modelo lee.
 *
 *   npm run test:mcp
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenDeRefrescoDe } from "../api.js";
import { resolverOrganizacion } from "../organizaciones.js";
import { cargarConfiguracion, guardarToken } from "../configuracion.js";
import { formatear, type Resultado } from "./buscar.js";

let total = 0;
let fallos = 0;

function check(nombre: string, condicion: boolean): void {
  total += 1;
  if (condicion) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
  }
}

async function espera(nombre: string, fn: () => Promise<unknown>, trozo: string): Promise<void> {
  total += 1;
  try {
    await fn();
    fallos += 1;
    console.log(`  ✗ ${nombre} (no falló y tenía que fallar)`);
  } catch (fallo) {
    const mensaje = fallo instanceof Error ? fallo.message : String(fallo);
    if (mensaje.includes(trozo)) {
      console.log(`  ✓ ${nombre}`);
    } else {
      fallos += 1;
      console.log(`  ✗ ${nombre} (falló con «${mensaje}», esperaba «${trozo}»)`);
    }
  }
}

/** Un cliente de mentira: devuelve lo que se le diga sin salir a la red. */
function clienteFalso(organizations: unknown[]) {
  return {
    apiUrl: "http://localhost:4000",
    get: async () => ({ organizations }),
  } as unknown as Parameters<typeof resolverOrganizacion>[0];
}

console.log("\nEl token rotado que viene en set-cookie");
check(
  "lo saca de una cabecera con atributos",
  tokenDeRefrescoDe([
    "devup_refresh=abc123; Path=/auth; HttpOnly; Secure; SameSite=None; Max-Age=2592000",
  ]) === "abc123",
);
check(
  "lo distingue del de acceso, que va en otra cabecera",
  tokenDeRefrescoDe([
    "devup_access=noesteotro; Path=/; HttpOnly",
    "devup_refresh=elbueno; Path=/auth; HttpOnly",
  ]) === "elbueno",
);
check(
  "descodifica lo que venga con porcentajes",
  tokenDeRefrescoDe(["devup_refresh=a%2Fb%2Bc; Path=/auth"]) === "a/b+c",
);
// Al cerrar sesión la API manda la cookie vacía. Guardar eso dejaría el
// archivo con una credencial en blanco y la conexión muerta sin explicación.
check("no confunde un borrado con un token", tokenDeRefrescoDe(["devup_refresh=; Path=/auth"]) === null);
check("sin cabeceras devuelve nulo", tokenDeRefrescoDe([]) === null);

console.log("\nQuién gana entre el archivo y DEVUP_TOKEN");
// La prueba que faltaba, y que habria ahorrado el rato de descubrirlo a mano:
// como el token rota, el vivo es el del archivo. Si la variable ganara
// siempre, cada arranque presentaria el token con el que se sembro la
// conexion —ya consumido— y moriria tras el primer uso.
const carpeta = mkdtempSync(join(tmpdir(), "devup-mcp-"));
process.env.DEVUP_CONFIG = join(carpeta, "mcp.json");
process.env.DEVUP_API_URL = "http://localhost:4000";

process.env.DEVUP_TOKEN = "semilla-1";
const sembrada = cargarConfiguracion();
check("sin archivo, DEVUP_TOKEN siembra", sembrada.refreshToken === "semilla-1");
check(
  "y queda guardado para el siguiente arranque",
  (JSON.parse(readFileSync(process.env.DEVUP_CONFIG, "utf8")) as { refreshToken: string })
    .refreshToken === "semilla-1",
);

// Lo que hace el cliente al renovar: guarda el rotado y conserva la semilla.
guardarToken({ ...sembrada, refreshToken: "rotado-1" });
check(
  "con la MISMA semilla, gana el rotado del archivo",
  cargarConfiguracion().refreshToken === "rotado-1",
);

process.env.DEVUP_TOKEN = "semilla-2";
check(
  "con una semilla NUEVA, se adopta (conexion nueva a proposito)",
  cargarConfiguracion().refreshToken === "semilla-2",
);

delete process.env.DEVUP_TOKEN;
check("sin variable, se usa lo guardado", cargarConfiguracion().refreshToken === "semilla-2");

writeFileSync(process.env.DEVUP_CONFIG, "{}");
await espera(
  "sin token en ningun sitio, explica de donde saca uno",
  async () => cargarConfiguracion(),
  "Ajustes -> Conexiones de agente",
);

console.log("\nResolver la organización sin pedir uuid");
const una = [{ id: "11111111-1111-1111-1111-111111111111", name: "Hytrex", slug: "hytrex" }];
const dos = [
  ...una,
  { id: "22222222-2222-2222-2222-222222222222", name: "Clínica Santa Ana", slug: "santa-ana" },
];

check(
  "con una sola, no hace falta decir cuál",
  (await resolverOrganizacion(clienteFalso(una))).name === "Hytrex",
);
check(
  "encuentra por nombre exacto",
  (await resolverOrganizacion(clienteFalso(dos), "Hytrex")).slug === "hytrex",
);
check(
  "encuentra por slug",
  (await resolverOrganizacion(clienteFalso(dos), "santa-ana")).name === "Clínica Santa Ana",
);
check(
  "encuentra por un trozo del nombre",
  (await resolverOrganizacion(clienteFalso(dos), "santa")).slug === "santa-ana",
);
await espera(
  "con varias y sin decir cuál, dice cuáles hay",
  () => resolverOrganizacion(clienteFalso(dos)),
  "Clínica Santa Ana",
);
await espera(
  "si el nombre no existe, dice cuáles hay",
  () => resolverOrganizacion(clienteFalso(dos), "Acme"),
  "No hay ninguna organización",
);
await espera(
  "sin ninguna organización, lo dice",
  () => resolverOrganizacion(clienteFalso([])),
  "no pertenece a ninguna organización",
);

console.log("\nEl formato que lee el modelo");
const resultados: Resultado[] = [
  {
    entity: "task",
    id: "aaaa1111-0000-0000-0000-000000000000",
    title: "Cobrar la factura de agosto",
    snippet: "quedó   pendiente\ndesde el   día 3",
    workspaceId: "bbbb2222-0000-0000-0000-000000000000",
    channelId: null,
    createdAt: "2026-09-01T10:00:00Z",
  },
  {
    entity: "client",
    id: "cccc3333-0000-0000-0000-000000000000",
    title: "Clínica Santa Ana",
    snippet: null,
    workspaceId: null,
    channelId: null,
    createdAt: "2026-08-01T10:00:00Z",
  },
];
const texto = formatear(resultados, "santa ana", "Hytrex");

check("dice cuántos hay y dónde buscó", texto.startsWith("2 resultado(s) para «santa ana» en Hytrex."));
check("agrupa por tipo con el nombre en español", texto.includes("TAREA (1)") && texto.includes("CLIENTE (1)"));
check("lleva el identificador para poder encadenar", texto.includes("[task aaaa1111-0000-0000-0000-000000000000"));
check("aplasta los espacios del fragmento", texto.includes("quedó pendiente desde el día 3"));
check("sin resultados no inventa una lista vacía", formatear([], "nada", "Hytrex").startsWith("Sin resultados"));

console.log(`\n${total - fallos} comprobaciones correctas, ${fallos} fallidas`);
if (fallos > 0) process.exit(1);
