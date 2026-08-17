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
 *
 * EL ENCADENADO LO HACE SPOTIFY, NO NOSOTROS. Los dos primeros intentos fueron
 * detectar el final de la canción para poner la siguiente, y los dos fallaron
 * por lo mismo: el SDK no manda «terminó». Hay que deducirlo de un `paused` con
 * la posición a 0, que es idéntico a rebobinar — y aun acertando, entre canción
 * y canción quedaba el silencio de nuestra llamada de reproducción.
 *
 * Así que la cola compartida se le ENTREGA a Spotify (`/me/player/queue`) y es
 * él quien enlaza, sin huecos y sin adivinar nada. Nuestra lista sigue siendo
 * la que ve la sala, y se mantiene al día por el otro lado: cada vez que
 * empieza a sonar una pista se saca de la lista, la haya puesto quien sea.
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
  /** Hay una orden de reproducción en curso: la interfaz debe decirlo. */
  poniendo: boolean;
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

  /**
   * Las pistas que ya se le entregaron a la cola de Spotify.
   *
   * Sin esto, cada vez que la cola compartida cambia volveríamos a mandar todo
   * y la misma canción se apilaría varias veces en la cola de Spotify.
   */
  const despachadas = useRef<Set<string>>(new Set());

  const alCambiarPista = useRef<(uri: string) => void>(() => {});
  const player = useSpotifyPlayer(cuenta?.connected ?? false, (uri) => alCambiarPista.current(uri));

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

  const puedeSonar = player.estado.listo && !player.estado.sinPremium;

  /*
   * Lo que sigue depende de VALORES y no del objeto `player`.
   *
   * El hook devuelve un objeto nuevo en cada renderizado, así que meterlo en las
   * dependencias de un `useCallback` lo recrea siempre — y un efecto que dependa
   * de ese callback se dispara en cada renderizado. La primera versión hacía
   * justo eso y acabó pidiendo tokens en bucle hasta comerse el límite de
   * peticiones de la API (429). Extraer las piezas estables lo corta de raíz.
   */
  const encolarEnSpotify = player.encolarEnSpotify;
  const uriSonando = player.estado.pista?.uri ?? null;

  /**
   * Entrega a Spotify todo lo que está en la cola compartida y aún no le hemos
   * pasado. Spotify se encarga del encadenado, sin huecos entre canciones.
   *
   * En serie y no en paralelo: la cola de Spotify respeta el orden en que
   * llegan las peticiones, y con `Promise.all` el orden lo decide la red.
   */
  const sincronizarConSpotify = useCallback(async () => {
    // Sin nada sonando no hay cola donde encolar: Spotify necesita una
    // reproducción activa para aceptar `/me/player/queue`.
    if (!puedeSonar || !uriSonando) return;
    for (const pista of colaRef.current) {
      if (despachadas.current.has(pista.trackUri)) continue;
      try {
        await encolarEnSpotify(pista.trackUri);
        despachadas.current.add(pista.trackUri);
      } catch {
        // Si una falla, se deja sin marcar para reintentarla en la próxima
        // sincronización en vez de perderla en silencio.
        break;
      }
    }
  }, [puedeSonar, uriSonando, encolarEnSpotify]);

  /**
   * Si otra persona de la sala añade algo mientras suena la música, quien
   * pincha tiene que entregárselo a Spotify — el que añadió puede no tener ni
   * Premium ni reproductor, así que no puede hacerlo él.
   *
   * La dependencia es la FIRMA de la cola, no el array: un `useState` devuelve
   * un array nuevo en cada carga aunque el contenido sea idéntico, y con eso el
   * efecto volvería a dispararse sin que haya nada nuevo que entregar.
   */
  const firmaCola = cola.map((t) => t.id).join(",");
  useEffect(() => {
    void sincronizarConSpotify();
  }, [firmaCola, sincronizarConSpotify]);

  /**
   * Una orden de reproducción a la vez.
   *
   * Poner algo tarda un momento en confirmarse, y sin señal en pantalla lo
   * natural es volver a pulsar. Dos órdenes solapadas se estorban —la segunda
   * llega mientras la primera aún está trasladando el dispositivo— y el
   * resultado es que no suena ninguna, que es justo el «hay que darle varias
   * veces» que esto viene a arreglar. El cerrojo va en una referencia y no en
   * el estado porque tiene que ser cierto en el instante, sin esperar a un
   * renderizado.
   */
  const enCurso = useRef(false);
  const [poniendo, setPoniendo] = useState(false);

  const poner = useCallback(
    async (pista: Ponible) => {
      if (enCurso.current) return;
      enCurso.current = true;
      setPoniendo(true);
      try {
        await player.reproducirUri(pista.trackUri);
        // Al poner algo se rompe la cola que Spotify tenía montada, así que lo
        // despachado deja de ser válido y hay que volver a entregarlo.
        despachadas.current.clear();
        despachadas.current.add(pista.trackUri);
        if (pista.id) await quitar(pista.id);
        await sincronizarConSpotify();
      } finally {
        enCurso.current = false;
        setPoniendo(false);
      }
    },
    [player, quitar, sincronizarConSpotify],
  );

  const encolar = useCallback(
    async (pista: SpotifyQueueTrack) => {
      setCola((previa) => (previa.some((t) => t.id === pista.id) ? previa : [...previa, pista]));
      colaRef.current = colaRef.current.some((t) => t.id === pista.id)
        ? colaRef.current
        : [...colaRef.current, pista];

      // Si no suena nada, esto es además la orden de empezar: una cola con cosas
      // dentro que no se mueve parece estropeada.
      const nadaSonando = !player.estado.pista || !player.estado.reproduciendo;
      if (puedeSonar && nadaSonando) {
        await poner(pista).catch(() => {});
        return;
      }
      // Y si ya suena algo, va detrás en la cola de Spotify para que enlace.
      await sincronizarConSpotify();
    },
    [player.estado.pista, player.estado.reproduciendo, puedeSonar, poner, sincronizarConSpotify],
  );

  /**
   * Cuando empieza a sonar una pista, sacarla de la cola compartida.
   *
   * Da igual quién la haya puesto: si la encadenó Spotify, este es el único
   * momento en que nos enteramos. Así lo que se ve en la lista es siempre lo
   * que queda por sonar, que es lo que la palabra «cola» promete.
   */
  alCambiarPista.current = (uri: string) => {
    setCola((previa) => {
      const siguiente = previa.filter((t) => t.trackUri !== uri);
      if (siguiente.length === previa.length) return previa;
      colaRef.current = siguiente;
      // Y se limpia de la base, que es la lista que ve el resto de la sala.
      for (const ida of previa.filter((t) => t.trackUri === uri)) {
        void api.delete(`/spotify/queue/${ida.id}`).catch(() => {});
      }
      return siguiente;
    });
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
    poniendo,
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
