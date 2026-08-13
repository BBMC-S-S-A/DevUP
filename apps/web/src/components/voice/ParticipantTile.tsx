"use client";

import { Loader2, Mic, MicOff } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Participant } from "@/lib/voice/useVoiceRoom";
import { useSpeaking } from "@/lib/voice/useSpeaking";

export function ParticipantTile({
  participant,
  isSelf = false,
  stream,
}: {
  participant: Pick<Participant, "displayName" | "muted" | "connectionState">;
  isSelf?: boolean;
  stream: MediaStream | null;
}) {
  const audio = useRef<HTMLAudioElement>(null);

  // El indicador de voz se calcula sobre la propia pista incluso cuando está
  // silenciada… salvo que lo esté: quien se ha silenciado no debe aparecer
  // hablando aunque el micrófono siga captando.
  const speaking = useSpeaking(stream, !participant.muted);

  useEffect(() => {
    const element = audio.current;
    if (!element || !stream || isSelf) return;
    element.srcObject = stream;
    // Puede fallar si el navegador aún no considera que hubo interacción.
    // Como para llegar aquí hay que haber pulsado «entrar», es raro, pero un
    // catch vacío es mejor que una excepción sin manejar en consola.
    void element.play().catch(() => {});
    return () => {
      element.srcObject = null;
    };
  }, [stream, isSelf]);

  // «completed» pertenece a iceConnectionState, no a connectionState: aquí los
  // estados posibles son new, connecting, connected, disconnected, failed y
  // closed.
  const connecting = !isSelf && participant.connectionState !== "connected";

  const initials = participant.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <li
      className={`relative flex flex-col items-center gap-3 rounded-2xl border bg-surface px-4 py-6 transition ${
        speaking ? "border-live/60 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]" : "border-line"
      }`}
    >
      <div
        className={`grid size-16 place-items-center rounded-full text-lg font-medium transition ${
          speaking ? "bg-live/20 text-live" : "bg-raised text-muted"
        }`}
      >
        {initials || "?"}
      </div>

      <div className="text-center">
        <p className="max-w-36 truncate text-sm">
          {participant.displayName}
          {isSelf && <span className="ml-1 text-xs text-faint">(tú)</span>}
        </p>
        <p className="mt-0.5 flex items-center justify-center gap-1 text-xs text-faint">
          {connecting ? (
            <>
              <Loader2 size={11} className="animate-spin" />
              {participant.connectionState === "failed" ? "sin conexión" : "conectando"}
            </>
          ) : participant.muted ? (
            <>
              <MicOff size={11} />
              silenciado
            </>
          ) : (
            <>
              <Mic size={11} className={speaking ? "text-live" : ""} />
              {speaking ? "hablando" : "en línea"}
            </>
          )}
        </p>
      </div>

      {/* El audio propio nunca se reproduce: se oiría a sí mismo con retardo. */}
      {!isSelf && <audio ref={audio} autoPlay playsInline />}
    </li>
  );
}
