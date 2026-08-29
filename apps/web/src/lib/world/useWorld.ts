"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { buildWsUrl, requestTicket } from "../ws";
import type { Scene } from "./scene";
import { isWalkable, zoneAt } from "./scene";
import type { Avatar, Facing, Peer, Zone } from "./types";

/** Casillas por segundo. Rápido para cruzar la oficina, lento para no pasarse. */
const SPEED = 4.6;
/** Cada cuánto se manda la posición. El servidor reparte a la misma cadencia. */
const SEND_MS = 100;
/**
 * Constante de suavizado de la interpolación, en milisegundos.
 *
 * El servidor manda posiciones diez veces por segundo. Sin interpolar, los
 * demás avanzarían a diez saltos por segundo aunque el dibujo vaya a sesenta
 * fotogramas — se ve peor de lo que suena. Con esto, cada avatar persigue su
 * última posición conocida y el movimiento se lee continuo.
 */
const SMOOTH_TAU = 70;
/**
 * Cuánto dura una burbuja en pantalla.
 *
 * Cuatro segundos y medio: lo que se tarda en leer una frase corta sin
 * quedarse mirando. Permanentes convertirían la oficina en un muro de
 * bocadillos, y el mensaje no se pierde — está en el canal.
 */
const BUBBLE_MS = 4500;
const EMOTE_MS = 2200;

export type WorldStatus = "idle" | "connecting" | "live" | "error";

export type Input = { up: boolean; down: boolean; left: boolean; right: boolean };

export type WorldState = {
  self: { x: number; y: number; facing: Facing; moving: boolean; sitting: boolean };
  peers: Map<string, Peer>;
};

type Options = {
  workspaceId: string;
  scene: Scene | null;
  displayName: string;
  /** Quién soy. Viene de la sesión, que ya lo sabe: no hace falta preguntarlo otra vez. */
  selfUserId: string;
  /** Se llama al entrar o salir de una zona. Es lo que ata el mundo a los canales. */
  onZoneChange?: (zone: Zone | null) => void;
};

