import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodObject, ZodRawShape, infer as Inferir } from "zod";
import { ErrorDeApi, type ClienteApi } from "./api.js";
import { FRASES_POR_HERRAMIENTA } from "./frases.js";
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
  crearEntorno,
  descripcionCrearEntorno,
  descripcionSincronizarEntornos,
  descripcionVerEntornos,
  esquemaCrearEntorno,
  esquemaSincronizarEntornos,
  esquemaVerEntornos,
  sincronizarEntornos,
  verEntornos,
} from "./herramientas/entornos.js";
import {
  descripcionEstoyHaciendo,
  esquemaEstoyHaciendo,
  estoyHaciendo,
} from "./herramientas/estado.js";
import { descripcionQueHaPasado, esquemaQueHaPasado, queHaPasado } from "./herramientas/pasado.js";
import { descripcionDiario, diarioDelProyecto, esquemaDiario } from "./herramientas/diario.js";
import { descripcionPuntos, esquemaPuntos, verPuntos } from "./herramientas/puntos.js";
import { comoDato } from "./dato.js";
import { contextoDeTarea, descripcionContexto, esquemaContexto } from "./herramientas/contexto.js";
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
  comentarTarea,
  crearArea,
  crearColumna,
  crearTarea,
  descripcionActualizarTarea,
  descripcionComentarTarea,
  descripcionCrearArea,
  descripcionCrearColumna,
  descripcionCrearTarea,
  descripcionEnlazarRama,
  descripcionMarcarHecha,
  descripcionMoverTarea,
  enlazarRama,
  esquemaActualizarTarea,
  esquemaComentarTarea,
  esquemaCrearArea,
  esquemaCrearColumna,
  esquemaCrearTarea,
  esquemaEnlazarRama,
  esquemaMarcarHecha,
  esquemaMoverTarea,
  marcarHecha,
  moverTarea,
} from "./herramientas/escribir.js";
import {
  borrarArchivo,
  descargarArchivo,
  descripcionBorrarArchivo,
  descripcionDescargarArchivo,
  descripcionSubirArchivos,
  esquemaBorrarArchivo,
  esquemaDescargarArchivo,
  esquemaSubirArchivos,
  subirArchivos,
  descripcionVerBiblioteca,
  esquemaVerBiblioteca,
  verBiblioteca,
} from "./herramientas/archivos.js";
import {
  descripcionEscribirEnCanal,
  descripcionLeerCanal,
  descripcionVerCanales,
  escribirEnCanal,
  esquemaEscribirEnCanal,
  esquemaLeerCanal,
  esquemaVerCanales,
  leerCanal,
  verCanales,
} from "./herramientas/canales.js";
import {
  crearReunion,
  descripcionCrearReunion,
  descripcionMisAvisos,
  descripcionPublicarAnuncio,
  descripcionVerAnuncios,
  descripcionVerReuniones,
  esquemaCrearReunion,
  esquemaMisAvisos,
  esquemaPublicarAnuncio,
  esquemaVerAnuncios,
  esquemaVerReuniones,
  misAvisos,
  publicarAnuncio,
  verAnuncios,
  verReuniones,
} from "./herramientas/agenda.js";
import {
  descripcionMiInicio,
  descripcionVerEmbudo,
  descripcionVerEquipo,
  descripcionVerOrganizacion,
  descripcionVerRamas,
  descripcionVerRepositorios,
  esquemaMiInicio,
  esquemaVerEmbudo,
  esquemaVerEquipo,
  esquemaVerOrganizacion,
  esquemaVerRamas,
  esquemaVerRepositorios,
  miInicio,
  verEmbudo,
  verEquipo,
  verOrganizacion,
  verRamas,
  verRepositorios,
} from "./herramientas/niveles.js";

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

type Contenido =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  /**
   * Un archivo que NO es imagen (un PDF, un zip, lo que sea), incrustado en la
   * propia respuesta. Es el bloque que define el propio protocolo MCP para
   * esto —no una imagen disfrazada— y por eso `descargar_archivo` lo usa: una
   * imagen se puede ENSEÑAR, pero un PDF no, y forzarlo en un bloque `image`
   * sería mentirle al cliente sobre qué está recibiendo.
   *
   * `uri` no apunta a nada real —no hay nada que resolver del otro lado— es
   * solo el identificador que exige el formato, y lleva el id del archivo para
   * que se pueda reconocer de dónde salió.
   */
  | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } };

