import { z } from "zod";
import type { ClienteApi } from "../api.js";
import { resolverEspacio } from "../espacios.js";

/**
 * Subir archivos a la biblioteca de un espacio — de una, no uno por uno.
 *
 * QUÉ FALTABA. El MCP podía LEER adjuntos (`imagenes.ts`: las imágenes de una
 * tarea vuelven incrustadas, y un PDF adjunto se nombra) pero no podía subir
 * ninguno: no había ninguna herramienta de escritura para archivos, solo para
 * tareas, columnas, áreas y ramas. Un agente que tuviera media docena de PDFs
 * que dejar en el proyecto —contratos, informes, lo que fuera— no tenía cómo.
 *
 * DE UNA, PORQUE ESO ES LO QUE SE PIDIÓ. Se acepta una LISTA de archivos y se
 * suben todos en la misma llamada, cada uno con su propio resultado: uno que
 * falla —pesa demasiado, el nombre viene vacío— no tira a los demás. Es el
 * mismo criterio que ya se usó en ARQ-04 para la salud de varios entornos: un
 * fallo por elemento, no un fallo por lote.
 *
 * MISMOS TRES PASOS QUE USA LA WEB (`lib/files/upload.ts`): reservar, subir
 * los bytes al almacén, confirmar. Los bytes van por una URL FIRMADA que la
 * API entrega en el paso 1 — se suben con un `fetch` normal, sin el token del
 * agente, porque la firma ya es la autorización de ESE archivo y nada más. El
 * cliente del MCP (`ClienteApi`) no necesita saber hacer subidas: solo hace
 * falta para reservar y para confirmar, que sí son peticiones de la API.
 *
 * POR QUÉ BASE64 Y NO UNA RUTA DE ARCHIVO. Este servidor atiende dos
 * transportes —stdio, en la máquina de quien lo usa, y remoto, dentro de la
 * API— y solo el primero tiene un disco al que mirar. Pedir una ruta
 * funcionaría en uno y no en el otro. El contenido en la propia llamada
 * funciona en los dos, a cambio de un límite de tamaño más corto que el que
 * admite la API: una llamada de herramienta no es donde poner cien megas.
 *
 * NO HAY «BORRAR» AQUÍ, Y ES A PROPÓSITO — mismo criterio que el resto de
 * `escribir.ts`: un agente que se equivoca subiendo dos veces deja algo que
 * revisar; uno que pudiera borrar dejaría algo perdido. Borrar sigue siendo de
 * personas, desde la propia pantalla de la biblioteca.
 */

/** Los bytes decodificados no pueden pasar de esto. Ver la cabecera. */
const LIMITE_POR_ARCHIVO = 15 * 1024 * 1024;
const MAX_ARCHIVOS = 20;

type Carpeta = { id: string; nombre: string; padreId: string | null };

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const unidades = ["B", "kB", "MB", "GB"];
  const exponente = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), unidades.length - 1);
  const escalado = bytes / 1024 ** exponente;
  return `${escalado.toFixed(exponente === 0 ? 0 : 1)} ${unidades[exponente]}`;
}

/** El camino de una carpeta, para desempatar cuando dos se llaman igual. */
function caminoDe(carpetas: Carpeta[], id: string): string {
  const trozos: string[] = [];
  let actual: string | null = id;
  for (let i = 0; actual && i < 20; i += 1) {
    const carpeta = carpetas.find((c) => c.id === actual);
    if (!carpeta) break;
    trozos.unshift(carpeta.nombre);
    actual = carpeta.padreId;
  }
  return trozos.join(" / ");
}

/**
 * Por nombre, en cualquier nivel del árbol. Sin ambigüedad no pregunta nada;
 * con ella, contesta con el camino de cada candidata para poder decir cuál.
 */
async function resolverCarpeta(
  cliente: ClienteApi,
  espacioId: string,
  nombre: string,
): Promise<{ id: string } | { error: string }> {
  const { carpetas } = await cliente.get<{ carpetas: Carpeta[] }>(
    `/workspaces/${espacioId}/carpetas`,
  );
  const buscado = nombre.trim().toLowerCase();

  const exactas = carpetas.filter((c) => c.nombre.toLowerCase() === buscado);
  const candidatas = exactas.length > 0 ? exactas : carpetas.filter((c) => c.nombre.toLowerCase().includes(buscado));

  if (candidatas.length === 0) {
    return {
      error:
        `No encontré ninguna carpeta que sea «${nombre}» en este espacio. ` +
        (carpetas.length > 0
          ? `Las que hay: ${carpetas.map((c) => caminoDe(carpetas, c.id)).join(", ")}.`
          : "Este espacio todavía no tiene carpetas."),
    };
  }
  if (candidatas.length > 1) {
    return {
      error:
        `«${nombre}» encaja con ${candidatas.length} carpetas. Dime cuál, con su camino:\n` +
        candidatas.map((c) => `- ${caminoDe(carpetas, c.id)}`).join("\n"),
    };
  }
  return { id: candidatas[0]!.id };
}

