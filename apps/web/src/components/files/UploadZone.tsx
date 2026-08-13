"use client";

import { AlertCircle, CloudUpload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { FileRecord } from "@/lib/api";
import { formatBytes, uploadFile } from "@/lib/files/upload";

type Job = {
  id: string;
  name: string;
  size: number;
  progress: number;
  error?: string;
};

export function UploadZone({
  workspaceId,
  channelId,
  tagIds,
  onUploaded,
}: {
  workspaceId: string;
  channelId?: string | null;
  tagIds: string[];
  onUploaded: (file: FileRecord) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const input = useRef<HTMLInputElement>(null);
  // Contador en vez de booleano: dragenter y dragleave saltan también al pasar
  // por encima de los hijos, y con un booleano el recuadro parpadea.
  const dragDepth = useRef(0);

  const start = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const id = `${file.name}-${Date.now()}-${Math.random()}`;
        setJobs((current) => [...current, { id, name: file.name, size: file.size, progress: 0 }]);

        try {
          const record = await uploadFile(workspaceId, file, {
            channelId: channelId ?? null,
            tagIds,
            onProgress: (fraction) =>
              setJobs((current) =>
                current.map((job) => (job.id === id ? { ...job, progress: fraction } : job)),
              ),
          });
          onUploaded(record);
          setJobs((current) => current.filter((job) => job.id !== id));
        } catch (error) {
          setJobs((current) =>
            current.map((job) =>
              job.id === id
                ? { ...job, error: error instanceof Error ? error.message : "falló la subida" }
                : job,
            ),
          );
        }
      }
    },
    [workspaceId, channelId, tagIds, onUploaded],
  );

  return (
    <div className="space-y-2">
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (event.dataTransfer.files.length > 0) void start(event.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") input.current?.click();
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center transition ${
          dragging
            ? "border-accent bg-accent-soft/40"
            : "border-line bg-surface hover:border-line-strong"
        }`}
      >
        <CloudUpload size={22} className={dragging ? "text-accent" : "text-faint"} />
        <p className="text-sm text-muted">
          Arrastra archivos aquí o <span className="text-accent">búscalos</span>
        </p>
        {tagIds.length > 0 && (
          <p className="text-xs text-faint">
            Se etiquetarán con las {tagIds.length} etiqueta(s) seleccionada(s)
          </p>
        )}
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void start(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {jobs.map((job) => (
        <div key={job.id} className="rounded-lg border border-line bg-surface px-3 py-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted">{job.name}</span>
            <span className="shrink-0 text-faint">{formatBytes(job.size)}</span>
            {job.error && (
              <button
                type="button"
                onClick={() => setJobs((current) => current.filter((j) => j.id !== job.id))}
                className="text-faint hover:text-ink"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {job.error ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-danger">
              <AlertCircle size={12} />
              {job.error}
            </p>
          ) : (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
              <div
                className="h-full bg-accent transition-[width] duration-150"
                style={{ width: `${Math.round(job.progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