/** Convierte cualquier fallo en una respuesta que el modelo pueda leer y
 *  explicar. Lanzar hacia el transporte deja al modelo con «error interno»,
 *  que no le dice a la persona qué tiene que arreglar. */
function comoError(fallo: unknown) {
  const mensaje =
    fallo instanceof ErrorDeApi || fallo instanceof Error ? fallo.message : String(fallo);
  return { content: [{ type: "text" as const, text: `No pude: ${mensaje}` }] };
}

/**
 * El latido que hace que el muñeco de DevVerse diga algo.
 *
 * SIN `await`, Y CON EL FALLO TRAGADO A PROPÓSITO. Esto es decoración: que no
 * se pueda pintar una frase no puede retrasar ni tumbar el trabajo de verdad.
 * Si la API no contesta, el muñeco dirá que está libre — que es exactamente
 * lo que hay que decir cuando no se sabe.
 *
 * Va aquí, en el envoltorio común, porque es el único sitio por el que pasan
 * todas las herramientas y los dos transportes. Ponerlo en cada herramienta
 * serían diez copias y la siguiente que alguien añada se olvidaría.
 */
function latir(cliente: ClienteApi, nombre: string): void {
  const frase = FRASES_POR_HERRAMIENTA[nombre];
  if (!frase) return;
  void cliente.post("/me/agente/latido", { origen: "herramienta", frase }).catch(() => {});
}

