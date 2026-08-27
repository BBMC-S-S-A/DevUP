"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTema, type Tema } from "@/lib/tema";

/**
 * Elegir tema: claro, oscuro, o lo que diga el sistema.
 *
 * SEGMENTADO Y NO UN INTERRUPTOR. Un interruptor solo tiene dos posiciones, así
 * que «seguir al sistema» tendría que esconderse en otro sitio o desaparecer —
 * y es la opción por defecto y la que más gente quiere. Con tres segmentos las
 * tres opciones se ven a la vez y se entiende que son excluyentes sin leer nada.
 *
 * La pastilla que marca la selección se desplaza entre segmentos en vez de
 * aparecer y desaparecer: el movimiento es lo que dice «esto era una cosa que se
 * ha movido» en lugar de «esto es otra cosa distinta». Sale gratis con una
 * transición de `transform`, que es de las dos propiedades que el compositor
 * puede animar sin repintar.
 */

const OPCIONES: { valor: Tema; icono: typeof Sun; etiqueta: string }[] = [
  { valor: "claro", icono: Sun, etiqueta: "Claro" },
  { valor: "oscuro", icono: Moon, etiqueta: "Oscuro" },
  { valor: "sistema", icono: Monitor, etiqueta: "Sistema" },
];

export function SelectorTema({ className = "" }: { className?: string }) {
  const { tema, poner } = useTema();
  const indice = OPCIONES.findIndex((o) => o.valor === tema);

  return (
    <div
      role="radiogroup"
      aria-label="Tema de la interfaz"
      className={`relative inline-flex items-center gap-0.5 rounded-xl border border-line bg-raised/60 p-0.5 ${className}`}
    >
      {/* La pastilla va detrás de los botones y se mueve por transform. Ancho
          fijo por segmento para que el desplazamiento sea exacto: con anchos
          automáticos habría que medir en JavaScript en cada renderizado. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0.5 top-0.5 size-7 rounded-lg bg-accent-soft
          shadow-[inset_0_0_0_1px_var(--canto)]
          transition-transform duration-[var(--dur-pop)] ease-[var(--muelle-firme)]
          motion-reduce:transition-none"
        style={{ transform: `translateX(${indice * 30}px)` }}
      />

      {OPCIONES.map(({ valor, icono: Icono, etiqueta }) => {
        const activo = tema === valor;
        return (
          <button
            key={valor}
            type="button"
            role="radio"
            aria-checked={activo}
            aria-label={etiqueta}
            title={etiqueta}
            onClick={() => poner(valor)}
            className={`presionable relative z-10 grid size-7 place-items-center rounded-lg
              transition-colors duration-[var(--dur-hover)]
              ${activo ? "text-accent" : "text-faint hover:text-muted"}`}
          >
            <Icono size={14} />
          </button>
        );
      })}
    </div>
  );
}
