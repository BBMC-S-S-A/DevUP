"use client";

import {
  ListMusic,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ApiError,
  API_URL,
  type SpotifyQueueTrack,
  type SpotifySession,
  type SpotifyTrack,
  api,
} from "@/lib/api";
import { useSpotifyChannelFeed } from "@/lib/spotify/useSpotifyChannelFeed";

/**
 * Música compartida de la sala de voz, como icono — igual que la campana de
 * notificaciones: un botón compacto que abre un panel, para poder vivir tanto
 * en la página del canal como en la barra de llamada persistente
 * (`ActiveCallBar`) sin competir por espacio con nada más.
 *
 * El audio nunca suena "dentro" de la llamada — eso rompería su cifrado
 * extremo a extremo y el propio SDK de Spotify no lo permitiría. Lo que se
 * sincroniza es el estado: quien tiene Premium conectado transfiere la
 * reproducción a su dispositivo; el resto ve qué suena, en tiempo real, y
 * puede añadir canciones a la cola aunque no tenga cuenta.
 *
 * Ver docs/plan-conectores-busqueda-e-interfaz.md §6 para el porqué completo.
 */
type Status = { connected: boolean; premium: boolean };

type SpotifyPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, cb: (state: unknown) => void) => void;
  togglePlay: () => Promise<void>;
};

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayer;
    };
  }
}

const money = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
};

