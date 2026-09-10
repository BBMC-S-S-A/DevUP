#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ClienteDevUP, ErrorDeApi } from "./api.js";
import { buscar, descripcionBuscar, esquemaBuscar } from "./herramientas/buscar.js";
import { cargarConfiguracion, rutaDeConfiguracion } from "./configuracion.js";

/**
 * Servidor MCP de DevUP.
 *
 * Expone el proyecto a un modelo por stdio: Claude arranca este proceso y le
 * habla por la entrada y la salida estándar. Consecuencia que hay que tener
 * presente al tocar este archivo: **nada se imprime por stdout salvo el
 * protocolo**. Un `console.log` de depuración rompe la conexión sin decir por
 * qué. Todo lo que haya que contar va por `console.error`.
 *
 * DevUP no compra inferencia: cada persona conecta su propio Claude con su
 * propia sesión, y este proceso corre en su máquina con sus credenciales. El
 * aislamiento entre organizaciones lo sigue poniendo RLS en la base, igual que
 * para el navegador.
 *
 * El plan y el porqué de cada decisión, en docs/HEARTH-Y-LA-PUERTA-MCP.md.
 */

const servidor = new McpServer({ name: "devup", version: "0.1.0" });

let cliente: ClienteDevUP | null = null;

/** Se construye a la primera llamada y no al arrancar: si falta el token, el
 *  fallo tiene que llegar como respuesta a una herramienta —donde el modelo lo
 *  lee y lo cuenta— y no como una muerte al iniciar, que en stdio se ve como
 *  «el servidor no responde». */
function clienteDevUP(): ClienteDevUP {
  cliente ??= new ClienteDevUP(cargarConfiguracion());
  return cliente;
}

/** Convierte cualquier fallo en una respuesta que el modelo pueda leer y
 *  explicar. Lanzar hacia el transporte deja al modelo con «error interno», que
 *  no le dice a la persona qué tiene que arreglar. */
function comoError(fallo: unknown): { content: [{ type: "text"; text: string }] } {
  const mensaje =
    fallo instanceof ErrorDeApi || fallo instanceof Error ? fallo.message : String(fallo);
  return { content: [{ type: "text" as const, text: `No pude: ${mensaje}` }] };
}

servidor.tool("buscar", descripcionBuscar, esquemaBuscar, async (entrada) => {
  try {
    return { content: [{ type: "text" as const, text: await buscar(clienteDevUP(), entrada) }] };
  } catch (fallo) {
    return comoError(fallo);
  }
});

const transporte = new StdioServerTransport();
await servidor.connect(transporte);

console.error(
  `[devup-mcp] listo. Configuración en ${rutaDeConfiguracion()} ` +
    "(DEVUP_API_URL y DEVUP_TOKEN la pisan).",
);
