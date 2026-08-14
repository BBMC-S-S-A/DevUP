"use client";

import { Loader2, Mic, MicOff, MonitorUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Participant } from "@/lib/voice/useVoiceRoom";
import { useSpeaking } from "@/lib/voice/useSpeaking";

export function ParticipantTile({
  participant,
  isSelf = false,
  stream,
}: {
  participant: Pick<Participant, "displayName" | "muted" | "connectionState" | "camera" | "sharing">;
  isSelf?: boolean;
  stream: MediaStream | null;
}) {
  const media = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  // El indicador de voz se calcula sobre la propia pista… salvo que esté
  // silenciada: quien se ha silenciado no debe aparecer hablando aunque el
  // micrófono siga captando.
  const speaking = useSpeaking(stream, !participant.muted);

  useEffect(() => {
    if (!stream) {
      setHasVideo(false);
      return;
    }

    const sync = () => setHasVideo(stream.getVideoTracks().some((t) => t.readyState === "live"));
    sync();

    // Encender la cámara a mitad de llamada añade una pista al stream que ya
    // teníamos. Sin escuchar estos eventos, el recuadro seguiría enseñando las
    // iniciales con el vídeo llegando por detrás.
    stream.addEventListener("addtrack", sync);
    stream.addEventListener("removetrack", sync);
    return () => {
      stream.removeEventListener("addtrack", sync);
      stream.removeEventListener("removetrack", sync);
    };
  }, [stream]);

  useEffect(() => {
    const element = media.current;
    if (!element || !stream) return;
    element.srcObject = stream;
    void element.play().catch(() => {});
    return () => {
      element.srcObject = null;
    };
  }, [stream, hasVideo]);

  const connecting = !isSelf && participant.connectionState !== "connected";

  const initials = participant.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <li
      className={`relative flex flex-col overflow-hidden rounded-2xl border bg-surface transition ${
        speaking ? "border-live/60 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]" : "border-line"
      }`}
    >
      <div className="relative grid aspect-video place-items-center bg-canvas">
        {hasVideo ? (
          <video
            ref={media}
            autoPlay
            playsInline
            // El vídeo propio se refleja como un espejo: es lo que espera
            // cualquiera que se vea a sí mismo. El de los demás, no.
            muted={isSelf}
            className={`size-full ${participant.sharing ? "object-contain" : "object-cover"} ${
              isSelf && !participant.sharing ? "-scale-x-100" : ""
            }`}
          />
        ) : (
          <>
            <div
              className={`grid size-14 place-items-center rounded-full text-base font-medium transition ${
                speaking ? "bg-live/20 text-live" : "bg-raised text-muted"
              }`}
            >
              {initials || "?"}
            </div>
            {/* Sin vídeo sigue haciendo falta un elemento que reproduzca el
                audio del otro extremo. */}
            {!isSelf && <video ref={media} autoPlay playsInline className="hidden" />}
          </>
        )}

        {participant.sharing && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-canvas/80 px-1.5 py-0.5 text-[10px] text-accent">
            <MonitorUp size={10} />
            pantalla
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 truncate text-xs">
          {participant.displayName}
          {isSelf && <span className="ml-1 text-faint">(tú)</span>}
        </span>

        <span className="flex shrink-0 items-center gap-1 text-[11px] text-faint">
          {connecting ? (
            <>
              <Loader2 size={11} className="animate-spin" />
              {participant.connectionState === "failed" ? "sin conexión" : "conectando"}
            </>
          ) : participant.muted ? (
            <MicOff size={12} className="text-warn" />
          ) : (
            <Mic size={12} className={speaking ? "text-live" : ""} />
          )}
        </span>
      </div>
    </li>
  );
}
