"use client";

import { AlertCircle, CloudUpload, X } from "lucide-react";
import { useCallback, useRef, useState, type CSSProperties } from "react";
import type { FileRecord } from "@/lib/api";
import { formatBytes, uploadFile } from "@/lib/files/upload";
import { BotonIcono } from "@/components/ui/Boton";
import { Chip, Rotulo } from "@/components/ui/Superficies";

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
        // El halo del acento aquí no contradice la regla del brillo: mientras
        // hay algo colgando del cursor, esta zona SÍ está pasando algo. Se
        // apaga en cuanto se suelta.
        className={`group relative flex cursor-pointer flex-col items-center justify-center gap-2.5
          rounded-2xl border border-dashed px-6 py-9 text-center
          transition-[border-color,background-color,box-shadow] duration-200 ease-[var(--ease-out)]
          ${
            dragging
              ? "border-accent bg-accent-soft/40 shadow-[var(--halo-accent)]"
              : "border-line-strong/70 bg-surface/60 hover:border-accent/40 hover:bg-raised/40"
          }`}
      >
        {/* La rejilla solo aparece al arrastrar: le da suelo a la zona justo
            cuando hace falta apuntar a ella, y no compite el resto del tiempo. */}
        <span
          aria-hidden
          className={`rejilla pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-200 ${
            dragging ? "opacity-100" : "opacity-0"
          }`}
        />

        <span
          className={`relative grid size-11 place-items-center rounded-2xl border
            transition-[transform,border-color,background-color,color] duration-200 ease-[var(--ease-out)]
            ${
              dragging
                ? "border-accent/50 bg-accent-soft text-accent-bright motion-safe:scale-110"
                : "border-line bg-raised/60 text-faint group-hover:text-muted"
            }`}
        >
          <CloudUpload size={20} />
        </span>

        <span className="relative">
          <Rotulo className={dragging ? "text-accent" : ""}>
            {dragging ? "Suelta para subir" : "Zona de carga"}
          </Rotulo>
          <p className="mt-1 text-sm text-muted">
            Arrastra archivos aquí o <span className="text-accent-bright">búscalos</span>
          </p>
        </span>

        {tagIds.length > 0 && (
          <Chip tono="accent" className="relative">
            se etiquetarán con {tagIds.length}
          </Chip>
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

      {jobs.map((job, index) => {
        const porcentaje = Math.round(job.progress * 100);
        return (
          <div
            key={job.id}
            className="devup-entrada panel rounded-xl px-3 py-2.5"
            style={{ "--retraso": `${Math.min(index, 8) * 40}ms` } as CSSProperties}
          >
            <div className="flex items-center gap-3 text-xs">
              <span className="min-w-0 flex-1 truncate text-ink">{job.name}</span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
                {formatBytes(job.size)}
              </span>
              {job.error ? (
                <BotonIcono
                  etiqueta="Descartar el aviso"
                  className="size-6"
                  onClick={() => setJobs((current) => current.filter((j) => j.id !== job.id))}
                >
                  <X size={13} />
                </BotonIcono>
              ) : (
                <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-accent-bright">
                  {porcentaje}%
                </span>
              )}
            </div>

            {job.error ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-danger">
                <AlertCircle size={12} className="shrink-0" />
                {job.error}
              </p>
            ) : (
              <div
                role="progressbar"
                aria-label={`Subiendo ${job.name}`}
                aria-valuenow={porcentaje}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-2 h-1 overflow-hidden rounded-full bg-line/70"
              >
                {/* scaleX en vez de width: la barra se refresca muchas veces por
                    segundo y animar el ancho obliga al navegador a recalcular
                    el diseño en cada paso. */}
                <div
                  className="h-full origin-left rounded-full bg-gradient-to-r from-accent to-cyan
                    transition-transform duration-150 ease-[var(--ease-out)]"
                  style={{ transform: `scaleX(${job.progress})` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
