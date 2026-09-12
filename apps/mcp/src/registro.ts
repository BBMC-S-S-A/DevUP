import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorDeApi, type ClienteApi } from "./api.js";
import {
  descripcionDibujarArquitectura,
  descripcionVerArquitectura,
  dibujarArquitectura,
  esquemaDibujarArquitectura,
  esquemaVerArquitectura,
  verArquitectura,
} from "./herramientas/arquitectura.js";
import { buscar, descripcionBuscar, esquemaBuscar } from "./herramientas/buscar.js";
import {
  descripcionQueHaPasado,
  esquemaQueHaPasado,
  queHaPasado,
} from "./herramientas/historia.js";
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
  crearArea,
  crearColumna,
  crearTarea,
  descripcionActualizarTarea,
  descripcionCrearArea,
  descripcionCrearColumna,
  descripcionCrearTarea,
  descripcionEnlazarRama,
  descripcionMarcarHecha,
  descripcionMoverTarea,
  enlazarRama,
  esquemaActualizarTarea,
  esquemaCrearArea,
  esquemaCrearColumna,
  esquemaCrearTarea,
  esquemaEnlazarRama,
  esquemaMarcarHecha,
  esquemaMoverTarea,
  marcarHecha,
  moverTarea,
} from "./herramientas/escribir.js";

/**
 * Qué herramientas expone la puerta MCP, en un solo sitio.
 *
 * POR QUÉ ESTO NO VIVE EN `index.ts`. Hay dos transportes —stdio (este
 * paquete) y HTTP remoto (`apps/api/src/routes/mcp.ts`)— y el documento ya lo
 * anticipaba: "cuando exista el remoto, el mismo conjunto de herramientas se
 * sirve por los dos". Si la lista se escribiera dos veces, la segunda copia
 * empezaría a divergir por el sitio que más importa: las descripciones, que
 * son la documentación que el modelo lee para decidir si usa una herramienta.
 *
 * `obtenerCliente` es una función y no un cliente ya hecho porque los dos
 * transportes lo consiguen de forma distinta: stdio lo construye a la primera
 * llamada (para que un token que falta salga como respuesta de herramienta y
 * no como una muerte al arrancar), y el remoto ya lo tiene resuelto por la
 * petición.
 */

type Contenido = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** Convierte cualquier fallo en una respuesta que el modelo pueda leer y
 *  explicar. Lanzar hacia el transporte deja al modelo con «error interno»,
 *  que no le dice a la persona qué tiene que arreglar. */
function comoError(fallo: unknown) {
  const mensaje =
    fallo instanceof ErrorDeApi || fallo instanceof Error ? fallo.message : String(fallo);
  return { content: [{ type: "text" as const, text: `No pude: ${mensaje}` }] };
}

export function registrarHerramientas(
  servidor: McpServer,
  obtenerCliente: () => ClienteApi,
): void {
  const herramienta = <E>(hacer: (cliente: ClienteApi, entrada: E) => Promise<Contenido[]>) =>
    async (entrada: E) => {
      try {
        return { content: await hacer(obtenerCliente(), entrada) };
      } catch (fallo) {
        return comoError(fallo);
      }
    };

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

  servidor.tool(
    "que_ha_pasado",
    descripcionQueHaPasado,
    esquemaQueHaPasado,
    herramienta(async (cliente, entrada) => [
      { type: "text" as const, text: await queHaPasado(cliente, entrada) },
    ]),
  );

  servidor.tool(
    "ver_arquitectura",
    descripcionVerArquitectura,
    esquemaVerArquitectura,
    herramienta(async (cliente, entrada) => [
      { type: "text" as const, text: await verArquitectura(cliente, entrada) },
    ]),
  );

  // --- Las que escriben -----------------------------------------------------
  //
  // Escriben en el tablero de un equipo, asi que van marcadas: todo lo que
  // crean lleva la etiqueta «agente», que es lo que permite verlo, filtrarlo y
  // deshacerlo en bloque. El porque, en herramientas/escribir.ts.
  //
  // No hay ninguna de borrar, y es deliberado: equivocarse creando deja
  // trabajo que revisar, equivocarse borrando deja trabajo perdido.

  servidor.tool(
    "crear_tarea",
    descripcionCrearTarea,
    esquemaCrearTarea,
    herramienta(async (cliente, entrada) => [
      { type: "text" as const, text: await crearTarea(cliente, entrada) },
    ]),
  );

  servidor.tool(
    "crear_area",
    descripcionCrearArea,
    esquemaCrearArea,
    herramienta(async (cliente, entrada) => [
      { type: "text" as const, text: await crearArea(cliente, entrada) },
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
    "enlazar_rama",
    descripcionEnlazarRama,
    esquemaEnlazarRama,
    herramienta(async (cliente, entrada) => [
      { type: "text" as const, text: await enlazarRama(cliente, entrada) },
    ]),
  );

  /**
   * Cerrar es la única escritura del agente que AFIRMA algo.
   *
   * Las demás proponen —crea una tarea, la mueve, la renombra— y una persona lo
   * ve en el tablero y lo corrige. Esta dice «esto ya está hecho», y si se
   * equivoca, el equipo deja de mirar algo que sigue roto. Por eso pide el
   * identificador y no el título, y por eso su descripción insiste en dejar la
   * prueba: una afirmación con su PR debajo se puede comprobar en diez
   * segundos; una sola, hay que creérsela.
   */
  servidor.tool(
    "marcar_hecha",
    descripcionMarcarHecha,
    esquemaMarcarHecha,
    herramienta(async (cliente, entrada) => [
      { type: "text" as const, text: await marcarHecha(cliente, entrada) },
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

  /**
   * Dibujar la arquitectura es la única escritura que no va al tablero.
   *
   * Es acumulativa y no borra nada, así que el peor caso de equivocarse es un
   * lienzo con cajas de más —que una persona quita de una en una— y no trabajo
   * perdido. Coloca las cajas ella: ver `herramientas/arquitectura.ts`.
   */
  servidor.tool(
    "dibujar_arquitectura",
    descripcionDibujarArquitectura,
    esquemaDibujarArquitectura,
    herramienta(async (cliente, entrada) => [
      { type: "text" as const, text: await dibujarArquitectura(cliente, entrada) },
    ]),
  );
}
