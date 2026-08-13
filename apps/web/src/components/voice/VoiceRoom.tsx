"use client";

import { AlertTriangle, Mic, MicOff, PhoneOff, Radio, ShieldCheck } from "lucide-react";
import type { Channel } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useVoiceRoom } from "@/lib/voice/useVoiceRoom";
import { ParticipantTile } from "./ParticipantTile";

export function VoiceRoom({ channel }: { channel: Channel }) {
  const { user } = useSession();
  const room = useVoiceRoom(channel.id);

  const inRoom = room.status === "live" || room.status === "connecting";

  return (
    <section className="rounded-2xl border border-line bg-surface/60 p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Radio size={15} className={room.status === "live" ? "text-live" : "text-faint"} />
            Sala de voz
            {room.status === "live" && (
              <span className="rounded-full bg-live/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-live">
                en directo
              </span>
            )}
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-faint">
            <ShieldCheck size={12} />
            Cifrada entre pares con DTLS-SRTP. El audio no pasa por ningún servidor de DevUP —
            y por eso mismo no se puede grabar desde el servidor.
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={room.toggleMute}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                room.muted
                  ? "border-warn/40 bg-warn/10 text-warn"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              {room.muted ? <MicOff size={15} /> : <Mic size={15} />}
              {room.muted ? "Silenciado" : "Micrófono"}
            </button>
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

      {inRoom && !room.turnConfigured && (
        // El aviso importa: sin TURN la señalización conecta y parece que todo
        // va bien, pero en NAT simétrico y en buena parte de las redes móviles
        // el audio no llega nunca. Es el fallo número uno de este tipo de
        // sistema y el más difícil de diagnosticar sin una pista.
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Sin servidor TURN configurado. Entre dos equipos de la misma red funciona; a través
            de redes móviles o con NAT simétrico la llamada conectará pero no se oirá nada.
            Configura <code className="font-mono">NEXT_PUBLIC_TURN_URL</code> antes de usar esto
            fuera de la oficina.
          </span>
        </p>
      )}

      {!inRoom ? (
        <p className="py-10 text-center text-sm text-faint">
          Nadie ha abierto la sala todavía. La malla aguanta bien hasta unas seis personas.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            <ParticipantTile
              participant={{
                displayName: user?.displayName ?? "Tú",
                muted: room.muted,
                connectionState: "connected",
              }}
              isSelf
              stream={room.localStream}
            />
            {room.participants.map((participant) => (
              <ParticipantTile
                key={participant.peerId}
                participant={participant}
                stream={participant.stream}
              />
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

          {room.participants.length >= 6 && (
            <p className="mt-4 text-xs text-warn">
              Sois {room.participants.length + 1}. Por encima de seis, cada equipo sube su audio
              una vez por participante y la calidad se degrada: es el momento de plantear un SFU.
            </p>
          )}
        </>
      )}
    </section>
  );
}
