"use client";

import { ImagePlus, Loader2, Paperclip, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BotonIcono } from "@/components/ui/Boton";
import { FilePreview } from "@/components/files/FilePreview";
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
 *
 * Y al pulsar una imagen NO se abre otra pestaña: se abre el mismo visor que
 * usa la biblioteca, encima de la tarea. Todo pasa dentro de la aplicación.
 */
export function AdjuntosTarea({
  taskId,
  workspaceId,
  pendientes = [],
  onPendientes,
}: {
  /** `null` mientras la tarea no existe todavía: se está creando. */
  taskId: string | null;
  workspaceId: string;
  /**
   * MODO BORRADOR, para el diálogo de crear.
   *
   * Un archivo necesita el id de la tarea, y al crear todavía no hay ninguno.
   * En vez de crear la tarea a medias para tener un id —lo que dejaría tareas
   * huérfanas cada vez que alguien cancela—, las imágenes se retienen aquí y
   * quien crea la tarea las sube en cuanto la API le devuelve el id.
   */
  pendientes?: File[];
  onPendientes?: (archivos: File[]) => void;
}) {
  const confirmar = useConfirmar();
  const [archivos, setArchivos] = useState<FileRecord[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [subiendo, setSubiendo] = useState(false);
  const [encima, setEncima] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const borrador = taskId === null;
  const [viendo, setViendo] = useState<FileRecord | null>(null);

  // Vistas previas locales del borrador. Se liberan al desmontar: un
  // `createObjectURL` que nadie revoca se queda con el archivo en memoria
  // mientras viva la pestaña.
  const previas = useMemo(
    () => pendientes.map((archivo) => ({ archivo, url: URL.createObjectURL(archivo) })),
    [pendientes],
  );
  useEffect(
    () => () => {
      for (const p of previas) URL.revokeObjectURL(p.url);
    },
    [previas],
  );

  const cargar = useCallback(async () => {
    if (taskId === null) return;
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
      // Sin tarea todavia: se retienen. Las sube quien pulse «Crear».
      if (taskId === null) {
        onPendientes?.([...pendientes, ...lista]);
        return;
      }
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
    [workspaceId, taskId, cargar, pendientes, onPendientes],
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

  // Con el visor abierto, Esc lo cierra a él y a nadie más. El diálogo de la
  // tarea también escucha en `window`, así que sin frenarlo en captura un Esc
  // se llevaría por delante el formulario a medio escribir.
  useEffect(() => {
    if (!viendo) return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape") return;
      evento.stopImmediatePropagation();
      setViendo(null);
    };
    window.addEventListener("keydown", alTeclear, true);
    return () => window.removeEventListener("keydown", alTeclear, true);
  }, [viendo]);

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
  const cuantos = borrador ? previas.length : (archivos?.length ?? 0);

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
          Imágenes y adjuntos
        </span>
        {cuantos > 0 && (
          <span className="font-mono text-[10px] tabular-nums text-faint">{cuantos}</span>
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
        {!borrador && archivos === null ? (
          <div className="grid h-16 place-items-center">
            <Loader2 size={14} className="animate-spin text-faint" />
          </div>
        ) : (
          <>
            {/* Las del borrador: viven en memoria y se pintan desde un blob
                local, sin pasar por el almacen ni firmar nada. */}
            {previas.length > 0 && (
              <div className="mb-2 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
                {previas.map((previa, indice) => (
                  <figure key={previa.url} className="group relative">
                    <div className="overflow-hidden rounded-lg border border-line bg-canvas/60">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previa.url}
                        alt={previa.archivo.name}
                        className="h-24 w-full object-cover"
                      />
                    </div>
                    <BotonIcono
                      etiqueta={`Quitar ${previa.archivo.name}`}
                      onClick={() =>
                        onPendientes?.(pendientes.filter((_, otro) => otro !== indice))
                      }
                      className="!absolute right-1 top-1 !size-6 opacity-0 transition-opacity
                        group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 size={11} />
                    </BotonIcono>
                  </figure>
                ))}
              </div>
            )}
            {imagenes.length > 0 && (
              <div className="mb-2 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
                {imagenes.map((archivo) => (
                  <figure key={archivo.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => setViendo(archivo)}
                      title={archivo.name}
                      className="presionable block w-full overflow-hidden rounded-lg border border-line bg-canvas/60"
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
                    </button>
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
                      onClick={() => setViendo(archivo)}
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
              {cuantos === 0 && !subiendo && (
                <span className="text-[11px] text-faint">Todo el equipo las ve.</span>
              )}
            </div>
          </>
        )}
      </div>

      {viendo && (
        <FilePreview
          file={viendo}
          onClose={() => setViendo(null)}
          onDeleted={() => void cargar()}
        />
      )}
    </div>
  );
}
