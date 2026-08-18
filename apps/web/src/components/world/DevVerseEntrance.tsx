"use client";

import { Gamepad2 } from "lucide-react";

/**
 * La entrada a DevVerse.
 *
 * Se pinta mientras `WorldView` todavía no tiene escena que dibujar —sin mapa
 * cargado no hay cámara ni fondo que preparar— y se sustituye por el lienzo en
 * cuanto la hay. Dura lo que tarde la carga real, nunca un tiempo fijo: lo que
 * se anima es la propia aparición del panel (una vez, con `devup-dialogo`,
 * igual que cualquier superficie que no cuelga de un disparador) y un anillo
 * que se expande una sola vez — no en bucle, porque entrar a un espacio es un
 * evento puntual, no un estado que siga "pasando" mientras se espera.
 *
 * Por qué no es un simple giro genérico: DevVerse es la única pantalla de la
 * aplicación que se recorre en vez de leerse (0002, "el mundo proyecta, no
 * origina"), y merece anunciarse como un sitio al que se entra, no como una
 * carga más.
 */
export function DevVerseEntrance() {
  return (
    <div className="relative grid h-full w-full place-items-center overflow-hidden bg-canvas">
      <div className="rejilla pointer-events-none absolute inset-0" aria-hidden />

      <div className="devup-dialogo relative flex flex-col items-center gap-4">
        <div className="relative grid size-16 place-items-center">
          <span
            aria-hidden
            className="devup-portal-anillo absolute inset-0 rounded-full border border-accent/60"
          />
          <span aria-hidden className="absolute inset-0 rounded-full bg-accent/10 blur-xl" />
          <span className="cristal relative grid size-16 place-items-center rounded-2xl text-accent">
            <Gamepad2 size={26} />
          </span>
        </div>

        <div className="text-center">
          <p className="font-display text-sm font-semibold tracking-tight text-ink">DevVerse</p>
          <p className="animate-pulse-slow mt-1 text-[11px] uppercase tracking-[0.18em] text-faint">
            Entrando…
          </p>
        </div>
      </div>
    </div>
  );
}
