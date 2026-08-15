"use client";

import {
  AlertTriangle,
  Circle,
  Info,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Radio,
  ShieldCheck,
  Square,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Channel } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useVoiceRoom } from "@/lib/voice/useVoiceRoom";
import { ParticipantVideos } from "./ParticipantTile";

/** Duración de la llamada, contada desde que se abrió la sesión en el servidor. */
function useElapsed(startedAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return null;

  // Quien entra a los diez minutos ve diez minutos, no cero: es la duración de
  // la llamada, no la suya.
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

export function VoiceRoom({ channel }: { channel: Channel }) {
  const { user } = useSession();
  const room = useVoiceRoom(channel.id, channel.workspaceId);
  const elapsed = useElapsed(room.startedAt);

  const inRoom = room.status === "live" || room.status === "connecting";
  const total = room.participants.length + 1;

  return (
    <section className="relative rounded-2xl border border-line bg-surface/60 p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Radio size={15} className={room.status === "live" ? "text-live" : "text-faint"} />
            Sala de voz
            {room.status === "live" && (
              <>
                <span className="rounded-full bg-live/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-live">
                  en directo
                </span>
                {elapsed && (
                  <span className="font-mono text-xs tabular-nums text-muted">{elapsed}</span>
                )}
                {room.recording.active && (
                  <span className="flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-danger">
                    <Circle size={7} className="animate-pulse-slow fill-current" />
                    grabando
                  </span>
                )}
              </>
            )}
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-faint">
            <ShieldCheck size={12} />
            Cifrada entre pares con DTLS-SRTP. El audio no pasa por ningún servidor de DevUP, así
            que solo se puede grabar desde el navegador de alguien que esté dentro — y con permiso
            de todos.
          </p>
        </div>

        {!inRoom ? (
          <button
            type="button"
            onClick={() => void room.join()}
            className="flex items-center gap-2 rounded-lg bg-live px-4 py-2 text-sm font-medium text-canvas transition hover:brightness-110"
          >
            <Mic size={15} />
            Entrar
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Control
              active={room.muted}
              activeTone="warn"
              onClick={room.toggleMute}
              icon={room.muted ? <MicOff size={15} /> : <Mic size={15} />}
              label={room.muted ? "Silenciado" : "Micrófono"}
            />
            <Control
              active={room.cameraOn}
              onClick={() => void room.toggleCamera()}
              icon={room.cameraOn ? <Video size={15} /> : <VideoOff size={15} />}
              label="Cámara"
            />
            <Control
              active={room.sharing}
              onClick={() => void room.toggleScreenShare()}
              icon={<MonitorUp size={15} />}
              label="Pantalla"
            />

            {room.recording.saving ? (
              <span className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-muted">
                <Loader2 size={15} className="animate-spin" />
                Guardando
              </span>
            ) : room.recording.active && room.recording.mine ? (
              <Control
                active
                activeTone="danger"
                onClick={room.stopRecording}
                icon={<Square size={14} className="fill-current" />}
                label="Detener"
              />
            ) : room.recording.awaitingConsent ? (
              <span className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-muted">
                <Loader2 size={15} className="animate-spin" />
                Esperando permiso
              </span>
            ) : !room.recording.active ? (
              <Control
                onClick={room.startRecording}
                icon={<Circle size={13} className="fill-current" />}
                label="Grabar"
              />
            ) : null}

            <button
              type="button"
              onClick={room.leave}
              className="flex items-center gap-2 rounded-lg bg-danger/90 px-3 py-2 text-sm font-medium text-canvas transition hover:brightness-110"
            >
              <PhoneOff size={15} />
              Colgar
            </button>
          </div>
        )}
      </header>

      {room.error && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {room.error}
        </p>
      )}

      {room.notice && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-muted">
          <Info size={15} className="mt-0.5 shrink-0" />
          <span className="flex-1">{room.notice}</span>
          <button type="button" onClick={room.dismissNotice} className="text-faint hover:text-ink">
            <X size={14} />
          </button>
        </p>
      )}

      {inRoom && !room.turnConfigured && (
        // Sin TURN la llamada conecta y parece que todo va bien, pero en NAT
        // simétrico y en buena parte de las redes móviles el audio no llega
        // nunca. Es el fallo número uno de este tipo de sistema y el más
        // difícil de diagnosticar sin una pista.
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Sin servidor TURN configurado. Entre dos equipos de la misma red funciona; a través de
            redes móviles o con NAT simétrico la llamada conectará pero no se oirá nada. Configura{" "}
            <code className="font-mono">NEXT_PUBLIC_TURN_URL</code> antes de usar esto fuera de la
            oficina.
          </span>
        </p>
      )}

      {inRoom && room.videoStrain >= 4 && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Hay {room.videoStrain} cámaras encendidas. En una malla cada equipo sube su vídeo una vez
          por participante, así que a partir de aquí la calidad se degrada. Apagar alguna cámara
          ayuda más que bajar la resolución.
        </p>
      )}

      {!inRoom ? (
        <p className="py-10 text-center text-sm text-faint">
          Nadie ha abierto la sala todavía. La malla aguanta bien hasta unas seis personas solo con
          voz, y unas cuatro con cámara.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            <ParticipantVideos
              participant={{
                displayName: user?.displayName ?? "Tú",
                muted: room.muted,
                camera: room.cameraOn,
                sharing: room.sharing,
                connectionState: "connected",
                audioStream: room.localAudioStream,
                cameraStream: room.localCameraStream,
                screenStream: room.localScreenStream,
              }}
              isSelf
            />
            {room.participants.map((participant) => (
              <ParticipantVideos key={participant.peerId} participant={participant} />
            ))}
          </ul>

          {room.devices.length > 1 && (
            <label className="mt-5 flex items-center gap-2 text-xs text-faint">
              Micrófono
              <select
                onChange={(event) => void room.switchDevice(event.target.value)}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-muted outline-none"
              >
                {room.devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || "Micrófono sin nombre"}
                  </option>
                ))}
              </select>
            </label>
          )}

          {total > 6 && (
            <p className="mt-4 text-xs text-warn">
              Sois {total}. Por encima de seis, cada equipo sube su audio una vez por participante
              y la calidad se degrada: es el momento de plantear un SFU.
            </p>
          )}
        </>
      )}

      {room.prompt && (
        <ConsentDialog
          prompt={room.prompt}
          onAnswer={room.answerRecordingPrompt}
          onLeave={room.leave}
        />
      )}
    </section>
  );
}

