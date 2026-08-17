"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type SpotifyQueueTrack, type SpotifySession } from "../api";
import { useSpotifyPlayer } from "./useSpotifyPlayer";

/**
 * La música vive aquí, no en la página del canal.
 *
 * Es exactamente la misma corrección que ya hizo falta para las llamadas (ver
 * VoiceCallProvider): mientras `useSpotifyPlayer` se llamaba dentro del widget,
 * y el widget solo estaba montado en la cabecera de un canal de voz, irse al
 * tablero o a la biblioteca lo desmontaba — y su limpieza llama a
 * `disconnect()`, así que la música se cortaba. No era un fallo del
 * reproductor: era que el reproductor dejaba de existir.
 *
 * Montado una sola vez en el layout de `/app`, el SDK sobrevive a cualquier
 * navegación dentro de la aplicación. Lo que se monta y desmonta al navegar es
 * el panel que lo controla, que es otra cosa.
 *
 * UNA SALA A LA VEZ. La cola y lo que suena cuelgan de un canal, y aquí se
 * gobierna solo el canal donde se puso música. Si alguien abre el widget en
 * otro canal, se le dice dónde está sonando en vez de fingir que la cola de
 * este es la que manda — dos colas compitiendo por un solo reproductor es cómo
 * se acaba con una canción que nadie entiende de dónde salió.
 */
type Cuenta = { connected: boolean; premium: boolean };

type Valor = {
  player: ReturnType<typeof useSpotifyPlayer>;
  cuenta: Cuenta | null;
  /** El canal cuya música gobierna este reproductor, o null si no hay ninguna. */
  canalMusica: string | null;
  cola: SpotifyQueueTrack[];
  sesion: SpotifySession;
  /** Toma el mando de la música de este canal. La llama cualquier acción de poner algo. */
  tomarCanal: (channelId: string) => void;
  refrescarCola: (channelId: string) => Promise<void>;
  refrescarSesion: (channelId: string) => Promise<void>;
  setCola: React.Dispatch<React.SetStateAction<SpotifyQueueTrack[]>>;
};

const Contexto = createContext<Valor | null>(null);

export function SpotifyProvider({ children }: { children: ReactNode }) {
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [canalMusica, setCanalMusica] = useState<string | null>(null);
  const [cola, setCola] = useState<SpotifyQueueTrack[]>([]);
  const [sesion, setSesion] = useState<SpotifySession>(null);

  // La cola en una referencia además del estado: el encadenado se dispara desde
  // un evento del SDK, y una función creada en un renderizado anterior vería la
  // cola de aquel momento — justo el caso que importa, alguien añadiendo una
  // canción mientras suena otra.
  const colaRef = useRef<SpotifyQueueTrack[]>([]);
  colaRef.current = cola;
  const canalRef = useRef<string | null>(null);
  canalRef.current = canalMusica;

  const encadenar = useRef<() => void>(() => {});
  const player = useSpotifyPlayer(cuenta?.connected ?? false, () => encadenar.current());

  useEffect(() => {
    void api
      .get<Cuenta>("/me/spotify/status")
      .then(setCuenta)
      .catch(() => setCuenta({ connected: false, premium: false }));
  }, []);

  const refrescarCola = useCallback(async (channelId: string) => {
    const { queue } = await api.get<{ queue: SpotifyQueueTrack[] }>(
      `/channels/${channelId}/spotify/queue`,
    );
    setCola(queue);
  }, []);

  const refrescarSesion = useCallback(async (channelId: string) => {
    const { session } = await api.get<{ session: SpotifySession }>(
      `/channels/${channelId}/spotify/session`,
    );
    setSesion(session);
  }, []);

  const tomarCanal = useCallback(
    (channelId: string) => {
      if (canalRef.current === channelId) return;
      setCanalMusica(channelId);
      void refrescarCola(channelId);
      void refrescarSesion(channelId);
    },
    [refrescarCola, refrescarSesion],
  );

  /**
   * Al acabar una canción, la siguiente de la cola.
   *
   * Es lo que convierte la cola en una cola de verdad: antes, cada canción
   * terminaba en silencio y había que volver a darle a play. La pista se quita
   * de la cola al empezar a sonar, no al terminar — así lo que se ve en la
   * lista es lo que queda por sonar, que es lo que la palabra «cola» promete.
   */
  encadenar.current = () => {
    const canal = canalRef.current;
    const siguiente = colaRef.current[0];
    if (!canal || !siguiente) return;

    void player
      .reproducirUri(siguiente.trackUri)
      .then(async () => {
        await api.delete(`/spotify/queue/${siguiente.id}`).catch(() => {});
        setCola((previa) => previa.filter((t) => t.id !== siguiente.id));
      })
      .catch(() => {});
  };

  /**
   * Publicar al resto de la sala qué suena. Solo al cambiar de canción o de
   * play a pausa: en cada tic del contador serían cuatro escrituras por segundo
   * y por persona.
   */
  const ultimoPublicado = useRef("");
  useEffect(() => {
    const canal = canalRef.current;
    const pista = player.estado.pista;
    if (!canal || !pista) return;

    const firma = `${canal}:${pista.uri}:${player.estado.reproduciendo}`;
    if (firma === ultimoPublicado.current) return;
    ultimoPublicado.current = firma;

    void api
      .post(`/channels/${canal}/spotify/session`, {
        trackUri: pista.uri,
        trackName: pista.nombre,
        trackArtist: pista.artista,
        trackImageUrl: pista.caratula,
        durationMs: pista.duracionMs,
        positionMs: Math.round(player.estado.posicionMs),
        isPlaying: player.estado.reproduciendo,
      })
      .catch(() => {});
    // `posicionMs` va en el cuerpo como instantánea pero fuera de las
    // dependencias: si entrara, publicaríamos sin parar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.estado.pista, player.estado.reproduciendo]);

  const valor: Valor = {
    player,
    cuenta,
    canalMusica,
    cola,
    sesion,
    tomarCanal,
    refrescarCola,
    refrescarSesion,
    setCola,
  };

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSpotify(): Valor {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useSpotify debe usarse dentro de SpotifyProvider");
  return ctx;
}
