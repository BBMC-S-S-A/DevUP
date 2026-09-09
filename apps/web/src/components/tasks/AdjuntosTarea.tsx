"use client";

import { ImagePlus, Loader2, Paperclip, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BotonIcono } from "@/components/ui/Boton";
import { useConfirmar } from "@/components/ui/Confirmar";
import { ApiError, type FileRecord, api } from "@/lib/api";
import { uploadFile } from "@/lib/files/upload";

/**
 * Las imágenes y los adjuntos de una tarea.
 *
 * NO ES UN ALMACÉN NUEVO. Es la misma biblioteca del espacio de trabajo con la
 * tarea apuntada en el propio archivo (migración 0028): mismo almacén, mismo
 * enlace firmado con caducidad, mismo barrendero. Por eso «que todos las vean»
 * sale gratis — el archivo vive en la organización y lo ve cualquiera que
 * tenga acceso al espacio, no en el navegador de quien lo subió.
 *
 * PEGAR ES LO PRINCIPAL, y por eso el manejador de pegado no es un extra: lo
 * que se pone en un tablero es casi siempre una captura, y bajarla al disco
 * para volver a subirla es el paso que hace que nadie lo use. Se admiten
 * igualmente el botón y arrastrar.
 *
 * Los enlaces de descarga se firman de uno en uno y caducan, así que se piden
 * al abrir la tarea y no se guardan: un `src` cacheado sería un enlace muerto
 * la próxima vez.
 */
