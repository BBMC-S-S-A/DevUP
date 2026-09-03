"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { BotonIcono } from "./Boton";

/**
 * Las superficies de la aplicación: tarjeta, cabecera de sección, diálogo y
 * estado vacío. Están juntas en un archivo porque comparten el mismo lenguaje
 * de material —el de globals.css— y separarlas invita a que cada una derive
 * por su cuenta.
 */

/** Tarjeta sólida. Sin desenfoque: en una lista larga cuesta caro y no aporta. */
export function Tarjeta({
  viva = false,
  elevable = false,
  flotante = false,
  className = "",
  children,
  ...props
}: {
  /** Está pasando algo dentro ahora mismo: se le enciende el borde. */
  viva?: boolean;
  /** Se levanta al pasar el puntero. Solo si la tarjeta entera es pulsable. */
  elevable?: boolean;
  /**
   * `capa-flotante` en vez de `panel`: para tarjetas que van directamente
   * sobre la atmósfera y no dentro de una página con fondo propio —el tablero,
   * la mesa—. `false` por defecto a propósito: es el material opaco el que
   * evita repintar en listas largas (ver el comentario de `.capa` en
   * globals.css), y la mayoría de quien usa `Tarjeta` sigue siendo eso.
   */
  flotante?: boolean;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={`${flotante ? "capa-flotante" : "panel"} rounded-2xl ${viva ? "panel-vivo" : ""} ${elevable ? "elevable" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * La etiqueta de instrumento: mayúsculas pequeñas con mucho tracking sobre
 * cada grupo de la interfaz. Es lo que le da a la aplicación el aire de panel
 * técnico sin necesidad de un solo adorno.
 */
export function Rotulo({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-faint ${className}`}
    >
      {children}
    </span>
  );
}

/** Chip de estado. El color lo pone quien lo usa; la forma la pone esto. */
export function Chip({
  tono = "neutro",
  className = "",
  children,
}: {
  tono?: "neutro" | "accent" | "live" | "warn" | "danger";
  className?: string;
  children: ReactNode;
}) {
  const tonos = {
    neutro: "border-line text-faint",
    accent: "border-accent/40 bg-accent-soft/60 text-accent",
    live: "border-live/40 bg-live/10 text-live",
    warn: "border-warn/40 bg-warn/10 text-warn",
    danger: "border-danger/40 bg-danger/10 text-danger",
  } as const;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5
        font-display text-[10px] font-semibold uppercase tracking-wider ${tonos[tono]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Diálogo modal.
 *
 * Cierra con Escape y con clic en el velo — las dos salidas que todo el mundo
 * intenta antes de buscar la equis. El velo va difuminado y no solo oscuro:
 * empujar el fondo hacia atrás enfoca la tarea sin apagar del todo el contexto.
 *
 * Crece desde su propio centro, que es la excepción a anclar los paneles a su
 * disparador: un modal no cuelga de ningún botón.
 */
export function Dialogo({
  titulo,
  descripcion,
  onCerrar,
  ancho = "md",
  children,
}: {
  titulo: string;
  descripcion?: string;
  onCerrar: () => void;
  ancho?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  useEffect(() => {
    const alPulsar = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [onCerrar]);

  const anchos = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg" } as const;

  return (
    <div
      className="devup-velo fixed inset-0 z-50 grid place-items-center bg-canvas/70 p-4 backdrop-blur-md"
      onMouseDown={(event) => {
        // Solo si el clic empezó en el velo: arrastrar una selección de texto
        // desde dentro y soltar fuera no debería cerrar nada.
        if (event.target === event.currentTarget) onCerrar();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        // `devup-materializa` y no `devup-dialogo`: este es cristal, y un
        // cristal que solo sube de opacidad se lee como una calcomanía —el
        // desenfoque ya está a tope en el primer fotograma, así que lo de detrás
        // aparece borroso de golpe. Animando desenfoque y escala juntos, la
        // superficie cuaja como un material que llega.
        className={`devup-materializa cristal-denso w-full ${anchos[ancho]} max-h-[85svh] overflow-y-auto rounded-2xl p-5`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold tracking-tight">{titulo}</h2>
            {descripcion && <p className="mt-0.5 text-xs text-faint">{descripcion}</p>}
          </div>
          <BotonIcono etiqueta="Cerrar" onClick={onCerrar}>
            <X size={15} />
          </BotonIcono>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Estado vacío.
 *
 * Un hueco en blanco no dice si la aplicación está cargando, si falló o si
 * simplemente no hay nada — y esas tres cosas piden reacciones distintas de
 * quien mira. Este componente obliga a decir cuál es.
 */
export function EstadoVacio({
  icono,
  titulo,
  pista,
  accion,
}: {
  icono: ReactNode;
  titulo: string;
  pista?: string;
  accion?: ReactNode;
}) {
  return (
    <div className="devup-entrada grid place-items-center px-6 py-14 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-2xl border border-line bg-raised/50 text-faint">
        {icono}
      </div>
      <p className="font-display text-sm font-medium text-muted">{titulo}</p>
      {pista && <p className="mt-1 max-w-xs text-xs leading-relaxed text-faint">{pista}</p>}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  );
}