export function registrarHerramientas(servidor: McpServer, obtenerCliente: () => ClienteApi): void {
  /**
   * Registra una herramienta con su envoltorio.
   *
   * El nombre se escribe UNA vez: es también la clave con la que se busca su
   * frase para DevVerse, y dos copias del mismo nombre es una copia que puede
   * descuadrar sin que nada se queje.
   */
  const registrar = <S extends ZodRawShape>(
    nombre: string,
    descripcion: string,
    esquema: S,
    hacer: (cliente: ClienteApi, entrada: Inferir<ZodObject<S>>) => Promise<Contenido[]>,
  ): void => {
    const envoltorio = async (entrada: Inferir<ZodObject<S>>) => {
      const cliente = obtenerCliente();
      try {
        latir(cliente, nombre);
        // Todo el texto que sale se marca como dato y no como orden: casi todo
        // lo escribió alguien, y el agente lo lee junto a las instrucciones de
        // su persona. Ver `dato.ts`. Las imágenes pasan tal cual.
        const contenido = await hacer(cliente, entrada);
        return {
          content: contenido.map((pieza) =>
            pieza.type === "text" ? { ...pieza, text: comoDato(pieza.text) } : pieza,
          ),
        };
      } catch (fallo) {
        return comoError(fallo);
      }
    };
    // El único `as` de todo esto, y va aquí a propósito. `servidor.tool` tiene
    // seis sobrecargas y ninguna deja atar `S` hasta el tipo de su callback,
    // así que TypeScript resuelve el parámetro como `ZodRawShape` a secas.
    // Puesto en este sitio, los once registros de abajo conservan la
    // inferencia entera: si un esquema y su función no encajan, salta ahí.
    servidor.tool(nombre, descripcion, esquema, envoltorio as never);
  };

  registrar("buscar", descripcionBuscar, esquemaBuscar, async (cliente, entrada) => [
    { type: "text" as const, text: await buscar(cliente, entrada) },
  ]);

  registrar("mis_tareas", descripcionMisTareas, esquemaMisTareas, (cliente, entrada) =>
    misTareas(cliente, entrada),
  );

  registrar("ver_tablero", descripcionVerTablero, esquemaVerTablero, async (cliente, entrada) => [
    { type: "text" as const, text: await verTablero(cliente, entrada) },
  ]);

  registrar("ver_tarea", descripcionVerTarea, esquemaVerTarea, (cliente, entrada) =>
    verTarea(cliente, entrada),
  );

  registrar(
    "ver_arquitectura",
    descripcionVerArquitectura,
    esquemaVerArquitectura,
    async (cliente, entrada) => [
      { type: "text" as const, text: await verArquitectura(cliente, entrada) },
    ],
  );

  /**
   * La única que no toca el proyecto: solo dice en qué anda el agente, para
   * que el muñeco de la sala «Agente IA» lo cuente. Ver `herramientas/estado.ts`.
   */
  registrar(
    "estoy_haciendo",
    descripcionEstoyHaciendo,
    esquemaEstoyHaciendo,
    async (cliente, entrada) => [
      { type: "text" as const, text: await estoyHaciendo(cliente, entrada) },
    ],
  );

  /**
   * La del contexto compartido: qué ha hecho el equipo desde un momento.
   * Va con las de leer porque no escribe nada — solo pregunta al registro
   * de actividad, que es de solo añadir. Ver `herramientas/pasado.ts`.
   */
  registrar(
    "que_ha_pasado",
    descripcionQueHaPasado,
    esquemaQueHaPasado,
    async (cliente, entrada) => [
      { type: "text" as const, text: await queHaPasado(cliente, entrada) },
    ],
  );

  /**
   * La vista de lejos. Va justo detrás de `que_ha_pasado` porque la pregunta
   * que las separa es fácil de confundir: una cuenta lo que pasó, la otra cómo
   * fue. Ver `herramientas/diario.ts`.
   */
  registrar("diario", descripcionDiario, esquemaDiario, async (cliente, entrada) => [
    { type: "text" as const, text: await diarioDelProyecto(cliente, entrada) },
  ]);

  /**
   * El marcador. Va detrás del diario porque contesta la otra mitad de «cómo
   * ha ido»: el diario dice qué pasó, esto dice quién participó y cuánto de
   * eso pasó por una sola persona. Ver `herramientas/puntos.ts`.
   */
  registrar("puntos", descripcionPuntos, esquemaPuntos, async (cliente, entrada) => [
    { type: "text" as const, text: await verPuntos(cliente, entrada) },
  ]);

  /**
   * La tesis del producto en una herramienta: por qué se hizo así. Va con las
   * de leer — no escribe nada. Ver `herramientas/contexto.ts`.
   */
  registrar("contexto_de_tarea", descripcionContexto, esquemaContexto, async (cliente, entrada) => [
    { type: "text" as const, text: await contextoDeTarea(cliente, entrada) },
  ]);

  registrar("ver_entornos", descripcionVerEntornos, esquemaVerEntornos, async (cliente, entrada) => [
    { type: "text" as const, text: await verEntornos(cliente, entrada) },
  ]);

  /**
   * Sincronizar va con las de leer aunque escriba.
   *
   * Lo que guarda es un reflejo de lo que dijo GitHub, no una decisión de
   * nadie: no crea nada que no existiera ni cambia lo que el equipo puso a
   * mano. Volver a preguntar dos veces deja el mismo resultado.
   */
  registrar(
    "sincronizar_entornos",
    descripcionSincronizarEntornos,
    esquemaSincronizarEntornos,
    async (cliente, entrada) => [
      { type: "text" as const, text: await sincronizarEntornos(cliente, entrada) },
    ],
  );

  // --- Los tres niveles: la persona, la organización, el espacio ------------
  //
  // Ver `herramientas/niveles.ts`. Hasta el 24-sep el MCP solo sabía mirar
  // dentro de un espacio, y la organización es un nivel con contenido propio.

  registrar("mi_inicio", descripcionMiInicio, esquemaMiInicio, async (cliente, entrada) => [
    { type: "text" as const, text: await miInicio(cliente, entrada) },
  ]);
  registrar("ver_organizacion", descripcionVerOrganizacion, esquemaVerOrganizacion, async (cliente, entrada) => [
    { type: "text" as const, text: await verOrganizacion(cliente, entrada) },
  ]);
  registrar("ver_equipo", descripcionVerEquipo, esquemaVerEquipo, async (cliente, entrada) => [
    { type: "text" as const, text: await verEquipo(cliente, entrada) },
  ]);
  registrar("ver_ramas", descripcionVerRamas, esquemaVerRamas, async (cliente, entrada) => [
    { type: "text" as const, text: await verRamas(cliente, entrada) },
  ]);
  registrar("ver_repositorios", descripcionVerRepositorios, esquemaVerRepositorios, async (cliente, entrada) => [
    { type: "text" as const, text: await verRepositorios(cliente, entrada) },
  ]);
  registrar("ver_embudo", descripcionVerEmbudo, esquemaVerEmbudo, async (cliente, entrada) => [
    { type: "text" as const, text: await verEmbudo(cliente, entrada) },
  ]);

  // --- Lo que se habla y lo que llega ---------------------------------------
  //
  // Leer no marca nada como leído: lo lee el agente, no la persona.

  registrar("ver_canales", descripcionVerCanales, esquemaVerCanales, async (cliente, entrada) => [
    { type: "text" as const, text: await verCanales(cliente, entrada) },
  ]);
  registrar("leer_canal", descripcionLeerCanal, esquemaLeerCanal, async (cliente, entrada) => [
    { type: "text" as const, text: await leerCanal(cliente, entrada) },
  ]);
  registrar("ver_reuniones", descripcionVerReuniones, esquemaVerReuniones, async (cliente, entrada) => [
    { type: "text" as const, text: await verReuniones(cliente, entrada) },
  ]);
  registrar("ver_anuncios", descripcionVerAnuncios, esquemaVerAnuncios, async (cliente, entrada) => [
    { type: "text" as const, text: await verAnuncios(cliente, entrada) },
  ]);
  registrar("mis_avisos", descripcionMisAvisos, esquemaMisAvisos, async (cliente, entrada) => [
    { type: "text" as const, text: await misAvisos(cliente, entrada) },
  ]);
  registrar("ver_biblioteca", descripcionVerBiblioteca, esquemaVerBiblioteca, async (cliente, entrada) => [
    { type: "text" as const, text: await verBiblioteca(cliente, entrada) },
  ]);

  // --- Las que escriben -----------------------------------------------------
  //
  // Escriben en el tablero de un equipo, asi que van marcadas: todo lo que
  // crean lleva la etiqueta «agente», que es lo que permite verlo, filtrarlo y
  // deshacerlo en bloque. El porque, en herramientas/escribir.ts.
  //
  // No hay ninguna de borrar, y es deliberado: equivocarse creando deja
  // trabajo que revisar, equivocarse borrando deja trabajo perdido.

  registrar("crear_tarea", descripcionCrearTarea, esquemaCrearTarea, async (cliente, entrada) => [
    { type: "text" as const, text: await crearTarea(cliente, entrada) },
  ]);

  registrar(
    "crear_columna",
    descripcionCrearColumna,
    esquemaCrearColumna,
    async (cliente, entrada) => [
      { type: "text" as const, text: await crearColumna(cliente, entrada) },
    ],
  );

  registrar("crear_area", descripcionCrearArea, esquemaCrearArea, async (cliente, entrada) => [
    { type: "text" as const, text: await crearArea(cliente, entrada) },
  ]);

  registrar(
    "enlazar_rama",
    descripcionEnlazarRama,
    esquemaEnlazarRama,
    async (cliente, entrada) => [
      { type: "text" as const, text: await enlazarRama(cliente, entrada) },
    ],
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
  registrar(
    "marcar_hecha",
    descripcionMarcarHecha,
    esquemaMarcarHecha,
    async (cliente, entrada) => [
      { type: "text" as const, text: await marcarHecha(cliente, entrada) },
    ],
  );

  registrar("mover_tarea", descripcionMoverTarea, esquemaMoverTarea, async (cliente, entrada) => [
    { type: "text" as const, text: await moverTarea(cliente, entrada) },
  ]);

  registrar(
    "actualizar_tarea",
    descripcionActualizarTarea,
    esquemaActualizarTarea,
    async (cliente, entrada) => [
      { type: "text" as const, text: await actualizarTarea(cliente, entrada) },
    ],
  );

  registrar(
    "comentar_tarea",
    descripcionComentarTarea,
    esquemaComentarTarea,
    async (cliente, entrada) => [
      { type: "text" as const, text: await comentarTarea(cliente, entrada) },
    ],
  );

  /**
   * Dibujar la arquitectura es la única escritura que no va al tablero.
   *
   * Es acumulativa y no borra nada, así que el peor caso de equivocarse es un
   * lienzo con cajas de más —que una persona quita de una en una— y no trabajo
   * perdido. Coloca las cajas ella: ver `herramientas/arquitectura.ts`.
   */
  registrar(
    "dibujar_arquitectura",
    descripcionDibujarArquitectura,
    esquemaDibujarArquitectura,
    async (cliente, entrada) => [
      { type: "text" as const, text: await dibujarArquitectura(cliente, entrada) },
    ],
  );

  /**
   * Crear un entorno no es pintar una caja: si lleva repositorio, se pone a
   * leer despliegues de GitHub de verdad y gasta cupo de su API. Por eso la
   * herramienta avisa cuando no va a poder leer nada —sin token no sincroniza
   * jamás, y callarlo deja a alguien esperando despliegues que no llegan— y
   * por eso no hay ninguna de borrar: un entorno se lleva consigo su historia.
   */
  registrar("crear_entorno", descripcionCrearEntorno, esquemaCrearEntorno, async (cliente, entrada) => [
    { type: "text" as const, text: await crearEntorno(cliente, entrada) },
  ]);

  /**
   * Subir es crear, no borrar, y por eso va con las que escriben: un archivo
   * de más se quita a mano desde la biblioteca, igual que una tarea de más se
   * quita desde el tablero. Ver `herramientas/archivos.ts`.
   */
  registrar(
    "subir_archivos",
    descripcionSubirArchivos,
    esquemaSubirArchivos,
    async (cliente, entrada) => [
      { type: "text" as const, text: await subirArchivos(cliente, entrada) },
    ],
  );

  /**
   * La única que borra en todo `registro.ts`, y por eso pide dos llamadas: la
   * primera solo describe, la segunda —con `confirmar: true` puesto a mano—
   * ejecuta. Ver la cabecera de `herramientas/archivos.ts` para el porqué de
   * la excepción.
   */
  registrar(
    "borrar_archivo",
    descripcionBorrarArchivo,
    esquemaBorrarArchivo,
    async (cliente, entrada) => [
      { type: "text" as const, text: await borrarArchivo(cliente, entrada) },
    ],
  );

  // --- Hablar y convocar ----------------------------------------------------
  //
  // Escriben COMO LA PERSONA: el mensaje, la reunión y el anuncio salen con su
  // nombre. Por eso sus descripciones piden que solo se escriba lo que ella
  // haya dictado. Publicar un anuncio avisa a toda la organización.

  registrar("escribir_en_canal", descripcionEscribirEnCanal, esquemaEscribirEnCanal, async (cliente, entrada) => [
    { type: "text" as const, text: await escribirEnCanal(cliente, entrada) },
  ]);
  registrar("crear_reunion", descripcionCrearReunion, esquemaCrearReunion, async (cliente, entrada) => [
    { type: "text" as const, text: await crearReunion(cliente, entrada) },
  ]);
  registrar("publicar_anuncio", descripcionPublicarAnuncio, esquemaPublicarAnuncio, async (cliente, entrada) => [
    { type: "text" as const, text: await publicarAnuncio(cliente, entrada) },
  ]);

  /**
   * Contraparte de `subir_archivos`: baja lo que ya está en la biblioteca. Ver
   * la cabecera de `herramientas/archivos.ts`.
   */
  registrar(
    "descargar_archivo",
    descripcionDescargarArchivo,
    esquemaDescargarArchivo,
    async (cliente, entrada) => {
      const resultado = await descargarArchivo(cliente, entrada);
      if (typeof resultado === "string") return [{ type: "text" as const, text: resultado }];
      return [
        { type: "text" as const, text: resultado.mensaje },
        resultado.contenido,
      ];
    },
  );
}