export const esquemaSubirArchivos = {
  archivos: z
    .array(
      z.object({
        nombre: z.string().trim().min(1).max(255).describe("El nombre con el que se guarda, con su extensión."),
        contenidoBase64: z
          .string()
          .min(1)
          .describe("El archivo entero, codificado en base64 — sin el prefijo `data:...;base64,`."),
        mimeType: z
          .string()
          .trim()
          .max(255)
          .optional()
          .describe('Por ejemplo "application/pdf". Si se omite, se guarda como binario genérico.'),
        descripcion: z.string().trim().max(2000).optional(),
      }),
    )
    .min(1)
    .max(MAX_ARCHIVOS)
    .describe(`De uno a ${MAX_ARCHIVOS} archivos, todos en la misma llamada.`),
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  carpeta: z
    .string()
    .optional()
    .describe("En qué carpeta de la biblioteca. Omitir para dejarlos en la raíz. Tiene que existir ya."),
  organizacion: z.string().optional(),
};

export const descripcionSubirArchivos = [
  "Sube uno o varios archivos a la biblioteca de un espacio, TODOS EN LA MISMA",
  "LLAMADA — para eso existe: antes solo se podían leer los adjuntos que ya",
  "hubiera, nunca dejar uno nuevo.",
  "",
  "Cada archivo va con su contenido en base64 dentro de la propia llamada, no",
  "con una ruta de disco: este servidor puede atender un cliente remoto sin",
  "ningún archivo al que mirar, así que la ruta no serviría siempre. Por lo",
  "mismo hay un límite por archivo bastante más corto que el de la propia",
  `aplicación (${formatBytes(LIMITE_POR_ARCHIVO)}): una llamada de herramienta no`,
  "es el sitio para cien megas de PDF.",
  "",
  "Uno que falle —pesa de más, el nombre viene vacío— no tira a los demás: se",
  "sube lo que se pueda y se dice, archivo por archivo, qué pasó con cada uno.",
  "",
  "La carpeta tiene que existir ya — se crea desde la propia pantalla de la",
  "biblioteca, con «Nueva carpeta». Omitirla los deja en la raíz.",
  "",
  "No hay forma de borrar desde aquí, a propósito: esto solo añade. Borrar",
  "sigue siendo de personas, desde la biblioteca.",
].join("\n");

type EntradaSubirArchivos = {
  archivos: {
    nombre: string;
    contenidoBase64: string;
    mimeType?: string;
    descripcion?: string;
  }[];
  espacio?: string;
  carpeta?: string;
  organizacion?: string;
};

export async function subirArchivos(
  cliente: ClienteApi,
  entrada: EntradaSubirArchivos,
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);

  let folderId: string | null = null;
  if (entrada.carpeta) {
    const resuelta = await resolverCarpeta(cliente, espacio.id, entrada.carpeta);
    if ("error" in resuelta) return resuelta.error;
    folderId = resuelta.id;
  }

  const listas: string[] = [];
  const fallidas: string[] = [];

  for (const archivo of entrada.archivos) {
    try {
      // `Buffer.from` con base64 no revienta con texto que no lo sea: se queda
      // corto en silencio. `sizeBytes` sale de los bytes DECODIFICADOS y no de
      // `contenidoBase64.length` por lo mismo — es lo que de verdad se sube, y
      // es lo que la API compara al confirmar.
      const bytes = Buffer.from(archivo.contenidoBase64, "base64");
      if (bytes.length === 0) {
        fallidas.push(`${archivo.nombre}: el contenido no parece base64 válido, o está vacío`);
        continue;
      }
      if (bytes.length > LIMITE_POR_ARCHIVO) {
        fallidas.push(
          `${archivo.nombre}: pesa ${formatBytes(bytes.length)}, más del límite de ` +
            `${formatBytes(LIMITE_POR_ARCHIVO)} por llamada`,
        );
        continue;
      }

      const reservado = await cliente.post<{ fileId: string; uploadUrl: string }>(
        `/workspaces/${espacio.id}/files`,
        {
          name: archivo.nombre,
          mimeType: archivo.mimeType ?? "application/octet-stream",
          sizeBytes: bytes.length,
          folderId,
          description: archivo.descripcion ?? "",
        },
      );

      // Sin el token del agente: la URL ya viene firmada para ESTE archivo, y
      // es exactamente lo mismo que hace el navegador al subir desde la web.
      const subida = await fetch(reservado.uploadUrl, {
        method: "PUT",
        headers: { "content-type": archivo.mimeType ?? "application/octet-stream" },
        body: bytes,
      });
      if (!subida.ok) {
        fallidas.push(`${archivo.nombre}: el almacén rechazó la subida (${subida.status})`);
        continue;
      }

      await cliente.post(`/files/${reservado.fileId}/confirm`, { tagIds: [] });
      listas.push(`${archivo.nombre} (${formatBytes(bytes.length)})`);
    } catch (fallo) {
      fallidas.push(`${archivo.nombre}: ${fallo instanceof Error ? fallo.message : String(fallo)}`);
    }
  }

  const donde = entrada.carpeta ? `en la carpeta «${entrada.carpeta}» de ${espacio.name}` : `en ${espacio.name}`;
  const trozos: string[] = [];
  if (listas.length > 0) trozos.push(`Subidos ${donde}: ${listas.join(", ")}.`);
  if (fallidas.length > 0) trozos.push(`Fallaron:\n${fallidas.map((f) => `- ${f}`).join("\n")}`);
  return trozos.join("\n\n") || "No había ningún archivo que subir.";
}
