"use client";

import { Download, FileText, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { type FileRecord, api } from "@/lib/api";
import { downloadUrl, formatBytes, kindOf } from "@/lib/files/upload";
import { TagBadge } from "./TagBadge";

/**
 * Previsualización a pantalla parcial.
 *
 * La URL se firma al abrir y caduca sola, así que no se puede compartir el
 * enlace del `src` fuera del equipo más allá de esa ventana. Es también la
 * razón de pedirla aquí y no al listar: firmar sesenta URLs para enseñar una
 * rejilla sería sesenta permisos concedidos para nada.
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={file.name}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium">{file.name}</h2>
            <p className="mt-0.5 text-xs text-faint">
              {formatBytes(file.sizeBytes)} · {file.mimeType} · {file.uploadedByName}
            </p>
            {file.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {file.tags.map((tag) => (
                  <TagBadge key={tag.id} tag={tag} />
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              title="Descargar"
              onClick={async () => {
                // Se pide una firma nueva con disposition=attachment: la misma
                // URL no sirve porque la cabecera va dentro de lo firmado.
                const signed = await downloadUrl(file.id, "attachment");
                window.open(signed, "_blank", "noopener");
              }}
              className="rounded-lg p-2 text-muted transition hover:bg-raised hover:text-ink"
            >
              <Download size={16} />
            </button>
            <button
              type="button"
              title="Eliminar"
              disabled={deleting}
              onClick={async () => {
                if (!window.confirm(`¿Eliminar «${file.name}»? No se puede deshacer.`)) return;
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
              className="rounded-lg p-2 text-muted transition hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={16} />
            </button>
            <button
              type="button"
              title="Cerrar"
              onClick={onClose}
              className="rounded-lg p-2 text-muted transition hover:bg-raised hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="grid min-h-64 flex-1 place-items-center overflow-auto bg-canvas p-4">
          {error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : !url ? (
            <Loader2 className="animate-spin text-faint" size={20} />
          ) : kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={file.name} className="max-h-[70vh] max-w-full object-contain" />
          ) : kind === "video" ? (
            <video src={url} controls className="max-h-[70vh] max-w-full" />
          ) : kind === "audio" ? (
            <audio src={url} controls className="w-full max-w-md" />
          ) : kind === "pdf" ? (
            <iframe src={url} title={file.name} className="h-[70vh] w-full rounded-lg bg-white" />
          ) : (
            <div className="text-center">
              <FileText size={32} className="mx-auto mb-3 text-faint" />
              <p className="mb-3 text-sm text-muted">
                No hay previsualización para este tipo de archivo.
              </p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent underline"
              >
                Abrir en una pestaña nueva
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
