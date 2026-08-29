"use client";

import { ChevronDown } from "lucide-react";

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
          focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_var(--anillo-foco)]
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
        focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_var(--anillo-foco)]
        ${className}`}
    />
  );
}

/**
 * Desplegable.
 *
 * Es un `<select>` de verdad, no un menú dibujado a mano. La razón es que en un
 * teléfono el nativo abre la rueda del sistema, y con el teclado ya sabe
 * escribir para saltar a una opción y cerrarse con Escape. Un menú propio hay
 * que enseñárselo todo eso, y casi siempre se le enseña la mitad. El menú
 * dibujado tiene sitio cuando las opciones llevan icono o descripción; para
 * elegir entre «Miembro» y «Administrador» es peor en todo.
 *
 * Lo único que se le añade es la flecha, porque la del sistema no se puede
 * teñir y en el tema oscuro se queda casi negra sobre casi negro.
 */
export function Desplegable({
  tamano = "md",
  contenedor = "",
  className = "",
  children,
  ...props
}: {
  tamano?: "sm" | "md";
  /** Clases del envoltorio. `w-full` va aquí, no en el `<select>`: el que
   *  tiene que ocupar el ancho es el que posiciona la flecha. */
  contenedor?: string;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const tamanos = {
    sm: "h-8 rounded-lg pl-2.5 pr-7 text-xs",
    md: "h-10 rounded-xl pl-3.5 pr-9 text-sm",
  } as const;

  return (
    <span className={`relative inline-flex ${contenedor}`}>
      <select
        {...props}
        className={`w-full appearance-none border border-line bg-canvas/60 outline-none
          transition-[border-color,box-shadow,background-color] duration-200
          hover:border-line-strong
          focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_var(--anillo-foco)]
          disabled:opacity-60
          ${tamanos[tamano]} ${className}`}
      >
        {children}
      </select>
      {/* La lista desplegada la pinta el sistema y no se puede tocar desde
          aquí; teñir las `<option>` es lo máximo que llega, y en Windows ni
          eso. Por eso las opciones se pasan con `bg-surface` desde quien las
          escribe: es el único sitio donde sirve de algo. */}
      <ChevronDown
        size={tamano === "sm" ? 12 : 14}
        aria-hidden
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-faint ${
          tamano === "sm" ? "right-2.5" : "right-3"
        }`}
      />
    </span>
  );
}

/**
 * Área de texto.
 *
 * `resize-none` por defecto: el asa de redimensionar de la esquina rompe
 * cualquier composición en cuanto alguien la arrastra, y en un formulario con
 * un botón debajo lo que hace es tapar el botón. Quien necesite lo contrario lo
 * pide con `className="resize-y"`.
 */
export function AreaTexto({
  className = "",
  rows = 4,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      rows={rows}
      className={`w-full resize-none rounded-xl border border-line bg-canvas/60 p-3 text-sm
        leading-relaxed outline-none
        transition-[border-color,box-shadow,background-color] duration-200
        placeholder:text-faint
        hover:border-line-strong
        focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_var(--anillo-foco)]
        disabled:opacity-60
        ${className}`}
    />
  );
}
