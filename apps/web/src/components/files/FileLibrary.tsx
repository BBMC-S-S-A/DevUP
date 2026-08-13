"use client";

import {
  FileArchive,
  FileAudio,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type FileRecord, type Tag, api } from "@/lib/api";
import { formatBytes, kindOf } from "@/lib/files/upload";
import { useFileFeed } from "@/lib/files/useFileFeed";
import { FilePreview } from "./FilePreview";
import { TagBadge } from "./TagBadge";
import { UploadZone } from "./UploadZone";

const ICONS = {
  image: ImageIcon,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  text: FileText,
  other: FileArchive,
} as const;

export function FileLibrary({
  workspaceId,
  organizationId,
  channelId = null,
}: {
  workspaceId: string;
  organizationId: string;
  channelId?: string | null;
}) {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<FileRecord | null>(null);

  // La búsqueda espera a que la persona deje de escribir: sin esto, «informe»
  // son siete consultas a la base y la última puede llegar antes que la
  // penúltima.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (debounced) params.set("q", debounced);
    if (channelId) params.set("channelId", channelId);
    if (selectedTags.length > 0) params.set("tags", selectedTags.join(","));
    return params.toString();
  }, [debounced, channelId, selectedTags]);

  // Descarta respuestas que llegan tarde: sin esto, una búsqueda lenta puede
  // pisar el resultado de otra posterior y enseñar lo que no toca.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const mine = ++requestId.current;
    try {
      const [{ files }, { tags }] = await Promise.all([
        api.get<{ files: FileRecord[] }>(
          `/workspaces/${workspaceId}/files${query ? `?${query}` : ""}`,
        ),
        api.get<{ tags: Tag[] }>(`/organizations/${organizationId}/tags`),
      ]);
      if (mine !== requestId.current) return;
      setFiles(files);
      setTags(tags);
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }, [workspaceId, organizationId, query]);

  useEffect(() => {
    void load();
  }, [load]);

  // Subir algo en otra pestaña tiene que aparecer aquí.
  useFileFeed(workspaceId, load);

  return (
    <div className="space-y-5">
      <UploadZone
        workspaceId={workspaceId}
        channelId={channelId}
        tagIds={selectedTags}
        onUploaded={(file) => setFiles((current) => [file, ...current])}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre o descripción"
            className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm outline-none placeholder:text-faint focus:border-accent/60"
          />
        </div>
        <NewTag organizationId={organizationId} onCreated={load} />
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <TagBadge
              key={tag.id}
              tag={tag}
              active={selectedTags.includes(tag.id)}
              onClick={() =>
                setSelectedTags((current) =>
                  current.includes(tag.id)
                    ? current.filter((id) => id !== tag.id)
                    : [...current, tag.id],
                )
              }
            />
          ))}
          {selectedTags.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTags([])}
              className="text-[11px] text-faint underline hover:text-muted"
            >
              limpiar filtro
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="animate-spin text-faint" size={20} />
        </div>
      ) : files.length === 0 ? (
        <p className="py-16 text-center text-sm text-faint">
          {debounced || selectedTags.length > 0
            ? "Nada coincide con ese filtro."
            : "Todavía no hay archivos aquí."}
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
          {files.map((file) => {
            const Icon = ICONS[kindOf(file.mimeType)];
            return (
              <li key={file.id}>
                <button
                  type="button"
                  onClick={() => setPreview(file)}
                  className="flex h-full w-full flex-col gap-2 rounded-xl border border-line bg-surface p-3 text-left transition hover:border-line-strong hover:bg-raised"
                >
                  <span className="grid h-20 place-items-center rounded-lg bg-canvas text-faint">
                    <Icon size={22} />
                  </span>
                  <span className="line-clamp-2 text-xs text-ink">{file.name}</span>
                  <span className="mt-auto text-[11px] text-faint">
                    {formatBytes(file.sizeBytes)} · {file.uploadedByName}
                  </span>
                  {file.tags.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {file.tags.slice(0, 3).map((tag) => (
                        <TagBadge key={tag.id} tag={tag} />
                      ))}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {preview && (
        <FilePreview
          file={preview}
          onClose={() => setPreview(null)}
          onDeleted={(fileId) => setFiles((current) => current.filter((f) => f.id !== fileId))}
        />
      )}
    </div>
  );
}

function NewTag({
  organizationId,
  onCreated,
}: {
  organizationId: string;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("blue");

  const colors = ["slate", "blue", "green", "amber", "red", "violet", "pink", "teal"];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-muted transition hover:border-line-strong hover:text-ink"
      >
        <Plus size={14} />
        Etiqueta
      </button>
    );
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        await api.post(`/organizations/${organizationId}/tags`, { name, color });
        setName("");
        setOpen(false);
        await onCreated();
      }}
      className="flex items-center gap-1.5"
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="nombre"
        className="w-32 rounded-lg border border-line bg-surface px-2.5 py-2 text-xs outline-none focus:border-accent/60"
      />
      <select
        value={color}
        onChange={(event) => setColor(event.target.value)}
        className="rounded-lg border border-line bg-surface px-2 py-2 text-xs outline-none"
      >
        {colors.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={name.trim().length === 0}
        className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-canvas disabled:opacity-40"
      >
        Crear
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-lg border border-line px-2 py-2 text-xs text-muted"
      >
        ✕
      </button>
    </form>
  );
}
