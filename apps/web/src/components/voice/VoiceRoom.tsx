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
import type { ReactNode } from "react";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Chip, EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import type { Channel } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useElapsed } from "@/lib/voice/useElapsed";
import { useVoiceCall } from "@/lib/voice/VoiceCallProvider";
import { ParticipantVideos } from "./ParticipantTile";

export function VoiceRoom({ channel }: { channel: Channel }) {
  const { user } = useSession();
  const { room, activeChannelId, joinChannel, leaveChannel } = useVoiceCall();
  const elapsed = useElapsed(room.startedAt);

  // La llamada vive fuera de esta página (ver VoiceCallProvider): puede haber
  // una activa en OTRO canal mientras se mira este. `room` refleja siempre la
  // que esté activa, así que sin esta comprobación este canal mostraría los
  // controles de una llamada que en realidad es de otro.
  const isThisChannel = activeChannelId === channel.id;
  const inRoom = isThisChannel && (room.status === "live" || room.status === "connecting");
  const total = room.participants.length + 1;
  const spotlightScreen = inRoom && (room.sharing || room.participants.some((p) => p.sharing));

  return (
    // El halo del panel es la señal de «aquí está pasando algo»: se enciende
    // solo cuando la llamada en directo es la de ESTE canal, y con transición
    // para que encenderse se note como un instrumento y no como un salto.
    <section
      className={`panel relative overflow-hidden rounded-2xl
        transition-[box-shadow,border-color] duration-[260ms] ease-[var(--ease-out)]
        ${inRoom && room.status === "live" ? "panel-vivo" : ""}`}
    >
      <header className="rejilla filo-luz relative px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-lg border
                  transition-colors duration-[200ms] ease-[var(--ease-out)] ${
                    room.status === "live"
                      ? "border-live/40 bg-live/10 text-live"
                      : "border-line bg-raised text-faint"
                  }`}
              >
                <Radio size={14} />
              </span>
              <h2 className="text-sm font-semibold">Sala de voz</h2>

              {room.status === "live" && (
                <>
                  <Chip tono="live">
                    <span aria-hidden className="size-1.5 animate-pulse-slow rounded-full bg-live" />
                    en directo
                  </Chip>
                  {room.recording.active && (
                    <Chip tono="danger">
                      <Circle size={7} className="animate-pulse-slow fill-current" />
                      grabando
                    </Chip>
                  )}
                </>
              )}
            </div>

            {room.status === "live" && (
              <div className="mt-3 flex flex-wrap items-end gap-4">
                <Lectura rotulo="tiempo">
                  <span className="texto-plasma text-base">{elapsed ?? "0:00"}</span>
                </Lectura>

                {/* El recuento y la carga de vídeo describen ESTA sala, así que
                    solo se enseñan cuando la llamada activa es la de aquí. */}
                {inRoom && (
                  <>
                    <Separador />
                    <Lectura rotulo="en sala">{total}</Lectura>
                    <Separador />
                    <Lectura rotulo="cámaras" tono={room.videoStrain >= 4 ? "text-warn" : undefined}>
                      {room.videoStrain}
                    </Lectura>
                  </>
                )}
              </div>
            )}
          </div>

          {!inRoom ? (
            <Boton
              variante="primario"
              icono={<Mic size={15} />}
              onClick={() => joinChannel(channel.id, channel.workspaceId, channel.name)}
            >
              Entrar
            </Boton>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {/* Botonera de cabina: los interruptores de estado viven juntos
                  dentro de un mismo raíl y colgar queda fuera, en rojo macizo.
                  Que el botón irreversible no comparta forma con los demás es
                  lo que impide pulsarlo por inercia. */}
              <div className="flex items-center gap-1 rounded-2xl border border-line bg-canvas/50 p-1">
                <Control
                  activo={room.muted}
                  tono="warn"
                  onClick={room.toggleMute}
                  icono={room.muted ? <MicOff size={15} /> : <Mic size={15} />}
                  etiqueta={room.muted ? "Silenciado" : "Micrófono"}
                  aria={room.muted ? "Activar el micrófono" : "Silenciar el micrófono"}
                />
                <Control
                  activo={room.cameraOn}
                  presionado={room.cameraOn}
                  onClick={() => void room.toggleCamera()}
                  icono={room.cameraOn ? <Video size={15} /> : <VideoOff size={15} />}
                  etiqueta="Cámara"
                  aria="Cámara"
                />
                <Control
                  activo={room.sharing}
                  presionado={room.sharing}
                  onClick={() => void room.toggleScreenShare()}
                  icono={<MonitorUp size={15} />}
                  etiqueta="Pantalla"
                  aria="Compartir pantalla"
                />

                <span aria-hidden className="mx-0.5 h-6 w-px bg-line" />

                {room.recording.saving ? (
                  <Inerte icono={<Loader2 size={14} className="animate-spin" />}>Guardando</Inerte>
                ) : room.recording.active && room.recording.mine ? (
                  <Control
                    activo
                    tono="danger"
                    onClick={room.stopRecording}
                    icono={<Square size={13} className="fill-current" />}
                    etiqueta="Detener"
                    aria="Detener la grabación"
                  />
                ) : room.recording.awaitingConsent ? (
                  <Inerte icono={<Loader2 size={14} className="animate-spin" />}>
                    Esperando permiso
                  </Inerte>
                ) : !room.recording.active ? (
                  <Control
                    onClick={room.startRecording}
                    // El punto rojo hasta apagado: es el único lenguaje que
                    // todo el mundo lee como «grabar» sin pensarlo.
                    icono={<Circle size={11} className="fill-danger text-danger" />}
                    etiqueta="Grabar"
                    aria="Grabar la llamada"
                  />
                ) : null}
              </div>

              <button
                type="button"
                onClick={leaveChannel}
                aria-label="Colgar y salir de la sala"
                className="presionable flex h-11 items-center gap-2 rounded-2xl bg-danger px-4
                  font-display text-[11px] font-semibold uppercase tracking-wider text-canvas
                  shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_6px_20px_-8px_rgb(251_113_133/0.8)]
                  hover:brightness-110"
              >
                <PhoneOff size={16} />
                Colgar
              </button>
            </div>
          )}
        </div>

        <p className="mt-3 flex max-w-3xl items-start gap-1.5 text-xs leading-relaxed text-muted">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-faint" />
          <span>
            Cifrada entre pares con DTLS-SRTP. El audio no pasa por ningún servidor de DevUP, así
            que solo se puede grabar desde el navegador de alguien que esté dentro — y con permiso
            de todos.
          </span>
        </p>
      </header>

      <div className="px-5 py-5 sm:px-6">
        <div className="mb-4 space-y-2 empty:hidden">
          {room.error && (
            <Aviso tono="danger" titulo="fallo" icono={<AlertTriangle size={14} />}>
              {room.error}
            </Aviso>
          )}

          {room.notice && (
            <Aviso tono="neutro" icono={<Info size={14} />} onCerrar={room.dismissNotice}>
              {room.notice}
            </Aviso>
          )}

          {inRoom && !room.turnConfigured && (
            // Sin TURN la llamada conecta y parece que todo va bien, pero en NAT
            // simétrico y en buena parte de las redes móviles el audio no llega
            // nunca. Es el fallo número uno de este tipo de sistema y el más
            // difícil de diagnosticar sin una pista.
            <Aviso tono="warn" titulo="sin servidor TURN" icono={<AlertTriangle size={14} />}>
              Entre dos equipos de la misma red funciona; a través de redes móviles o con NAT
              simétrico la llamada conectará pero no se oirá nada. Configura{" "}
              <code className="font-mono text-[11px] text-ink">NEXT_PUBLIC_TURN_URL</code> antes de
              usar esto fuera de la oficina.
            </Aviso>
          )}

          {inRoom && room.videoStrain >= 4 && (
            <Aviso tono="warn" titulo="malla cargada" icono={<AlertTriangle size={14} />}>
              Hay {room.videoStrain} cámaras encendidas. En una malla cada equipo sube su vídeo una
              vez por participante, así que a partir de aquí la calidad se degrada. Apagar alguna
              cámara ayuda más que bajar la resolución.
            </Aviso>
          )}
        </div>

        {!inRoom ? (
          <EstadoVacio
            icono={<Radio size={20} />}
            titulo="Nadie ha abierto la sala todavía"
            pista="La malla aguanta bien hasta unas seis personas solo con voz, y unas cuatro con cámara."
          />
        ) : (
          <>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
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
                spotlightScreen={spotlightScreen}
              />
              {room.participants.map((participant, indice) => (
                <ParticipantVideos
                  key={participant.peerId}
                  participant={participant}
                  spotlightScreen={spotlightScreen}
                  indice={indice + 1}
                />
              ))}
            </ul>

            {room.devices.length > 1 && (
              <label className="mt-5 inline-flex items-center gap-2">
                <Rotulo>micrófono</Rotulo>
                <select
                  onChange={(event) => void room.switchDevice(event.target.value)}
                  className="h-9 rounded-xl border border-line bg-canvas/60 px-3 text-xs text-muted outline-none
                    transition-[border-color,box-shadow] duration-200
                    hover:border-line-strong
                    focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--anillo-foco)]"
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
              <div className="mt-4">
                <Aviso tono="warn" titulo="malla al límite" icono={<AlertTriangle size={14} />}>
                  Sois {total}. Por encima de seis, cada equipo sube su audio una vez por
                  participante y la calidad se degrada: es el momento de plantear un SFU.
                </Aviso>
              </div>
            )}
          </>
        )}
      </div>

      {inRoom && room.prompt && (
        <ConsentDialog
          prompt={room.prompt}
          onAnswer={room.answerRecordingPrompt}
          onLeave={leaveChannel}
        />
      )}
    </section>
  );
}

/** Lectura de instrumento: rótulo pequeño encima, cifra en mono debajo. */
function Lectura({
  rotulo,
  tono = "text-ink",
  children,
}: {
  rotulo: string;
  tono?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <Rotulo>{rotulo}</Rotulo>
      <span className={`font-mono text-sm font-medium leading-none tabular-nums ${tono}`}>
        {children}
      </span>
    </div>
  );
}

function Separador() {
  return <span aria-hidden className="h-7 w-px bg-line" />;
}

/**
 * Interruptor de la botonera. No es `Boton` porque lo que tiene que comunicar
 * no es «pulsa aquí» sino un estado encendido/apagado, y para eso el color de
 * relleno es la única señal que se lee de un vistazo.
 *
 * La etiqueta se esconde en pantallas estrechas, pero `aria` va siempre: el
 * icono solo nunca puede quedarse sin nombre.
 */
function Control({
  activo = false,
  tono = "accent",
  presionado,
  onClick,
  icono,
  etiqueta,
  aria,
}: {
  activo?: boolean;
  tono?: "accent" | "warn" | "danger";
  presionado?: boolean;
  onClick: () => void;
  icono: ReactNode;
  etiqueta: string;
  aria: string;
}) {
  const tonos = {
    accent: "border-accent/40 bg-accent-soft text-accent-bright",
    warn: "border-warn/40 bg-warn/10 text-warn",
    danger: "border-danger/40 bg-danger/10 text-danger",
  }[tono];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aria}
      aria-pressed={presionado}
      title={aria}
      className={`presionable flex h-9 items-center gap-2 rounded-xl border px-3
        font-display text-[11px] font-semibold uppercase tracking-wider ${
          activo ? tonos : "border-transparent text-muted hover:bg-raised hover:text-ink"
        }`}
    >
      {icono}
      <span className="hidden sm:inline">{etiqueta}</span>
    </button>
  );
}

/** Hueco de la botonera cuando el mando no se puede pulsar: mismo sitio, misma
    altura, sin aspecto de botón. Mover los de al lado sería peor. */
function Inerte({ icono, children }: { icono: ReactNode; children: ReactNode }) {
  return (
    <span
      className="flex h-9 items-center gap-2 rounded-xl px-3 font-display text-[11px] font-semibold
        uppercase tracking-wider text-faint"
    >
      {icono}
      {children}
    </span>
  );
}

/**
 * Aviso de la sala. Todos comparten forma para que el color sea lo único que
 * cambie: rojo es un fallo, ámbar es una limitación de la malla, gris es
 * información. El rótulo de arriba da el titular en una ojeada.
 */
function Aviso({
  tono,
  titulo,
  icono,
  onCerrar,
  children,
}: {
  tono: "danger" | "warn" | "neutro";
  titulo?: string;
  icono: ReactNode;
  onCerrar?: () => void;
  children: ReactNode;
}) {
  const tonos = {
    danger: "border-danger/30 bg-danger/10 text-danger",
    warn: "border-warn/30 bg-warn/10 text-warn",
    neutro: "border-line bg-raised/70 text-muted",
  }[tono];

  return (
    <div className={`devup-entrada flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${tonos}`}>
      <span className="mt-0.5 shrink-0">{icono}</span>
      <div className="min-w-0 flex-1">
        {titulo && (
          <span className="mb-0.5 block font-display text-[10px] font-semibold uppercase tracking-[0.18em] opacity-75">
            {titulo}
          </span>
        )}
        <p className="text-xs leading-relaxed">{children}</p>
      </div>
      {onCerrar && (
        <BotonIcono etiqueta="Descartar el aviso" onClick={onCerrar} className="-my-1 -mr-1 size-6">
          <X size={13} />
        </BotonIcono>
      )}
    </div>
  );
}

/**
 * Nadie queda grabado sin haber dicho que sí.
 *
 * El diálogo bloquea y no se puede cerrar: las dos salidas son aceptar o irse
 * de la llamada. Un «quizá luego» dejaría a alguien dentro de una grabación
 * que no ha autorizado, que es exactamente lo que esto existe para evitar. Por
 * eso tampoco usa el `Dialogo` de las primitivas: aquel cierra con Escape y
 * con clic fuera, que aquí serían dos formas de no contestar.
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
  const titulo = prompt.alreadyRunning
    ? "Esta llamada se está grabando"
    : "Petición para grabar";

  return (
    <div className="devup-velo absolute inset-0 z-50 grid place-items-center bg-canvas/80 p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="devup-dialogo cristal-denso w-full max-w-md rounded-2xl p-5"
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-danger/40 bg-danger/10 text-danger">
            <Circle size={9} className="animate-pulse-slow fill-current" />
          </span>
          <h3 className="text-sm font-semibold">{titulo}</h3>
        </div>

        <p className="mb-2 text-sm leading-relaxed text-muted">
          {prompt.alreadyRunning ? (
            <>
              <strong className="font-medium text-ink">{prompt.displayName}</strong> está grabando la
              llamada a la que acabas de entrar.
            </>
          ) : (
            <>
              <strong className="font-medium text-ink">{prompt.displayName}</strong> quiere grabar
              esta llamada.
            </>
          )}
        </p>

        <p className="mb-5 text-xs leading-relaxed text-muted">
          La grabación se hace en su navegador y se guarda en la biblioteca de archivos del canal,
          donde la verá todo el que tenga acceso. Tu respuesta queda registrada. Si dices que no, no
          se grabará para nadie.
        </p>

        <div className="flex flex-wrap gap-2">
          <Boton variante="primario" className="flex-1" onClick={() => onAnswer(true)}>
            Acepto que se grabe
          </Boton>
          <Boton variante="secundario" onClick={() => onAnswer(false)}>
            No
          </Boton>
          <Boton variante="peligro" icono={<PhoneOff size={14} />} onClick={onLeave}>
            Salir
          </Boton>
        </div>
      </div>
    </div>
  );
}
