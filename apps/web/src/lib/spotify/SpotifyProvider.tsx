"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, type SpotifyQueueTrack, type SpotifySession } from "../api";
import { useSpotifyPlayer } from "./reproductor";
import { toast } from "sonner";

/**
 * La música vive aquí, no en la página del canal.
 *
 * Es la misma corrección que ya hizo falta para las llamadas (ver
 * `VoiceCallProvider`): mientras el reproductor se montaba dentro del widget, y
 * el widget solo existía en la cabecera de un canal de voz, irse al tablero lo
 * desmontaba — y su limpieza llama a `disconnect()`, así que la música se
 * cortaba. No era un fallo del reproductor: era que el reproductor dejaba de
 * existir.
 *
 * Tres decisiones que parecen rodeos y no lo son:
 *
 * **Una sola cola, y aquí.** La primera versión la guardaba en dos sitios —este
 * proveedor y el widget— y eso rompía el encadenado de forma difícil de ver: al
 * poner una canción el widget la quitaba de SU copia mientras el proveedor
 * seguía con la suya, así que al terminar se leía una cola vieja y volvía a
 * sonar lo mismo. Ahora el widget solo pinta.
 *
 * **El encadenado lo hace Spotify.** Los dos primeros intentos detectaban el
 * final de la canción para poner la siguiente, y fallaron por lo mismo: el SDK
 * no manda «terminó». Hay que deducirlo de un `paused` con la posición a cero,
 * que es idéntico a rebobinar — y aun acertando quedaba un silencio entre
 * canción y canción. Así que la cola se le ENTREGA a Spotify
 * (`/me/player/queue`) y enlaza él, sin huecos y sin adivinar.
 *
 * **Las dependencias son valores, nunca el objeto `player`.** El hook devuelve
 * un objeto nuevo en cada renderizado; meterlo en un `useCallback` lo recrea
 * siempre, y un efecto que dependa de ese callback se dispara sin parar. La
 * primera versión hacía justo eso y acabó pidiendo tokens en bucle hasta comerse
 * el límite de peticiones (429).
 */

type Cuenta = { connected: boolean; premium: boolean };

/**
 * Algo que se puede poner a sonar.
 *
 * `id` es opcional a propósito: una pista de la cola lo tiene y hay que sacarla
 * al ponerla, pero un resultado de búsqueda que se pone directamente no está en
 * ninguna cola y no hay nada que sacar. Un solo tipo para las dos cosas evita
 * dos caminos de reproducción que acaban desincronizados.
 */
/**
 * Algo que se puede poner a sonar.
 *
 * `trackUri` ya no es obligatorio: desde que la cola guarda la canción y no
 * el enlace, hay pistas que solo traen ISRC y su dirección en Spotify se
 * resuelve en el momento. Lo que no puede faltar es una de las dos.
 */
export type Ponible = {
  trackUri?: string | null;
  isrc?: string | null;
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
  /** Cierra la sesión de Spotify de esta cuenta. */
  desconectar: () => Promise<void>;
};

const Contexto = createContext<Valor | null>(null);