export function AdjuntosTarea({
  taskId,
  workspaceId,
}: {
  taskId: string;
  workspaceId: string;
}) {
  const confirmar = useConfirmar();
  const [archivos, setArchivos] = useState<FileRecord[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [subiendo, setSubiendo] = useState(false);
  const [encima, setEncima] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    const { files } = await api
      .get<{ files: FileRecord[] }>(`/tasks/${taskId}/files`)
      .catch(() => ({ files: [] as FileRecord[] }));
    setArchivos(files);

    // Una firma por imagen. Solo para lo que se va a pintar: un PDF adjunto se
    // enseña como chip y su enlace se pide al pulsarlo.
    const imagenes = files.filter((f) => f.mimeType.startsWith("image/"));
    const firmadas = await Promise.all(
      imagenes.map(async (f) => {
        const { url } = await api
          .get<{ url: string }>(`/files/${f.id}/download-url`)
          .catch(() => ({ url: "" }));
        return [f.id, url] as const;
      }),
    );
    setUrls(Object.fromEntries(firmadas.filter(([, url]) => url)));
  }, [taskId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const subir = useCallback(
    async (lista: File[]) => {
      if (lista.length === 0) return;
      setSubiendo(true);
      try {
        for (const archivo of lista) {
          await uploadFile(workspaceId, archivo, { taskId });
        }
        await cargar();
        toast.success(lista.length === 1 ? "Imagen añadida" : `${lista.length} archivos añadidos`);
      } catch (fallo) {
        toast.error(fallo instanceof ApiError ? fallo.message : "no se pudo subir");
      } finally {
        setSubiendo(false);
      }
    },
    [workspaceId, taskId, cargar],
  );

  // Pegar una captura con el foco dentro del diálogo. Se escucha en el
  // documento porque el foco suele estar en un campo de texto del formulario,
  // no en esta zona.
  useEffect(() => {
    const alPegar = (evento: ClipboardEvent) => {
      const imagenes = Array.from(evento.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (imagenes.length === 0) return;
      evento.preventDefault();
      void subir(imagenes);
    };
    document.addEventListener("paste", alPegar);
    return () => document.removeEventListener("paste", alPegar);
  }, [subir]);

  const borrar = async (archivo: FileRecord) => {
    if (
      !(await confirmar({
        titulo: `¿Quitar «${archivo.name}»?`,
        accion: "Quitar",
        peligro: true,
      }))
    )
      return;
    try {
      await api.delete(`/files/${archivo.id}`);
      await cargar();
    } catch (fallo) {
      toast.error(fallo instanceof ApiError ? fallo.message : "no se pudo quitar");
    }
  };

  const imagenes = (archivos ?? []).filter((f) => f.mimeType.startsWith("image/"));
  const otros = (archivos ?? []).filter((f) => !f.mimeType.startsWith("image/"));

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
          Imágenes y adjuntos
        </span>
        {archivos !== null && archivos.length > 0 && (
          <span className="font-mono text-[10px] tabular-nums text-faint">{archivos.length}</span>
        )}
        <span className="flex-1" />
        <span className="text-[10px] text-faint">o pega una captura</span>
      </div>

      <div
        onDragOver={(evento) => {
          evento.preventDefault();
          setEncima(true);
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={(evento) => {
          evento.preventDefault();
          setEncima(false);
          void subir(Array.from(evento.dataTransfer.files));
        }}
        className={`rounded-xl border border-dashed p-2.5 transition-colors duration-[var(--dur-hover)]
          ${encima ? "border-accent/60 bg-accent-soft/30" : "border-line"}`}
      >
        {archivos === null ? (
          <div className="grid h-16 place-items-center">
            <Loader2 size={14} className="animate-spin text-faint" />
          </div>
        ) : (
          <>
            {imagenes.length > 0 && (
              <div className="mb-2 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
                {imagenes.map((archivo) => (
                  <figure key={archivo.id} className="group relative">
                    {/* Enlace y no lightbox: abrir el original en una pestaña
                        es lo que la gente espera de una captura, y no hay que
                        mantener un visor. */}
                    <a
                      href={urls[archivo.id] ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      title={archivo.name}
                      className="block overflow-hidden rounded-lg border border-line bg-canvas/60"
                    >
                      {urls[archivo.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={urls[archivo.id]}
                          alt={archivo.name}
                          className="h-24 w-full object-cover"
                        />
                      ) : (
                        <div className="grid h-24 place-items-center text-faint">
                          <ImagePlus size={16} />
                        </div>
                      )}
                    </a>
                    <BotonIcono
                      etiqueta={`Quitar ${archivo.name}`}
                      onClick={() => void borrar(archivo)}
                      className="!absolute right-1 top-1 !size-6 opacity-0 transition-opacity
                        group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 size={11} />
                    </BotonIcono>
                  </figure>
                ))}
              </div>
            )}

            {otros.length > 0 && (
              <ul className="mb-2 space-y-1">
                {otros.map((archivo) => (
                  <li key={archivo.id} className="flex items-center gap-2">
                    <Paperclip size={11} className="shrink-0 text-faint" />
                    <button
                      type="button"
                      onClick={async () => {
                        const { url } = await api.get<{ url: string }>(
                          `/files/${archivo.id}/download-url`,
                        );
                        window.open(url, "_blank", "noreferrer");
                      }}
                      className="min-w-0 flex-1 truncate text-left text-xs text-muted hover:text-accent"
                    >
                      {archivo.name}
                    </button>
                    <BotonIcono
                      etiqueta={`Quitar ${archivo.name}`}
                      onClick={() => void borrar(archivo)}
                      className="!size-6"
                    >
                      <Trash2 size={11} />
                    </BotonIcono>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2">
              <input
                ref={campo}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(evento) => {
                  void subir(Array.from(evento.target.files ?? []));
                  evento.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => campo.current?.click()}
                disabled={subiendo}
                className="presionable inline-flex items-center gap-1.5 rounded-lg border border-line
                  px-2.5 py-1.5 text-[11px] text-muted
                  hover:border-line-strong hover:text-ink disabled:opacity-50"
              >
                {subiendo ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
                {subiendo ? "Subiendo…" : "Añadir imagen"}
              </button>
              {archivos.length === 0 && !subiendo && (
                <span className="text-[11px] text-faint">
                  Todo el equipo las ve.
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
