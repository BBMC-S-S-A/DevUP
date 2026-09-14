import { API_URL } from "./api";

/**
 * Leer la respuesta del asistente según va llegando.
 *
 * POR QUÉ NO PASA POR `api.post`. Ese envoltorio espera el cuerpo entero y lo
 * convierte a JSON, que es justo lo que aquí no se puede hacer: la gracia es
 * empezar a contar cosas antes de que haya cuerpo. Así que esto usa `fetch`
 * directo, con las mismas credenciales.
 *
 * LO QUE SE PIERDE AL SALIRSE DEL ENVOLTORIO, y conviene tenerlo escrito: el
 * reintento automático tras un 401 con la sesión caducada. Aquí un 401 se
 * cuenta como error en vez de renovar y repetir. Es aceptable porque preguntar
 * es un gesto que la persona repite sin coste, y porque cualquier otra pantalla
 * abierta ya habrá renovado la sesión por su cuenta.
 *
 * EL FORMATO ES SSE, y se parte a mano en vez de con `EventSource` porque
 * `EventSource` solo sabe hacer GET: esto es un POST con la pregunta y el
 * historial en el cuerpo.
 */

export type Paso = { herramienta: string; entrada: unknown };
export type Adjunto = { fileId: string; nombre: string; tarea: string };

export type Suceso =
  | { tipo: "herramienta"; herramienta: string }
  | { tipo: "fin"; respuesta: string; pasos: Paso[]; adjuntos: Adjunto[] }
  | { tipo: "error"; mensaje: string };

/**
 * Qué decir mientras corre cada herramienta.
 *
 * Las frases son las MISMAS que dice el muñeco de la sala «Agente IA»
 * (`apps/mcp/src/frases.ts`). No es una coincidencia bonita: es el mismo agente
 * haciendo lo mismo, y que se llame igual en los dos sitios es lo que hace que
 * quien ve una cosa entienda la otra.
 *
 * Una herramienta sin frase no rompe nada: se cuenta con su nombre, que queda
 * más seco pero sigue siendo cierto.
 */
const FRASES: Record<string, string> = {
  mis_tareas: "revisando lo que tienes pendiente",
  ver_tablero: "mirando el tablero",
  ver_tarea: "leyendo una tarea",
  buscar: "buscando en el proyecto",
  ver_arquitectura: "mirando la arquitectura",
  crear_tarea: "anotando una tarea nueva",
  crear_columna: "añadiendo una columna al tablero",
  mover_tarea: "moviendo una tarjeta",
  actualizar_tarea: "actualizando una tarea",
  dibujar_arquitectura: "dibujando la arquitectura",
  que_ha_pasado: "mirando qué ha pasado por aquí",
  ver_entornos: "mirando dónde está desplegado",
};

export function fraseDe(herramienta: string): string {
  return FRASES[herramienta] ?? herramienta.replace(/_/g, " ");
}

/**
 * Parte lo acumulado en sucesos completos, y devuelve lo que sobra.
 *
 * VIVE APARTE PORQUE ES LO ÚNICO QUE PUEDE FALLAR AQUÍ, y falla de la peor
 * manera: un suceso puede partirse entre dos lecturas de la red, y tratar ese
 * trozo como si estuviera entero da un JSON roto. Eso NO pasa con respuestas
 * cortas — pasa cuando la respuesta crece, o sea justo con las que más
 * importan. Con el corte fuera de la función que habla con la red, se puede
 * probar sin red.
 *
 * Lo ilegible se descarta en silencio a propósito: un suceso roto no puede
 * tirar la conversación entera, porque el que de verdad importa —el `fin`—
 * puede venir detrás.
 */
export function partirSucesos(acumulado: string): { sucesos: Suceso[]; resto: string } {
  // Los sucesos van separados por una línea en blanco. El último trozo puede
  // estar a medias, así que se guarda para la vuelta siguiente.
  //
  // `\r?\n` Y NO `\n` A SECAS: el protocolo admite terminar las líneas con
  // CRLF, y hay intermediarios que reescriben los saltos. Partiendo solo por
  // `\n\n`, un flujo con `\r\n\r\n` no casa NUNCA: no sale ni un suceso, todo
  // se queda en el resto esperando un separador que ya pasó, y la pantalla se
  // queda pensando para siempre sin un error que lo explique. Cuesta un
  // carácter y quita un modo de fallo que no se puede diagnosticar desde
  // fuera.
  const partes = acumulado.split(/\r?\n\r?\n/);
  const resto = partes.pop() ?? "";
  const sucesos: Suceso[] = [];
  for (const parte of partes) {
    const linea = parte.split("\n").find((l) => l.startsWith("data: "));
    if (!linea) continue;
    try {
      sucesos.push(JSON.parse(linea.slice(6)) as Suceso);
    } catch {
      // Ilegible: se descarta y se sigue con el siguiente.
    }
  }
  return { sucesos, resto };
}

/**
 * Pregunta, y va llamando a `alSuceso` con lo que llega.
 *
 * No devuelve la respuesta: la entrega por el mismo camino que lo demás, en un
 * suceso `fin`. Tener dos salidas —una por retorno y otra por callback— haría
 * que el orden entre ellas dependiera del azar del bucle de eventos.
 */
export async function preguntarEnFlujo(
  workspaceId: string,
  pregunta: string,
  historial: { rol: "usuario" | "asistente"; texto: string }[],
  alSuceso: (suceso: Suceso) => void,
): Promise<void> {
  const respuesta = await fetch(`${API_URL}/workspaces/${workspaceId}/asistente`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pregunta, historial }),
  });

  // Un fallo antes de empezar el flujo llega como JSON normal, con su mensaje:
  // sin clave puesta, sin acceso al espacio, cuerpo inválido.
  if (!respuesta.ok || !respuesta.body) {
    const cuerpo = (await respuesta.json().catch(() => null)) as { message?: unknown } | null;
    alSuceso({
      tipo: "error",
      mensaje: typeof cuerpo?.message === "string" ? cuerpo.message : "no pude preguntarle",
    });
    return;
  }

  const lector = respuesta.body.getReader();
  const decodificador = new TextDecoder();
  let resto = "";

  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    // `stream: true` importa: un carácter de varios bytes puede partirse entre
    // dos lecturas, y sin esto saldría un rombo negro a mitad de palabra.
    const partido = partirSucesos(resto + decodificador.decode(value, { stream: true }));
    resto = partido.resto;
    for (const suceso of partido.sucesos) alSuceso(suceso);
  }
}
