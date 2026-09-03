import Link from "next/link";
import type { ReactNode } from "react";
import { retraso } from "@/lib/animacion";

/**
 * Una fila de la barra lateral.
 *
 * TRES ESTADOS Y NO MÁS, cada uno significando lo mismo en toda la aplicación:
 * activo, con algo pendiente, y en reposo. El activo se marca con un listón de
 * acento a la izquierda en vez de con más brillo — el halo está reservado a lo
 * que está pasando ahora mismo (regla 2 de `globals.css`), y «estoy aquí» no es
 * un evento, es una posición.
 *
 * ESTABA DUPLICADA EN LOS DOS ARMAZONES, y ya divergida: la copia de
 * organización había perdido `resaltado`, `onClick` y `sufijo`, así que era un
 * subconjunto estricto de la del espacio de trabajo — mismas clases, mismos
 * colores, menos capacidades. Por eso unificarlas no cambió ni un píxel: con
 * `resaltado` en falso y sin sufijo, esta versión renderiza exactamente lo que
 * renderizaba la otra. El tamaño del icono lo sigue pasando quien llama (14 px
 * en organización, 15 en el espacio), que es la única diferencia que quedaba y
 * es de quien lo usa, no de esto.
 */
export function ItemNav({
  href,
  icono,
  activo,
  indice,
  resaltado = false,
  onClick,
  sufijo,
  children,
}: {
  href: string;
  icono: ReactNode;
  activo: boolean;
  indice: number;
  /** Tiene pendientes: se lee más fuerte sin llegar a marcarse como activo. */
  resaltado?: boolean;
  onClick?: () => void;
  sufijo?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={activo ? "page" : undefined}
      style={retraso(indice)}
      className={`devup-entrada presionable relative flex items-center gap-2.5 rounded-lg py-1.5 pl-3 pr-2 text-[13px] ${
        activo
          ? "bg-accent-soft/70 text-ink"
          : resaltado
            ? "font-medium text-ink hover:bg-raised/70"
            : "text-muted hover:bg-raised/70 hover:text-ink"
      }`}
    >
      {activo && (
        <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-accent" />
      )}
      <span
        className={`shrink-0 ${activo ? "text-accent" : resaltado ? "text-muted" : "text-faint"}`}
      >
        {icono}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {sufijo}
    </Link>
  );
}
