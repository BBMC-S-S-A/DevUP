"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

/**
 * El reproductor de Spotify dentro de DevUP.
 *
 * Este hook posee el Web Playback SDK y lo convierte en algo con lo que se
 * puede construir un reproductor de verdad: posición que avanza, transporte
 * completo, volumen, aleatorio, repetición y lista de dispositivos.
 *
 * TRES COSAS QUE NO SON OBVIAS Y EXPLICAN CASI TODO EL ARCHIVO:
 *
 * 1. `player_state_changed` NO va contando. Manda el estado cuando algo cambia
 *    —play, pausa, salto, cambio de canción— y ahí se acabó. Si la barra de
 *    progreso dependiera solo de ese evento, se quedaría clavada mientras suena
 *    la canción. Por eso hay un contador local que avanza con el reloj del
 *    navegador y se resincroniza con cada evento: el evento manda, el contador
 *    solo rellena los huecos.
 *
 * 2. El SDK controla ESTE navegador; el resto de Spotify se controla por su API
 *    HTTP. Aleatorio, repetición, dispositivos y transferir la reproducción no
 *    existen como métodos del SDK, así que van por `fetch` con el token del
 *    usuario. No es una inconsistencia nuestra: es cómo está partida su API.
 *
 * 3. Una cuenta sin Premium falla en `account_error`, no al conectar. El SDK se
 *    inicializa igual y solo protesta después, así que no se puede decidir por
 *    adelantado si va a funcionar — hay que escuchar ese error y degradar a
 *    modo espectador cuando llega.
 */

export type PistaActual = {
  uri: string;
  nombre: string;
  artista: string;
  album: string;
  caratula: string | null;
  duracionMs: number;
};

export type EstadoReproductor = {
  /** El SDK está montado y tiene dispositivo. */
  listo: boolean;
  /** Spotify rechazó la cuenta: casi siempre, que no es Premium. */
  sinPremium: boolean;
  /**
   * El SDK no arrancó por algo que no es la cuenta: DRM no disponible en este
   * navegador, script bloqueado, token rechazado. Se guarda para poder DECIRLO:
   * un reproductor sin botones y sin explicación es indistinguible de uno roto.
   */
  fallo: string | null;
  dispositivoId: string | null;
  pista: PistaActual | null;
  posicionMs: number;
  duracionMs: number;
  reproduciendo: boolean;
  volumen: number;
  aleatorio: boolean;
  /** 0 sin repetición · 1 repetir contexto · 2 repetir pista. */
  repeticion: 0 | 1 | 2;
};

type SdkPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (evento: string, cb: (carga: unknown) => void) => void;
  togglePlay: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  setVolume: (v: number) => Promise<void>;
  activateElement: () => Promise<void>;
  /** El estado real de ESTE reproductor. Es la única fuente que no miente. */
  getCurrentState: () => Promise<SdkEstado | null>;
};

type SdkEstado = {
  paused: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat_mode: 0 | 1 | 2;
  track_window: {
    current_track: {
      uri: string;
      name: string;
      duration_ms: number;
      artists: { name: string }[];
      album: { name: string; images: { url: string }[] };
    } | null;
  };
};

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (opciones: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SdkPlayer;
    };
  }
}

const ESTADO_INICIAL: EstadoReproductor = {
  listo: false,
  sinPremium: false,
  fallo: null,
  dispositivoId: null,
  pista: null,
  posicionMs: 0,
  duracionMs: 0,
  reproduciendo: false,
  volumen: 0.7,
  aleatorio: false,
  repeticion: 0,
};

/** Trae un token fresco. La API lo refresca sola si caducó. */
async function tokenFresco(): Promise<string> {
  const { accessToken } = await api.get<{ accessToken: string }>("/me/spotify/token");
  return accessToken;
}

/**
 * Llama a la API HTTP de Spotify con el token del usuario.
 *
 * Un 204 (que es lo que devuelven casi todos los controles de reproducción)
 * no trae cuerpo, así que devolver `response.json()` a secas reventaría.
 */
