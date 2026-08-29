"use client";

import { Circle, MinusCircle, PauseCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Presencia } from "@/lib/api";
import { api } from "@/lib/datos";
import { useSession } from "@/lib/session";

/**
 * El estado de presencia, en la barra.
 *
 * TRES ESTADOS Y NO DOS. El del medio es el motivo de que esto exista: casi
 * todas las herramientas ofrecen «disponible» y «no molestar», y la verdad la
 * mayor parte del tiempo no es ninguna de las dos. «Ocupado, pero abierto a
 * llamadas» es lo que la gente quiere decir cuando se pone en rojo: déjame
 * trabajar, y si hace falta hablar de verdad, llámame. Sin ese estado, quien
 * necesita concentrarse se aísla de más y quien no quiere aislarse acepta que
 * le interrumpan por cualquier cosa.
 *
 * SE ELIGE, NO SE DEDUCE. No mira el teclado ni si hay una pestaña abierta. Un
 * estado que el sistema adivina acaba diciendo «disponible» de alguien que se
 * fue a comer, y en cuanto miente una vez deja de consultarse.
 *
 * VIVE EN EL PIE DE LA BARRA, junto al tema y la sesión, y no en unos ajustes:
 * es algo que se cambia varias veces al día, y esconderlo detrás de dos clics
 * significa que se cambia una vez al mes y se queda mintiendo el resto.
 */

const ESTADOS: {
  valor: Presencia;
  etiqueta: string;
  ayuda: string;
  color: string;
  icono: typeof Circle;
}[] = [
  {
    valor: "available",
    etiqueta: "Disponible",
    ayuda: "Escríbeme o llámame.",
    color: "text-live",
    icono: Circle,
  },
  {
    valor: "busy_open",
    etiqueta: "Ocupado",
    ayuda: "Concentrado, pero abierto a llamadas si hace falta.",
    color: "text-warn",
    icono: PauseCircle,
  },
  {
    valor: "do_not_disturb",
    etiqueta: "No molestar",
    ayuda: "Ahora no.",
    color: "text-danger",
    icono: MinusCircle,
  },
];

export function SelectorPresencia() {
  const { user, refresh } = useSession();
  const [guardando, setGuardando] = useState<Presencia | null>(null);

  const actual = user?.presence ?? "available";

  async function cambiar(valor: Presencia) {
    if (valor === actual) return;
    setGuardando(valor);
    try {
      await api.patch("/me/profile", { presence: valor });
      await refresh();
    } catch {
      toast.error("No se pudo cambiar el estado.");
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Estado de presencia"
      className="flex items-center gap-0.5 rounded-lg border border-line bg-canvas/50 p-0.5"
    >
      {ESTADOS.map((estado) => {
        const activo = actual === estado.valor;
        const Icono = estado.icono;
        return (
          <button
            key={estado.valor}
            type="button"
            role="radio"
            aria-checked={activo}
            // El texto completo en el título: los tres iconos caben en la barra,
            // la frase que explica el estado del medio no.
            title={`${estado.etiqueta} · ${estado.ayuda}`}
            disabled={guardando !== null}
            onClick={() => void cambiar(estado.valor)}
            className={`presionable grid size-6 place-items-center rounded-md transition-colors
              duration-150 disabled:opacity-50
              ${activo ? `bg-raised ${estado.color}` : "text-faint hover:text-muted"}`}
          >
            {/* Relleno además de color: los tres iconos tienen silueta distinta,
                así que el estado se distingue sin depender de verlo en color. */}
            <Icono size={12} fill={activo ? "currentColor" : "none"} />
            <span className="sr-only">{estado.etiqueta}</span>
          </button>
        );
      })}
    </div>
  );
}
