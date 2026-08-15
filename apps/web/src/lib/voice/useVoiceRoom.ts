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
 * aguanta unas seis personas; con cámara, cuatro. Compartir cámara y pantalla
 * a la vez sube el doble de vídeo por esa cuenta — `videoStrain` ya lo pesa
 * así. A partir de ahí toca un SFU, y esa migración solo debería tocar este
 * archivo.
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
 *
 * Cámara y pantalla compartida son dos vías de vídeo independientes —
 * `publishVideoTrack` — cada una con su propio `RTCRtpSender` y su propio
 * `MediaStream` local, así que las dos pueden estar encendidas a la vez sin
 * que una sustituya a la otra. El otro extremo distingue cuál es cuál
 * comparando el `.id` de cada stream recibido por `ontrack` contra el
 * `cameraStreamId`/`screenStreamId` que se anuncia por el mismo canal de
 * estado que ya llevaba `camera`/`sharing` — nunca hace falta tocar el
 * servidor de señalización para el vídeo en sí, solo reenvía ese identificador
 * como reenvía todo lo demás.
 */
export type Status = "idle" | "connecting" | "live" | "error";

export type Participant = {
  peerId: string;
  userId: string;
  displayName: string;
  muted: boolean;
  camera: boolean;
  sharing: boolean;
  cameraStreamId: string | null;
  screenStreamId: string | null;
  /** Voz. Cámara y pantalla van en streams propios — ver publishVideoTrack. */
  audioStream: MediaStream | null;
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
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
  const [localAudioStream, setLocalAudioStream] = useState<MediaStream | null>(null);
  const [localCameraStream, setLocalCameraStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
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
  // Cámara y pantalla compartida son streams locales propios, separados del
  // de voz — es lo que permite que las dos vías salgan a la vez sin que una
  // pise el sender de la otra. Cada uno conserva su identidad (mismo
  // MediaStream, pista sustituida por dentro) durante toda la llamada, así
  // que su `.id` es estable y sirve para que el otro extremo distinga cuál es
  // cuál al recibirlas — ver publishVideoTrack y resolveVideoRoles.
  const cameraMedia = useRef<MediaStream | null>(null);
  const screenMedia = useRef<MediaStream | null>(null);
  const cameraSenders = useRef(new Map<string, RTCRtpSender>());
  const screenSenders = useRef(new Map<string, RTCRtpSender>());
  const self = useRef<string | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const makingOffer = useRef(new Map<string, boolean>());
  const ignoreOffer = useRef(new Map<string, boolean>());
  // Todo stream visto por `ontrack`, por par — para la grabadora, que ignora
  // sola cualquiera sin pista de audio (mic, cámara y pantalla conviven aquí).
  const remoteStreamsByPeer = useRef(new Map<string, Set<MediaStream>>());
  // De esos streams, cuáles son «la cámara» o «la pantalla» de cada par, según
  // el `cameraStreamId`/`screenStreamId` que llega por `peer-state`. El resto
  // — el que sí tiene audio y no es ni uno ni otro — es la voz.
  const remoteRoleStreams = useRef(new Map<string, Map<string, MediaStream>>());
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
        cameraStreamId: null,
        screenStreamId: null,
        audioStream: null,
        cameraStream: null,
        screenStream: null,
        connectionState: "new" as RTCPeerConnectionState,
      };
      return { ...current, [peerId]: { ...existing, ...patch } };
    });
  }, []);

  /**
   * Reparte los streams vistos por `ontrack` de un par entre voz, cámara y
   * pantalla, comparando su `.id` contra lo último que ese par anunció por
   * `peer-state`. Se llama tanto al llegar una pista nueva como al cambiar el
   * estado — cualquiera de las dos puede llegar primero, y hasta que llegan
   * las dos el vídeo correspondiente queda en `null` (la interfaz ya sabe
   * mostrar «conectando» para eso, no hace falta nada especial).
   */
  const resolveVideoRoles = useCallback((peerId: string) => {
    const known = remoteRoleStreams.current.get(peerId);
    setParticipants((current) => {
      const participant = current[peerId];
      if (!participant || !known) return current;

      let audioStream: MediaStream | null = null;
      let cameraStream: MediaStream | null = null;
      let screenStream: MediaStream | null = null;
      for (const candidate of known.values()) {
        if (participant.cameraStreamId && candidate.id === participant.cameraStreamId) {
          cameraStream = candidate;
        } else if (participant.screenStreamId && candidate.id === participant.screenStreamId) {
          screenStream = candidate;
        } else if (candidate.getAudioTracks().length > 0) {
          audioStream = candidate;
        }
      }

      if (
        participant.audioStream === audioStream &&
        participant.cameraStream === cameraStream &&
        participant.screenStream === screenStream
      ) {
        return current;
      }
      return { ...current, [peerId]: { ...participant, audioStream, cameraStream, screenStream } };
    });
  }, []);

  const dropPeer = useCallback((peerId: string) => {
    peers.current.get(peerId)?.close();
    peers.current.delete(peerId);
    makingOffer.current.delete(peerId);
    ignoreOffer.current.delete(peerId);
    cameraSenders.current.delete(peerId);
    screenSenders.current.delete(peerId);
    const gone = remoteStreamsByPeer.current.get(peerId);
    remoteStreamsByPeer.current.delete(peerId);
    remoteRoleStreams.current.delete(peerId);
    if (gone) for (const s of gone) recorder.current?.removeStream(s);
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

      // Si ya estaba compartiendo cámara o pantalla cuando este par se une a
      // mitad de llamada, hay que dárselas desde ya — si no, vería a los demás
      // sin vídeo hasta el siguiente toggle.
      const camTrack = cameraMedia.current?.getVideoTracks()[0];
      if (camTrack && cameraMedia.current) {
        cameraSenders.current.set(remote, pc.addTrack(camTrack, cameraMedia.current));
      }
      const screenTrack = screenMedia.current?.getVideoTracks()[0];
      if (screenTrack && screenMedia.current) {
        screenSenders.current.set(remote, pc.addTrack(screenTrack, screenMedia.current));
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          emit({ type: "signal", to: remote, data: { candidate: event.candidate.toJSON() } });
        }
      };

      pc.ontrack = (event) => {
        const incoming = event.streams[0] ?? null;
        if (!incoming) return;

        let seen = remoteStreamsByPeer.current.get(remote);
        if (!seen) {
          seen = new Set();
          remoteStreamsByPeer.current.set(remote, seen);
        }
        // `ontrack` salta una vez por pista: al encender la cámara o la
        // pantalla a mitad de llamada vuelve a saltar, con un stream nuevo
        // porque cada vía tiene el suyo propio. La grabadora ignora sola
        // cualquiera sin pista de audio, así que no hace falta filtrar aquí.
        if (!seen.has(incoming)) {
          seen.add(incoming);
          recorder.current?.addStream(incoming);
        }

        let known = remoteRoleStreams.current.get(remote);
        if (!known) {
          known = new Map();
          remoteRoleStreams.current.set(remote, known);
        }
        known.set(incoming.id, incoming);
        resolveVideoRoles(remote);
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
    [emit, upsert, resolveVideoRoles],
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
    cameraSenders.current.clear();
    screenSenders.current.clear();
    remoteStreamsByPeer.current.clear();
    remoteRoleStreams.current.clear();

    // Parar las pistas es lo que apaga la luz del micrófono y de la cámara.
    // Olvidarlo las deja encendidas después de colgar, que es de las cosas que
    // más desconfianza generan en una herramienta de voz.
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    for (const track of cameraMedia.current?.getTracks() ?? []) track.stop();
    cameraMedia.current = null;
    for (const track of screenMedia.current?.getTracks() ?? []) track.stop();
    screenMedia.current = null;

    socket.current?.close();
    socket.current = null;
    self.current = null;

    setLocalAudioStream(null);
    setLocalCameraStream(null);
    setLocalScreenStream(null);
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
      setLocalAudioStream(media);

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
              peers: Omit<
                Participant,
                "audioStream" | "cameraStream" | "screenStream" | "connectionState"
              >[];
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
              peer: Omit<
                Participant,
                "audioStream" | "cameraStream" | "screenStream" | "connectionState"
              >;
            };
            upsert(peer.peerId, peer);
            // Defensivo: en el orden habitual el vídeo llega después y su
            // propio `ontrack` ya resuelve esto, pero si por lo que sea
            // llegara antes, que no se quede sin resolver para siempre.
            resolveVideoRoles(peer.peerId);
            break;
          }

          case "peer-left":
            dropPeer(String(payload.peerId));
            break;

          case "peer-state": {
            const peerId = String(payload.peerId);
            const data = message as unknown as {
              cameraStreamId?: string | null;
              screenStreamId?: string | null;
            };
            upsert(peerId, {
              muted: Boolean(payload.muted),
              camera: Boolean(payload.camera),
              sharing: Boolean(payload.sharing),
              cameraStreamId: data.cameraStreamId ?? null,
              screenStreamId: data.screenStreamId ?? null,
            });
            // El vídeo puede haber llegado por `ontrack` antes de saber cuál
            // era cuál — al saberlo ahora, hay que resolver lo que ya llegó.
            resolveVideoRoles(peerId);
            break;
          }

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
            // Solo hay una grabación posible a la vez por canal: si esto
            // llega, cualquier diálogo pendiente era sobre esta misma
            // grabación y ya se resolvió. Dejarlo abierto tapa el resto de la
            // interfaz con un mensaje que ya no es cierto.
            setPrompt(null);
            setRecording((current) => {
              const mine = current.mine || current.awaitingConsent;
              if (mine && !recorder.current) {
                // Solo el navegador de quien pidió grabar abre el MediaRecorder.
                // `createRecorder` ignora solo cualquier stream sin pista de
                // audio, así que pasarle también los de cámara/pantalla no
                // hace daño — no hace falta filtrarlos aquí.
                const allRemote = [...remoteStreamsByPeer.current.values()].flatMap((set) => [
                  ...set,
                ]);
                const handle = createRecorder(stream.current, allRemote);
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
            setPrompt(null);
            setRecording(IDLE_RECORDING);
            setNotice(`${String(payload.by)} no aceptó que se grabara la llamada.`);
            break;

          case "recording-stopped": {
            const recordingId = String(payload.recordingId);
            setPrompt(null);
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
      setLocalAudioStream(null);
    }
  }, [
    status,
    channelId,
    peerFor,
    handleSignal,
    upsert,
    dropPeer,
    leave,
    saveRecording,
    resolveVideoRoles,
  ]);

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

  /**
   * Añade o quita la pista de una vía de vídeo (cámara o pantalla) en todas
   * las conexiones. Cada vía tiene su propio MediaStream local, creado una
   * sola vez y reutilizado durante toda la llamada — por eso su `.id` es
   * estable y sirve para que el otro extremo distinga cuál es cuál (ver
   * `resolveVideoRoles`). Esto es lo que permite que cámara y pantalla estén
   * las dos encendidas a la vez: no comparten sender ni stream.
   */
  const publishVideoTrack = useCallback(
    async (kind: "camera" | "screen", track: MediaStreamTrack | null): Promise<string> => {
      const mediaRef = kind === "camera" ? cameraMedia : screenMedia;
      const senderMap = kind === "camera" ? cameraSenders : screenSenders;

      if (!mediaRef.current) mediaRef.current = new MediaStream();
      const media = mediaRef.current;
      for (const old of media.getVideoTracks()) {
        old.stop();
        media.removeTrack(old);
      }
      if (track) media.addTrack(track);

      for (const [peerId, pc] of peers.current.entries()) {
        try {
          const sender = senderMap.current.get(peerId);
          if (sender) {
            // Sustituir no renegocia: encender o apagar esta vía no corta nada.
            await sender.replaceTrack(track);
          } else if (track) {
            // La primera vez que esta vía se activa con un par sí renegocia,
            // y de eso se encarga el patrón cortés.
            senderMap.current.set(peerId, pc.addTrack(track, media));
          }
        } catch (caught) {
          // Una conexión rota con un par no debería impedir que los demás
          // vean la cámara o la pantalla — se avisa y se sigue con el resto.
          console.warn("[voz] no se pudo publicar vídeo a", peerId, caught);
        }
      }

      const setLocal = kind === "camera" ? setLocalCameraStream : setLocalScreenStream;
      // El objeto MediaStream es el mismo, así que React no ve un cambio de
      // referencia. Se clona para que las vistas que lo pintan se enteren.
      setLocal(track ? new MediaStream(media.getTracks()) : null);

      return media.id;
    },
    [],
  );

  const toggleCamera = useCallback(async () => {
    try {
      if (cameraOn) {
        await publishVideoTrack("camera", null);
        setCameraOn(false);
        emit({
          type: "state",
          muted,
          camera: false,
          sharing,
          cameraStreamId: null,
          screenStreamId: screenMedia.current?.id ?? null,
        });
        return;
      }
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const streamId = await publishVideoTrack("camera", media.getVideoTracks()[0] ?? null);
      setCameraOn(true);
      emit({
        type: "state",
        muted,
        camera: true,
        sharing,
        cameraStreamId: streamId,
        screenStreamId: screenMedia.current?.id ?? null,
      });
    } catch {
      setError("no se pudo abrir la cámara");
    }
  }, [cameraOn, sharing, muted, publishVideoTrack, emit]);

  const toggleScreenShare = useCallback(async () => {
    try {
      if (sharing) {
        await publishVideoTrack("screen", null);
        setSharing(false);
        emit({
          type: "state",
          muted,
          camera: cameraOn,
          sharing: false,
          cameraStreamId: cameraMedia.current?.id ?? null,
          screenStreamId: null,
        });
        return;
      }
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0] ?? null;
      // El navegador tiene su propio botón de «dejar de compartir», fuera de
      // nuestra interfaz. Sin escuchar esto, el botón de la página se quedaría
      // diciendo que sigues compartiendo cuando ya no.
      track?.addEventListener("ended", () => {
        void publishVideoTrack("screen", null);
        setSharing(false);
        emit({
          type: "state",
          muted,
          camera: cameraOn,
          sharing: false,
          cameraStreamId: cameraMedia.current?.id ?? null,
          screenStreamId: null,
        });
      });
      const streamId = await publishVideoTrack("screen", track);
      setSharing(true);
      emit({
        type: "state",
        muted,
        camera: cameraOn,
        sharing: true,
        cameraStreamId: cameraMedia.current?.id ?? null,
        screenStreamId: streamId,
      });
    } catch {
      // Cancelar el diálogo del navegador no es un error que haya que enseñar.
    }
  }, [sharing, cameraOn, muted, publishVideoTrack, emit]);

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
      setLocalAudioStream(new MediaStream(local.getTracks()));
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
    localAudioStream,
    localCameraStream,
    localScreenStream,
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
    /**
     * Con cámara la malla aguanta menos: a partir de aquí se avisa. Cámara y
     * pantalla cuentan cada una por separado — quien comparte las dos a la
     * vez sube el doble de vídeo, no lo mismo que antes.
     */
    videoStrain:
      list.reduce((n, p) => n + (p.camera ? 1 : 0) + (p.sharing ? 1 : 0), 0) +
      (cameraOn ? 1 : 0) +
      (sharing ? 1 : 0),
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