async function llamarSpotify(
  ruta: string,
  init: RequestInit = {},
): Promise<unknown> {
  const token = await tokenFresco();
  const respuesta = await fetch(`https://api.spotify.com/v1${ruta}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!respuesta.ok) throw new Error(`Spotify respondió ${respuesta.status} en ${ruta}`);
  if (respuesta.status === 204) return null;
  const texto = await respuesta.text();
  return texto ? JSON.parse(texto) : null;
}

export type Playlist = {
  id: string;
  uri: string;
  nombre: string;
  caratula: string | null;
  pistas: number;
  de: string;
};

/**
 * @param activo Monta el SDK solo si la cuenta está conectada.
 * @param onPistaCambiada Se llama con la URI cada vez que empieza a sonar una
 *   pista distinta — la haya puesto quien sea, incluida la cola de Spotify. El
 *   proveedor lo usa para sacar de la cola compartida lo que ya está sonando.
 *
 *   Es un HECHO observable, no una deducción. La versión anterior avisaba de
 *   «terminó la canción», que el SDK no manda: había que inferirlo de un
 *   `paused` con la posición a 0, y eso es indistinguible de rebobinar.
 */
/**
 * Reintenta lo que se arregla esperando, y solo eso.
 *
 * El dispositivo que crea el Web Playback SDK no existe para el backend de
 * Spotify en el mismo instante en que el SDK dice `ready`: tarda un momento en
 * registrarse. Si la primera orden de reproducir llega en ese hueco, responde
 * 404 «Device not found» — y desde fuera eso se ve como «hay que darle al play
 * dos o tres veces para que suene».
 *
 * Se reintenta 404 (aún no registrado) y 502/503 (su servicio, de paso). Un 403
 * es «esta cuenta no puede», y un 401 es un token malo: reintentar esos solo
 * gasta llamadas y retrasa el mensaje de error de verdad.
 */
async function conReintento<T>(fn: () => Promise<T>, intentos = 3): Promise<T> {
  let ultimo: unknown;
  for (let intento = 0; intento < intentos; intento += 1) {
    try {
      return await fn();
    } catch (fallo) {
      ultimo = fallo;
      const mensaje = fallo instanceof Error ? fallo.message : String(fallo);
      if (!/respondió (404|502|503)/.test(mensaje)) throw fallo;
      // Espera creciente y corta: 250, 500, 750 ms. Más que suficiente para que
      // el dispositivo aparezca, y poco para que no se note como lentitud.
      await new Promise((listo) => setTimeout(listo, 250 * (intento + 1)));
    }
  }
  throw ultimo;
}

export function useSpotifyPlayer(activo: boolean, onPistaCambiada?: (uri: string) => void) {
  const [estado, setEstado] = useState<EstadoReproductor>(ESTADO_INICIAL);
  const reproductor = useRef<SdkPlayer | null>(null);

  // La referencia evita que cambiar el callback vuelva a montar el SDK: si
  // fuera dependencia del efecto, cada renderizado del widget reconectaría el
  // reproductor y cortaría la música.
  const cambiada = useRef(onPistaCambiada);
  cambiada.current = onPistaCambiada;

  /** La última URI que sonó, para avisar solo de los cambios de verdad. */
  const ultimaUri = useRef<string | null>(null);

  /**
   * Quien esté esperando a que el SDK anuncie un dispositivo nuevo.
   *
   * Hace falta porque el identificador de dispositivo CADUCA: Spotify lo retira
   * tras un rato de inactividad y entonces toda orden contra él responde 404
   * para siempre. Reintentar no arregla eso — hay que crear uno nuevo y esperar
   * su `ready`, que es un evento y no una promesa.
   */
  const esperandoDispositivo = useRef<((id: string | null) => void) | null>(null);

  // Ancla para el contador local: en qué posición estábamos y cuándo. La
  // posición mostrada se calcula desde aquí, no se acumula — acumular deriva.
  const ancla = useRef({ posicionMs: 0, en: 0, corriendo: false });
  // Mientras se arrastra la barra, el contador no debe pisar al dedo.
  const arrastrando = useRef(false);

  // --- Montar el SDK ---------------------------------------------------------
  useEffect(() => {
    if (!activo) return;

    let cancelado = false;

    /**
     * El SDK puede quedarse callado para siempre: `connect()` resuelve `true` y
     * `ready` no llega nunca —pasa cuando el navegador no tiene el módulo de
     * contenido protegido y la negociación de DRM muere sin lanzar ningún
     * evento—. Sin este plazo, la interfaz se queda esperando en silencio y
     * quien mira solo ve un reproductor sin botones, que es indistinguible de
     * un fallo nuestro. Doce segundos: más que de sobra en una conexión mala.
     */
    const paciencia = setTimeout(() => {
      if (cancelado) return;
      setEstado((e) =>
        e.listo || e.sinPremium || e.fallo
          ? e
          : { ...e, fallo: "el reproductor no arrancó en este navegador" },
      );
    }, 12_000);

    const montar = () => {
      if (cancelado || !window.Spotify) return;

      const p = new window.Spotify.Player({
        name: "DevUP",
        getOAuthToken: (cb) => {
          void tokenFresco()
            .then(cb)
            .catch(() => {});
        },
        volume: ESTADO_INICIAL.volumen,
      });
      reproductor.current = p;

      p.addListener("ready", (carga) => {
        const { device_id } = carga as { device_id: string };
        if (cancelado) return;
        clearTimeout(paciencia);
        setEstado((e) => ({ ...e, listo: true, fallo: null, dispositivoId: device_id }));
        // Despertar a quien estuviera esperando un dispositivo nuevo.
        const esperando = esperandoDispositivo.current;
        esperandoDispositivo.current = null;
        esperando?.(device_id);
      });

      p.addListener("not_ready", () => {
        if (!cancelado) setEstado((e) => ({ ...e, listo: false }));
      });

      p.addListener("player_state_changed", (carga) => {
        if (cancelado) return;
        const s = carga as SdkEstado | null;

        // null significa que la reproducción se fue a otro dispositivo. No es
        // un error: es que este navegador ya no es el que suena.
        if (!s) {
          ancla.current.corriendo = false;
          setEstado((e) => ({ ...e, reproduciendo: false }));
          return;
        }

        const pista = s.track_window.current_track;

        // Cambió la pista: avisar una sola vez por canción. Cubre tanto lo que
        // ponemos nosotros como lo que encadena la cola de Spotify, que es
        // justo lo que hay que saber para mantener la cola compartida al día.
        if (pista?.uri && pista.uri !== ultimaUri.current) {
          ultimaUri.current = pista.uri;
          cambiada.current?.(pista.uri);
        }

        ancla.current = { posicionMs: s.position, en: performance.now(), corriendo: !s.paused };

        setEstado((e) => ({
          ...e,
          reproduciendo: !s.paused,
          posicionMs: s.position,
          duracionMs: s.duration,
          aleatorio: s.shuffle,
          repeticion: s.repeat_mode,
          pista: pista
            ? {
                uri: pista.uri,
                nombre: pista.name,
                artista: pista.artists.map((a) => a.name).join(", "),
                album: pista.album.name,
                caratula: pista.album.images[0]?.url ?? null,
                duracionMs: pista.duration_ms,
              }
            : null,
        }));
      });

      // Una cuenta gratuita llega hasta aquí y falla justo en este punto.
      p.addListener("account_error", () => {
        if (!cancelado) {
          clearTimeout(paciencia);
          setEstado((e) => ({ ...e, sinPremium: true, listo: false }));
        }
      });
      p.addListener("initialization_error", () => {
        if (!cancelado) {
          clearTimeout(paciencia);
          setEstado((e) => ({
            ...e,
            listo: false,
            fallo: "este navegador no puede reproducir Spotify (falta el módulo de contenido protegido)",
          }));
        }
      });
      p.addListener("authentication_error", () => {
        if (!cancelado) {
          clearTimeout(paciencia);
          setEstado((e) => ({ ...e, listo: false, fallo: "Spotify rechazó la sesión" }));
        }
      });

      void p.connect();
    };

    if (window.Spotify) {
      montar();
    } else {
      window.onSpotifyWebPlaybackSDKReady = montar;
      if (!document.getElementById("spotify-sdk")) {
        const script = document.createElement("script");
        script.id = "spotify-sdk";
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        document.body.appendChild(script);
      }
    }

    return () => {
      cancelado = true;
      clearTimeout(paciencia);
      reproductor.current?.disconnect();
      reproductor.current = null;
    };
  }, [activo]);

  // --- El contador local -----------------------------------------------------
  //
  // A 4 Hz y no por fotograma: la barra de progreso de una canción de tres
  // minutos no gana nada actualizándose sesenta veces por segundo, y un
  // `requestAnimationFrame` vivo todo el rato impide que el navegador deje la
  // pestaña en reposo.
  useEffect(() => {
    if (!activo) return;
    const tic = setInterval(() => {
      if (!ancla.current.corriendo || arrastrando.current) return;
      const transcurrido = performance.now() - ancla.current.en;
      setEstado((e) => {
        const siguiente = ancla.current.posicionMs + transcurrido;
        // Segundo y medio antes del final se arma la marca que deja distinguir
        // «terminó» de «le dieron a pausa» cuando llegue el evento del SDK.
        if (e.duracionMs > 0 && siguiente >= e.duracionMs) return { ...e, posicionMs: e.duracionMs };
        return { ...e, posicionMs: siguiente };
      });
    }, 250);
    return () => clearInterval(tic);
  }, [activo]);

  // --- Controles -------------------------------------------------------------

  /**
   * Reproduce una pista concreta en este navegador.
   *
   * `activateElement` antes de nada: los navegadores no dejan que empiece a
   * sonar audio sin un gesto del usuario, y sin esta llamada el primer play de
   * la sesión falla en silencio.
   */
  /**
   * Espera a que este reproductor esté sonando de verdad.
   *
   * Existe porque el código HTTP no sirve para saberlo: Spotify responde
   * `202 Accepted` cuando acepta la orden pero el dispositivo todavía no está
   * activo, y eso cae dentro del rango de éxito. La orden se daba por buena, no
   * sonaba nada, y desde fuera se veía como «hay que darle al play varias
   * veces». Preguntarle al SDK por su estado es la única comprobación que no
   * miente.
   */
  const esperarQueSuene = useCallback(async (limiteMs = 1600): Promise<boolean> => {
    const hasta = performance.now() + limiteMs;
    while (performance.now() < hasta) {
      const s = await reproductor.current?.getCurrentState().catch(() => null);
      if (s && !s.paused && s.track_window?.current_track) return true;
      await new Promise((listo) => setTimeout(listo, 150));
    }
    return false;
  }, []);

  /**
   * Levanta un dispositivo nuevo y devuelve su identificador.
   *
   * `disconnect()` + `connect()` obliga al SDK a registrarse otra vez, y el
   * `ready` que llega después trae un identificador válido. Sin esto, un
   * identificador caducado condena todas las órdenes a un 404 eterno por muchas
   * veces que se reintenten — que es exactamente lo que pasaba.
   */
  const renovarDispositivo = useCallback(async (): Promise<string | null> => {
    const p = reproductor.current;
    if (!p) return null;

    const nuevo = new Promise<string | null>((resolver) => {
      esperandoDispositivo.current = resolver;
      // Sin plazo, una reconexión que nunca completa dejaría la promesa —y con
      // ella el botón de reproducir— colgada para siempre.
      setTimeout(() => {
        if (esperandoDispositivo.current === resolver) {
          esperandoDispositivo.current = null;
          resolver(null);
        }
      }, 8000);
    });

    p.disconnect();
    await p.connect().catch(() => false);
    return nuevo;
  }, []);

  /**
   * Da la orden y comprueba que surtió efecto; si no, la repite.
   *
   * Los dos motivos por los que una orden no llega a sonar piden respuestas
   * distintas, y por eso se distinguen aquí:
   *
   *  · 404 — el dispositivo ya no existe para Spotify. Caduca tras un rato de
   *    inactividad, y contra un identificador muerto no hay reintento que valga:
   *    hay que levantar uno nuevo.
   *  · 202 y silencio — el dispositivo existe pero no está activo, porque la
   *    cuenta tenía la música en el móvil o en la aplicación de escritorio. Se
   *    arregla trasladando la reproducción aquí.
   */
  const ordenarYComprobar = useCallback(
    async (cuerpo: Record<string, unknown>) => {
      let dispositivo = estado.dispositivoId;
      if (!dispositivo) throw new Error("el reproductor todavía no está listo");

      // Antes de cualquier espera: los navegadores exigen un gesto del usuario
      // para dejar que empiece a sonar audio, y ese gesto se «gasta» si primero
      // se hace una petición.
      await reproductor.current?.activateElement().catch(() => {});

      let ultimoFallo: unknown = null;

      for (let intento = 0; intento < 3; intento += 1) {
        try {
          if (intento > 0) {
            await llamarSpotify("/me/player", {
              method: "PUT",
              body: JSON.stringify({ device_ids: [dispositivo], play: false }),
            }).catch(() => {});
          }

          await llamarSpotify(`/me/player/play?device_id=${dispositivo}`, {
            method: "PUT",
            body: JSON.stringify(cuerpo),
          });

          if (await esperarQueSuene()) return;
          ultimoFallo = new Error("Spotify aceptó la orden pero no llegó a sonar");
        } catch (fallo) {
          ultimoFallo = fallo;
          const mensaje = fallo instanceof Error ? fallo.message : String(fallo);

          if (/respondió 404/.test(mensaje)) {
            const renovado = await renovarDispositivo();
            if (!renovado) break;
            dispositivo = renovado;
            continue;
          }
          // 403 (la cuenta no puede) y 401 (token malo) no mejoran repitiendo.
          if (!/respondió (502|503)/.test(mensaje)) throw fallo;
          await new Promise((listo) => setTimeout(listo, 300));
        }
      }

      throw ultimoFallo instanceof Error
        ? ultimoFallo
        : new Error("no se pudo empezar la reproducción en este equipo");
    },
    [estado.dispositivoId, esperarQueSuene, renovarDispositivo],
  );

  const reproducirUri = useCallback(
    (uri: string) => ordenarYComprobar({ uris: [uri] }),
    [ordenarYComprobar],
  );

  /**
   * Reproduce un CONTEXTO: una playlist, un álbum, tus canciones guardadas.
   *
   * La diferencia con `reproducirUri` no es cosmética. Con `uris` se manda una
   * lista cerrada de pistas y al acabar la última se hace el silencio; con
   * `context_uri` es Spotify quien sostiene la cola, así que el aleatorio, la
   * repetición y el «siguiente» funcionan sobre la playlist entera, como en su
   * propia aplicación. Poner una playlist mandando sus cien URIs sería
   * técnicamente posible y perdería todo eso.
   */
  const reproducirContexto = useCallback(
    (contextoUri: string, desdePista = 0) =>
      ordenarYComprobar({ context_uri: contextoUri, offset: { position: desdePista } }),
    [ordenarYComprobar],
  );

  const alternarPausa = useCallback(async () => {
    await reproductor.current?.activateElement().catch(() => {});
    await reproductor.current?.togglePlay();
  }, []);

  const siguiente = useCallback(() => reproductor.current?.nextTrack(), []);

  /**
   * Mete una pista en la cola NATIVA de Spotify.
   *
   * Este es el mecanismo que hace que la música no se corte entre canciones, y
   * sustituye a detectar el final por nuestra cuenta. El motivo es que «terminó»
   * no es un evento que el SDK mande: hay que deducirlo de un `paused` con la
   * posición a 0, que es exactamente lo que también llega al rebobinar. Toda
   * heurística ahí es frágil, y encima deja un silencio entre temas mientras
   * viaja nuestra llamada de reproducción.
   *
   * Delegándolo en Spotify, el encadenado es el suyo: sin huecos y sin que
   * tengamos que adivinar nada.
   */
  const encolarEnSpotify = useCallback(
    async (uri: string) => {
      if (!estado.dispositivoId) return;
      await conReintento(() =>
        llamarSpotify(
          `/me/player/queue?uri=${encodeURIComponent(uri)}&device_id=${estado.dispositivoId}`,
          { method: "POST" },
        ),
      );
    },
    [estado.dispositivoId],
  );

  /**
   * Anterior, con el comportamiento que todo el mundo espera de un reproductor:
   * si ya han sonado más de tres segundos, vuelve al principio de la canción en
   * vez de saltar a la anterior. Es la convención de todos los reproductores
   * desde el walkman, y su ausencia se nota como un fallo.
   */
  const anterior = useCallback(async () => {
    if (ancla.current.posicionMs > 3000) {
      await reproductor.current?.seek(0);
      ancla.current = { ...ancla.current, posicionMs: 0, en: performance.now() };
      setEstado((e) => ({ ...e, posicionMs: 0 }));
      return;
    }
    await reproductor.current?.previousTrack();
  }, []);

  /** Mientras el dedo está en la barra, el contador se aparta. */
  const empezarArrastre = useCallback(() => {
    arrastrando.current = true;
  }, []);

  const arrastrarA = useCallback((ms: number) => {
    setEstado((e) => ({ ...e, posicionMs: ms }));
  }, []);

  const soltarEn = useCallback(async (ms: number) => {
    ancla.current = { ...ancla.current, posicionMs: ms, en: performance.now() };
    arrastrando.current = false;
    await reproductor.current?.seek(ms);
  }, []);

  const ponerVolumen = useCallback(async (v: number) => {
    setEstado((e) => ({ ...e, volumen: v }));
    await reproductor.current?.setVolume(v);
  }, []);

  const alternarAleatorio = useCallback(async () => {
    const siguienteValor = !estado.aleatorio;
    setEstado((e) => ({ ...e, aleatorio: siguienteValor }));
    await llamarSpotify(`/me/player/shuffle?state=${siguienteValor}`, { method: "PUT" }).catch(
      () => setEstado((e) => ({ ...e, aleatorio: !siguienteValor })),
    );
  }, [estado.aleatorio]);

  const ciclarRepeticion = useCallback(async () => {
    const siguienteValor = ((estado.repeticion + 1) % 3) as 0 | 1 | 2;
    const nombres = ["off", "context", "track"] as const;
    setEstado((e) => ({ ...e, repeticion: siguienteValor }));
    await llamarSpotify(`/me/player/repeat?state=${nombres[siguienteValor]}`, {
      method: "PUT",
    }).catch(() => setEstado((e) => ({ ...e, repeticion: estado.repeticion })));
  }, [estado.repeticion]);

  /**
   * Tus playlists, con «Canciones que te gustan» al principio.
   *
   * Los guardados no son una playlist para Spotify —tienen su propio endpoint y
   * su propio URI de contexto— pero para quien mira son lo mismo: una lista
   * suya que quiere poner. Se disfrazan de playlist aquí para no obligar a la
   * interfaz a tratar dos cosas distintas que se usan igual.
   *
   * Lanza `sin_permiso` si el token es de antes de que se pidieran los permisos
   * de biblioteca; quien llama lo traduce a «vuelve a conectar tu cuenta».
   */
  const listarPlaylists = useCallback(async (): Promise<Playlist[]> => {
    const guardadas = await llamarSpotify("/me/tracks?limit=1").catch((fallo: Error) => {
      if (fallo.message.includes("403")) throw new Error("sin_permiso");
      return null;
    });

    const propias = (await llamarSpotify("/me/playlists?limit=50")) as {
      items: ({
        id: string;
        uri: string;
        name: string;
        images?: { url: string }[] | null;
        tracks?: { total: number } | null;
        owner?: { display_name?: string | null } | null;
      } | null)[];
    } | null;

    /**
     * Todo se lee a la defensiva, y no por costumbre: `/me/playlists` devuelve
     * entradas con huecos de verdad. Hay `items` a null —una playlist que se
     * borró o dejó de estar disponible en tu país sigue ocupando su sitio en la
     * página— y objetos sin `tracks` ni `owner.display_name`. Dar esos campos
     * por seguros costó que la pestaña entera reventara con un
     * «Cannot read properties of undefined» y no enseñara ni una sola lista de
     * las cuarenta y cinco que sí venían bien.
     */
    const lista: Playlist[] = (propias?.items ?? [])
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.id && p?.uri))
      .map((p) => ({
        id: p.id,
        uri: p.uri,
        nombre: p.name || "Lista sin nombre",
        caratula: p.images?.[0]?.url ?? null,
        pistas: p.tracks?.total ?? 0,
        de: p.owner?.display_name || "—",
      }));

    const total = (guardadas as { total?: number } | null)?.total;
    if (typeof total === "number") {
      lista.unshift({
        id: "guardadas",
        uri: "spotify:collection:tracks",
        nombre: "Canciones que te gustan",
        caratula: null,
        pistas: total,
        de: "Tu biblioteca",
      });
    }

    return lista;
  }, []);

  /** Las pistas de una playlist, o las guardadas si es la lista disfrazada. */
  const listarPistas = useCallback(async (playlistId: string) => {
    const ruta =
      playlistId === "guardadas"
        ? "/me/tracks?limit=50"
        : `/playlists/${playlistId}/tracks?limit=50`;
    const carga = (await llamarSpotify(ruta)) as {
      items: ({
        track?: {
          uri?: string;
          name?: string;
          duration_ms?: number;
          artists?: { name?: string | null }[] | null;
          album?: { images?: { url: string }[] | null } | null;
        } | null;
      } | null)[];
    } | null;

    return (carga?.items ?? [])
      // Una pista puede llegar en null, o sin `uri`: se retiró del catálogo de
      // tu país, o era un episodio de podcast en una playlist mixta. Y como en
      // `listarPlaylists`, el resto de campos tampoco están garantizados.
      .filter((i) => Boolean(i?.track?.uri))
      .map((i) => ({
        uri: i!.track!.uri!,
        name: i!.track!.name || "Sin título",
        artist: (i!.track!.artists ?? [])
          .map((a) => a?.name)
          .filter(Boolean)
          .join(", "),
        imageUrl: i!.track!.album?.images?.[0]?.url ?? null,
        durationMs: i!.track!.duration_ms ?? 0,
      }));
  }, []);

  /** Los dispositivos donde esta cuenta puede sonar (móvil, escritorio, altavoz). */
  const listarDispositivos = useCallback(async () => {
    const carga = (await llamarSpotify("/me/player/devices")) as {
      devices: { id: string; name: string; type: string; is_active: boolean }[];
    } | null;
    return carga?.devices ?? [];
  }, []);

  /** Manda la reproducción a otro dispositivo sin cortar la canción. */
  const transferirA = useCallback(async (dispositivoId: string) => {
    await llamarSpotify("/me/player", {
      method: "PUT",
      body: JSON.stringify({ device_ids: [dispositivoId], play: true }),
    });
  }, []);

  return {
    estado,
    reproducirUri,
    reproducirContexto,
    encolarEnSpotify,
    listarPlaylists,
    listarPistas,
    alternarPausa,
    siguiente,
    anterior,
    empezarArrastre,
    arrastrarA,
    soltarEn,
    ponerVolumen,
    alternarAleatorio,
    ciclarRepeticion,
    listarDispositivos,
    transferirA,
  };
}

/** Milisegundos a `m:ss`. Vive aquí porque lo usan el reproductor y la cola. */
export function reloj(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