export function useWorld({
  workspaceId,
  scene,
  displayName,
  selfUserId,
  onZoneChange,
  onDirecto,
}: Options & {
  /**
   * Lo que llega dirigido a mí y no a la sala: una llamada, su respuesta, o
   * un trozo de negociación de la conexión.
   *
   * Se saca por aquí en vez de gestionarlo dentro porque este hook ya tiene
   * bastante con mover gente por una planta. La llamada la lleva useLlamada,
   * que sabe de WebRTC y no sabe de mundos.
   */
  onDirecto?: (mensaje: { type: string; fromPeerId: string; [k: string]: unknown }) => void;
}) {
  const [status, setStatus] = useState<WorldStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  /** Solo para la lista lateral: cambia al entrar y salir gente, no al moverse. */
  const [roster, setRoster] = useState<Peer[]>([]);
  const [avatars, setAvatars] = useState<Map<string, Avatar>>(new Map());
  const [zone, setZone] = useState<Zone | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const stateRef = useRef<WorldState>({
    self: { x: 4, y: 4, facing: "s", moving: false, sitting: false },
    peers: new Map(),
  });
  const lastSentRef = useRef(0);
  const lastSittingRef = useRef(false);
  const selfBubbleRef = useRef<{ text: string; until: number } | null>(null);
  const selfEmoteRef = useRef<{ kind: NonNullable<Peer["emote"]>; until: number } | null>(null);
  const zoneRef = useRef<string | null>(null);
  const onDirectoRef = useRef(onDirecto);
  onDirectoRef.current = onDirecto;
  const sceneRef = useRef<Scene | null>(scene);
  const onZoneChangeRef = useRef(onZoneChange);

  // Las dos referencias siguientes existen para que el bucle de animación no
  // dependa de valores que cambian en cada renderizado: si `step` se recreara
  // con cada uno, el bucle se reiniciaría constantemente.
  sceneRef.current = scene;
  onZoneChangeRef.current = onZoneChange;

  // --- Avatares -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void api
      .get<{ avatars: (Avatar & { userId: string })[] }>("/world/avatars")
      .then(({ avatars: list }) => {
        if (cancelled) return;
        setAvatars(new Map(list.map(({ userId, ...look }) => [userId, look])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshAvatars = useCallback(async () => {
    const { avatars: list } = await api.get<{ avatars: (Avatar & { userId: string })[] }>(
      "/world/avatars",
    );
    setAvatars(new Map(list.map(({ userId, ...look }) => [userId, look])));
  }, []);

  // --- Conexión -------------------------------------------------------------
  useEffect(() => {
    if (!workspaceId) return;

    let closed = false;
    let socket: WebSocket | null = null;

    const connect = async (): Promise<void> => {
      setStatus("connecting");
      try {
        const ticket = await requestTicket();
        if (closed) return;

        socket = new WebSocket(buildWsUrl("/ws/world", { workspaceId, ticket }));
        socketRef.current = socket;

        socket.onopen = () => {
          if (!closed) setStatus("live");
        };

        socket.onmessage = (event: MessageEvent<string>) => {
          let message: Record<string, unknown> & { type?: string };
          try {
            message = JSON.parse(event.data) as typeof message;
          } catch {
            return;
          }

          switch (message.type) {
            case "welcome": {
              const you = message.you as { x: number; y: number };
              const peers = message.peers as Peer[];
              stateRef.current.self.x = you.x;
              stateRef.current.self.y = you.y;
              stateRef.current.peers = new Map(
                peers.map((p) => [p.peerId, { ...p, tx: p.x, ty: p.y }]),
              );
              setRoster(peers);
              break;
            }

            case "peer-joined": {
              const peer = message.peer as Peer;
              stateRef.current.peers.set(peer.peerId, { ...peer, tx: peer.x, ty: peer.y });
              setRoster([...stateRef.current.peers.values()]);
              break;
            }

            case "peer-left": {
              stateRef.current.peers.delete(message.peerId as string);
              setRoster([...stateRef.current.peers.values()]);
              break;
            }

            case "tick": {
              // El mensaje trae a todos los que se movieron en este tick, no
              // uno por persona. Solo se actualiza el destino: acercarse a él
              // es trabajo del bucle de animación.
              for (const move of message.moves as Peer[]) {
                const peer = stateRef.current.peers.get(move.peerId);
                if (!peer) continue;
                peer.tx = move.x;
                peer.ty = move.y;
                peer.facing = move.facing;
                peer.moving = move.moving;
                peer.sitting = move.sitting ?? false;
              }
              break;
            }

            case "peer-say": {
              const peer = stateRef.current.peers.get(message.peerId as string);
              if (peer) {
                peer.bubble = message.text as string;
                peer.bubbleUntil = performance.now() + BUBBLE_MS;
              }
              break;
            }

            case "peer-emote": {
              const peer = stateRef.current.peers.get(message.peerId as string);
              if (peer) {
                peer.emote = message.emote as Peer["emote"];
                peer.emoteUntil = performance.now() + EMOTE_MS;
              }
              break;
            }

            case "peer-zone": {
              const peer = stateRef.current.peers.get(message.peerId as string);
              if (peer) peer.zoneId = (message.zoneId as string | null) ?? null;
              setRoster([...stateRef.current.peers.values()]);
              break;
            }

            case "knocked":
            case "knock-answered":
            case "rtc": {
              // Sin interpretar: este hook es el buzón, no el destinatario.
              onDirectoRef.current?.(message as never);
              return;
            }

            case "ping":
              socket?.send(JSON.stringify({ type: "pong" }));
              break;

            case "error":
              setError((message.message as string) ?? "error en DevVerse");
              setStatus("error");
              break;
          }
        };

        socket.onclose = () => {
          socketRef.current = null;
          if (!closed) setStatus("idle");
        };

        socket.onerror = () => {
          if (!closed) {
            setStatus("error");
            setError("no se pudo conectar con DevVerse");
          }
        };
      } catch {
        if (!closed) {
          setStatus("error");
          setError("no se pudo conectar con DevVerse");
        }
      }
    };

    void connect();

    return () => {
      closed = true;
      socketRef.current = null;
      socket?.close();
      // Al salir se limpia todo: si no, volver a entrar arrastraría los
      // avatares de la visita anterior, ya desconectados.
      stateRef.current.peers.clear();
      setRoster([]);
      zoneRef.current = null;
    };
  }, [workspaceId]);

  /**
   * Un paso del mundo. Lo llama el bucle de animación del componente.
   *
   * Hace cuatro cosas por fotograma: mover al jugador según las teclas,
   * acercar a los demás a su última posición conocida, mirar si se ha cruzado
   * una puerta y, como mucho diez veces por segundo, contar dónde estamos.
   */
  const step = useCallback((dt: number, input: Input): void => {
    const current = sceneRef.current;
    if (!current) return;

    const state = stateRef.current;
    const self = state.self;

    // --- Movimiento propio -------------------------------------------------
    // Sentado no se camina. Pulsar una dirección levanta: es lo que espera
    // cualquiera, y ahorra tener que acordarse de una tecla para ponerse de
    // pie.
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (self.sitting && (dx !== 0 || dy !== 0)) self.sitting = false;
    if (self.sitting) {
      dx = 0;
      dy = 0;
    }

    if (dx !== 0 && dy !== 0) {
      // En diagonal se recorrería 1,41 veces más rápido. Normalizar es la
      // diferencia entre un movimiento que se siente correcto y uno en el que
      // todo el mundo aprende a caminar en diagonal.
      const inv = Math.SQRT1_2;
      dx *= inv;
      dy *= inv;
    }

    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      const distance = (SPEED * dt) / 1000;

      // Los ejes se prueban por separado para poder deslizarse a lo largo de
      // una pared en vez de quedarse clavado al rozarla en diagonal.
      const nextX = self.x + dx * distance;
      if (isWalkable(current, nextX, self.y)) self.x = nextX;

      const nextY = self.y + dy * distance;
      if (isWalkable(current, self.x, nextY)) self.y = nextY;

      // Mirar hacia donde más se avanza: con las dos teclas a la vez, el eje
      // dominante manda.
      if (Math.abs(dx) > Math.abs(dy)) self.facing = dx > 0 ? "e" : "o";
      else self.facing = dy > 0 ? "s" : "n";
    }
    self.moving = moving;

    // Las burbujas y los gestos caducan solos. Se limpian aquí y no con un
    // temporizador por burbuja: con veinte personas hablando serían veinte
    // temporizadores vivos para algo que el bucle ya recorre.
    const now2 = performance.now();
    for (const peer of state.peers.values()) {
      if (peer.bubbleUntil && peer.bubbleUntil < now2) {
        peer.bubble = undefined;
        peer.bubbleUntil = undefined;
      }
      if (peer.emoteUntil && peer.emoteUntil < now2) {
        peer.emote = undefined;
        peer.emoteUntil = undefined;
      }
    }
    if (selfBubbleRef.current && selfBubbleRef.current.until < now2) selfBubbleRef.current = null;
    if (selfEmoteRef.current && selfEmoteRef.current.until < now2) selfEmoteRef.current = null;

    // --- Interpolación de los demás ---------------------------------------
    const k = 1 - Math.exp(-dt / SMOOTH_TAU);
    for (const peer of state.peers.values()) {
      peer.x += (peer.tx - peer.x) * k;
      peer.y += (peer.ty - peer.y) * k;
    }

    // --- Zonas -------------------------------------------------------------
    const inside = zoneAt(current, self.x, self.y);
    const insideId = inside?.id ?? null;
    if (insideId !== zoneRef.current) {
      zoneRef.current = insideId;
      setZone(inside);
      // El socket puede seguir en CONNECTING si el cambio de zona ocurre en
      // el primer fotograma (apareces ya dentro de una sala): sin este
      // guardián, send() lanza InvalidStateError igual que ya se evita más
      // abajo para el envío de movimiento.
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "zone", zoneId: insideId }));
      }
      onZoneChangeRef.current?.(inside);
    }

    // --- Enviar ------------------------------------------------------------
    const now = performance.now();
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN && now - lastSentRef.current >= SEND_MS) {
      // Se manda mientras haya movimiento y una vez más al pararse. Sin ese
      // último envío, quien deja de andar se queda para los demás con el
      // último paso a medias y `moving` encendido para siempre.
      const wasMoving = lastSentRef.current !== 0;
      const postureChanged = self.sitting !== lastSittingRef.current;
      if (postureChanged) lastSittingRef.current = self.sitting;
      if (moving || wasMoving || postureChanged) {
        lastSentRef.current = moving ? now : 0;
        socket.send(
          JSON.stringify({
            type: "move",
            x: Number(self.x.toFixed(2)),
            y: Number(self.y.toFixed(2)),
            facing: self.facing,
            moving,
            sitting: self.sitting,
          }),
        );
      }
    }
  }, []);

  /**
   * Decir algo en la sala.
   *
   * Primero el mensaje de verdad, al canal, por HTTP. La burbuja se manda
   * después y solo si el mensaje se guardó: si el orden fuera al revés,
   * bastaría con que fallara el POST para que la gente viera un bocadillo de
   * algo que no existe en ninguna parte.
   */
  const say = useCallback(
    async (text: string, channelId: string) => {
      const trimmed = text.trim().slice(0, 200);
      if (trimmed.length === 0) return;

      await api.post(`/channels/${channelId}/messages`, { body: trimmed });
      socketRef.current?.send(JSON.stringify({ type: "say", text: trimmed }));

      // La propia burbuja no llega por el socket —el servidor no se la manda a
      // quien la envió— así que se pone a mano.
      selfBubbleRef.current = { text: trimmed, until: performance.now() + BUBBLE_MS };
    },
    [],
  );

  const emote = useCallback((kind: NonNullable<Peer["emote"]>) => {
    socketRef.current?.send(JSON.stringify({ type: "emote", emote: kind }));
    selfEmoteRef.current = { kind, until: performance.now() + EMOTE_MS };
  }, []);

  /**
   * Sentarse en una plaza, o levantarse.
   *
   * La posición se ajusta a la plaza exacta: sentarse «más o menos donde
   * estaba» deja al avatar medio dentro del sofá, y con perspectiva eso se ve
   * enseguida.
   */
  const sit = useCallback((seat: { x: number; y: number; facing: Facing } | null) => {
    const self = stateRef.current.self;
    if (!seat) {
      self.sitting = false;
      return;
    }
    self.x = seat.x + 0.5;
    self.y = seat.y + 0.9;
    self.facing = seat.facing;
    self.sitting = true;
    self.moving = false;
  }, []);

  /**
   * Manda un mensaje por el socket del mundo.
   *
   * Existe para la llamada individual: la negociación viaja por aquí porque
   * este socket ya conoce a los dos y no hace falta abrir un segundo. El
   * servidor solo reparte — no entiende ni guarda lo que va dentro.
   */
  const enviar = useCallback((mensaje: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(mensaje));
    return true;
  }, []);

  return {
    status,
    error,
    enviar,
    stateRef,
    roster,
    avatars,
    refreshAvatars,
    zone,
    selfUserId,
    displayName,
    step,
    sit,
    say,
    emote,
    selfBubbleRef,
    selfEmoteRef,
  };
}
