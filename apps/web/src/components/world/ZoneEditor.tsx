"use client";

import { Loader2, RotateCw, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { TILE } from "@/lib/world/atlas";
import { drawProp } from "@/lib/world/furniture";
import { CATEGORIES, type PropKind, prop } from "@/lib/world/props";
import { MATERIALS } from "@/lib/world/rooms";
import type { useEditor } from "@/lib/world/useEditor";
import type { Zone } from "@/lib/world/types";

const MATERIAL_NAMES = ["Parquet", "Baldosa", "Damero", "Moqueta", "Hormigón"];

/**
 * La paleta y los controles del editor.
 *
 * Cada mueble de la paleta se dibuja con `drawProp`, el mismo del mundo. Es la
 * misma razón por la que la vista previa del avatar usa `drawAvatar`: dos rutas
 * de dibujo se separan a la tercera semana y nadie se entera hasta que alguien
 * coloca algo que no se parece a lo que eligió.
 */
export function ZoneEditor({
  zone,
  editor,
}: {
  zone: Zone;
  editor: ReturnType<typeof useEditor>;
}) {
  return (
    <div className="pointer-events-auto absolute inset-y-0 right-0 z-50 flex w-72 flex-col border-l border-line bg-surface/95 backdrop-blur">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">Editando</p>
          <h2 className="truncate text-sm font-semibold">{zone.channelName}</h2>
        </div>
        <button
          type="button"
          onClick={editor.close}
          aria-label="Cerrar el editor"
          className="text-faint transition hover:text-ink"
        >
          <X size={16} />
        </button>
      </header>

      {/* Acciones sobre lo seleccionado. Se muestran siempre, deshabilitadas
          si no hay nada elegido: aparecer y desaparecer mueve los botones de
          sitio justo cuando se van a pulsar. */}
      <div className="flex gap-1.5 border-b border-line px-4 py-2.5">
        <Action
          icon={<RotateCw size={13} />}
          label="Girar"
          hint="R"
          onClick={editor.rotateSelected}
          disabled={editor.selected < 0}
        />
        <Action
          icon={<Trash2 size={13} />}
          label="Quitar"
          hint="Supr"
          onClick={editor.deleteSelected}
          disabled={editor.selected < 0}
          danger
        />
        <Action
          icon={<Undo2 size={13} />}
          label="Deshacer"
          hint="Z"
          onClick={editor.undo}
          disabled={!editor.canUndo}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-faint">Suelo</p>
        <div className="mb-4 flex flex-wrap gap-1">
          {MATERIALS.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => void editor.setMaterial(index)}
              className={`rounded-lg border px-2 py-1 text-[11px] transition ${
                zone.material === index
                  ? "border-accent/50 bg-accent-soft text-accent"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              {MATERIAL_NAMES[index]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void editor.setMaterial(null)}
            className={`rounded-lg border px-2 py-1 text-[11px] transition ${
              zone.material === null
                ? "border-accent/50 bg-accent-soft text-accent"
                : "border-line text-faint hover:text-muted"
            }`}
          >
            Automático
          </button>
        </div>

        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-faint">Color</p>
        <div className="mb-4 flex flex-wrap gap-1">
          {Array.from({ length: 8 }, (_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => editor.setTone(index)}
              aria-label={`Color ${index + 1}`}
              aria-pressed={editor.tone === index}
              style={{ background: TONE_SWATCHES[index] }}
              className={`h-6 w-6 rounded-md border-2 transition ${
                editor.tone === index ? "border-accent" : "border-transparent hover:border-line-strong"
              }`}
            />
          ))}
        </div>

        {CATEGORIES.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
              {group.label}
            </p>
            <div className="grid grid-cols-4 gap-1">
              {group.kinds.map((kind) => (
                <PaletteItem
                  key={kind}
                  kind={kind}
                  tone={editor.tone}
                  active={editor.brush === kind}
                  onPick={() => editor.setBrush(editor.brush === kind ? null : kind)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {editor.error && <p className="px-4 pb-1 text-xs text-danger">{editor.error}</p>}

      <footer className="space-y-2 border-t border-line px-4 py-3">
        <p className="text-[10px] leading-relaxed text-faint">
          {editor.brush
            ? "Haz clic dentro de la sala para colocar."
            : "Haz clic en un mueble para seleccionarlo, o elige uno de la paleta."}
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => void editor.save()}
            disabled={editor.saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
          >
            {editor.saving && <Loader2 size={12} className="animate-spin" />}
            Guardar
          </button>
          <button
            type="button"
            onClick={() => void editor.restore()}
            disabled={editor.saving}
            title="Vuelve al mobiliario que la sala tiene por su nombre"
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:text-ink disabled:opacity-40"
          >
            Restaurar
          </button>
        </div>
      </footer>
    </div>
  );
}

const TONE_SWATCHES = [
  "#c2586a", "#5b8cff", "#34d399", "#f59e0b",
  "#c193e0", "#66c2d9", "#8a94a6", "#4a5568",
];

function Action({
  icon,
  label,
  hint,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`${label} (${hint})`}
      className={`flex flex-1 items-center justify-center gap-1 rounded-lg border border-line px-2 py-1.5 text-[11px] transition disabled:opacity-30 ${
        danger ? "text-muted hover:text-danger" : "text-muted hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** Una casilla de la paleta, con el mueble dibujado de verdad dentro. */
function PaletteItem({
  kind,
  tone,
  active,
  onPick,
}: {
  kind: PropKind;
  tone: number;
  active: boolean;
  onPick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = 56 * ratio;
    canvas.height = 56 * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, 56, 56);
    ctx.imageSmoothingEnabled = false;
    // Escala corta y centrada: algunas piezas miden dos casillas de ancho y a
    // tamaño real se salen del recuadro.
    ctx.setTransform(0.85 * ratio, 0, 0, 0.85 * ratio, 0, 0);
    ctx.translate(33 - TILE / 2, 56);
    drawProp(ctx, prop(kind, 0, 0, { tone }));
  }, [kind, tone]);

  return (
    <button
      type="button"
      onClick={onPick}
      title={kind}
      aria-pressed={active}
      className={`grid aspect-square place-items-center overflow-hidden rounded-lg border transition ${
        active ? "border-accent bg-accent-soft" : "border-line bg-canvas hover:border-line-strong"
      }`}
    >
      <canvas ref={canvasRef} style={{ width: 56, height: 56 }} />
    </button>
  );
}
