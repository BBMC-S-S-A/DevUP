"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { buildWsUrl, requestTicket } from "../ws";
import { type RecordingHandle, createRecorder } from "./recorder";

/**
 * Sala de voz y vídeo en malla, sin servidor de medios.
 *
 * Cada participante se conecta directamente con cada otro; el servidor solo
 * reparte SDP y candidatos ICE. El audio y el vídeo nunca pasan por DevUP: van
 * cifrados entre pares con DTLS-SRTP. Eso hace que la sala sea de hecho
 * extremo a extremo — y por eso mismo no sea grabable desde el servidor. Las
 * dos cosas a la vez no existen, por mucho que se prometan juntas.
 *
 * Límite honesto: cada cliente sube su medio N−1 veces. Con solo voz la malla
 * aguanta unas seis personas; con cámara, cuatro. A partir de ahí toca un SFU,
 * y esa migración solo debería tocar este archivo.
 *
 * La dificultad real está en la negociación. Dos pares pueden ofrecer a la
 * vez, y sin un desempate acordado los dos se quedan colgados en
 * `have-local-offer` esperando una respuesta que nunca llega. Se implementa el
 * patrón de «negociación perfecta»: el cortés cede ante una colisión, el
 * descortés no. Cortés es el del peerId mayor — determinista y simétrico, los
 * dos extremos calculan lo mismo sin ponerse de acuerdo.
 *
 * Encender la cámara a mitad de llamada renegocia. No hace falta nada especial
 * para eso: `addTrack` dispara `onnegotiationneeded` y el mismo patrón que
 * resuelve la entrada resuelve también esto.
 */
export type Status = "idle" | "connecting" | "live" | "error";

export type Participant = {
  peerId: string;
  userId: string;
  displayName: string;
  muted: boolean;
  camera: boolean;
  sharing: boolean;
  stream: MediaStream | null;
  connectionState: RTCPeerConnectionState;
};

/** Petición de grabación pendiente de respuesta por mi parte. */
export type RecordingPrompt = {
  recordingId: string;
  displayName: string;
  /** true si la llamada ya se estaba grabando cuando entré. */
  alreadyRunning: boolean;
};

export type RecordingState = {
  /** Alguien está grabando ahora mismo. */
  active: boolean;
  recordingId: string | null;
  startedBy: string | null;
  /** Yo soy quien graba: mi navegador tiene el MediaRecorder. */
  mine: boolean;
  /** Pedí grabar y espero respuestas. */
  awaitingConsent: boolean;
  /** Subiendo el archivo al terminar. */
  saving: boolean;
};

