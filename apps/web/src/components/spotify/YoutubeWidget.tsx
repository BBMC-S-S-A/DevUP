"use client";

import { Music, Pause, Play } from "lucide-react";
import { useSpotify } from "@/lib/spotify/SpotifyProvider";
import { Barra, Portada } from "./piezas";

/**
 * «Qué suena» por YouTube, como tarjeta del panel — no el vídeo en sí.
 *
 * EL VÍDEO SIGUE EN SU ESQUINA. Los términos de YouTube exigen que su
 * reproductor esté siempre visible, y el iframe se recrea —con el vídeo
 * reiniciándose un instante— si se le cambia de contenedor; mudarlo aquí cada
 * vez que se abre o se cierra el panel sería justo eso. Esta tarjeta es
 * carátula, título y progreso: un reflejo de lo que ya suena, no el
 * reproductor mismo.
 *
 * `Portada` y `Barra` son las mismas piezas del widget de Spotify, sin
 * adaptarlas: es la manera de que esta tarjeta se vea y se sienta como la
 * misma familia sin escribir su propio CSS.
 */
export function YoutubeWidget() {
  const { youtube, pistaYt } = useSpotify();
  const { estado } = youtube;

  const duracionMs = estado.duracionMs || pistaYt?.durationMs || 0;

  const pista = pistaYt
    ? {
        nombre: estado.titulo ?? pistaYt.trackName,
        artista: pistaYt.trackArtist,
        caratula: pistaYt.trackImageUrl,
        posicionMs: estado.posicionMs,
        duracionMs,
        sonando: estado.reproduciendo,
      }
    : null;

  if (!pista) {
    return (
      <div className="flex items-center gap-3 p-4">
        <div className="grid size-16 shrink-0 place-items-center rounded-xl border border-line bg-raised text-faint">
          <Music size={20} />
        </div>
        <div className="min-w-0">
          <p className="font-display text-sm font-medium text-muted">Nada sonando por YouTube</p>
          <p className="mt-0.5 text-xs text-faint">
            Pega un enlace o busca algo en la pestaña YouTube del reproductor.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Portada pista={pista} pinchando={false} sinPremium={false} />

      <div className="flex items-center gap-3 px-4 pb-3">
        <button
          type="button"
          onClick={() => (estado.reproduciendo ? youtube.pausar() : youtube.reanudar())}
          aria-label={estado.reproduciendo ? "Pausar" : "Reproducir"}
          className="presionable grid size-10 shrink-0 place-items-center rounded-full
            bg-gradient-to-b from-accent-bright to-accent text-canvas
            shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_4px_16px_-6px_rgb(124_58_237/0.8)]
            hover:brightness-110"
        >
          {estado.reproduciendo ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
        </button>

        <div className="min-w-0 flex-1">
          {/* `onArrastrar` no hace nada a propósito: en el de Spotify, arrastrar
              solo actualiza un estado local y el salto real ocurre al soltar
              (`soltarEn`). Aquí no hay ese estado intermedio — `irA` es lo único
              que YouTube expone, y ya hace el salto de verdad. Llamarlo en cada
              movimiento del puntero saltaría el vídeo de verdad decenas de veces
              por segundo mientras se arrastra; un solo salto al soltar es peor
              en vista previa pero no rompe nada. */}
          <Barra
            posicionMs={estado.posicionMs}
            duracionMs={duracionMs}
            onEmpezar={() => {}}
            onArrastrar={() => {}}
            onSoltar={async (ms) => youtube.irA(ms)}
          />
        </div>
      </div>

      {estado.fallo && (
        <p className="px-4 pb-3 text-xs text-danger" role="alert">
          {estado.fallo}
        </p>
      )}
    </div>
  );
}
