#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ClienteDevUP, ErrorDeApi } from "./api.js";
import { buscar, descripcionBuscar, esquemaBuscar } from "./herramientas/buscar.js";
import {
  descripcionMisTareas,
  descripcionVerTablero,
  descripcionVerTarea,
  esquemaMisTareas,
  esquemaVerTablero,
  esquemaVerTarea,
  misTareas,
  verTablero,
  verTarea,
} from "./herramientas/tareas.js";
import {
  actualizarTarea,
  crearColumna,
  crearTarea,
  descripcionActualizarTarea,
  descripcionCrearColumna,
  descripcionCrearTarea,
  descripcionMoverTarea,
  esquemaActualizarTarea,
  esquemaCrearColumna,
  esquemaCrearTarea,
  esquemaMoverTarea,
  moverTarea,
} from "./herramientas/escribir.js";
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
function comoError(fallo: unknown) {
  const mensaje =
    fallo instanceof ErrorDeApi || fallo instanceof Error ? fallo.message : String(fallo);
  return { content: [{ type: "text" as const, text: `No pude: ${mensaje}` }] };
}

/** Envuelve una herramienta: construye el cliente a la primera llamada y
 *  convierte cualquier fallo en algo que el modelo pueda contar. */
function herramienta<E>(hacer: (cliente: ClienteDevUP, entrada: E) => Promise<Contenido[]>) {
  return async (entrada: E) => {
    try {
      return { content: await hacer(clienteDevUP(), entrada) };
    } catch (fallo) {
      return comoError(fallo);
    }
  };
}

type Contenido =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

servidor.tool(
  "buscar",
  descripcionBuscar,
  esquemaBuscar,
  herramienta(async (cliente, entrada) => [
    { type: "text" as const, text: await buscar(cliente, entrada) },
  ]),
);

servidor.tool(
  "mis_tareas",
  descripcionMisTareas,
  esquemaMisTareas,
  herramienta((cliente, entrada) => misTareas(cliente, entrada)),
);

servidor.tool(
  "ver_tablero",
  descripcionVerTablero,
  esquemaVerTablero,
  herramienta(async (cliente, entrada) => [
    { type: "text" as const, text: await verTablero(cliente, entrada) },
  ]),
);

servidor.tool(
  "ver_tarea",
  descripcionVerTarea,
  esquemaVerTarea,
  herramienta((cliente, entrada) => verTarea(cliente, entrada)),
);

// --- Las que escriben -------------------------------------------------------
//
// Escriben en el tablero de un equipo, asi que van marcadas: todo lo que crean
// lleva la etiqueta «agente», que es lo que permite verlo, filtrarlo y
// deshacerlo en bloque. El porque, en herramientas/escribir.ts.
//
// No hay ninguna de borrar, y es deliberado: equivocarse creando deja trabajo
// que revisar, equivocarse borrando deja trabajo perdido.

servidor.tool(
  "crear_tarea",
  descripcionCrearTarea,
  esquemaCrearTarea,
  herramienta(async (cliente, entrada) => [
    { type: "text" as const, text: await crearTarea(cliente, entrada) },
  ]),
);

servidor.tool(
  "crear_columna",
  descripcionCrearColumna,
  esquemaCrearColumna,
  herramienta(async (cliente, entrada) => [
    { type: "text" as const, text: await crearColumna(cliente, entrada) },
  ]),
);

servidor.tool(
  "mover_tarea",
  descripcionMoverTarea,
  esquemaMoverTarea,
  herramienta(async (cliente, entrada) => [
    { type: "text" as const, text: await moverTarea(cliente, entrada) },
  ]),
);

servidor.tool(
  "actualizar_tarea",
  descripcionActualizarTarea,
  esquemaActualizarTarea,
  herramienta(async (cliente, entrada) => [
    { type: "text" as const, text: await actualizarTarea(cliente, entrada) },
  ]),
);

const transporte = new StdioServerTransport();
await servidor.connect(transporte);

console.error(
  `[devup-mcp] listo. Configuración en ${rutaDeConfiguracion()} ` +
    "(DEVUP_API_URL y DEVUP_TOKEN la pisan).",
);
