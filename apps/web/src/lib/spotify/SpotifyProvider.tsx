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
import { createPortal } from "react-dom";
import { api, type SpotifyQueueTrack, type SpotifySession } from "../api";
import { useSpotifyPlayer } from "./reproductor";
import { esDeYoutube, useYoutubePlayer } from "../youtube/reproductor";
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
  /** La segunda fuente: estado y controles del reproductor de YouTube. */
  youtube: ReturnType<typeof useYoutubePlayer>;
  /** Lo que suena por YouTube, con el nombre que traía la cola. */
  pistaYt: SpotifyQueueTrack | null;
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

  /**
   * La segunda fuente. Vive aquí y no en el widget por el mismo motivo que la
   * de Spotify: si se montara dentro del widget, irse al tablero cortaría la
   * música. Ver la cabecera de este archivo.
   *
   * `pistaYt` guarda el nombre y la carátula que traía la cola, porque el
   * reproductor de YouTube solo sabe el título del vídeo — y lo que el resto
   * de la sala tiene que ver es lo que se encoló, no lo que YouTube llame a
   * ese vídeo.
   */
  const [nodoYt, setNodoYt] = useState<HTMLDivElement | null>(null);
  const [pistaYt, setPistaYt] = useState<SpotifyQueueTrack | null>(null);
  const siguienteDeLaCola = useRef<() => void>(() => {});
  const youtube = useYoutubePlayer(nodoYt, () => siguienteDeLaCola.current());

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
        /**
         * La bifurcación entre las dos fuentes, y es lo único que hay.
         *
         * El prefijo del `trackUri` ya dice de dónde salió la pista, así que
         * no hace falta ni una columna nueva ni preguntarle a nadie: si es de
         * YouTube la pone su reproductor, y si no sigue el camino de Spotify
         * de siempre, intacto.
         */
        if (esDeYoutube(pista.trackUri)) {
          youtube.poner(pista.trackUri!);
          setPistaYt({
            id: pista.id ?? "",
            isrc: pista.isrc ?? null,
            trackUri: pista.trackUri!,
            trackName: pista.trackName,
            trackArtist: pista.trackArtist,
            trackImageUrl: null,
            durationMs: null,
            addedBy: null,
          } as SpotifyQueueTrack);
          if (pista.id) await quitar(pista.id);
          return;
        }

        // De aquí abajo, Spotify como siempre.
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
    [reproducirUri, quitar, sincronizarConSpotify, direccionAqui, youtube],
  );

  const encolar = useCallback(
    async (pista: SpotifyQueueTrack) => {
      setCola((previa) => (previa.some((t) => t.id === pista.id) ? previa : [...previa, pista]));
      colaRef.current = colaRef.current.some((t) => t.id === pista.id)
        ? colaRef.current
        : [...colaRef.current, pista];

      // Si no suena nada, esto es además la orden de empezar: una cola con cosas
      // dentro que no se mueve parece estropeada.
      //
      // Una pista de YouTube arranca aunque Spotify no esté conectado: no lo
      // necesita, y exigirlo dejaría la cola quieta justo para quien añadimos
      // YouTube en primer lugar.
      if (esDeYoutube(pista.trackUri) && !youtube.estado.reproduciendo) {
        await poner(pista).catch(() => {});
        return;
      }
      if (puedeSonar && (!uriSonando || !sonando)) {
        await poner(pista).catch(() => {});
        return;
      }
      // Y si ya suena algo, va detrás en la cola de Spotify para que enlace.
      await sincronizarConSpotify();
    },
    [puedeSonar, uriSonando, sonando, poner, sincronizarConSpotify, youtube.estado.reproduciendo],
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
   * Encadenar en YouTube, que no tiene cola propia.
   *
   * Spotify sí la tiene: se le entregan las canciones por adelantado y él
   * encadena solo, y por eso allí basta con enterarse del cambio de pista.
   * Aquí el vídeo simplemente termina, así que hay que ir a buscar el
   * siguiente de la cola compartida y ponerlo.
   *
   * Va por referencia y no por dependencia del hook porque quien lo llama es
   * un evento del iframe: una función creada en un renderizado anterior vería
   * la cola de aquel momento, que es justo el caso que importa —alguien
   * añadiendo algo mientras suena—.
   */
  siguienteDeLaCola.current = () => {
    const siguiente = colaRef.current[0];
    if (!siguiente) {
      setPistaYt(null);
      return;
    }
    void poner(siguiente).catch(() => {});
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

  /**
   * Lo mismo para YouTube. La sala ve «qué suena» sin tener que saber de qué
   * servicio salió: es la misma tabla y los mismos campos, y por eso quien no
   * tenga Spotify puede seguir la música del resto igualmente.
   *
   * El nombre y el artista salen de `pistaYt` —lo que se encoló— y no del
   * título del vídeo: si alguien añadió «Radiohead – Creep», eso es lo que la
   * sala debe leer, no «Creep (Official Video) [HD] 4K REMASTERED».
   */
  const ultimoPublicadoYt = useRef("");
  useEffect(() => {
    const sala = canalRef.current;
    if (!sala || !pistaYt || !youtube.estado.videoId) return;

    const firma = `${sala}:${pistaYt.trackUri}:${youtube.estado.reproduciendo}`;
    if (firma === ultimoPublicadoYt.current) return;
    ultimoPublicadoYt.current = firma;

    void api
      .post(`/channels/${sala}/spotify/session`, {
        trackUri: pistaYt.trackUri,
        trackName: pistaYt.trackName,
        trackArtist: pistaYt.trackArtist,
        trackImageUrl: pistaYt.trackImageUrl,
        durationMs: youtube.estado.duracionMs || null,
        positionMs: Math.round(youtube.estado.posicionMs),
        isPlaying: youtube.estado.reproduciendo,
      })
      .catch(() => {});
    // Igual que arriba: la posición viaja en el cuerpo pero no como
    // dependencia, o se publicaría dos veces por segundo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pistaYt, youtube.estado.videoId, youtube.estado.reproduciendo]);

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
    youtube,
    pistaYt,
  };

  return (
    <Contexto.Provider value={valor}>
      {children}
      <PanelYoutube alMontar={setNodoYt} visible={youtube.estado.videoId !== null} />
    </Contexto.Provider>
  );
}

/**
 * El vídeo, en una esquina y a la vista.
 *
 * TIENE QUE VERSE, y no es una decisión de diseño: los términos de YouTube
 * exigen que su reproductor esté visible y sin tapar. Esconderlo detrás de una
 * carátula para dejar solo el sonido quedaría más bonito y es exactamente lo
 * que hacían los bots de música que Google cerró en 2021 — con la clave de la
 * API de por medio, no compensa.
 *
 * El contenedor se monta SIEMPRE, aunque no haya vídeo: el reproductor se
 * engancha a ese nodo al arrancar, y si el nodo apareciera y desapareciera con
 * cada canción habría que volver a montarlo cada vez. Lo que cambia es si se
 * ve, no si existe.
 */
function PanelYoutube({
  alMontar,
  visible,
}: {
  alMontar: (nodo: HTMLDivElement | null) => void;
  visible: boolean;
}) {
  // Montado en el body por un portal, y no donde cae en el árbol.
  //
  // `position: fixed` se mide contra el ancestro más cercano que tenga
  // `transform`, `filter` o `contain` — y este árbol tiene varios, que es
  // justo lo que hacen las animaciones de entrada. El panel acababa a 1.600
  // píxeles del borde superior, fuera de la pantalla, con el CSS correcto y
  // sin ningún error. Colgarlo del body lo saca de esa cadena.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;

  return createPortal(
    <div
      className={`fixed bottom-4 right-4 z-40 overflow-hidden rounded-xl border border-line
        bg-black shadow-[0_8px_32px_-8px_rgb(0_0_0/0.7)] transition-opacity duration-200
        ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
      style={{ width: 256, height: 144 }}
      aria-hidden={!visible}
    >
      <div ref={alMontar} className="size-full" />
    </div>,
    document.body,
  );
}

export function useSpotify(): Valor {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useSpotify debe usarse dentro de SpotifyProvider");
  return ctx;
}