export function SpotifyWidget({
  channelId,
  panelDirection = "down",
}: {
  channelId: string;
  /** "up" cuando el icono vive cerca del borde inferior (la barra de llamada persistente). */
  panelDirection?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [queue, setQueue] = useState<SpotifyQueueTrack[]>([]);
  const [session, setSession] = useState<SpotifySession>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(async () => {
    const s = await api.get<Status>("/me/spotify/status").catch(() => ({ connected: false, premium: false }));
    setStatus(s);
  }, []);

  const loadQueue = useCallback(async () => {
    const { queue } = await api.get<{ queue: SpotifyQueueTrack[] }>(
      `/channels/${channelId}/spotify/queue`,
    );
    setQueue(queue);
  }, [channelId]);

  const loadSession = useCallback(async () => {
    const { session } = await api.get<{ session: SpotifySession }>(
      `/channels/${channelId}/spotify/session`,
    );
    setSession(session);
  }, [channelId]);

  useEffect(() => {
    void loadStatus();
    void loadQueue();
    void loadSession();
  }, [loadStatus, loadQueue, loadSession]);

  useSpotifyChannelFeed(channelId, (kind) => {
    if (kind === "queue-changed") void loadQueue();
    if (kind === "session-changed") void loadSession();
  });

  // Cerrar al pulsar fuera, igual que la campana de notificaciones.
  useEffect(() => {
    if (!open) return;
    const fuera = (event: MouseEvent) => {
      if (!contenedor.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [open]);

  // --- El reproductor, solo si hay Premium conectado --------------------------
  useEffect(() => {
    if (!status?.connected || !status.premium) return;

    const tokenFor = (cb: (token: string) => void) => {
      void api
        .get<{ accessToken: string }>("/me/spotify/token")
        .then(({ accessToken }) => cb(accessToken))
        .catch(() => {});
    };

    let cancelled = false;
    const setup = () => {
      if (cancelled || !window.Spotify) return;
      const player = new window.Spotify.Player({ name: "DevUP", getOAuthToken: tokenFor, volume: 0.7 });
      playerRef.current = player;
      player.addListener("ready", (state) => {
        const { device_id } = state as { device_id: string };
        if (!cancelled) setDeviceId(device_id);
      });
      player.addListener("initialization_error", () => toast.error("Spotify no pudo iniciar el reproductor"));
      player.addListener("authentication_error", () => toast.error("Spotify rechazó la conexión"));
      void player.connect();
    };

    if (window.Spotify) {
      setup();
    } else {
      window.onSpotifyWebPlaybackSDKReady = setup;
      if (!document.getElementById("spotify-sdk")) {
        const script = document.createElement("script");
        script.id = "spotify-sdk";
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        document.body.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      playerRef.current?.disconnect();
      playerRef.current = null;
    };
  }, [status?.connected, status?.premium]);

  const play = useCallback(
    async (
      track: Pick<SpotifyQueueTrack, "trackUri" | "trackName" | "trackArtist" | "trackImageUrl" | "durationMs">,
      queueItemId?: string,
    ) => {
      if (!deviceId) {
        toast.error("El reproductor todavía no está listo — espera unos segundos");
        return;
      }
      try {
        const { accessToken } = await api.get<{ accessToken: string }>("/me/spotify/token");
        await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ uris: [track.trackUri] }),
        });
        await api.post(`/channels/${channelId}/spotify/session`, {
          trackUri: track.trackUri,
          trackName: track.trackName,
          trackArtist: track.trackArtist,
          trackImageUrl: track.trackImageUrl,
          durationMs: track.durationMs,
          positionMs: 0,
          isPlaying: true,
        });
        if (queueItemId) {
          await api.delete(`/spotify/queue/${queueItemId}`);
          setQueue((prev) => prev.filter((t) => t.id !== queueItemId));
        }
      } catch {
        toast.error("No se pudo reproducir");
      }
    },
    [deviceId, channelId],
  );

  const toggle = useCallback(async () => {
    if (!playerRef.current) return;
    await playerRef.current.togglePlay();
    if (session) {
      await api.post(`/channels/${channelId}/spotify/session`, { ...session, isPlaying: !session.isPlaying });
    }
  }, [channelId, session]);

  if (status === null) return null;
  const canControl = status.connected && status.premium && !!deviceId;
  const playing = session?.isPlaying ?? false;

  return (
    <div ref={contenedor} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Música compartida"
        title={session?.trackName ? `Suena: ${session.trackName}` : "Música compartida"}
        className={`relative rounded-full p-1.5 transition ${
          playing ? "text-live" : "text-muted hover:text-ink"
        }`}
      >
        <Music size={14} />
        {playing && (
          <span className="absolute -right-0.5 -top-0.5 size-1.5 animate-pulse-slow rounded-full bg-live" />
        )}
      </button>

      {open && (
        <div
          className={`absolute right-0 z-40 max-h-[28rem] w-80 overflow-y-auto rounded-xl border border-line bg-surface p-3 shadow-xl ${
            panelDirection === "up" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          <div className="mb-2 flex items-center gap-2">
            <Music size={13} className="text-faint" />
            <h3 className="text-xs font-semibold">Música compartida</h3>
          </div>

          {!status.connected && (
            <div className="mb-3 rounded-lg border border-dashed border-line p-2.5 text-[11px] text-faint">
              <p className="mb-2">
                Conecta tu Spotify para reproducir. Sin conectar también puedes buscar y añadir a
                la cola para que otra persona la reproduzca.
              </p>
              <button
                type="button"
                onClick={() => {
                  window.location.href = `${API_URL}/integrations/spotify/authorize`;
                }}
                className="rounded-lg bg-[#1db954] px-3 py-1.5 text-[11px] font-medium text-black"
              >
                Conectar Spotify
              </button>
            </div>
          )}

          {status.connected && !status.premium && (
            <p className="mb-3 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-2 text-[10px] text-warn">
              Tu cuenta no es Premium: puedes añadir a la cola, pero no reproducir.
            </p>
          )}

          <NowPlaying session={session} canControl={canControl} onToggle={toggle} />
          <Queue channelId={channelId} queue={queue} setQueue={setQueue} canPlay={canControl} onPlay={play} />
        </div>
      )}
    </div>
  );
}

function NowPlaying({
  session,
  canControl,
  onToggle,
}: {
  session: SpotifySession;
  canControl: boolean;
  onToggle: () => void;
}) {
  if (!session || !session.trackName) {
    return <p className="mb-3 text-xs text-faint">Nada sonando todavía.</p>;
  }

  return (
    <div className="mb-3 flex items-center gap-3 rounded-lg border border-line bg-canvas p-2.5">
      {session.trackImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={session.trackImageUrl} alt="" className="size-10 shrink-0 rounded object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{session.trackName}</p>
        <p className="truncate text-[11px] text-faint">{session.trackArtist}</p>
      </div>
      {session.durationMs != null && (
        <span className="shrink-0 font-mono text-[10px] text-faint">
          {money(session.positionMs)} / {money(session.durationMs)}
        </span>
      )}
      {canControl && (
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-raised hover:text-ink"
        >
          {session.isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
      )}
    </div>
  );
}

function Queue({
  channelId,
  queue,
  setQueue,
  canPlay,
  onPlay,
}: {
  channelId: string;
  queue: SpotifyQueueTrack[];
  setQueue: React.Dispatch<React.SetStateAction<SpotifyQueueTrack[]>>;
  canPlay: boolean;
  onPlay: (
    track: Pick<SpotifyQueueTrack, "trackUri" | "trackName" | "trackArtist" | "trackImageUrl" | "durationMs">,
    queueItemId: string,
  ) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { tracks } = await api.get<{ tracks: SpotifyTrack[] }>(
          `/spotify/search?q=${encodeURIComponent(query)}`,
        );
        setResults(tracks);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const addToQueue = async (track: SpotifyTrack) => {
    try {
      const { track: added } = await api.post<{ track: SpotifyQueueTrack }>(
        `/channels/${channelId}/spotify/queue`,
        {
          trackUri: track.uri,
          trackName: track.name,
          trackArtist: track.artist,
          trackImageUrl: track.imageUrl,
          durationMs: track.durationMs,
        },
      );
      setQueue((prev) => [...prev, added]);
      setQuery("");
      setResults([]);
      toast.success(`«${track.name}» añadida a la cola`);
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "no se pudo añadir");
    }
  };

  return (
    <div>
      <div className="relative mb-2">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar una canción…"
          className="w-full rounded-lg border border-line bg-canvas py-1.5 pl-8 pr-2.5 text-xs outline-none placeholder:text-faint focus:border-accent/60"
        />
        {searching && (
          <Loader2 size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-faint" />
        )}
      </div>

      {results.length > 0 && (
        <div className="mb-3 space-y-1 rounded-lg border border-line bg-canvas p-1.5">
          {results.map((track) => (
            <button
              key={track.uri}
              type="button"
              onClick={() => void addToQueue(track)}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition hover:bg-raised"
            >
              {track.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={track.imageUrl} alt="" className="size-7 shrink-0 rounded object-cover" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{track.name}</span>
                <span className="block truncate text-[10px] text-faint">{track.artist}</span>
              </span>
              <Plus size={12} className="shrink-0 text-faint" />
            </button>
          ))}
        </div>
      )}

      {queue.length > 0 && (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-faint">
            <ListMusic size={11} />
            Cola
          </p>
          {queue.map((track) => (
            <div key={track.id} className="flex items-center gap-2 rounded-md px-1.5 py-1">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{track.trackName}</span>
                <span className="block truncate text-[10px] text-faint">{track.trackArtist}</span>
              </span>
              {canPlay && (
                <button
                  type="button"
                  onClick={() => void onPlay(track, track.id)}
                  className="shrink-0 rounded p-1 text-faint transition hover:text-ink"
                  title="Reproducir ahora"
                >
                  <Play size={12} />
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  await api.delete(`/spotify/queue/${track.id}`);
                  setQueue((prev) => prev.filter((t) => t.id !== track.id));
                }}
                className="shrink-0 rounded p-1 text-faint transition hover:text-danger"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
