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

export function useSpotifyPlayer(activo: boolean) {
  const [estado, setEstado] = useState<EstadoReproductor>(ESTADO_INICIAL);
  const reproductor = useRef<SdkPlayer | null>(null);

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
        if (!cancelado) {
          clearTimeout(paciencia);
          setEstado((e) => ({ ...e, listo: true, fallo: null, dispositivoId: device_id }));
        }
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
  const reproducirUri = useCallback(
    async (uri: string) => {
      if (!estado.dispositivoId) throw new Error("el reproductor todavía no está listo");
      await reproductor.current?.activateElement().catch(() => {});
      await llamarSpotify(`/me/player/play?device_id=${estado.dispositivoId}`, {
        method: "PUT",
        body: JSON.stringify({ uris: [uri] }),
      });
    },
    [estado.dispositivoId],
  );

  const alternarPausa = useCallback(async () => {
    await reproductor.current?.activateElement().catch(() => {});
    await reproductor.current?.togglePlay();
  }, []);

  const siguiente = useCallback(() => reproductor.current?.nextTrack(), []);

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
