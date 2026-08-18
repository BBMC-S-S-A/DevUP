"use client";

import { Music, Pause, Play, SkipForward } from "lucide-react";
import { usePathname } from "next/navigation";
import { BotonIcono } from "@/components/ui/Boton";
import { useSpotify } from "@/lib/spotify/SpotifyProvider";
import { useVoiceCall } from "@/lib/voice/VoiceCallProvider";
import { SpotifyWidget } from "./SpotifyWidget";

/**
 * La música que te sigue por la aplicación.
 *
 * Existe por el mismo motivo que la barra de llamada: el reproductor vive en el
 * layout y sigue sonando al cambiar de pantalla, pero si el único sitio para
 * controlarlo fuera la cabecera de un canal de voz, desde el tablero o la
 * biblioteca no habría forma de pausar lo que suena.
 *
 * DOS DECISIONES DE SITIO, las dos por no tapar nada:
 *
 *  · Se apila justo encima de la barra de llamada cuando hay una abierta. Las
 *    dos son «cosas que van contigo», y agrupadas se leen como un solo bloque de
 *    estado en vez de como dos avisos compitiendo.
 *
 *  · En DevVerse no aparece. Esa vista es un espacio para recorrer y tiene su
 *    propia interfaz; añadirle cromo flotante es justo lo que la hace dejar de
 *    funcionar. La contrapartida honesta: estando dentro de DevVerse no se puede
 *    pausar la música sin salir.
 */
export function MusicaBar() {
  const { canal, sesion, player } = useSpotify();
  const { activeChannelId, room } = useVoiceCall();
  const pathname = usePathname();

  const enDevVerse = pathname?.includes("/devverse") ?? false;
  const hayLlamada = Boolean(activeChannelId) && room.status !== "idle";

  // Se pinta si este navegador está reproduciendo, o si la sala tiene algo
  // sonando aunque lo ponga otra persona: saber qué suena vale también cuando no
  // eres quien pincha.
  const pista = player.estado.pista;
  const enSala = sesion?.trackName ? sesion : null;
  if (enDevVerse || !canal || (!pista && !enSala)) return null;

  const puedeControlar = player.estado.listo && !player.estado.sinPremium && pista !== null;
  const titulo = pista?.nombre ?? enSala?.trackName ?? "";
  const artista = pista?.artista ?? enSala?.trackArtist ?? "";
  const caratula = pista?.caratula ?? enSala?.trackImageUrl ?? null;
  const sonando = pista ? player.estado.reproduciendo : (enSala?.isPlaying ?? false);

  return (
    <div
      className={`fixed inset-x-0 z-40 flex justify-center px-4 transition-[bottom] duration-200
        ${hayLlamada ? "bottom-[4.5rem]" : "bottom-4"}`}
    >
      <div className="cristal flex max-w-[min(24rem,100%)] items-center gap-2 rounded-full py-1.5 pl-2 pr-1.5">
        {caratula ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={caratula} alt="" className="size-8 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-raised text-faint">
            <Music size={13} />
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-xs font-medium leading-tight">
            {titulo}
          </span>
          <span className="block truncate text-[10px] leading-tight text-faint">{artista}</span>
        </span>

        {puedeControlar ? (
          <>
            <BotonIcono
              etiqueta={sonando ? "Pausar" : "Reproducir"}
              onClick={() => void player.alternarPausa()}
            >
              {sonando ? <Pause size={14} /> : <Play size={14} />}
            </BotonIcono>
            <BotonIcono etiqueta="Siguiente" onClick={() => void player.siguiente()}>
              <SkipForward size={14} />
            </BotonIcono>
          </>
        ) : (
          // Sin mando: al menos que se vea que está sonando en otro sitio.
          <span className="px-1 text-[10px] uppercase tracking-wider text-faint">en la sala</span>
        )}

        <span className="mx-0.5 h-5 w-px shrink-0 bg-line-strong" aria-hidden />
        <SpotifyWidget channelId={canal} panelDirection="up" />
      </div>
    </div>
  );
}
