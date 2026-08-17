"use client";

import { Circle, Mic, MicOff, PhoneOff } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SpotifyWidget } from "@/components/spotify/SpotifyWidget";
import { BotonIcono } from "@/components/ui/Boton";
import { useElapsed } from "@/lib/voice/useElapsed";
import { useVoiceCall } from "@/lib/voice/VoiceCallProvider";

/**
 * Se ve en cualquier página de la app mientras hay una llamada activa en la
 * que no se está viendo la sala en este momento — en la propia página del
 * canal ya están los controles completos, y duplicarlos aquí solo confundiría
 * sobre cuál es el botón que manda.
 *
 * Va en cristal y no en superficie sólida por lo que la barra es: cromo
 * flotando sobre el contenido de otra página. El desenfoque deja ver que hay
 * algo debajo, que es exactamente la información de «esto no pertenece a la
 * pantalla que estás mirando, viene contigo».
 */
export function ActiveCallBar() {
  const { room, activeChannelId, activeWorkspaceId, activeChannelName, leaveChannel } = useVoiceCall();
  const pathname = usePathname();
  const elapsed = useElapsed(room.startedAt);

  if (!activeChannelId || room.status === "idle") return null;
  const channelHref = `/app/w/${activeWorkspaceId}/c/${activeChannelId}`;
  const onOwnPage = pathname === channelHref;

  // El diálogo de consentimiento de grabación solo se pinta en la página del
  // propio canal (ver VoiceRoom): si hay una pregunta pendiente y no se está
  // ahí, no basta con la barra normal — nadie puede contestar algo que no ve,
  // y sin respuesta la grabación se queda esperando para siempre.
  if (room.prompt && !onOwnPage) {
    return (
      <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        <Link
          href={channelHref}
          className="presionable cristal flex items-center gap-2.5 rounded-full border-danger/40
            bg-danger/12 px-4 py-2.5 text-sm text-danger
            shadow-[0_0_0_1px_rgb(251_113_133/0.3),0_0_28px_-6px_rgb(251_113_133/0.5)]"
        >
          <Circle size={9} className="animate-pulse-slow fill-current" aria-hidden />
          Hace falta tu permiso para grabar en «{activeChannelName}»
        </Link>
      </div>
    );
  }

  if (onOwnPage) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="cristal flex items-center gap-1 rounded-full py-1.5 pl-3.5 pr-1.5">
        {/* El punto en directo, no el icono de radio: un círculo que late dice
            «hay una llamada abierta» sin competir con los iconos de los
            controles, que es lo que hay que poder distinguir de un vistazo. */}
        <span className="relative mr-1 flex size-2 shrink-0 items-center justify-center" aria-hidden>
          <span className="absolute size-2 animate-pulse-slow rounded-full bg-live" />
          <span className="size-2 rounded-full bg-live shadow-[0_0_10px_rgb(52_211_153/0.9)]" />
        </span>

        <Link
          href={channelHref}
          className="max-w-40 truncate font-display text-sm font-medium tracking-tight
            transition-colors duration-150 hover:text-accent-bright"
        >
          {activeChannelName}
        </Link>

        {elapsed && (
          <span className="ml-1 font-mono text-xs tabular-nums text-muted">{elapsed}</span>
        )}

        <span className="mx-1.5 h-5 w-px shrink-0 bg-line-strong" aria-hidden />

        <SpotifyWidget channelId={activeChannelId} panelDirection="up" />

        <BotonIcono
          etiqueta={room.muted ? "Activar micrófono" : "Silenciar"}
          onClick={room.toggleMute}
          className={room.muted ? "!bg-warn/15 !text-warn" : ""}
        >
          {room.muted ? <MicOff size={14} /> : <Mic size={14} />}
        </BotonIcono>

        <BotonIcono
          etiqueta="Colgar"
          onClick={leaveChannel}
          className="!bg-danger/90 !text-canvas hover:!bg-danger"
        >
          <PhoneOff size={14} />
        </BotonIcono>
      </div>
    </div>
  );
}
