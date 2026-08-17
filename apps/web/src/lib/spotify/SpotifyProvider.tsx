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
 * UNA SOLA COLA, Y AQUÍ. La primera versión guardaba la cola en dos sitios —
 * aquí y en el widget— y eso rompía el encadenado de una forma difícil de ver:
 * al poner una canción, el widget la quitaba de SU copia mientras el proveedor
 * seguía con la suya, así que al acabar la canción el encadenado leía una cola
 * vieja y volvía a poner lo mismo. Ahora la cola de la sala que se está mirando
 * vive solo en este proveedor, y el widget únicamente la pinta.
 */
type Cuenta = { connected: boolean; premium: boolean };

/**
 * Algo que se puede poner a sonar.
 *
 * `id` es opcional a propósito: una pista de la cola lo tiene y hay que sacarla
 * al ponerla, pero un resultado de búsqueda que se pone directamente no está en
 * ninguna cola y no hay nada que sacar. Un solo tipo para las dos cosas evita
 * dos caminos de reproducción que se desincronizan.
 */
export type Ponible = {
  trackUri: string;
  trackName: string;
  trackArtist: string;
  id?: string;
};

type Valor = {
  player: ReturnType<typeof useSpotifyPlayer>;
  cuenta: Cuenta | null;
  /** La sala cuya música se gobierna y cuya cola se muestra. */
  canal: string | null;
  cola: SpotifyQueueTrack[];
  sesion: SpotifySession;
  /** Declara qué sala se está mirando. La llama el widget al montarse. */
  verCanal: (channelId: string) => void;
  refrescar: (channelId: string) => Promise<void>;
  /** Pone una pista y, si venía de la cola, la saca. */
  poner: (pista: Ponible) => Promise<void>;
  /** Añade a la cola. Si no suena nada, arranca en el momento. */
  encolar: (pista: SpotifyQueueTrack) => Promise<void>;
  quitar: (id: string) => Promise<void>;
};

const Contexto = createContext<Valor | null>(null);

export function SpotifyProvider({ children }: { children: ReactNode }) {
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [canal, setCanal] = useState<string | null>(null);
  const [cola, setCola] = useState<SpotifyQueueTrack[]>([]);
  const [sesion, setSesion] = useState<SpotifySession>(null);

  // Referencias además del estado: el encadenado se dispara desde un evento del
  // SDK, y una función creada en un renderizado anterior vería la cola de aquel
  // momento — justo el caso que importa, alguien añadiendo una canción mientras
  // suena otra.
  const colaRef = useRef<SpotifyQueueTrack[]>([]);
  colaRef.current = cola;
  const canalRef = useRef<string | null>(null);
  canalRef.current = canal;

  const encadenar = useRef<() => void>(() => {});
  const player = useSpotifyPlayer(cuenta?.connected ?? false, () => encadenar.current());

  useEffect(() => {
    void api
      .get<Cuenta>("/me/spotify/status")
      .then(setCuenta)
      .catch(() => setCuenta({ connected: false, premium: false }));
  }, []);

  const refrescar = useCallback(async (channelId: string) => {
    const [{ queue }, { session }] = await Promise.all([
      api.get<{ queue: SpotifyQueueTrack[] }>(`/channels/${channelId}/spotify/queue`),
      api.get<{ session: SpotifySession }>(`/channels/${channelId}/spotify/session`),
    ]);
    setCola(queue);
    setSesion(session);
  }, []);

  const verCanal = useCallback(
    (channelId: string) => {
      if (canalRef.current === channelId) return;
      canalRef.current = channelId;
      setCanal(channelId);
      void refrescar(channelId);
    },
    [refrescar],
  );

  /** Saca una pista de la cola, en la base y en pantalla. */
  const quitar = useCallback(async (id: string) => {
    setCola((previa) => previa.filter((t) => t.id !== id));
    await api.delete(`/spotify/queue/${id}`).catch(() => {});
  }, []);

  const poner = useCallback(
    async (pista: Ponible) => {
      await player.reproducirUri(pista.trackUri);
      // Se quita al EMPEZAR a sonar, no al acabar: lo que queda en la lista es
      // lo que queda por sonar, que es lo que la palabra «cola» promete.
      if (pista.id) await quitar(pista.id);
    },
    [player, quitar],
  );

  const encolar = useCallback(
    async (pista: SpotifyQueueTrack) => {
      setCola((previa) => (previa.some((t) => t.id === pista.id) ? previa : [...previa, pista]));

      // Si no hay nada sonando, esto es además la orden de empezar: una cola con
      // cosas dentro que no se mueve parece estropeada.
      const nadaSonando = !player.estado.pista || !player.estado.reproduciendo;
      if (player.estado.listo && !player.estado.sinPremium && nadaSonando) {
        await poner(pista).catch(() => {});
      }
    },
    [player.estado.pista, player.estado.reproduciendo, player.estado.listo, player.estado.sinPremium, poner],
  );

  /**
   * Al acabar una canción, la siguiente de la cola.
   *
   * Es lo que convierte la cola en una cola de verdad: antes cada canción
   * terminaba en silencio. Si la cola está vacía no hace nada — y eso es
   * correcto: no inventamos qué poner.
   */
  encadenar.current = () => {
    const siguiente = colaRef.current[0];
    if (!canalRef.current || !siguiente) return;
    void poner(siguiente).catch(() => {});
  };

  /**
   * Publicar al resto de la sala qué suena. Solo al cambiar de canción o de
   * play a pausa: en cada tic del contador serían cuatro escrituras por segundo
   * y por persona.
   */
  const ultimoPublicado = useRef("");
  useEffect(() => {
    const sala = canalRef.current;
    const pista = player.estado.pista;
    if (!sala || !pista) return;

    const firma = `${sala}:${pista.uri}:${player.estado.reproduciendo}`;
    if (firma === ultimoPublicado.current) return;
    ultimoPublicado.current = firma;

    void api
      .post(`/channels/${sala}/spotify/session`, {
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
    canal,
    cola,
    sesion,
    verCanal,
    refrescar,
    poner,
    encolar,
    quitar,
  };

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSpotify(): Valor {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useSpotify debe usarse dentro de SpotifyProvider");
  return ctx;
}
