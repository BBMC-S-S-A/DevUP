"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Boton } from "./Boton";
import { Rotulo } from "./Superficies";

/**
 * El marco de página.
 *
 * EXISTE PORQUE LA CABECERA ESTABA ESCRITA CINCO VECES. Cada pantalla llegó
 * como una pantalla entera e independiente, y ninguna llegó como una pieza
 * dentro de un marco, porque el marco nunca se escribió. Cinco copias de la
 * misma cabecera son cinco sitios donde una decisión se toma otra vez, y ya se
 * habían separado: distinto ancho, distinto relleno, y un enlace de vuelta que
 * en cuatro se llamaba «Organizaciones» y en una «Workspaces».
 *
 * Lo que este componente decide una vez, para que nadie lo vuelva a decidir:
 * el ancho de la columna, el aire alrededor del título, la rejilla de la
 * cabecera y la chapa del icono. Lo que deja abierto es lo que de verdad
 * cambia entre pantallas: qué acciones van arriba a la derecha, y qué se
 * enseña junto al título.
 */

const ANCHOS = {
  sm: "max-w-2xl",
  md: "max-w-3xl",
  lg: "max-w-4xl",
  xl: "max-w-5xl",
  /** Sin columna: la pantalla se extiende. Para tableros y rejillas. */
  completo: "max-w-none",
} as const;

export function Pagina({
  titulo,
  rotulo,
  icono,
  ancho = "md",
  acciones,
  junto,
  children,
}: {
  titulo: string;
  /** La línea en versalitas bajo el título. Dice de qué va, no lo repite. */
  rotulo?: string;
  icono?: ReactNode;
  ancho?: keyof typeof ANCHOS;
  /** Arriba a la derecha: lo que se puede hacer en esta pantalla. */
  acciones?: ReactNode;
  /** Al lado del título, separado por una regla. Cifras de cabecera. */
  junto?: ReactNode;
  children: ReactNode;
}) {
  const columna = ANCHOS[ancho];

  return (
    <div className="alto-util">
      <header className="filo-luz relative bg-surface/40">
        {/* La rejilla solo en la cabecera: es donde hay sitio para que la
            máscara radial se abra y no quede un recorte a media altura. */}
        <div className="rejilla pointer-events-none absolute inset-0" aria-hidden />

        <div className={`relative mx-auto ${columna} px-4 pb-6 pt-5 sm:px-6 sm:pb-7 sm:pt-6`}>
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
              <div className="flex items-center gap-3.5">
                {icono && (
                  <span
                    className="grid size-11 shrink-0 place-items-center rounded-2xl border
                      border-line-strong bg-raised text-ink"
                    style={{ boxShadow: "inset 0 1px 0 var(--brillo-canto)" }}
                  >
                    {icono}
                  </span>
                )}
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-semibold">{titulo}</h1>
                  {rotulo && <Rotulo className="mt-1 block">{rotulo}</Rotulo>}
                </div>
              </div>

              {junto && (
                <>
                  <span aria-hidden className="hidden h-11 w-px bg-line sm:block" />
                  {junto}
                </>
              )}
            </div>

            {acciones && <div className="flex items-center gap-2">{acciones}</div>}
          </div>
        </div>
      </header>

      <main className={`mx-auto ${columna} px-4 py-6 sm:px-6 sm:py-8`}>{children}</main>
    </div>
  );
}

/**
 * Cargando.
 *
 * Un hueco en blanco no dice si la aplicación está pensando, si falló o si no
 * hay nada — y las tres cosas piden reacciones distintas de quien mira. Este
 * componente y `Fallo` y `EstadoVacio` son los tres finales posibles de una
 * carga, y tenerlos con nombre es lo que obliga a decir cuál es.
 *
 * `role="status"` no es adorno: sin él, quien usa un lector de pantalla se
 * queda con la página muda mientras llegan los datos.
 */
export function Cargando({
  etiqueta = "Cargando",
  className = "",
}: {
  etiqueta?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label={etiqueta}
      className={`grid place-items-center py-16 ${className}`}
    >
      <Loader2 className="animate-spin text-faint" size={20} />
    </div>
  );
}

/**
 * Fallo.
 *
 * `role="alert"` para que se anuncie solo al aparecer: un error que solo se ve
 * es un error que quien no mira la pantalla no tiene.
 *
 * Y lleva reintentar cuando se le pasa, porque un mensaje de error sin una
 * salida deja a quien lo lee recargando la página a mano — que es lo que iba a
 * hacer el botón, pero perdiendo de paso lo que estuviera escribiendo.
 */
export function Fallo({
  children,
  onReintentar,
  className = "",
}: {
  children: ReactNode;
  onReintentar?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10
        px-4 py-3 text-sm text-danger ${className}`}
    >
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {onReintentar && (
        <Boton tamano="sm" variante="fantasma" onClick={onReintentar} className="-my-0.5 shrink-0">
          Reintentar
        </Boton>
      )}
    </div>
  );
}