function Control({
  active = false,
  activeTone = "accent",
  onClick,
  icon,
  label,
}: {
  active?: boolean;
  activeTone?: "accent" | "warn" | "danger";
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  const tone = {
    accent: "border-accent/40 bg-accent-soft text-accent",
    warn: "border-warn/40 bg-warn/10 text-warn",
    danger: "border-danger/40 bg-danger/10 text-danger",
  }[activeTone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
        active ? tone : "border-line text-muted hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Nadie queda grabado sin haber dicho que sí.
 *
 * El diálogo bloquea y no se puede cerrar: las dos salidas son aceptar o irse
 * de la llamada. Un «quizá luego» dejaría a alguien dentro de una grabación
 * que no ha autorizado, que es exactamente lo que esto existe para evitar.
 *
 * El bloqueo es solo de la sala de voz — `absolute inset-0` sobre la
 * `<section>` de la llamada (que por eso lleva `relative`), no `fixed` sobre
 * toda la ventana. Antes tapaba también la barra lateral y el resto de
 * canales: no se podía ni mirar otra conversación mientras se contestaba.
 */
function ConsentDialog({
  prompt,
  onAnswer,
  onLeave,
}: {
  prompt: { recordingId: string; displayName: string; alreadyRunning: boolean };
  onAnswer: (granted: boolean) => void;
  onLeave: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center rounded-2xl bg-black/70 p-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6">
        <div className="mb-3 flex items-center gap-2 text-danger">
          <Circle size={12} className="fill-current" />
          <h3 className="text-sm font-semibold">
            {prompt.alreadyRunning ? "Esta llamada se está grabando" : "Petición para grabar"}
          </h3>
        </div>

        <p className="mb-2 text-sm text-muted">
          {prompt.alreadyRunning ? (
            <>
              <strong className="text-ink">{prompt.displayName}</strong> está grabando la llamada a
              la que acabas de entrar.
            </>
          ) : (
            <>
              <strong className="text-ink">{prompt.displayName}</strong> quiere grabar esta llamada.
            </>
          )}
        </p>

        <p className="mb-5 text-xs text-faint">
          La grabación se hace en su navegador y se guarda en la biblioteca de archivos del canal,
          donde la verá todo el que tenga acceso. Tu respuesta queda registrada. Si dices que no, no
          se grabará para nadie.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onAnswer(true)}
            className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-canvas transition hover:brightness-110"
          >
            Acepto que se grabe
          </button>
          <button
            type="button"
            onClick={() => onAnswer(false)}
            className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition hover:text-ink"
          >
            No
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition hover:text-danger"
          >
            Salir
          </button>
        </div>
      </div>
    </div>
  );
}
