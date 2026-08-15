"use client";

import { Loader2, Mic, MicOff, MonitorUp } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import type { Participant } from "@/lib/voice/useVoiceRoom";
import { useSpeaking } from "@/lib/voice/useSpeaking";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/**
 * Reproduce el audio de un participante remoto — una sola vez por persona,
 * sin importar cuántos recuadros de vídeo tenga a la vez (cámara y pantalla
 * son streams sin audio; la voz vive aparte). Sin esto, tener las dos vías
 * encendidas duplicaría el audio si cada recuadro reprodujera el suyo.
 */
function HiddenAudio({ stream }: { stream: MediaStream | null }) {
  const media = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = media.current;
    if (!element || !stream) return;
    element.srcObject = stream;
    void element.play().catch(() => {});
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  if (!stream) return null;
  return <video ref={media} autoPlay playsInline className="hidden" />;
}

/**
 * Todos los recuadros de un participante: uno por vía de vídeo activa
 * (cámara, pantalla — pueden estar las dos a la vez), o uno solo con sus
 * iniciales si no tiene ninguna. Cada recuadro se pinta con `ParticipantTile`;
 * aquí solo se decide cuántos hacen falta y se calcula si está hablando una
 * sola vez para que los dos coincidan.
 */
export function ParticipantVideos({
  participant,
  isSelf = false,
}: {
  participant: Pick<
    Participant,
    | "displayName"
    | "muted"
    | "connectionState"
    | "camera"
    | "sharing"
    | "audioStream"
    | "cameraStream"
    | "screenStream"
  >;
  isSelf?: boolean;
}) {
  const speaking = useSpeaking(participant.audioStream, !participant.muted);

  const tiles: { key: string; kind: "camera" | "screen" | "voice"; videoStream: MediaStream | null }[] =
    [];
  if (participant.camera) {
    tiles.push({ key: "camera", kind: "camera", videoStream: participant.cameraStream });
  }
  if (participant.sharing) {
    tiles.push({ key: "screen", kind: "screen", videoStream: participant.screenStream });
  }
  if (tiles.length === 0) tiles.push({ key: "voice", kind: "voice", videoStream: null });

  return (
    <>
      {!isSelf && <HiddenAudio stream={participant.audioStream} />}
      {tiles.map((tile) => (
        <ParticipantTile
          key={tile.key}
          kind={tile.kind}
          displayName={participant.displayName}
          isSelf={isSelf}
          muted={participant.muted}
          connectionState={participant.connectionState}
          speaking={speaking}
          videoStream={tile.videoStream}
        />
      ))}
    </>
  );
}

function ParticipantTile({
  kind,
  displayName,
  isSelf,
  muted,
  connectionState,
  speaking,
  videoStream,
}: {
  kind: "camera" | "screen" | "voice";
  displayName: string;
  isSelf: boolean;
  muted: boolean;
  connectionState: Participant["connectionState"];
  speaking: boolean;
  videoStream: MediaStream | null;
}) {
  const media = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState({ scale: MIN_ZOOM, x: 0, y: 0 });
  const dragging = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );

  useEffect(() => {
    const element = media.current;
    if (!element || !videoStream) return;
    element.srcObject = videoStream;
    void element.play().catch(() => {});
    return () => {
      element.srcObject = null;
    };
  }, [videoStream]);

  // Cambiar de stream (p. ej. dejar de compartir y volver a compartir)
  // reinicia el encuadre: conservar el zoom de un vídeo que ya no es ese no
  // tendría sentido.
  useEffect(() => {
    setZoom({ scale: MIN_ZOOM, x: 0, y: 0 });
  }, [videoStream]);

  const hasVideo = kind !== "voice" && videoStream !== null;
  const zoomed = zoom.scale > MIN_ZOOM;

  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  const connecting = !isSelf && connectionState !== "connected";

  // React 19 registra el listener nativo de `wheel` que hay detrás de
  // `onWheel` como pasivo — `preventDefault()` ahí es un no-op silencioso, y
  // la página se desplaza por debajo mientras se intenta hacer zoom. Con
  // `addEventListener` a mano y `{ passive: false }` sí se puede cancelar de
  // verdad.
  useEffect(() => {
    const element = frame.current;
    if (!element || !hasVideo) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.scale - event.deltaY * 0.0025));
        // Al volver al mínimo se recentra: si no, un desplazamiento que ya no
        // se ve (porque el zoom que lo justificaba desapareció) queda
        // invisible pero sigue ahí, listo para sorprender la próxima vez que
        // se acerque.
        return next <= MIN_ZOOM ? { scale: MIN_ZOOM, x: 0, y: 0 } : { ...current, scale: next };
      });
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [hasVideo]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!hasVideo || !zoomed) return;
    dragging.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: zoom.x,
      originY: zoom.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragging.current;
    if (!drag) return;
    setZoom((current) => ({
      ...current,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    }));
  };

  const stopDragging = () => {
    dragging.current = null;
  };

  const resetZoom = () => setZoom({ scale: MIN_ZOOM, x: 0, y: 0 });

  return (
    <li
      className={`relative flex flex-col overflow-hidden rounded-2xl border bg-surface transition ${
        speaking ? "border-live/60 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]" : "border-line"
      }`}
    >
      <div
        ref={frame}
        className={`relative grid aspect-video place-items-center overflow-hidden bg-canvas ${
          !hasVideo ? "" : zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDragging}
        onPointerLeave={stopDragging}
        onDoubleClick={hasVideo ? resetZoom : undefined}
      >
        {hasVideo ? (
          <video
            ref={media}
            autoPlay
            playsInline
            // El vídeo propio se refleja como un espejo: es lo que espera
            // cualquiera que se vea a sí mismo. El de los demás, y la
            // pantalla compartida (aunque sea la propia), no.
            muted={isSelf}
            style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }}
            className={`size-full select-none ${kind === "screen" ? "object-contain" : "object-cover"} ${
              isSelf && kind === "camera" ? "-scale-x-100" : ""
            }`}
          />
        ) : (
          <div
            className={`grid size-14 place-items-center rounded-full text-base font-medium transition ${
              speaking ? "bg-live/20 text-live" : "bg-raised text-muted"
            }`}
          >
            {initials || "?"}
          </div>
        )}

        {kind === "screen" && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-canvas/80 px-1.5 py-0.5 text-[10px] text-accent">
            <MonitorUp size={10} />
            pantalla
          </span>
        )}

        {hasVideo && zoomed && (
          <span className="absolute bottom-2 right-2 rounded-md bg-canvas/80 px-1.5 py-0.5 text-[10px] text-faint">
            {Math.round(zoom.scale * 100)}% · doble clic para restablecer
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 truncate text-xs">
          {displayName}
          {isSelf && <span className="ml-1 text-faint">(tú)</span>}
          {kind === "camera" && <span className="ml-1 text-faint">· cámara</span>}
        </span>

        <span className="flex shrink-0 items-center gap-1 text-[11px] text-faint">
          {connecting ? (
            <>
              <Loader2 size={11} className="animate-spin" />
              {connectionState === "failed" ? "sin conexión" : "conectando"}
            </>
          ) : muted ? (
            <MicOff size={12} className="text-warn" />
          ) : (
            <Mic size={12} className={speaking ? "text-live" : ""} />
          )}
        </span>
      </div>
    </li>
  );
}
