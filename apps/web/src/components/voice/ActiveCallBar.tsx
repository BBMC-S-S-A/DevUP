"use client";

import { Circle, Mic, MicOff, PhoneOff, Radio } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useElapsed } from "@/lib/voice/useElapsed";
import { useVoiceCall } from "@/lib/voice/VoiceCallProvider";

/**
 * Se ve en cualquier página de la app mientras hay una llamada activa en la
 * que no se está viendo la sala en este momento — en la propia página del
 * canal ya están los controles completos, y duplicarlos aquí solo confundiría
 * sobre cuál es el botón que manda.
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
          className="flex items-center gap-2 rounded-full border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger shadow-lg transition hover:brightness-110"
        >
          <Circle size={10} className="animate-pulse-slow fill-current" />
          Hace falta tu permiso para grabar en «{activeChannelName}»
        </Link>
      </div>
    );
  }

  if (onOwnPage) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 shadow-lg">
        <Radio size={14} className="text-live" />
        <Link
          href={channelHref}
          className="max-w-40 truncate text-sm font-medium hover:underline"
        >
          {activeChannelName}
        </Link>
        {elapsed && <span className="font-mono text-xs tabular-nums text-muted">{elapsed}</span>}

        <button
          type="button"
          onClick={room.toggleMute}
          title={room.muted ? "Activar micrófono" : "Silenciar"}
          className={`rounded-full p-1.5 transition ${
            room.muted ? "bg-warn/15 text-warn" : "text-muted hover:text-ink"
          }`}
        >
          {room.muted ? <MicOff size={14} /> : <Mic size={14} />}
        </button>

        <button
          type="button"
          onClick={leaveChannel}
          title="Colgar"
          className="rounded-full bg-danger/90 p-1.5 text-canvas transition hover:brightness-110"
        >
          <PhoneOff size={14} />
        </button>
      </div>
    </div>
  );
}
