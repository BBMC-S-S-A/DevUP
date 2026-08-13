"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildWsUrl, requestTicket } from "../ws";

/**
 * Sala de voz en malla, sin servidor de medios.
 *
 * Cada participante se conecta directamente con cada otro; el servidor solo
 * reparte SDP y candidatos ICE. El audio nunca pasa por DevUP, va cifrado
 * entre pares con DTLS-SRTP. Eso hace que la sala sea de hecho extremo a
 * extremo — y por eso mismo no sea grabable desde el servidor. Las dos cosas
 * a la vez no existen, por mucho que se prometan juntas.
 *
 * Límite honesto: por encima de unos seis participantes la malla se cae de
 * bruces, porque cada cliente sube su audio N−1 veces. A partir de ahí toca un
 * SFU, y esa migración solo debería tocar este archivo.
 *
 * La dificultad real está en la negociación. Dos pares pueden ofrecer a la
 * vez, y sin un desempate acordado los dos se quedan colgados en
 * `have-local-offer` esperando una respuesta que nunca llega. Se implementa el
 * patrón de «negociación perfecta»: el cortés cede ante una colisión, el
 * descortés no. Cortés es el del peerId mayor — determinista y simétrico, los
 * dos extremos calculan lo mismo sin ponerse de acuerdo.
 */
export type Status = "idle" | "connecting" | "live" | "error";

export type Participant = {
  peerId: string;
  userId: string;
  displayName: string;
  muted: boolean;
  stream: MediaStream | null;
  connectionState: RTCPeerConnectionState;
};

type SignalPayload = {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export function useVoiceRoom(channelId: string) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [selfPeerId, setSelfPeerId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Record<string, Participant>>({});
  const [muted, setMuted] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const socket = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const self = useRef<string | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const makingOffer = useRef(new Map<string, boolean>());
  const ignoreOffer = useRef(new Map<string, boolean>());
  const leaving = useRef(false);

  const { iceServers, turnConfigured } = useMemo(buildIceConfig, []);

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
   * aviso de que ese par existe, y sin esto se descartaría con un «no existe
   * el par» y la llamada no se establecería nunca.
   */
  const peerFor = useCallback(
    (remote: string): RTCPeerConnection => {
      const existing = peers.current.get(remote);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers });

      const local = stream.current;
      if (local) for (const track of local.getTracks()) pc.addTrack(track, local);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          emit({ type: "signal", to: remote, data: { candidate: event.candidate.toJSON() } });
        }
      };

      pc.ontrack = (event) => {
        upsert(remote, { stream: event.streams[0] ?? null });
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
    [iceServers, emit, upsert],
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
            // igualmente y fallan; ahí el error es esperado. En cualquier otro
            // caso sí importa.
            if (!ignoreOffer.current.get(from)) throw caught;
          }
        }
      } catch (caught) {
        console.warn("[voz] fallo negociando con", from, caught);
      }
    },
    [peerFor, emit],
  );

  const leave = useCallback(() => {
    leaving.current = true;

    for (const pc of peers.current.values()) pc.close();
    peers.current.clear();
    makingOffer.current.clear();
    ignoreOffer.current.clear();

    // Parar las pistas es lo que apaga la luz del micrófono. Olvidarlo deja el
    // micrófono abierto después de colgar, que es de las cosas que más
    // desconfianza generan en una herramienta de voz.
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;

    socket.current?.close();
    socket.current = null;
    self.current = null;

    setLocalStream(null);
    setParticipants({});
    setSelfPeerId(null);
    setMuted(false);
    setStatus("idle");
  }, []);

  const join = useCallback(async () => {
    if (status === "connecting" || status === "live") return;
    leaving.current = false;
    setError(null);
    setStatus("connecting");

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
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
        const message = JSON.parse(String(event.data)) as Record<string, never> & { type: string };

        switch (message.type) {
          case "welcome": {
            const { peerId, peers: existing } = message as unknown as {
              peerId: string;
              peers: Omit<Participant, "stream" | "connectionState">[];
            };
            self.current = peerId;
            setSelfPeerId(peerId);
            setStatus("live");

            // Quien entra ofrece a los que ya estaban. Los que estaban crean
            // su conexión al recibir esa oferta, no ahora: así la mayoría de
            // las veces no hay colisión que resolver.
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

          case "peer-left": {
            dropPeer((message as unknown as { peerId: string }).peerId);
            break;
          }

          case "peer-state": {
            const { peerId, muted } = message as unknown as { peerId: string; muted: boolean };
            upsert(peerId, { muted });
            break;
          }

          case "signal": {
            const { from, data } = message as unknown as { from: string; data: SignalPayload };
            void handleSignal(from, data);
            break;
          }

          case "ping": {
            // El servidor comprueba que seguimos vivos; si dejamos de
            // contestar nos expulsa de la sala en lugar de dejar un fantasma.
            ws.send(JSON.stringify({ type: "pong" }));
            break;
          }

          case "error": {
            setError((message as unknown as { message: string }).message);
            setStatus("error");
            break;
          }
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
  }, [status, channelId, peerFor, handleSignal, upsert, dropPeer, leave]);

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
    emit({ type: "state", muted: next });
  }, [muted, emit]);

  /**
   * Cambiar de micrófono en caliente.
   *
   * `replaceTrack` sustituye la pista en cada conexión sin renegociar: no hace
   * falta nueva SDP y nadie oye un corte.
   */
  const switchDevice = useCallback(async (deviceId: string) => {
    const replacement = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
    });
    const [track] = replacement.getAudioTracks();
    if (!track) return;

    for (const pc of peers.current.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
      await sender?.replaceTrack(track);
    }

    for (const old of stream.current?.getAudioTracks() ?? []) old.stop();
    stream.current = replacement;
    setLocalStream(replacement);
  }, []);

  // Al desmontar hay que soltarlo todo. Sin esto, salir de la página deja el
  // micrófono encendido y un par fantasma para los demás.
  useEffect(() => leave, [leave]);

  return {
    status,
    error,
    localStream,
    selfPeerId,
    participants: Object.values(participants),
    muted,
    devices,
    turnConfigured,
    join,
    leave,
    toggleMute,
    switchDevice,
  };
}

function buildIceConfig(): { iceServers: RTCIceServer[]; turnConfigured: boolean } {
  const iceServers: RTCIceServer[] = [];

  const stun = (process.env.NEXT_PUBLIC_STUN_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  if (stun.length > 0) iceServers.push({ urls: stun });

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL?.trim();
  if (turnUrl) {
    iceServers.push({
      urls: turnUrl,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME ?? "",
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL ?? "",
    });
  }

  return { iceServers, turnConfigured: Boolean(turnUrl) };
}
