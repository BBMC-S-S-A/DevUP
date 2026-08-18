import { type FileRecord, api } from "../api";

/**
 * Subida en tres pasos: reservar, subir, confirmar.
 *
 * Los bytes van directos del navegador al almacén y no pasan por la API. Es lo
 * que permite que DevUP no sea un intermediario de tráfico —y encaja con la
 * tesis del producto—, pero tiene una consecuencia: la API no puede saber si
 * la subida terminó. De ahí el tercer paso.
 *
 * Si el paso 2 falla se retira la reserva en el acto. Y si el navegador se
 * cierra entre el 1 y el 3, la fila queda en 'pending' y el barrendero del
 * servidor se la lleva junto con el objeto: no queda basura anónima.
 */
export type UploadOptions = {
  channelId?: string | null;
  description?: string;
  tagIds?: string[];
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

export async function uploadFile(
  workspaceId: string,
  file: File,
  options: UploadOptions = {},
): Promise<FileRecord> {
  const reserved = await api.post<{ fileId: string; uploadUrl: string }>(
    `/workspaces/${workspaceId}/files`,
    {
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      channelId: options.channelId ?? null,
      description: options.description ?? "",
    },
  );

  try {
    await put(reserved.uploadUrl, file, options);
  } catch (error) {
    // Retirar la reserva ahora evita que el usuario vea un archivo a medias en
    // su biblioteca hasta que pase el barrendero.
    await api.delete(`/files/${reserved.fileId}`).catch(() => {});
    throw error;
  }

  const { file: record } = await api.post<{ file: FileRecord }>(
    `/files/${reserved.fileId}/confirm`,
    { tagIds: options.tagIds ?? [] },
  );
  return record;
}

/**
 * PUT con barra de progreso. Se usa XMLHttpRequest y no fetch porque fetch
 * todavía no informa del progreso de subida en los navegadores de escritorio,
 * y subir cien megas sin ninguna señal parece que se ha colgado.
 */
function put(url: string, file: File, options: UploadOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("content-type", file.type || "application/octet-stream");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`el almacén rechazó la subida (${request.status})`));
    };
    request.onerror = () => reject(new Error("se cortó la conexión con el almacén"));
    request.onabort = () => reject(new Error("subida cancelada"));

    options.signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

/**
 * La foto de una organización sigue el mismo patrón de tres pasos que un
 * archivo cualquiera —reservar, subir, confirmar— y por eso reutiliza `put()`
 * en vez de repetir el `XMLHttpRequest`. Lo único que cambia es el sitio: no
 * hay barra de progreso porque una foto pesa poco y el sitio donde se usa
 * (Ajustes) no tiene hueco para una.
 */
export async function uploadOrgLogo(organizationId: string, file: File): Promise<string> {
  const reserved = await api.post<{ logoKey: string; uploadUrl: string }>(
    `/organizations/${organizationId}/logo`,
    { fileName: file.name, mimeType: file.type || "application/octet-stream" },
  );
  await put(reserved.uploadUrl, file, {});
  await api.post(`/organizations/${organizationId}/logo/confirm`, { logoKey: reserved.logoKey });
  return reserved.logoKey;
}

export async function downloadUrl(
  fileId: string,
  disposition: "inline" | "attachment" = "inline",
): Promise<string> {
  const { url } = await api.get<{ url: string }>(
    `/files/${fileId}/download-url?disposition=${disposition}`,
  );
  return url;
}

export function formatBytes(bytes: number | string): string {
  const value = typeof bytes === "string" ? Number(bytes) : bytes;
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "kB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** exponent;
  return `${scaled.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function kindOf(mimeType: string): "image" | "video" | "audio" | "pdf" | "text" | "other" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/") || mimeType.includes("json")) return "text";
  return "other";
}
