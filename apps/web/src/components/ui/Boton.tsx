"use client";

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * El botón de la aplicación.
 *
 * Existe para que la respuesta al tacto sea la misma en todas partes: la clase
 * `presionable` de globals.css da el hundido de 3 % al pulsar, y va en el
 * `:active` —no en el `click`— porque la señal tiene que llegar cuando el dedo
 * baja, no cuando se levanta. Esperar al click se siente muerto.
 *
 * `cargando` deshabilita además de mostrar el giro: un botón que sigue
 * aceptando pulsaciones mientras la petición viaja es cómo se acaba con dos
 * ventas creadas por un doble clic.
 */
type Variante = "primario" | "secundario" | "fantasma" | "peligro";
type Tamano = "sm" | "md";

const VARIANTES: Record<Variante, string> = {
  // El degradado sutil hace que el relleno lea como una superficie iluminada y
  // no como un rectángulo plano de color.
  primario:
    "bg-gradient-to-b from-accent-bright to-accent text-canvas font-medium " +
    "shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_4px_16px_-6px_rgb(91_140_255/0.7)] " +
    "hover:brightness-110",
  secundario:
    "border border-line bg-raised/60 text-ink hover:border-line-strong hover:bg-raised",
  fantasma: "text-muted hover:bg-raised hover:text-ink",
  peligro: "border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20",
};

const TAMANOS: Record<Tamano, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
};

export function Boton({
  variante = "secundario",
  tamano = "md",
  cargando = false,
  icono,
  className = "",
  children,
  disabled,
  ...props
}: {
  variante?: Variante;
  tamano?: Tamano;
  cargando?: boolean;
  icono?: ReactNode;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      disabled={disabled || cargando}
      className={`presionable inline-flex shrink-0 items-center justify-center whitespace-nowrap
        disabled:pointer-events-none disabled:opacity-40
        ${TAMANOS[tamano]} ${VARIANTES[variante]} ${className}`}
    >
      {cargando ? <Loader2 size={tamano === "sm" ? 12 : 15} className="animate-spin" /> : icono}
      {children}
    </button>
  );
}

/**
 * Botón de solo icono. Separado y no una variante del de arriba porque el
 * cuadrado exacto y el `aria-label` obligatorio son justamente lo que se
 * olvida cuando es una opción más de un componente que ya tiene cinco.
 */
export function BotonIcono({
  etiqueta,
  className = "",
  children,
  ...props
}: { etiqueta: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      aria-label={etiqueta}
      title={etiqueta}
      className={`presionable grid size-8 shrink-0 place-items-center rounded-lg text-muted
        hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}
