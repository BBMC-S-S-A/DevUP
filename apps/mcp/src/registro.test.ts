/**
 * Prueba del registro de herramientas.
 *
 * QUE SE PRUEBA, Y POR QUE ESTA CAPA LO NECESITA. Desde que hay dos
 * transportes —stdio (`index.ts`) y HTTP remoto
 * (`apps/api/src/routes/mcp.ts`)— la lista de herramientas vive en un solo
 * sitio a proposito. Esto fija esa propiedad: que todas quedan registradas
 * y con los nombres que el modelo espera. Si alguien anade una herramienta y
 * la cablea solo en un transporte, o le cambia el nombre a una que ya usa
 * alguien, esto se pone rojo.
 *
 * Tambien comprueba que el servidor y un transporte se componen sin reventar,
 * que es la unica parte del camino remoto que se puede verificar sin levantar
 * la API entera.
 *
 *   npm run test:mcp
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ClienteApi } from "./api.js";
import { FRASES_POR_HERRAMIENTA, SIN_FRASE_PROPIA } from "./frases.js";
import { registrarHerramientas } from "./registro.js";

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

/** Ninguna herramienta llega a llamarlo: aqui solo se registran. */
const clienteFalso: ClienteApi = {
  apiUrl: "http://127.0.0.1:4000",
  get: async () => ({}) as never,
  post: async () => ({}) as never,
  patch: async () => ({}) as never,
};

/** Las que el conector de Claude ve, con el nombre exacto. Cambiar uno rompe
 *  las conversaciones que ya lo usan, asi que esta lista es un contrato. */
const ESPERADAS = [
  "buscar",
  "mis_tareas",
  "ver_tablero",
  "ver_tarea",
  "ver_arquitectura",
  "que_ha_pasado",
  "diario",
  "ver_entornos",
  "sincronizar_entornos",
  "crear_tarea",
  "crear_area",
  "crear_columna",
  "mover_tarea",
  "enlazar_rama",
  "marcar_hecha",
  "actualizar_tarea",
  "dibujar_arquitectura",
  "crear_entorno",
  "estoy_haciendo",
];

console.log("\nRegistro de herramientas");

const servidor = new McpServer({ name: "devup", version: "0.1.0" });
registrarHerramientas(servidor, () => clienteFalso);

const registradas = Object.keys(
  (servidor as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
);

check(`se registran las ${ESPERADAS.length}`, registradas.length === ESPERADAS.length);
for (const nombre of ESPERADAS) {
  check(`está «${nombre}»`, registradas.includes(nombre));
}

/**
 * Que ninguna herramienta se quede sin frase para DevVerse.
 *
 * POR QUE ES UNA PRUEBA Y NO UN COMENTARIO. El mapa de frases vive en
 * `frases.ts`, separado del registro, asi que anadir una herramienta y
 * olvidarse de su frase no rompe nada visible: el muñeco de la sala se calla
 * cuando el agente la usa, y nadie lo relaciona con el cambio de hace dos
 * semanas. Esto lo pone rojo el mismo dia.
 */
console.log("\nTodas tienen frase para el muñeco");

for (const nombre of registradas) {
  if (SIN_FRASE_PROPIA.has(nombre)) continue;
  check(`«${nombre}» tiene frase`, typeof FRASES_POR_HERRAMIENTA[nombre] === "string");
}

// Y al reves: una frase para una herramienta que ya no existe es un nombre
// viejo que alguien copiara creyendo que sigue vivo.
for (const nombre of Object.keys(FRASES_POR_HERRAMIENTA)) {
  check(`la frase «${nombre}» corresponde a una herramienta`, registradas.includes(nombre));
}

console.log("\nEl transporte remoto se compone");

const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
await servidor.connect(transporte);
check("servidor y transporte streamable se conectan", true);
await transporte.close();
await servidor.close();
check("y se cierran sin quejarse", true);

console.log(`\n${total} comprobaciones, ${fallos} fallidas`);
if (fallos > 0) process.exit(1);
