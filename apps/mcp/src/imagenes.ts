import type { ClienteDevUP } from "./api.js";

/**
 * Bajar los adjuntos de una tarea y devolverlos como imágenes de verdad.
 *
 * POR QUÉ INCRUSTADAS Y NO COMO ENLACE. Los enlaces del almacén van firmados y
 * caducan, así que un enlace en la respuesta está muerto cuando alguien lo
 * pulsa media hora después. Y aunque no caducara, obligar a abrir el navegador
 * es exactamente el paso que esta herramienta existe para quitar: una
 * respuesta que dice «esta tarea tiene tres adjuntos» no ha contestado nada.
 *
 * MCP admite bloques de contenido de tipo imagen, así que el archivo se baja
 * aquí y se manda dentro de la respuesta.
 *
 * LOS TOPES NO SON OPCIONALES. Una captura de pantalla ronda el medio mega, y
 * en base64 crece un tercio más; un tablero con treinta tareas ilustradas
 * llenaría el contexto de la conversación de una sola llamada y dejaría al
 * modelo sin sitio para pensar. Así que hay tope por imagen y tope por
 * llamada, y lo que se queda fuera se dice en el texto en vez de callarlo.
 */

/** Por imagen. Por encima de esto se nombra y no se baja. */
const TOPE_POR_IMAGEN = 1_500_000;

/** Por llamada, sumando todas. */
export const TOPE_POR_LLAMADA = 6;

export type Bloque =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type Adjunto = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: string | number;
};

/**
 * Devuelve los bloques de las imágenes de una tarea, en orden, cada una
 * precedida por su nombre — que es lo que hace que se lean «una por una» y no
 * como un montón de imágenes sin decir de qué son.
 *
 * `cupo` es cuántas quedan por gastar en esta llamada; se devuelve lo que
 * queda para que quien recorra varias tareas no se pase del tope global.
 */
export async function imagenesDeTarea(
  cliente: ClienteDevUP,
  taskId: string,
  cupo: number,
): Promise<{ bloques: Bloque[]; cupo: number; omitidas: number }> {
  if (cupo <= 0) return { bloques: [], cupo, omitidas: 0 };

  const { files } = await cliente
    .get<{ files: Adjunto[] }>(`/tasks/${taskId}/files`)
    .catch(() => ({ files: [] as Adjunto[] }));

  const imagenes = files.filter((f) => f.mimeType.startsWith("image/"));
  const otros = files.filter((f) => !f.mimeType.startsWith("image/"));

  const bloques: Bloque[] = [];
  let restante = cupo;
  let omitidas = 0;

  for (const archivo of imagenes) {
    if (restante <= 0) {
      omitidas += 1;
      continue;
    }
    const tamano = Number(archivo.sizeBytes);
    if (Number.isFinite(tamano) && tamano > TOPE_POR_IMAGEN) {
      bloques.push({
        type: "text",
        text: `  · ${archivo.name} — ${Math.round(tamano / 1024)} kB, demasiado grande para enseñarla aquí.`,
      });
      continue;
    }

    const bytes = await bajar(cliente, archivo.id);
    if (!bytes) {
      bloques.push({ type: "text", text: `  · ${archivo.name} — no pude bajarla.` });
      continue;
    }

    bloques.push({ type: "text", text: `  · ${archivo.name}` });
    bloques.push({ type: "image", data: bytes, mimeType: archivo.mimeType });
    restante -= 1;
  }

  // Los que no son imágenes se nombran: saber que hay un PDF adjunto es parte
  // de la respuesta, aunque no se pueda pintar.
  for (const archivo of otros) {
    bloques.push({ type: "text", text: `  · ${archivo.name} (${archivo.mimeType})` });
  }

  return { bloques, cupo: restante, omitidas };
}

/**
 * Los bytes de un archivo, en base64.
 *
 * Dos saltos: la API firma la URL y el almacén sirve el contenido. La segunda
 * peticion va SIN la cabecera de sesión — la firma ya es la autorización, y
 * mandar el token a un tercero sería regalarlo.
 */
async function bajar(cliente: ClienteDevUP, fileId: string): Promise<string | null> {
  try {
    const { url } = await cliente.get<{ url: string }>(`/files/${fileId}/download-url`);
    const respuesta = await fetch(url);
    if (!respuesta.ok) return null;
    const buffer = await respuesta.arrayBuffer();
    if (buffer.byteLength > TOPE_POR_IMAGEN) return null;
    return Buffer.from(buffer).toString("base64");
  } catch {
    return null;
  }
}
