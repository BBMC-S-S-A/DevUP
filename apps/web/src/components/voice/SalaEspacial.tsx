"use client";

import type { CSSProperties } from "react";
import { Mic, MicOff } from "lucide-react";
import { useSpeaking } from "@/lib/voice/useSpeaking";
import { HiddenAudio } from "./ParticipantTile";

/**
 * La sala como un SITIO, no como una rejilla de tarjetas.
 *
 * POR QUÉ EXISTE. Con la voz sola, una tarjeta por persona es un formulario:
 * cada una es un rectángulo con su recuadro vacío —no hay vídeo que enseñar— y
 * su pie de estado. Lo que hay que leer de un vistazo en una llamada es otra
 * cosa: cuántos son, quién habla y quién está callado. Esto lo dice con el
 * tamaño y la luz, que es como se lee sin fijarse.
 *
 * SOLO SIN CÁMARA, y no es una limitación: en cuanto alguien enciende la cámara
 * o comparte pantalla hace falta un rectángulo con proporción de vídeo, y ahí
 * la rejilla de `ParticipantTile` es la forma correcta. La sala decide cuál
 * usar; ver `VoiceRoom`.
 *
 * QUIEN HABLA CRECE Y SE ADELANTA. El halo no basta por sí solo: en una sala de
 * cinco, cinco halos apagados y uno encendido se distinguen mirando, pero el
 * tamaño se distingue sin mirar — y eso es lo que hace que la vista pueda estar
 * en otra parte de la pantalla.
 */

/** Un color estable por persona, del mismo sitio que el resto del tema. */
const TINTES = [
  "linear-gradient(150deg, var(--c-accent-bright), var(--c-accent))",
  "linear-gradient(150deg, var(--c-cyan), color-mix(in oklab, var(--c-cyan) 55%, #000))",
  "linear-gradient(150deg, var(--c-violet), color-mix(in oklab, var(--c-violet) 55%, #000))",
  "linear-gradient(150deg, var(--c-warn), color-mix(in oklab, var(--c-warn) 55%, #000))",
  "linear-gradient(150deg, var(--c-live), color-mix(in oklab, var(--c-live) 55%, #000))",
] as const;

/**
 * El tinte sale del nombre y no de la posición en la lista.
 *
 * Por la posición, entrar o salir alguien de la sala le cambia el color a todos
 * los demás — y el color de una persona es justo lo que se usa para
 * reconocerla sin leer.
 */
function tinte(nombre: string): string {
  let suma = 0;
  for (let i = 0; i < nombre.length; i += 1) suma = (suma * 31 + nombre.charCodeAt(i)) >>> 0;
  return TINTES[suma % TINTES.length]!;
}

function iniciales(nombre: string): string {
  return (
    nombre
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

export type EnLaSala = {
  displayName: string;
  muted: boolean;
  audioStream: MediaStream | null;
  esYo?: boolean;
};

export function SalaEspacial({ gente }: { gente: EnLaSala[] }) {
  return (
    <ul
      // `items-end` con el que habla adelantado: la fila se lee como un
      // semicírculo visto de frente y no como una lista centrada.
      className="flex flex-wrap items-end justify-center gap-x-8 gap-y-7 px-2 py-6 sm:gap-x-11"
    >
      {gente.map((persona, indice) => (
        <Presencia key={`${persona.displayName}-${indice}`} persona={persona} indice={indice} />
      ))}
    </ul>
  );
}

function Presencia({ persona, indice }: { persona: EnLaSala; indice: number }) {
  const hablando = useSpeaking(persona.audioStream, !persona.muted);

  // El halo va en línea y no como clase porque se construye del acento del
  // tema (`--halo-live`), que cambia entre claro y oscuro.
  const halo: CSSProperties = { boxShadow: "var(--halo-live)" };

  return (
    <li
      className="devup-entrada flex flex-col items-center gap-3"
      style={
        {
          "--retraso": `${Math.min(indice, 8) * 70}ms`,
          // Adelantar al que habla mueve la fila entera si se hace con margen;
          // con `translate` solo se mueve él y nada más se recoloca.
          transform: hablando ? "translateY(-14px)" : undefined,
          transition: "transform 260ms var(--ease-out)",
        } as CSSProperties
      }
    >
      {!persona.esYo && <HiddenAudio stream={persona.audioStream} />}

      <div className="relative">
        {/* Dos anillos concéntricos, solo al hablar. Uno solo se confunde con
            un borde; dos se leen como algo que sale de la persona. */}
        <span
          aria-hidden
          className={`pointer-events-none absolute -inset-3 rounded-full border-2 border-live/50
            transition-opacity duration-[260ms] ease-[var(--ease-out)]
            ${hablando ? "opacity-100" : "opacity-0"}`}
        />
        <span
          aria-hidden
          className={`pointer-events-none absolute -inset-6 rounded-full border border-live/20
            transition-opacity duration-[260ms] ease-[var(--ease-out)]
            ${hablando ? "opacity-100" : "opacity-0"}`}
        />
        <span
          aria-hidden
          style={halo}
          className={`pointer-events-none absolute inset-0 rounded-full
            transition-opacity duration-[260ms] ease-[var(--ease-out)]
            ${hablando ? "opacity-100" : "opacity-0"}`}
        />

        <div
          style={{ backgroundImage: tinte(persona.displayName) }}
          className={`grid place-items-center rounded-full font-display font-semibold text-canvas
            shadow-[0_20px_44px_-14px_rgb(0_0_0/0.75)]
            transition-[width,height,font-size] duration-[260ms] ease-[var(--ease-out)]
            motion-reduce:transition-none
            ${hablando ? "size-[7rem] text-3xl" : "size-24 text-2xl"}`}
        >
          {iniciales(persona.displayName)}
        </div>

        {/* El micrófono cerrado se dice con un icono y no solo con la ausencia
            de halo: «callado a propósito» y «callado porque no dice nada» son
            dos estados distintos y uno de los dos hay que arreglarlo. */}
        {persona.muted && (
          <span
            aria-hidden
            className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full
              border border-line-strong bg-surface text-danger"
          >
            <MicOff size={13} />
          </span>
        )}
      </div>

      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[13px] font-medium">
          {persona.displayName}
          {persona.esYo && <span className="ml-1.5 text-[11px] text-faint">tú</span>}
        </span>
        <span
          className={`flex items-center gap-1 text-[11px] ${hablando ? "text-live" : "text-faint"}`}
        >
          {persona.muted ? (
            "en silencio"
          ) : hablando ? (
            <>
              <Mic size={10} />
              hablando
            </>
          ) : (
            "escuchando"
          )}
        </span>
      </div>
    </li>
  );
}
