"use client";

import { Loader2, Volume2, Users, Shirt } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useVoiceCall } from "@/lib/voice/VoiceCallProvider";
import { TILE } from "@/lib/world/atlas";
import { render, type Camera } from "@/lib/world/renderer";
import { buildScene, type Scene } from "@/lib/world/scene";
import type { Input } from "@/lib/world/useWorld";
import { useWorld } from "@/lib/world/useWorld";
import type { Avatar, WorldMap, Zone } from "@/lib/world/types";
import { AvatarEditor } from "./AvatarEditor";
import { ProximityAudio } from "./ProximityAudio";

/**
 * Hasta dónde se oye, en casillas. Ver el documento 0002: es lo que reparte la
 * malla WebRTC en corrillos pequeños en vez de exigir N−1 conexiones por
 * persona, que es donde se rompe por encima de seis.
 */
export const AUDIBLE_RADIUS = 5.5;

const KEYS: Record<string, keyof Input> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

export function WorldView({ workspaceId }: { workspaceId: string }) {
  const { user } = useSession();
  const { joinChannel, leaveChannel, activeChannelId, room } = useVoiceCall();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<Input>({ up: false, down: false, left: false, right: false });
  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 2 });

  const [map, setMap] = useState<WorldMap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const scene: Scene | null = useMemo(
    () => (map?.room ? buildScene(map.room, map.zones) : null),
    [map],
  );

  useEffect(() => {
    let cancelled = false;
    void api
      .get<WorldMap>(`/workspaces/${workspaceId}/world`)
      .then((data) => {
        if (!cancelled) setMap(data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLoadError(caught instanceof ApiError ? caught.message : "no se pudo cargar la oficina");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  /**
   * Cruzar una puerta es entrar en el canal.
   *
   * Aquí es donde la regla del documento 0002 deja de ser prosa: una zona de
   * voz no abre «una sala del mundo», abre el canal que proyecta, con su mismo
   * historial y su mismo consentimiento de grabación. Quien esté en la vista
   * profesional ve exactamente la misma llamada.
   */
  const onZoneChange = useCallback(
    (zone: Zone | null) => {
      if (!zone) {
        leaveChannel();
        return;
      }
      if (zone.channelKind !== "voice") {
        // Una zona de texto no arrastra a nadie a una llamada: se entra y se
        // sale de un canal de texto leyendo, no hablando.
        leaveChannel();
        return;
      }
      joinChannel(zone.channelId, workspaceId, zone.channelName);
    },
    [joinChannel, leaveChannel, workspaceId],
  );

  const world = useWorld({
    workspaceId,
    scene,
    displayName: user?.displayName ?? "tú",
    selfUserId: user?.id ?? "",
    onZoneChange,
  });

  // --- Teclado --------------------------------------------------------------
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = KEYS[event.code];
      if (!key) return;
      // Sin esto, las flechas desplazan la página por debajo del lienzo.
      event.preventDefault();
      inputRef.current[key] = true;
    };
    const up = (event: KeyboardEvent) => {
      const key = KEYS[event.code];
      if (!key) return;
      inputRef.current[key] = false;
    };
    // Cambiar de pestaña con una tecla pulsada deja el avatar andando solo
    // contra una pared para siempre.
    const blur = () => {
      inputRef.current = { up: false, down: false, left: false, right: false };
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // --- Bucle de animación ---------------------------------------------------
  const { step, stateRef, avatars } = world;
  const selfUserId = user?.id ?? "";
  const displayName = user?.displayName ?? "tú";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scene) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let last = performance.now();
    const started = last;

    const resize = () => {
      // El lienzo se dimensiona en píxeles reales del dispositivo. Sin esto,
      // en una pantalla con densidad doble todo sale borroso — y con arte de
      // píxel el desenfoque es lo primero que se ve.
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      cameraRef.current.scale = 2 * ratio;
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = (now: number) => {
      // El delta se acota: volver a una pestaña dormida entrega un salto de
      // varios segundos y el avatar aparecería al otro lado del mapa.
      const dt = Math.min(64, now - last);
      last = now;

      step(dt, inputRef.current);

      const self = stateRef.current.self;
      const camera = cameraRef.current;
      const targetX = self.x * TILE;
      const targetY = self.y * TILE;
      // La cámara persigue con retraso: pegada al avatar, cada paso sacude la
      // pantalla entera.
      const k = 1 - Math.exp(-dt / 90);
      camera.x += (targetX - camera.x) * k;
      camera.y += (targetY - camera.y) * k;

      render(ctx, {
        scene,
        self: { ...self, displayName },
        peers: [...stateRef.current.peers.values()],
        avatars,
        selfUserId,
        camera,
        time: now - started,
        audibleRadius: AUDIBLE_RADIUS,
      });

      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [scene, step, stateRef, avatars, selfUserId, displayName]);

  // Salir de la oficina cuelga la llamada: quedarse dentro de un canal al que
  // se entró caminando, después de cerrar la vista, no lo espera nadie.
  useEffect(() => () => leaveChannel(), [leaveChannel]);

  const saveAvatar = useCallback(
    async (look: Avatar) => {
      await api.put("/world/avatar", look);
      await world.refreshAvatars();
      setEditing(false);
    },
    [world],
  );

  if (loadError) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <p className="text-sm text-danger">{loadError}</p>
      </div>
    );
  }

  if (!scene) {
    return (
      <div className="grid h-full place-items-center">
        <Loader2 className="animate-spin text-faint" size={20} />
      </div>
    );
  }

  const nearby = [...world.roster].filter((peer) => {
    const self = stateRef.current.self;
    return Math.hypot(peer.x - self.x, peer.y - self.y) <= AUDIBLE_RADIUS;
  });

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      <canvas ref={canvasRef} className="h-full w-full" />

      {/* El audio de cada par, con el volumen que le toque por distancia. */}
      <ProximityAudio
        participants={room.participants}
        stateRef={stateRef}
        radius={AUDIBLE_RADIUS}
      />

      {/* --- Estado de la oficina --- */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-line bg-surface/90 px-3 py-2 backdrop-blur">
          <Users size={14} className="text-faint" />
          <span className="text-xs text-muted">
            {world.roster.length + 1} en la oficina
            {nearby.length > 0 && (
              <span className="text-faint"> · {nearby.length} a tu alcance</span>
            )}
          </span>
          {world.status === "connecting" && (
            <Loader2 size={12} className="animate-spin text-faint" />
          )}
          {world.status === "error" && <span className="text-xs text-danger">sin conexión</span>}
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {world.zone && (
            <div className="flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2">
              {world.zone.channelKind === "voice" ? (
                <Volume2 size={13} className="text-accent" />
              ) : (
                <span className="text-accent">#</span>
              )}
              <span className="text-xs font-medium text-accent">{world.zone.channelName}</span>
              {activeChannelId === world.zone.channelId && (
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-live animate-pulse-slow" />
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 rounded-xl border border-line bg-surface/90 px-3 py-2 text-xs text-muted backdrop-blur transition hover:text-ink"
          >
            <Shirt size={13} />
            Mi personaje
          </button>
        </div>
      </div>

      {/* --- Ayuda, solo mientras no se haya movido nadie --- */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
        <p className="rounded-xl border border-line bg-surface/90 px-3 py-2 text-[11px] text-faint backdrop-blur">
          Muévete con <kbd className="text-muted">WASD</kbd> o las flechas · entra en una sala para
          unirte a su canal
        </p>
      </div>

      {editing && (
        <AvatarEditor
          initial={avatars.get(selfUserId)}
          onCancel={() => setEditing(false)}
          onSave={saveAvatar}
        />
      )}
    </div>
  );
}
