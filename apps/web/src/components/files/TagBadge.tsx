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

export function TagBadge({
  tag,
  onClick,
  active = false,
}: {
  tag: Tag;
  onClick?: () => void;
  active?: boolean;
}) {
  const className = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition ${
    STYLES[tag.color] ?? STYLES.slate
  } ${active ? "ring-1 ring-current" : ""} ${onClick ? "cursor-pointer hover:brightness-125" : ""}`;

  if (!onClick) return <span className={className}>{tag.name}</span>;

  return (
    <button type="button" onClick={onClick} className={className}>
      {tag.name}
      {typeof tag.fileCount === "number" && (
        <span className="opacity-60">{tag.fileCount}</span>
      )}
    </button>
  );
}
