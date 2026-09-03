"use client";

import { AudioLines, Loader2, Mic, MicOff, MonitorUp } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Rotulo } from "@/components/ui/Superficies";
import type { Participant } from "@/lib/voice/useVoiceRoom";
import { useSpeaking } from "@/lib/voice/useSpeaking";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/**
 * El halo de «está hablando». Es el mismo valor que usa `.panel-vivo` para el
 * acento, pero en verde: en toda la aplicación el verde significa «esto está
 * pasando ahora mismo», y hablar es exactamente eso.
 *
 * Va en `style` y no en una utilidad de Tailwind porque `.panel` declara su
 * propia `box-shadow` sin capa, y una regla sin capa gana a cualquier utilidad.
 */
const HALO_HABLANDO: CSSProperties = { boxShadow: "var(--halo-live)" };

/**
 * Reproduce el audio de un participante remoto — una sola vez por persona,
 * sin importar cuántos recuadros de vídeo tenga a la vez (cámara y pantalla
 * son streams sin audio; la voz vive aparte). Sin esto, tener las dos vías
 * encendidas duplicaría el audio si cada recuadro reprodujera el suyo.
 */
// Exportado para que `SalaEspacial` reproduzca el audio igual: el elemento
// <audio> tiene que existir en el árbol o no se oye a nadie, y duplicarlo en
// dos sitios es tener dos formas de que deje de oírse.
export function HiddenAudio({ stream }: { stream: MediaStream | null }) {
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
  spotlightScreen = false,
  indice = 0,
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
  /** Con alguien compartiendo pantalla en la sala, ese recuadro se agranda. */
  spotlightScreen?: boolean;
  /** Posición en la rejilla. Solo sirve para escalonar la entrada. */
  indice?: number;
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
      {tiles.map((tile, posicion) => (
        <ParticipantTile
          key={tile.key}
          kind={tile.kind}
          displayName={participant.displayName}
          isSelf={isSelf}
          muted={participant.muted}
          connectionState={participant.connectionState}
          speaking={speaking}
          videoStream={tile.videoStream}
          spotlight={tile.kind === "screen" && spotlightScreen}
          // El índice se topa: en una sala de diez, el último recuadro no debe
          // entrar medio segundo después que el primero.
          retraso={(Math.min(indice, 8) + posicion) * 45}
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
  spotlight = false,
  retraso = 0,
}: {
  kind: "camera" | "screen" | "voice";
  displayName: string;
  isSelf: boolean;
  muted: boolean;
  connectionState: Participant["connectionState"];
  speaking: boolean;
  videoStream: MediaStream | null;
  spotlight?: boolean;
  retraso?: number;
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
  const failed = connectionState === "failed";

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
    // Sin `overflow-hidden` aquí a propósito: el halo de hablar se dibuja por
    // fuera del canto y un recorte lo dejaría en nada. Quien recorta el vídeo
    // es el marco de abajo, que ya lleva su propio radio.
    <li
      className={`panel devup-entrada relative flex flex-col rounded-2xl ${
        spotlight ? "col-span-full row-span-2 sm:col-span-2 lg:col-span-3" : ""
      }`}
      style={{ "--retraso": `${retraso}ms` } as CSSProperties}
    >
      {/*
        El halo se enciende cambiando solo la opacidad de esta capa. Interpolar
        una `box-shadow` entre «ninguna» y «halo» no da transición ninguna, y
        además la opacidad no obliga al navegador a rehacer el vídeo que hay
        debajo — con seis recuadros reproduciendo a la vez eso importa.
        El indicador ya viene con histéresis del hook: aquí no hace falta más
        amortiguación que los 260 ms de la propia transición.
      */}
      <span
        aria-hidden
        style={HALO_HABLANDO}
        className={`pointer-events-none absolute inset-0 z-10 rounded-2xl
          transition-opacity duration-[260ms] ease-[var(--ease-out)]
          ${speaking ? "opacity-100" : "opacity-0"}`}
      />

      <div
        ref={frame}
        className={`relative grid aspect-video place-items-center overflow-hidden rounded-t-2xl bg-canvas ${
          kind === "voice" ? "rejilla" : ""
        } ${!hasVideo ? "" : zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
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
            // Sin esto, la propia voz vuelve por el altavoz con retardo y
            // hablar se vuelve imposible.
            muted={isSelf}
            style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }}
            // El vídeo propio se refleja como un espejo: es lo que espera
            // cualquiera que se vea a sí mismo. El de los demás, y la pantalla
            // compartida (aunque sea la propia), no.
            className={`size-full select-none ${kind === "screen" ? "object-contain" : "object-cover"} ${
              isSelf && kind === "camera" ? "-scale-x-100" : ""
            }`}
          />
        ) : (
          <div
            className={`relative transition-transform duration-[260ms] ease-[var(--ease-out)]
              motion-reduce:transform-none ${speaking ? "scale-105" : ""}`}
          >
            <span
              aria-hidden
              style={HALO_HABLANDO}
              className={`pointer-events-none absolute inset-0 rounded-full
                transition-opacity duration-[260ms] ease-[var(--ease-out)]
                ${speaking ? "opacity-100" : "opacity-0"}`}
            />
            <div
              className={`grid size-16 place-items-center rounded-full border font-display text-lg font-semibold
                transition-colors duration-[260ms] ease-[var(--ease-out)] ${
                  speaking
                    ? "border-live/50 bg-live/15 text-live"
                    : "border-line-strong bg-raised text-muted"
                }`}
            >
              {initials || "?"}
            </div>
          </div>
        )}

        {kind === "screen" && (
          <span
            className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-lg border border-white/10
              bg-canvas/75 px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider
              text-accent-bright backdrop-blur-sm"
          >
            <MonitorUp size={10} />
            pantalla
          </span>
        )}

        {hasVideo && zoomed && (
          <span
            className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-lg border border-white/10
              bg-canvas/75 px-1.5 py-0.5 text-[10px] text-muted backdrop-blur-sm"
          >
            <span className="font-mono tabular-nums text-ink">{Math.round(zoom.scale * 100)}%</span>
            doble clic para restablecer
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-b-2xl bg-canvas/40 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-xs font-medium">{displayName}</span>
          {isSelf && <Rotulo>tú</Rotulo>}
          {kind === "camera" && <Rotulo>cámara</Rotulo>}
        </span>

        {connecting ? (
          <span
            className={`flex shrink-0 items-center gap-1 font-display text-[10px] font-semibold uppercase
              tracking-wider ${failed ? "text-danger" : "text-faint"}`}
          >
            {failed ? (
              <span aria-hidden className="size-1.5 rounded-full bg-danger" />
            ) : (
              <Loader2 size={11} className="animate-spin" />
            )}
            {failed ? "sin conexión" : "conectando"}
          </span>
        ) : muted ? (
          <span className="flex shrink-0 items-center text-warn">
            <MicOff size={13} />
            <span className="sr-only">Micrófono silenciado</span>
          </span>
        ) : (
          // La onda solo aparece mientras suena la voz: un icono que cambia
          // dice «está hablando» mucho antes que un color que cambia.
          <span
            className={`flex shrink-0 items-center transition-colors duration-[200ms] ease-[var(--ease-out)] ${
              speaking ? "text-live" : "text-faint"
            }`}
          >
            {speaking ? <AudioLines size={13} /> : <Mic size={13} />}
            <span className="sr-only">{speaking ? "Hablando" : "Micrófono abierto"}</span>
          </span>
        )}
      </div>
    </li>
  );
}
