"use client";

import type { Tag } from "@/lib/api";

/**
 * Los colores están escritos uno a uno en vez de componerse con plantillas.
 * Tailwind analiza el código fuente en busca de clases literales: `bg-${color}`
 * no aparece nunca en el CSS generado y la etiqueta saldría sin color.
 */
const STYLES: Record<string, string> = {
  slate: "bg-slate-500/15 text-slate-300 border-slate-500/25",
  blue: "bg-blue-500/15 text-blue-300 border-blue-500/25",
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  red: "bg-red-500/15 text-red-300 border-red-500/25",
  violet: "bg-violet-500/15 text-violet-300 border-violet-500/25",
  pink: "bg-pink-500/15 text-pink-300 border-pink-500/25",
  teal: "bg-teal-500/15 text-teal-300 border-teal-500/25",
};

/**
 * Misma geometría y tipografía que el `Chip` de Superficies: en una rejilla de
 * archivos conviven etiquetas del usuario y chips del sistema, y si cada una
 * tiene su forma la tarjeta parece un collage. Lo único que cambia es de dónde
 * sale el color.
 */
const FORMA =
  "inline-flex shrink-0 items-center gap-1 rounded-full border font-display " +
  "text-[10px] font-semibold uppercase tracking-wider";

export function TagBadge({
  tag,
  onClick,
  active = false,
}: {
  tag: Tag;
  onClick?: () => void;
  active?: boolean;
}) {
  const color = STYLES[tag.color] ?? STYLES.slate;

  // Sin `onClick` es un rótulo dentro de una tarjeta: se lee, no se toca.
  if (!onClick) {
    return <span className={`${FORMA} ${color} px-2 py-0.5`}>{tag.name}</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`presionable ${FORMA} ${color} px-2.5 py-1
        ${active ? "brightness-125 ring-1 ring-current" : "hover:brightness-125"}`}
    >
      {tag.name}
      {typeof tag.fileCount === "number" && (
        // La cifra en mono para que las etiquetas de una fila no bailen de
        // ancho al cambiar de 9 a 10 archivos.
        <span className="font-mono text-[10px] tabular-nums opacity-60">{tag.fileCount}</span>
      )}
    </button>
  );
}
