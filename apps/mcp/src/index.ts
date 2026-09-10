#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ClienteDevUP } from "./api.js";
import { cargarConfiguracion, rutaDeConfiguracion } from "./configuracion.js";
import { registrarHerramientas } from "./registro.js";

/**
 * Servidor MCP de DevUP, por stdio.
 *
 * Claude arranca este proceso y le habla por la entrada y la salida estándar.
 * Consecuencia que hay que tener presente al tocar este archivo: **nada se
 * imprime por stdout salvo el protocolo**. Un `console.log` de depuración
 * rompe la conexión sin decir por qué. Todo lo que haya que contar va por
 * `console.error`.
 *
 * Por stdio, cada persona conecta su propio Claude con su propia sesión y
 * este proceso corre en su máquina con sus credenciales. El transporte
 * remoto —para quien no quiera instalar nada— vive en
 * `apps/api/src/routes/mcp.ts` y sirve ESTAS MISMAS herramientas: la lista
 * está en `registro.ts`, no aquí.
 *
 * El aislamiento entre organizaciones lo sigue poniendo RLS en la base, igual
 * que para el navegador. El plan completo, en docs/HEARTH-Y-LA-PUERTA-MCP.md.
 */

const servidor = new McpServer({ name: "devup", version: "0.1.0" });

let cliente: ClienteDevUP | null = null;

/** Se construye a la primera llamada y no al arrancar: si falta el token, el
 *  fallo tiene que llegar como respuesta a una herramienta —donde el modelo lo
 *  lee y lo cuenta— y no como una muerte al iniciar, que en stdio se ve como
 *  «el servidor no responde». */
registrarHerramientas(servidor, () => {
  cliente ??= new ClienteDevUP(cargarConfiguracion());
  return cliente;
});

const transporte = new StdioServerTransport();
await servidor.connect(transporte);

console.error(
  `[devup-mcp] listo. Configuración en ${rutaDeConfiguracion()} ` +
    "(DEVUP_API_URL y DEVUP_TOKEN la pisan).",
);
