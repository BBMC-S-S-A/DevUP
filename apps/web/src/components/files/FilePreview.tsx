"use client";

import { Download, FileQuestion, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { type FileRecord, api } from "@/lib/api";
import { downloadUrl, formatBytes, kindOf } from "@/lib/files/upload";
import { BotonIcono } from "@/components/ui/Boton";
import { Chip, EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import { useConfirmar } from "@/components/ui/Confirmar";
import { TagBadge } from "./TagBadge";

/** Nombre corto del tipo, para el chip de la cabecera. */
const TIPOS = {
  image: "imagen",
  video: "vídeo",
  audio: "audio",
  pdf: "pdf",
  text: "texto",
  other: "archivo",
} as const;

/**
 * Previsualización a pantalla parcial.
 *
 * La URL se firma al abrir y caduca sola, así que no se puede compartir el
 * enlace del `src` fuera del equipo más allá de esa ventana. Es también la
 * razón de pedirla aquí y no al listar: firmar sesenta URLs para enseñar una
 * rejilla sería sesenta permisos concedidos para nada.
 *
 * No usa el `Dialogo` de Superficies porque ese tope de ancho (`max-w-lg`) es
 * el correcto para un formulario y el equivocado para un vídeo: aquí manda el
 * contenido. Sí toma prestado su material y su entrada.
 */
export function FilePreview({
  file,
  onClose,
  onDeleted,
}: {
  file: FileRecord;
  onClose: () => void;
  onDeleted: (fileId: string) => void;
}) {
  const confirmar = useConfirmar();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const kind = kindOf(file.mimeType);

  useEffect(() => {
    let cancelled = false;
    void downloadUrl(file.id, "inline")
      .then((signed) => {
        if (!cancelled) setUrl(signed);
      })
      .catch(() => {
        if (!cancelled) setError("no se pudo abrir el archivo");
      });
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="devup-velo fixed inset-0 z-50 flex items-center justify-center bg-canvas/75 p-4 backdrop-blur-md sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="devup-dialogo cristal-denso flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={file.name}
      >
        <header className="filo-luz flex items-start justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <Chip tono="accent">{TIPOS[kind]}</Chip>
              <Rotulo>previsualización</Rotulo>
            </div>

            <h2 className="truncate font-display text-sm font-semibold tracking-tight">
              {file.name}
            </h2>

            {/* Ficha técnica: tamaño y tipo MIME en mono porque son datos de
                máquina, y el nombre de quien lo subió en la de leer. */}
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
              <span className="font-mono tabular-nums text-muted">
                {formatBytes(file.sizeBytes)}
              </span>
              <span aria-hidden>·</span>
              <span className="font-mono">{file.mimeType}</span>
              <span aria-hidden>·</span>
              <span>subido por {file.uploadedByName}</span>
            </p>

            {file.description && (
              <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted">
                {file.description}
              </p>
            )}

            {file.tags.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1">
                {file.tags.map((tag) => (
                  <TagBadge key={tag.id} tag={tag} />
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <BotonIcono
              etiqueta="Descargar"
              onClick={async () => {
                // Se pide una firma nueva con disposition=attachment: la misma
                // URL no sirve porque la cabecera va dentro de lo firmado.
                const signed = await downloadUrl(file.id, "attachment");
                window.open(signed, "_blank", "noopener");
              }}
            >
              <Download size={16} />
            </BotonIcono>
            <BotonIcono
              etiqueta="Eliminar"
              disabled={deleting}
              className="hover:bg-danger/10 hover:text-danger"
              onClick={async () => {
                if (
                  !(await confirmar({
                    titulo: `¿Eliminar «${file.name}»?`,
                    accion: "Eliminar",
                    peligro: true,
                  }))
                )
                  return;
                setDeleting(true);
                try {
                  await api.delete(`/files/${file.id}`);
                  onDeleted(file.id);
                  onClose();
                } catch {
                  setError("no se pudo eliminar; puede que no seas quien lo subió");
                  setDeleting(false);
                }
              }}
            >
              <Trash2 size={16} />
            </BotonIcono>
            <BotonIcono etiqueta="Cerrar" onClick={onClose}>
              <X size={16} />
            </BotonIcono>
          </div>
        </header>

        {/* La rejilla detrás del contenido hace de mesa de luz: un PNG con
            transparencia o un vídeo vertical se apoyan en algo en vez de flotar
            sobre un rectángulo negro. */}
        <div className="rejilla grid min-h-64 flex-1 place-items-center overflow-auto bg-canvas/70 p-4">
          {error ? (
            <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : !url ? (
            <span className="flex items-center gap-2 text-faint">
              <Loader2 className="animate-spin" size={16} />
              <Rotulo>firmando el enlace</Rotulo>
            </span>
          ) : kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={file.name}
              className="max-h-[70vh] max-w-full rounded-xl object-contain shadow-[var(--sombra-panel)]"
            />
          ) : kind === "video" ? (
            <video
              src={url}
              controls
              className="max-h-[70vh] max-w-full rounded-xl shadow-[var(--sombra-panel)]"
            />
          ) : kind === "audio" ? (
            <audio src={url} controls className="w-full max-w-md" />
          ) : kind === "pdf" ? (
            <iframe src={url} title={file.name} className="h-[70vh] w-full rounded-xl bg-white" />
          ) : (
            <EstadoVacio
              icono={<FileQuestion size={20} />}
              titulo="Sin previsualización"
              pista="Este tipo de archivo no se puede enseñar aquí dentro, pero el enlace firmado ya está listo."
              accion={
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="presionable inline-flex h-8 items-center gap-1.5 rounded-lg border border-line
                    bg-raised/60 px-3 text-xs text-ink hover:border-line-strong hover:bg-raised"
                >
                  Abrir en una pestaña nueva
                </a>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