export function SpotifyProvider({ children }: { children: ReactNode }) {
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [canal, setCanal] = useState<string | null>(null);
  const [cola, setCola] = useState<SpotifyQueueTrack[]>([]);
  const [sesion, setSesion] = useState<SpotifySession>(null);

  // Referencias además del estado: el encadenado se dispara desde un evento del
  // SDK, y una función creada en un renderizado anterior vería la cola de aquel
  // momento — justo el caso que importa, alguien añadiendo algo mientras suena.
  const colaRef = useRef<SpotifyQueueTrack[]>([]);
  colaRef.current = cola;
  const canalRef = useRef<string | null>(null);
  canalRef.current = canal;

  /**
   * Lo que ya se le entregó a la cola de Spotify. Sin esto, cada cambio en la
   * cola compartida reenviaría todo y la misma canción se apilaría varias veces.
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

  /** Saca una pista de la cola, en pantalla y en la base. */
  const quitar = useCallback(async (id: string) => {
    setCola((previa) => previa.filter((t) => t.id !== id));
    await api.delete(`/spotify/queue/${id}`).catch(() => {});
  }, []);

  /**
   * Cierra la sesión de Spotify de esta cuenta.
   *
   * Basta con borrar la conexión y marcar la cuenta como desconectada: el motor
   * observa ese valor y su propia limpieza llama a `disconnect()` al ver que
   * deja de estar activo — repetirlo aquí sería la misma limpieza dos veces.
   *
   * Lo que suena en la sala para el resto no se toca: la sesión compartida es
   * del canal, no de esta cuenta, y desconectarse no debería callar lo que los
   * demás estaban escuchando.
   */
  const desconectar = useCallback(async () => {
    await api.delete("/integrations/spotify");
    setCuenta({ connected: false, premium: false });
  }, []);

  const puedeSonar = player.estado.listo && !player.estado.sinPremium;
  const encolarEnSpotify = player.encolarEnSpotify;
  const reproducirUri = player.reproducirUri;
  const uriSonando = player.estado.pista?.uri ?? null;
  const sonando = player.estado.reproduciendo;

  /**
   * Entrega a Spotify todo lo que está en la cola compartida y aún no le hemos
   * pasado, para que encadene sin huecos.
   *
   * En serie y no en paralelo: la cola de Spotify respeta el orden en que llegan
   * las peticiones, y con `Promise.all` el orden lo decidiría la red.
   */
  /**
   * Cómo se llama esta canción en Spotify.
   *
   * Si viene con dirección de Spotify, esa. Si no —porque la añadió alguien
   * desde otro servicio, o porque solo se guardó el ISRC—, se pregunta a la
   * API, que la busca por su identificador internacional.
   *
   * Lo resuelto se recuerda para el resto de la sesión: el ISRC de una
   * canción no cambia, y volver a buscarlo en cada sincronización sería una
   * petición por canción y por ciclo.
   */
  const resueltas = useRef(new Map<string, string | null>());

  const direccionAqui = useCallback(async (pista: Ponible) => {
    if (pista.trackUri?.startsWith("spotify:")) return pista.trackUri;
    if (!pista.isrc) return null;
    if (resueltas.current.has(pista.isrc)) return resueltas.current.get(pista.isrc) ?? null;

    const { track } = await api.get<{ track: { uri: string } | null }>(
      `/spotify/resolver?isrc=${encodeURIComponent(pista.isrc)}`,
    );
    const uri = track?.uri ?? null;
    resueltas.current.set(pista.isrc, uri);
    return uri;
  }, []);

  const sincronizarConSpotify = useCallback(async () => {
    // Sin nada sonando no hay cola donde encolar: Spotify necesita una
    // reproducción activa para aceptar `/me/player/queue`.
    if (!puedeSonar || !uriSonando) return;
    for (const pista of colaRef.current) {
      // Se lleva la cuenta por identificador de fila y no por dirección: una
      // canción sin dirección propia no tendría con qué marcarse, y la misma
      // canción añadida dos veces a propósito son dos filas y suena dos veces.
      if (despachadas.current.has(pista.id)) continue;
      try {
        const uri = await direccionAqui(pista);
        // Sin dirección en este catálogo no se puede hacer nada, pero tampoco
        // es un fallo: se marca como despachada para no volver a buscarla en
        // cada sincronización y se sigue con la siguiente.
        if (uri) await encolarEnSpotify(uri);
        despachadas.current.add(pista.id);
      } catch {
        // Si una falla se deja sin marcar, para reintentarla en la siguiente
        // sincronización en vez de perderla en silencio.
        break;
      }
    }
  }, [puedeSonar, uriSonando, encolarEnSpotify, direccionAqui]);

  /**
   * Si otra persona de la sala añade algo mientras suena la música, quien pincha
   * tiene que entregárselo a Spotify: el que añadió puede no tener ni Premium ni
   * reproductor, así que no puede hacerlo él.
   *
   * La dependencia es la FIRMA de la cola, no el array: `useState` devuelve un
   * array nuevo en cada carga aunque el contenido sea idéntico, y con eso el
   * efecto se dispararía sin que haya nada nuevo que entregar.
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
   * llega mientras la primera todavía traslada el dispositivo— y el resultado es
   * que no suena ninguna: justo el «hay que darle varias veces» que esto viene a
   * arreglar. El cerrojo va en una referencia y no en el estado porque tiene que
   * ser cierto en el instante, sin esperar a un renderizado.
   */
  const enCurso = useRef(false);
  const [poniendo, setPoniendo] = useState(false);

  const poner = useCallback(
    async (pista: Ponible) => {
      if (enCurso.current) return;
      enCurso.current = true;
      setPoniendo(true);
      try {
        // Una pista puede venir sin dirección de Spotify —la añadió alguien
        // desde otro servicio— y entonces hay que preguntar por su ISRC. Si
        // tampoco está en este catálogo, no se puede poner y se dice: dejarlo
        // en silencio parecería que el botón no funciona.
        const uri = await direccionAqui(pista);
        if (!uri) {
          toast.error(`«${pista.trackName}» no está en Spotify.`);
          return;
        }
        await reproducirUri(uri);
        // Poner algo rompe la cola que Spotify tenía montada, así que lo
        // despachado deja de valer y hay que volver a entregarlo.
        despachadas.current.clear();
        if (pista.id) {
          despachadas.current.add(pista.id);
          await quitar(pista.id);
        }
        await sincronizarConSpotify();
      } finally {
        enCurso.current = false;
        setPoniendo(false);
      }
    },
    [reproducirUri, quitar, sincronizarConSpotify, direccionAqui],
  );

  const encolar = useCallback(
    async (pista: SpotifyQueueTrack) => {
      setCola((previa) => (previa.some((t) => t.id === pista.id) ? previa : [...previa, pista]));
      colaRef.current = colaRef.current.some((t) => t.id === pista.id)
        ? colaRef.current
        : [...colaRef.current, pista];

      // Si no suena nada, esto es además la orden de empezar: una cola con cosas
      // dentro que no se mueve parece estropeada.
      if (puedeSonar && (!uriSonando || !sonando)) {
        await poner(pista).catch(() => {});
        return;
      }
      // Y si ya suena algo, va detrás en la cola de Spotify para que enlace.
      await sincronizarConSpotify();
    },
    [puedeSonar, uriSonando, sonando, poner, sincronizarConSpotify],
  );

  /**
   * Cuando empieza a sonar una pista, sacarla de la cola compartida.
   *
   * Da igual quién la pusiera: si la encadenó Spotify, este es el único momento
   * en que nos enteramos. Así la lista enseña siempre lo que queda por sonar,
   * que es lo que la palabra «cola» promete.
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
   * Publicar al resto de la sala qué suena. Solo al cambiar de canción o de play
   * a pausa: en cada tic del contador serían cuatro escrituras por segundo y por
   * persona.
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
    // `posicionMs` viaja en el cuerpo como instantánea pero queda fuera de las
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
    desconectar,
  };

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSpotify(): Valor {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useSpotify debe usarse dentro de SpotifyProvider");
  return ctx;
}
