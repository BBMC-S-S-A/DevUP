"use client";

/**
 * Campo de formulario. Lo usan el acceso, la invitación y la recuperación.
 *
 * El anillo de foco es del acento y no del borde gris por un motivo concreto:
 * en un formulario oscuro, un borde que solo cambia de gris a gris claro al
 * enfocarse es casi invisible, y quien navega con el teclado pierde el sitio.
 */
export function Field({
  label,
  value,
  onChange,
  hint,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
        {label}
      </span>
      <input
        {...props}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-line bg-canvas/60 px-3.5 text-sm outline-none
          transition-[border-color,box-shadow,background-color] duration-200
          placeholder:text-faint
          hover:border-line-strong
          focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_rgb(91_140_255/0.14)]
          disabled:opacity-60"
      />
      {hint && <span className="mt-1.5 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

/** Mismo campo, sin etiqueta encima: para filtros y barras de búsqueda. */
export function Entrada({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-10 w-full rounded-xl border border-line bg-canvas/60 px-3.5 text-sm outline-none
        transition-[border-color,box-shadow,background-color] duration-200
        placeholder:text-faint
        hover:border-line-strong
        focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_rgb(91_140_255/0.14)]
        ${className}`}
    />
  );
}
