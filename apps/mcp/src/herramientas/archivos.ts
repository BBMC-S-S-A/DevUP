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
 * BORRAR SÍ EXISTE AQUÍ (`borrar_archivo`), Y ES LA ÚNICA EXCEPCIÓN A LA REGLA
 * DE `escribir.ts` DE «NADA DE BORRAR». Se pidió explícitamente, y el borrado
 * de un archivo (`DELETE /files/:id`) es DEFINITIVO — la fila y el objeto del
 * almacén desaparecen, sin papelera. Eso es justo lo que la regla general
 * evita: un agente que se equivoca creando deja algo que revisar; uno que se
 * equivoca borrando deja algo perdido.
 *
 * LA SALIDA ES UN SEGUNDO PASO, NO UNA CONFIRMACIÓN DE INTERFAZ. El MCP no
 * tiene diálogo modal como la web (`useConfirmar`): lo único que puede hacer
 * es negarse a ejecutar y explicar qué haría. Así que `borrar_archivo` sin
 * `confirmar: true` NO TOCA NADA — resuelve el archivo y describe qué se
 * borraría, con su identificador — y solo ejecuta cuando se le llama otra vez
 * con `confirmar: true` puesto A PROPÓSITO. Un modelo que alucine la
 * intención de borrar algo tendría que alucinar TAMBIÉN ese segundo paso
 * explícito, dos veces seguidas, para que algo desaparezca de verdad.
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

// ---------------------------------------------------------------------------
// borrar_archivo
// ---------------------------------------------------------------------------

/** Igual que el que usa `moverTarea` en escribir.ts: si parece un uuid, se
 *  busca por identificador; si no, por nombre. */
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ArchivoAPI = {
  id: string;
  workspaceId: string;
  name: string;
  sizeBytes: number | string;
  uploadedByName?: string;
};

/**
 * Encuentra el archivo del que se habla, dentro de ESTE espacio.
 *
 * POR IDENTIFICADOR SE PIDE Y SE COMPRUEBA EL ESPACIO IGUAL. `GET /files/:id`
 * lo autoriza RLS —cualquiera de la organización puede pedirlo— pero eso no
 * basta aquí: si alguien dice «borra el archivo tal en el espacio Marketing»,
 * un identificador que resulte ser de OTRO proyecto de la misma organización
 * no puede colarse solo porque RLS lo dejara leer. Se comprueba a mano.
 */
async function resolverArchivo(
  cliente: ClienteApi,
  espacioId: string,
  buscado: string,
): Promise<ArchivoAPI[]> {
  const limpio = buscado.trim();

  if (ES_UUID.test(limpio)) {
    try {
      const { file } = await cliente.get<{ file: ArchivoAPI }>(`/files/${limpio}`);
      return file.workspaceId === espacioId ? [file] : [];
    } catch {
      // No existe, o RLS no lo deja ver: para quien pregunta es lo mismo que
      // no encontrarlo, así que se sigue con una lista vacía y no con un error
      // que hable de RLS, que no significa nada para quien llama.
      return [];
    }
  }

  const { files } = await cliente.get<{ files: ArchivoAPI[] }>(
    `/workspaces/${espacioId}/files?q=${encodeURIComponent(limpio)}`,
  );
  // La búsqueda de la API ya es difusa (nombre Y descripción); si hay un
  // nombre exacto entre los resultados, es casi seguro al que se refería.
  const exactos = files.filter((f) => f.name.toLowerCase() === limpio.toLowerCase());
  return exactos.length > 0 ? exactos : files;
}

export const esquemaBorrarArchivo = {
  archivo: z
    .string()
    .trim()
    .min(1)
    .describe(
      "El nombre del archivo, o su identificador — el que enseña esta misma " +
        "herramienta al preguntar, o el que devolvió subir_archivos.",
    ),
  confirmar: z
    .boolean()
    .optional()
    .describe(
      "Por defecto NO se borra nada: se contesta qué archivo es y se pide llamar " +
        "otra vez con esto en true para ejecutarlo de verdad. Poner true a la primera " +
        "sin haber visto la respuesta anterior es saltarse la única red que hay.",
    ),
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional(),
};

export const descripcionBorrarArchivo = [
  "Borra un archivo de la biblioteca de un espacio. DEFINITIVO: no hay",
  "papelera, y no se puede deshacer.",
  "",
  "SE LLAMA DOS VECES, A PROPÓSITO. La primera, sin `confirmar`, NO BORRA",
  "NADA: dice qué archivo encontró, de quién es y cuánto pesa, y pide llamar",
  "otra vez con `confirmar: true` para ejecutarlo. Es la única red que hay —",
  "este servidor no tiene un diálogo que preguntar como la pantalla— así que",
  "no conviene saltársela poniendo `confirmar: true` desde la primera llamada",
  "sin haber leído antes qué se iba a borrar.",
  "",
  "Si el nombre encaja con más de un archivo, se listan con su identificador",
  "en vez de borrar el primero: adivinar cuál es exactamente el error que esto",
  "existe para no cometer.",
].join("\n");

export async function borrarArchivo(
  cliente: ClienteApi,
  entrada: { archivo: string; confirmar?: boolean; espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const candidatos = await resolverArchivo(cliente, espacio.id, entrada.archivo);

  if (candidatos.length === 0) {
    return `No encontré ningún archivo que sea «${entrada.archivo}» en ${espacio.name}.`;
  }
  if (candidatos.length > 1) {
    return (
      `«${entrada.archivo}» encaja con ${candidatos.length} archivos. Dime cuál, con su identificador:\n` +
      candidatos
        .map((f) => `- ${f.name} (${formatBytes(Number(f.sizeBytes))})  [archivo ${f.id}]`)
        .join("\n")
    );
  }

  const archivo = candidatos[0]!;

  if (!entrada.confirmar) {
    return (
      `Vas a borrar «${archivo.name}» (${formatBytes(Number(archivo.sizeBytes))}` +
      `${archivo.uploadedByName ? `, subido por ${archivo.uploadedByName}` : ""}) de ${espacio.name}.\n\n` +
      "Esto NO se puede deshacer: desaparecen la fila y el objeto del almacén.\n\n" +
      `Si es lo que quieres, llama otra vez a esta misma herramienta con ` +
      `\`archivo: "${archivo.id}"\` y \`confirmar: true\`.`
    );
  }

  await cliente.delete(`/files/${archivo.id}`);
  return `«${archivo.name}» borrado de ${espacio.name}. No hay vuelta atrás.`;
}