type SignalPayload = {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

const IDLE_RECORDING: RecordingState = {
  active: false,
  recordingId: null,
  startedBy: null,
  mine: false,
  awaitingConsent: false,
  saving: false,
};

export function useVoiceRoom(channelId: string, workspaceId: string) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [selfPeerId, setSelfPeerId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Record<string, Participant>>({});
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [recording, setRecording] = useState<RecordingState>(IDLE_RECORDING);
  const [prompt, setPrompt] = useState<RecordingPrompt | null>(null);

  const socket = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const self = useRef<string | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const makingOffer = useRef(new Map<string, boolean>());
  const ignoreOffer = useRef(new Map<string, boolean>());
  const remoteStreams = useRef(new Map<string, MediaStream>());
  const recorder = useRef<RecordingHandle | null>(null);
  const leaving = useRef(false);

  // Los servidores ICE llegan de la API al entrar en la sala, no del bundle.
  // Ver apps/api/src/routes/ice.ts: una credencial de TURN en una variable
  // NEXT_PUBLIC_ sería un relé abierto para cualquiera que lea el JavaScript.
  const ice = useRef<RTCIceServer[]>([]);
  const [turnConfigured, setTurnConfigured] = useState(true);

  const emit = useCallback((message: Record<string, unknown>) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(message));
    }
  }, []);

  const upsert = useCallback((peerId: string, patch: Partial<Participant>) => {
    setParticipants((current) => {
      const existing = current[peerId] ?? {
        peerId,
        userId: "",
        displayName: "alguien",
        muted: false,
        camera: false,
        sharing: false,
        stream: null,
        connectionState: "new" as RTCPeerConnectionState,
      };
      return { ...current, [peerId]: { ...existing, ...patch } };
    });
  }, []);

  const dropPeer = useCallback((peerId: string) => {
    peers.current.get(peerId)?.close();
    peers.current.delete(peerId);
    makingOffer.current.delete(peerId);
    ignoreOffer.current.delete(peerId);
    const gone = remoteStreams.current.get(peerId);
    remoteStreams.current.delete(peerId);
    if (gone) recorder.current?.removeStream(gone);
    setParticipants((current) => {
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }, []);

  /**
   * Devuelve la conexión con un par, creándola si hace falta.
   *
   * Se llama desde dos sitios: al entrar (para los que ya estaban) y al
   * recibir una señal de alguien desconocido. Lo segundo no es defensivo por
   * si acaso — es imprescindible: la SDP de un par puede llegar antes que el
   * aviso de que ese par existe, y sin esto se descartaría y la llamada no se
   * establecería nunca.
   */
  const peerFor = useCallback(
    (remote: string): RTCPeerConnection => {
      const existing = peers.current.get(remote);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: ice.current });

      const local = stream.current;
      if (local) for (const track of local.getTracks()) pc.addTrack(track, local);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          emit({ type: "signal", to: remote, data: { candidate: event.candidate.toJSON() } });
        }
      };

      pc.ontrack = (event) => {
        const incoming = event.streams[0] ?? null;
        if (!incoming) return;
        // `ontrack` salta una vez por pista: al encender la cámara vuelve a
        // saltar con el mismo stream. Guardarlo por par y reasignarlo hace que
        // el vídeo aparezca sin tocar nada más.
        remoteStreams.current.set(remote, incoming);
        recorder.current?.addStream(incoming);
        upsert(remote, { stream: incoming });
      };

      pc.onnegotiationneeded = async () => {
        try {
          makingOffer.current.set(remote, true);
          // Sin argumento: el navegador crea la oferta apropiada al estado
          // actual. Es lo que hace que el patrón funcione al reintentar.
          await pc.setLocalDescription();
          emit({ type: "signal", to: remote, data: { description: pc.localDescription } });
        } catch {
          // Una negociación fallida se recupera sola en el siguiente evento.
        } finally {
          makingOffer.current.set(remote, false);
        }
      };

      pc.onconnectionstatechange = () => {
        upsert(remote, { connectionState: pc.connectionState });
        if (pc.connectionState === "failed") {
          // Casi siempre es un cambio de red (wifi a móvil). restartIce vuelve
          // a buscar camino sin rehacer la sesión entera.
          pc.restartIce();
        }
      };

      peers.current.set(remote, pc);
      return pc;
    },
    [emit, upsert],
  );

  const handleSignal = useCallback(
    async (from: string, data: SignalPayload) => {
      const pc = peerFor(from);
      const me = self.current;
      if (!me) return;

      // El cortés es el del peerId mayor.
      const polite = me > from;

      try {
        if (data.description) {
          const collision =
            data.description.type === "offer" &&
            (makingOffer.current.get(from) === true || pc.signalingState !== "stable");

          ignoreOffer.current.set(from, !polite && collision);
          if (ignoreOffer.current.get(from)) return;

          await pc.setRemoteDescription(data.description);
          if (data.description.type === "offer") {
            await pc.setLocalDescription();
            emit({ type: "signal", to: from, data: { description: pc.localDescription } });
          }
        } else if (data.candidate) {
          try {
            await pc.addIceCandidate(data.candidate);
          } catch (caught) {
            // Los candidatos de una oferta que decidimos ignorar llegan
            // igualmente y fallan; ahí el error es esperado.
            if (!ignoreOffer.current.get(from)) throw caught;
          }
        }
      } catch (caught) {
        console.warn("[voz] fallo negociando con", from, caught);
      }
    },
    [peerFor, emit],
  );

  // --- Grabación ------------------------------------------------------------
  /** Sube lo grabado a la biblioteca y lo enlaza con la llamada. */
  const saveRecording = useCallback(
    async (recordingId: string) => {
      const handle = recorder.current;
      recorder.current = null;
      if (!handle) return;

      setRecording((current) => ({ ...current, saving: true }));
      try {
        const file = await handle.stop();
        if (file.size === 0) return;

        const { uploadFile } = await import("../files/upload");
        const uploaded = await uploadFile(workspaceId, file, {
          channelId,
          description: "Grabación de llamada",
        });
        await api.post(`/recordings/${recordingId}/file`, { fileId: uploaded.id });
        setNotice(`Grabación guardada en la biblioteca como «${uploaded.name}».`);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? `no se pudo guardar la grabación: ${caught.message}`
            : "no se pudo guardar la grabación",
        );
      } finally {
        setRecording(IDLE_RECORDING);
      }
    },
    [workspaceId, channelId],
  );

  const startRecording = useCallback(() => {
    if (recording.active || recording.awaitingConsent) return;
    setRecording({ ...IDLE_RECORDING, awaitingConsent: true, mine: true });
    emit({ type: "recording-request" });
  }, [recording.active, recording.awaitingConsent, emit]);

  const stopRecording = useCallback(() => {
    emit({ type: "recording-stop" });
  }, [emit]);

  const answerRecordingPrompt = useCallback(
    (granted: boolean) => {
      if (!prompt) return;
      emit({ type: "recording-consent", recordingId: prompt.recordingId, granted });
      setPrompt(null);
    },
    [prompt, emit],
  );

  const leave = useCallback(() => {
    leaving.current = true;

    // Si estaba grabando, se descarta lo grabado: irse a mitad no es «guardar
    // lo que haya», es cancelar.
    void recorder.current?.stop().catch(() => {});
    recorder.current = null;

    for (const pc of peers.current.values()) pc.close();
    peers.current.clear();
    makingOffer.current.clear();
    ignoreOffer.current.clear();
    remoteStreams.current.clear();

    // Parar las pistas es lo que apaga la luz del micrófono y de la cámara.
    // Olvidarlo las deja encendidas después de colgar, que es de las cosas que
    // más desconfianza generan en una herramienta de voz.
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;

    socket.current?.close();
    socket.current = null;
    self.current = null;

    setLocalStream(null);
    setParticipants({});
    setSelfPeerId(null);
    setMuted(false);
    setCameraOn(false);
    setSharing(false);
    setStartedAt(null);
    setRecording(IDLE_RECORDING);
    setPrompt(null);
    setStatus("idle");
  }, []);

  const join = useCallback(async () => {
    if (status === "connecting" || status === "live") return;
    leaving.current = false;
    setError(null);
    setNotice(null);
    setStatus("connecting");

    try {
      // Antes de pedir el micrófono: si esto falla, mejor fallar sin haber
      // encendido nada.
      const config = await api.get<{ iceServers: RTCIceServer[]; turnConfigured: boolean }>(
        "/calls/ice-servers",
      );
      ice.current = config.iceServers;
      setTurnConfigured(config.turnConfigured);

      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      stream.current = media;
      setLocalStream(media);

      // La lista de micrófonos solo trae etiquetas después de conceder
      // permiso; pedirla antes devuelve entradas sin nombre.
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"),
      );

      const ticket = await requestTicket();
      if (leaving.current) {
        for (const track of media.getTracks()) track.stop();
        return;
      }

      const ws = new WebSocket(buildWsUrl("/ws/voice", { channelId, ticket }));
      socket.current = ws;

      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { type: string } & Record<string, never>;
        const payload = message as unknown as Record<string, string & boolean>;

        switch (message.type) {
          case "welcome": {
            const { peerId, peers: existing, startedAt } = message as unknown as {
              peerId: string;
              peers: Omit<Participant, "stream" | "connectionState">[];
              startedAt: string | null;
            };
            self.current = peerId;
            setSelfPeerId(peerId);
            setStartedAt(startedAt);
            setStatus("live");

            // Quien entra ofrece a los que ya estaban. Los que estaban crean su
            // conexión al recibir esa oferta, no ahora: así la mayoría de las
            // veces no hay colisión que resolver.
            for (const peer of existing) {
              upsert(peer.peerId, peer);
              peerFor(peer.peerId);
            }
            break;
          }

          case "peer-joined": {
            const { peer } = message as unknown as {
              peer: Omit<Participant, "stream" | "connectionState">;
            };
            upsert(peer.peerId, peer);
            break;
          }

          case "peer-left":
            dropPeer(String(payload.peerId));
            break;

          case "peer-state":
            upsert(String(payload.peerId), {
              muted: Boolean(payload.muted),
              camera: Boolean(payload.camera),
              sharing: Boolean(payload.sharing),
            });
            break;

          case "signal": {
            const { from, data } = message as unknown as { from: string; data: SignalPayload };
            void handleSignal(from, data);
            break;
          }

          case "recording-request":
            setPrompt({
              recordingId: String(payload.recordingId),
              displayName: String(payload.displayName),
              alreadyRunning: false,
            });
            break;

          case "recording-active":
            setPrompt({
              recordingId: String(payload.recordingId),
              displayName: String(payload.startedBy),
              alreadyRunning: true,
            });
            break;

          case "recording-started": {
            const recordingId = String(payload.recordingId);
            setRecording((current) => {
              const mine = current.mine || current.awaitingConsent;
              if (mine && !recorder.current) {
                // Solo el navegador de quien pidió grabar abre el MediaRecorder.
                const handle = createRecorder(stream.current, [...remoteStreams.current.values()]);
                recorder.current = handle;
                handle?.start();
              }
              return {
                active: true,
                recordingId,
                startedBy: String(payload.startedBy),
                mine,
                awaitingConsent: false,
                saving: false,
              };
            });
            break;
          }

          case "recording-denied":
            setRecording(IDLE_RECORDING);
            setNotice(`${String(payload.by)} no aceptó que se grabara la llamada.`);
            break;

          case "recording-stopped": {
            const recordingId = String(payload.recordingId);
            setRecording((current) => {
              if (current.mine && recorder.current) void saveRecording(recordingId);
              return current.mine ? { ...current, active: false } : IDLE_RECORDING;
            });
            break;
          }

          case "ping":
            // El servidor comprueba que seguimos vivos; si dejamos de
            // contestar nos expulsa en lugar de dejar un fantasma en la sala.
            ws.send(JSON.stringify({ type: "pong" }));
            break;

          case "error":
            setError(String(payload.message));
            break;
        }
      };

      ws.onerror = () => {
        if (!leaving.current) {
          setError("se perdió la conexión con la señalización");
          setStatus("error");
        }
      };

      ws.onclose = () => {
        if (!leaving.current) leave();
      };
    } catch (caught) {
      const message =
        caught instanceof DOMException && caught.name === "NotAllowedError"
          ? "hace falta permiso para usar el micrófono"
          : caught instanceof Error
            ? caught.message
            : "no se pudo entrar en la sala";
      setError(message);
      setStatus("error");
      for (const track of stream.current?.getTracks() ?? []) track.stop();
      stream.current = null;
      setLocalStream(null);
    }
  }, [status, channelId, peerFor, handleSignal, upsert, dropPeer, leave, saveRecording]);

  /**
   * Silenciar apaga la pista, no la cierra.
   *
   * Cerrarla obligaría a pedir el micrófono otra vez al volver, y algunos
   * navegadores vuelven a preguntar por el permiso. Con `enabled = false` la
   * pista sigue viva pero manda silencio.
   */
  const toggleMute = useCallback(() => {
    const next = !muted;
    for (const track of stream.current?.getAudioTracks() ?? []) track.enabled = !next;
    setMuted(next);
    emit({ type: "state", muted: next, camera: cameraOn, sharing });
  }, [muted, cameraOn, sharing, emit]);

  /** Añade o quita una pista de vídeo en todas las conexiones. */
  const publishVideo = useCallback(
    async (track: MediaStreamTrack | null) => {
      const local = stream.current;
      if (!local) return;

      for (const pc of peers.current.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (track && sender) {
          // Sustituir no renegocia: es lo que hace que pasar de cámara a
          // pantalla compartida no corte nada.
          await sender.replaceTrack(track);
        } else if (track) {
          // Añadir sí renegocia, y de eso se encarga el patrón cortés.
          pc.addTrack(track, local);
        } else if (sender) {
          pc.removeTrack(sender);
        }
      }

      for (const old of local.getVideoTracks()) {
        old.stop();
        local.removeTrack(old);
      }
      if (track) local.addTrack(track);

      // El objeto MediaStream es el mismo, así que React no ve un cambio de
      // referencia. Se clona para que las vistas que lo pintan se enteren.
      setLocalStream(new MediaStream(local.getTracks()));
    },
    [],
  );

  const toggleCamera = useCallback(async () => {
    try {
      if (cameraOn || sharing) {
        await publishVideo(null);
        setCameraOn(false);
        setSharing(false);
        emit({ type: "state", muted, camera: false, sharing: false });
        return;
      }
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      await publishVideo(media.getVideoTracks()[0] ?? null);
      setCameraOn(true);
      emit({ type: "state", muted, camera: true, sharing: false });
    } catch {
      setError("no se pudo abrir la cámara");
    }
  }, [cameraOn, sharing, muted, publishVideo, emit]);

  const toggleScreenShare = useCallback(async () => {
    try {
      if (sharing) {
        await publishVideo(null);
        setSharing(false);
        emit({ type: "state", muted, camera: false, sharing: false });
        return;
      }
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0] ?? null;
      // El navegador tiene su propio botón de «dejar de compartir», fuera de
      // nuestra interfaz. Sin escuchar esto, el botón de la página se quedaría
      // diciendo que sigues compartiendo cuando ya no.
      track?.addEventListener("ended", () => {
        void publishVideo(null);
        setSharing(false);
        emit({ type: "state", muted, camera: false, sharing: false });
      });
      await publishVideo(track);
      setSharing(true);
      setCameraOn(false);
      emit({ type: "state", muted, camera: false, sharing: true });
    } catch {
      // Cancelar el diálogo del navegador no es un error que haya que enseñar.
    }
  }, [sharing, muted, publishVideo, emit]);

  /**
   * Cambiar de micrófono en caliente. `replaceTrack` sustituye la pista en
   * cada conexión sin renegociar: nadie oye un corte.
   */
  const switchDevice = useCallback(async (deviceId: string) => {
    const replacement = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
    });
    const track = replacement.getAudioTracks()[0];
    if (!track) return;

    for (const pc of peers.current.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
      await sender?.replaceTrack(track);
    }

    const local = stream.current;
    if (local) {
      for (const old of local.getAudioTracks()) {
        old.stop();
        local.removeTrack(old);
      }
      local.addTrack(track);
      setLocalStream(new MediaStream(local.getTracks()));
    }
  }, []);

  // Al desmontar hay que soltarlo todo. Sin esto, salir de la página deja el
  // micrófono encendido y un par fantasma para los demás.
  useEffect(() => leave, [leave]);

  const list = Object.values(participants);

  return {
    status,
    error,
    notice,
    dismissNotice: () => setNotice(null),
    localStream,
    selfPeerId,
    participants: list,
    muted,
    cameraOn,
    sharing,
    devices,
    turnConfigured,
    startedAt,
    recording,
    prompt,
    /** Con cámara la malla aguanta menos: a partir de aquí se avisa. */
    videoStrain: list.filter((p) => p.camera || p.sharing).length + (cameraOn || sharing ? 1 : 0),
    join,
    leave,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    switchDevice,
    startRecording,
    stopRecording,
    answerRecordingPrompt,
  };
}

