"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  CATALOG,
  CLOTH_TONES,
  HAIR_TONES,
  SKIN_TONES,
  drawAvatar,
} from "@/lib/world/atlas";
import { DEFAULT_AVATAR, type Avatar } from "@/lib/world/types";

/**
 * Vestirse.
 *
 * La vista previa se dibuja con `drawAvatar`, el mismo del renderizador y no
 * una versión aparte. Es la única manera de que lo que eliges aquí sea
 * exactamente lo que ve el resto: dos rutas de dibujo distintas se separan a
 * la tercera semana y nadie se entera hasta que alguien dice «yo no me veo
 * así».
 */
export function AvatarEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Avatar;
  onSave: (look: Avatar) => Promise<void>;
  onCancel: () => void;
}) {
  const [look, setLook] = useState<Avatar>(initial ?? DEFAULT_AVATAR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const set = <K extends keyof Avatar>(key: K, value: Avatar[K]) =>
    setLook((current) => ({ ...current, [key]: value }));

  // Vista previa, animada: el avatar camina en el sitio. Un muñeco quieto no
  // dice si el pelo elegido se ve bien en movimiento, que es como se le va a
  // ver el 100 % del tiempo.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = 120 * ratio;
    canvas.height = 150 * ratio;

    let frame = 0;
    const started = performance.now();

    const loop = (now: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(3 * ratio, 0, 0, 3 * ratio, 0, 0);
      ctx.imageSmoothingEnabled = false;
      drawAvatar(ctx, 20, 46, look, "s", true, now - started);
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [look]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(look);
    } catch {
      setError("no se pudo guardar tu personaje");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">Mi personaje</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cerrar"
            className="text-faint transition hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex gap-5 p-5">
          <div className="shrink-0 rounded-xl border border-line bg-canvas p-2">
            <canvas ref={canvasRef} style={{ width: 120, height: 150 }} />
          </div>

          <div className="min-w-0 flex-1 space-y-3.5">
            <Choice
              label="Complexión"
              count={CATALOG.body}
              value={look.body}
              onChange={(v) => set("body", v)}
            />
            <Choice
              label="Pelo"
              count={CATALOG.hair}
              value={look.hair}
              onChange={(v) => set("hair", v)}
            />
            <Swatches
              label="Piel"
              tones={SKIN_TONES}
              value={look.skinTone}
              onChange={(v) => set("skinTone", v)}
            />
            <Swatches
              label="Color de pelo"
              tones={HAIR_TONES}
              value={look.hairTone}
              onChange={(v) => set("hairTone", v)}
            />
            <Swatches
              label="Camiseta"
              tones={CLOTH_TONES}
              value={look.topTone}
              onChange={(v) => set("topTone", v)}
            />
            <Swatches
              label="Pantalón"
              tones={CLOTH_TONES}
              value={look.bottomTone}
              onChange={(v) => set("bottomTone", v)}
            />
          </div>
        </div>

        {error && <p className="px-5 pb-2 text-xs text-danger">{error}</p>}

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:text-ink"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Guardar
          </button>
        </footer>
      </div>
    </div>
  );
}

function Choice({
  label,
  count,
  value,
  onChange,
}: {
  label: string;
  count: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: count }, (_, index) => (
          <button
            key={index}
            type="button"
            onClick={() => onChange(index)}
            aria-pressed={value === index}
            className={`h-7 w-7 rounded-lg border text-[11px] transition ${
              value === index
                ? "border-accent/50 bg-accent-soft text-accent"
                : "border-line text-faint hover:text-muted"
            }`}
          >
            {index + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

function Swatches({
  label,
  tones,
  value,
  onChange,
}: {
  label: string;
  tones: readonly string[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">
        {tones.map((tone, index) => (
          <button
            key={tone + String(index)}
            type="button"
            onClick={() => onChange(index)}
            aria-label={`${label} ${index + 1}`}
            aria-pressed={value === index}
            style={{ background: tone }}
            className={`h-6 w-6 rounded-md border-2 transition ${
              value === index ? "border-accent" : "border-transparent hover:border-line-strong"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
