"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SpotifyTrack } from "../api";

/**
 * El motor de reproducción: todo lo que habla con Spotify, y nada de interfaz.
 *
 * Reproducir en el navegador son dos APIs distintas trabajando juntas, y casi
 * todos los fallos raros vienen de confundirlas:
 *
 *  · El **Web Playback SDK** convierte esta pestaña en un altavoz («dispositivo»)
 *    y avisa de lo que va pasando. No sirve para dar órdenes fiables.
 *  · La **API HTTP** es la que manda: poner, encolar, saltar. Habla del
 *    dispositivo por su identificador, y ahí está casi toda la miseria.
 *
 * Cuatro trampas que costaron una noche entera y que este archivo evita a
 * propósito. Van marcadas [T1]..[T4] donde se resuelven, porque cada una parece
 * código de más hasta que se quita.
 */

const SDK_URL = "https://sdk.scdn.co/spotify-player.js";
const RAIZ = "https://api.spotify.com/v1";

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
   * No arrancó por algo que no es la cuenta: DRM no disponible, script
   * bloqueado, token rechazado. Se guarda para poder DECIRLO — un reproductor
   * sin botones y sin explicación es indistinguible de uno roto.
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

export type Playlist = {
  id: string;
  uri: string;
  nombre: string;
  caratula: string | null;
  pistas: number;
  de: string;
};

const ESTADO_INICIAL: EstadoReproductor = {
  listo: false,
  sinPremium: false,
  fallo: null,
  dispositivoId: null,
  pista: null,
  posicionMs: 0,
  duracionMs: 0,
  reproduciendo: false,
  volumen: 0.5,
  aleatorio: false,
  repeticion: 0,
};

// --- Lo mínimo del SDK que usamos, tipado a mano ------------------------------
// El paquete de tipos oficial arrastra medio DOM; esto es lo que se toca.

type EstadoSdk = {
  paused: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat_mode: 0 | 1 | 2;
  track_window: { current_track: PistaSdk | null };
};

type PistaSdk = {
  uri: string;
  name: string;
  artists: { name: string }[];
  album: { name?: string; images: { url: string }[] };
  duration_ms?: number;
};

type ReproductorSdk = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: <T>(evento: string, cb: (dato: T) => void) => void;
  getCurrentState: () => Promise<EstadoSdk | null>;
  setVolume: (v: number) => Promise<void>;
  seek: (ms: number) => Promise<void>;
};

declare global {
  interface Window {
    Spotify?: {
      Player: new (opciones: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume: number;
      }) => ReproductorSdk;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

/** Carga el script una sola vez, aunque el reproductor se monte varias veces. */
let sdkCargando: Promise<void> | null = null;

function cargarSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  sdkCargando ??= new Promise<void>((resolver, rechazar) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolver();
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => rechazar(new Error("no se pudo cargar el reproductor de Spotify"));
    document.body.appendChild(script);
  });
  return sdkCargando;
}

// --- Hablar con la API HTTP ---------------------------------------------------

/** Token fresco. La API lo refresca sola si caducó. */
async function tokenFresco(): Promise<string> {
  const { accessToken } = await api.get<{ accessToken: string }>("/me/spotify/token");
  return accessToken;
}

/**
 * Llama a la API de Spotify. Devuelve `null` en las respuestas sin cuerpo, que
 * son casi todos los controles de reproducción (204).
 *
 * El error lleva lo que Spotify explica, no solo el número: dos 403 idénticos a
 * la vista pueden ser «esta cuenta no está en la lista de la app» o «este
 * endpoint no está disponible para esta app», y se arreglan en sitios distintos.
 * El prefijo «respondió N en RUTA» se mantiene estable a propósito, porque hay
 * reintentos que lo reconocen por texto.
 */
async function llamarSpotify(ruta: string, init: RequestInit = {}): Promise<unknown> {
  const token = await tokenFresco();
  const respuesta = await fetch(`${RAIZ}${ruta}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    let motivo = "";
    try {
      motivo = (JSON.parse(cuerpo) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      motivo = cuerpo.slice(0, 140);
    }
    throw new Error(
      `Spotify respondió ${respuesta.status} en ${ruta}` + (motivo ? `: ${motivo}` : ""),
    );
  }

  if (respuesta.status === 204) return null;

  // No todo lo que trae cuerpo es JSON. Los controles de reproducción
  // (`play`, `pause`, `next`) contestan a veces 200 o 202 con un identificador
  // opaco en texto plano, y meterlo por `JSON.parse` reventaba la promesa con
  // un «Unexpected token» que no tiene nada que ver con lo que se pidió. Se mira
  // el tipo de contenido en vez de adivinar: si no dice JSON, no hay nada que
  // leer y quien llama tampoco lo espera.
  const tipo = respuesta.headers.get("content-type") ?? "";
  if (!tipo.includes("application/json")) return null;

  const texto = await respuesta.text();
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    // Se anunció JSON y no lo era. No es motivo para tumbar la reproducción.
    return null;
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useSpotifyPlayer(activo: boolean, onPistaCambiada?: (uri: string) => void) {
  const [estado, setEstado] = useState<EstadoReproductor>(ESTADO_INICIAL);
  const reproductor = useRef<ReproductorSdk | null>(null);
  const dispositivo = useRef<string | null>(null);
  const arrastrando = useRef(false);
  const ultimaUri = useRef<string | null>(null);
  const alCambiar = useRef(onPistaCambiada);
  alCambiar.current = onPistaCambiada;

  // --- Montaje del SDK --------------------------------------------------------

  useEffect(() => {
    if (!activo) return;
    let vivo = true;

    void (async () => {
      try {
        await cargarSdk();
        if (!vivo || !window.Spotify) return;

        const p = new window.Spotify.Player({
          name: "DevUP",
          getOAuthToken: (cb) => void tokenFresco().then(cb).catch(() => {}),
          volume: ESTADO_INICIAL.volumen,
        });

        // Sin casteos: una función que acepta un tipo concreto ya es asignable
        // a una que acepta `never`, porque los parámetros se comprueban al
        // revés. Forzarlo con `as unknown as` solo servía para descuadrar
        // paréntesis y esconder errores de verdad.
        p.addListener("ready", ({ device_id }: { device_id: string }) => {
          dispositivo.current = device_id;
          setEstado((e) => ({ ...e, listo: true, dispositivoId: device_id, fallo: null }));
        });

        p.addListener("not_ready", () => {
          setEstado((e) => ({ ...e, listo: false }));
        });

        p.addListener("account_error", () => {
          setEstado((e) => ({ ...e, sinPremium: true, listo: false }));
        });

        const alFallar = ({ message }: { message: string }) =>
          setEstado((e) => ({ ...e, fallo: message }));
        p.addListener("initialization_error", alFallar);
        p.addListener("authentication_error", alFallar);
        p.addListener("playback_error", alFallar);

        p.addListener("player_state_changed", (s: EstadoSdk | null) => {
          if (!s) return;
          const t = s.track_window?.current_track ?? null;
          if (t && t.uri !== ultimaUri.current) {
            ultimaUri.current = t.uri;
            alCambiar.current?.(t.uri);
          }
          setEstado((e) => ({
            ...e,
            reproduciendo: !s.paused,
            // Durante un arrastre manda el dedo, no Spotify: si no, la barra
            // pega un salto atrás cada vez que llega un evento a medio gesto.
            posicionMs: arrastrando.current ? e.posicionMs : s.position,
            duracionMs: s.duration || t?.duration_ms || e.duracionMs,
            aleatorio: s.shuffle,
            repeticion: s.repeat_mode,
            pista: t
              ? {
                  uri: t.uri,
                  nombre: t.name,
                  artista: t.artists.map((a) => a.name).join(", "),
                  album: t.album.name ?? "",
                  caratula: t.album.images[0]?.url ?? null,
                  duracionMs: t.duration_ms ?? s.duration,
                }
              : null,
          }));
        });

        await p.connect();
        if (vivo) reproductor.current = p;
      } catch (fallo) {
        if (vivo) setEstado((e) => ({ ...e, fallo: (fallo as Error).message }));
      }
    })();

    return () => {
      vivo = false;
      reproductor.current?.disconnect();
      reproductor.current = null;
      dispositivo.current = null;
      setEstado(ESTADO_INICIAL);
    };
  }, [activo]);

  /**
   * Un reproductor que no arranca tiene que DECIRLO.
   *
   * Si el SDK se queda a medias sin emitir ningún error —pasa cuando el
   * navegador no puede con el contenido protegido— nadie pone `fallo`, así que
   * la interfaz enseña «Preparando el reproductor…» eternamente. Un spinner
   * infinito es indistinguible de algo roto y no da ninguna pista de por dónde
   * mirar, que es exactamente el tipo de silencio que más caro sale.
   */
  useEffect(() => {
    if (!activo || estado.listo || estado.fallo || estado.sinPremium) return;
    const id = setTimeout(() => {
      setEstado((e) =>
        e.listo || e.fallo || e.sinPremium
          ? e
          : {
              ...e,
              fallo:
                "El reproductor no arrancó. Lo más común es que el navegador no pueda " +
                "reproducir contenido protegido: prueba en Chrome de escritorio, fuera de " +
                "incógnito y sin bloqueadores",
            },
      );
    }, 20_000);
    return () => clearTimeout(id);
  }, [activo, estado.listo, estado.fallo, estado.sinPremium]);

  /**
   * [T4] El tictac es nuestro. `player_state_changed` NO va marcando el tiempo:
   * solo avisa de cambios (pausa, pista nueva, salto). Sin este intervalo la
   * barra de progreso se queda clavada mientras la canción suena — uno de los
   * «está roto» más caros de diagnosticar, porque todo lo demás funcionaba.
   */
  useEffect(() => {
    if (!estado.reproduciendo) return;
    const id = setInterval(() => {
      if (arrastrando.current) return;
      setEstado((e) =>
        e.reproduciendo && e.posicionMs < e.duracionMs
          ? { ...e, posicionMs: e.posicionMs + 1000 }
          : e,
      );
    }, 1000);
    return () => clearInterval(id);
  }, [estado.reproduciendo]);

  // --- Dar órdenes de reproducción -------------------------------------------

  /**
   * [T3] Los identificadores de dispositivo caducan. Con la pestaña un rato
   * abierta, el que guardamos puede referirse a un altavoz que Spotify ya olvidó,
   * y entonces toda orden contesta 404 para siempre. Reconectar el SDK emite un
   * `ready` nuevo con identificador nuevo; sin esto, la única salida que le
   * quedaba a quien lo sufría era recargar la página.
   */
  const renovarDispositivo = useCallback(async (): Promise<string | null> => {
    const p = reproductor.current;
    if (!p) return null;
    dispositivo.current = null;
    p.disconnect();
    await p.connect();
    for (let i = 0; i < 20 && !dispositivo.current; i++) await esperar(150);
    return dispositivo.current;
  }, []);

  /**
   * [T2] La única fuente que no miente sobre si algo suena.
   *
   * `PUT /me/player/play` contesta `202 Accepted` cuando Spotify aceptó la orden
   * pero el dispositivo aún no la ejecutó — y a veces no la ejecuta nunca. Dar
   * ese 202 por bueno es exactamente lo que producía el «hay que darle varias
   * veces»: la interfaz decía que sonaba, y no sonaba.
   */
  const esperarQueSuene = useCallback(async (intentos = 12): Promise<boolean> => {
    for (let i = 0; i < intentos; i++) {
      const s = await reproductor.current?.getCurrentState().catch(() => null);
      if (s && !s.paused && s.track_window?.current_track) return true;
      await esperar(200);
    }
    return false;
  }, []);

  /** Manda la reproducción a otro dispositivo sin cortar la canción. */
  const transferirA = useCallback(async (dispositivoId: string) => {
    await llamarSpotify("/me/player", {
      method: "PUT",
      body: JSON.stringify({ device_ids: [dispositivoId], play: true }),
    });
  }, []);

  /**
   * Manda una orden de reproducción y comprueba el resultado.
   *
   * [T1] Un 404 recién montado el reproductor casi nunca es «no existe»: es que
   * el dispositivo todavía no acabó de registrarse en Spotify. Se reintenta y, si
   * insiste, se renueva el dispositivo [T3]. Los 502/503 son de Spotify y se
   * curan esperando. Cualquier otro error se lanza: reintentarlo no lo va a
   * arreglar, y esconderlo cuesta más de lo que ahorra.
   */
  const ordenar = useCallback(
    async (cuerpo: Record<string, unknown>): Promise<void> => {
      let id = dispositivo.current;
      if (!id) {
        for (let i = 0; i < 20 && !dispositivo.current; i++) await esperar(150);
        id = dispositivo.current;
      }
      if (!id) throw new Error("el reproductor todavía no tiene dispositivo");

      // Solo se transfiere una vez por identificador: si transferir no bastó,
      // repetirlo tampoco va a bastar, y cada intento cuesta una petición.
      let transferido = false;

      for (let intento = 0; intento < 4; intento++) {
        try {
          await llamarSpotify(`/me/player/play?device_id=${id}`, {
            method: "PUT",
            body: JSON.stringify(cuerpo),
          });
          if (await esperarQueSuene()) return;
          // Aceptada pero muda: se reintenta como si hubiera fallado.
        } catch (fallo) {
          const mensaje = (fallo as Error).message;

          /**
           * Un 404 es «Spotify no conoce ese dispositivo», y hay dos motivos
           * distintos con dos remedios distintos. Probarlos en el orden
           * equivocado deja el fallo dando vueltas:
           *
           *  1. El dispositivo existe pero no está ACTIVO en la cuenta. Se
           *     arregla transfiriéndole la reproducción, que es lo que lo
           *     registra en la lista de dispositivos de Spotify.
           *  2. El identificador caducó de verdad. Ahí sí toca reconectar el SDK.
           *
           * Se intenta primero transferir porque es lo más barato y el caso más
           * común, y porque reconectar NO siempre cambia nada: Spotify suele
           * devolver el MISMO identificador al reconectar, así que renovar de
           * primeras puede reintentar contra el mismo dispositivo muerto una y
           * otra vez. Es exactamente lo que se vio en producción — seis 404
           * seguidos con el mismo device_id.
           */
          if (/respondió 404/.test(mensaje)) {
            if (!transferido) {
              transferido = true;
              const ok = await transferirA(id).then(
                () => true,
                () => false,
              );
              if (ok) {
                await esperar(400);
                continue;
              }
            }

            const nuevo = await renovarDispositivo();
            // Si el reconectado trae el mismo identificador, insistir es perder
            // el tiempo: no hay nada más que probar por este camino.
            if (!nuevo || nuevo === id) throw fallo;
            id = nuevo;
            transferido = false;
            continue;
          }
          if (!/respondió (502|503)/.test(mensaje)) throw fallo;
        }
        await esperar(300 * (intento + 1));
      }
      throw new Error("Spotify aceptó la orden pero no llegó a sonar");
    },
    [esperarQueSuene, renovarDispositivo, transferirA],
  );

  const reproducirUri = useCallback((uri: string) => ordenar({ uris: [uri] }), [ordenar]);

  /**
   * Poner una lista entera. Va por `context_uri` y no por una lista de URIs a
   * propósito: así es Spotify quien sostiene la cola, y el aleatorio, el repetir
   * y el «siguiente» se comportan como en su aplicación. De regalo, no necesita
   * leer las pistas de la lista, que es justo lo que esta app tiene vetado.
   */
  const reproducirContexto = useCallback(
    (contextoUri: string, desdePista = 0) =>
      ordenar({ context_uri: contextoUri, offset: { position: desdePista } }),
    [ordenar],
  );

  /** Encola en la cola nativa de Spotify: es quien encadena sin huecos. */
  const encolarEnSpotify = useCallback(async (uri: string) => {
    const id = dispositivo.current;
    if (!id) throw new Error("el reproductor todavía no tiene dispositivo");
    await llamarSpotify(`/me/player/queue?uri=${encodeURIComponent(uri)}&device_id=${id}`, {
      method: "POST",
    });
  }, []);

  // --- Controles --------------------------------------------------------------

  const alternarPausa = useCallback(async () => {
    const s = await reproductor.current?.getCurrentState().catch(() => null);
    if (!s) return;
    await llamarSpotify(`/me/player/${s.paused ? "play" : "pause"}`, { method: "PUT" });
  }, []);

  const siguiente = useCallback(async () => {
    await llamarSpotify("/me/player/next", { method: "POST" });
  }, []);

  const anterior = useCallback(async () => {
    await llamarSpotify("/me/player/previous", { method: "POST" });
  }, []);

  const empezarArrastre = useCallback(() => {
    arrastrando.current = true;
  }, []);

  const arrastrarA = useCallback((ms: number) => {
    setEstado((e) => ({ ...e, posicionMs: ms }));
  }, []);

  const soltarEn = useCallback(async (ms: number) => {
    arrastrando.current = false;
    await reproductor.current?.seek(ms).catch(() => {});
  }, []);

  const ponerVolumen = useCallback(async (v: number) => {
    setEstado((e) => ({ ...e, volumen: v }));
    await reproductor.current?.setVolume(v).catch(() => {});
  }, []);

  const alternarAleatorio = useCallback(async () => {
    const valor = !estado.aleatorio;
    setEstado((e) => ({ ...e, aleatorio: valor }));
    await llamarSpotify(`/me/player/shuffle?state=${valor}`, { method: "PUT" });
  }, [estado.aleatorio]);

  const ciclarRepeticion = useCallback(async () => {
    const modos = ["off", "context", "track"] as const;
    const siguienteModo = ((estado.repeticion + 1) % 3) as 0 | 1 | 2;
    setEstado((e) => ({ ...e, repeticion: siguienteModo }));
    await llamarSpotify(`/me/player/repeat?state=${modos[siguienteModo]}`, { method: "PUT" });
  }, [estado.repeticion]);

  // --- Biblioteca -------------------------------------------------------------

  /**
   * Las listas de la cuenta, con una entrada falsa al principio para las
   * canciones guardadas: en Spotify «Tus me gusta» no es una playlist, pero en
   * una lista de sitios de donde sacar música se comporta igual, y esperarla ahí
   * es lo natural.
   *
   * Nada de lo que devuelve Spotify está garantizado: hay entradas nulas, listas
   * sin imagen y objetos `tracks` ausentes. Mapear a lo bruto reventaba, y el
   * fallo se leía como «esta cuenta no tiene playlists».
   */
  const listarPlaylists = useCallback(async (): Promise<Playlist[]> => {
    const lista: Playlist[] = [];

    const guardadas = (await llamarSpotify("/me/tracks?limit=1").catch(() => null)) as {
      total?: number;
    } | null;
    if (guardadas) {
      lista.push({
        id: "guardadas",
        uri: "",
        nombre: "Canciones que te gustan",
        caratula: null,
        pistas: guardadas.total ?? 0,
        de: "Tu biblioteca",
      });
    }

    const propias = (await llamarSpotify("/me/playlists?limit=50").catch((fallo: Error) => {
      if (fallo.message.includes("403")) throw new Error("sin_permiso");
      throw fallo;
    })) as {
      items: ({
        id?: string;
        uri?: string;
        name?: string;
        images?: { url: string }[] | null;
        tracks?: { total?: number } | null;
        owner?: { display_name?: string | null } | null;
      } | null)[];
    } | null;

    for (const l of propias?.items ?? []) {
      if (!l?.id || !l.uri) continue;
      lista.push({
        id: l.id,
        uri: l.uri,
        nombre: l.name || "Sin título",
        caratula: l.images?.[0]?.url ?? null,
        pistas: l.tracks?.total ?? 0,
        de: l.owner?.display_name || "Spotify",
      });
    }

    return lista;
  }, []);

  /**
   * Las pistas de una lista, o las guardadas si es la entrada falsa.
   *
   * El 403 de aquí NO es un permiso que falte, aunque lo parezca. Comprobado
   * contra la API con un token recién emitido y todos los permisos concedidos:
   * `/playlists/{id}/tracks` contesta 403 para todas las listas —incluidas las
   * que la propia cuenta creó— mientras `/me/playlists` y `/me/tracks` contestan
   * 200. Es una restricción de la aplicación en Spotify, no del token, y por eso
   * reconectar no la arregla. Se marca `sin_permiso` para que la interfaz lo
   * distinga de una lista vacía de verdad y ofrezca poner la lista entera, que sí
   * funciona.
   */
  const listarPistas = useCallback(async (playlistId: string): Promise<SpotifyTrack[]> => {
    const ruta =
      playlistId === "guardadas"
        ? "/me/tracks?limit=50"
        : `/playlists/${playlistId}/tracks?limit=50`;

    const carga = (await llamarSpotify(ruta).catch((fallo: Error) => {
      if (fallo.message.includes("403")) throw new Error("sin_permiso");
      throw fallo;
    })) as {
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

    // Una pista puede llegar nula o sin `uri`: se retiró del catálogo del país,
    // o era un episodio de podcast dentro de una lista mixta.
    return (carga?.items ?? [])
      .map((i) => i?.track)
      .filter((t): t is NonNullable<typeof t> => Boolean(t && t.uri))
      .map((t) => ({
        uri: t.uri as string,
        // Esta respuesta no incluye `external_ids`, así que aquí no hay ISRC
        // que leer. No se inventa: una pista sin él sigue teniendo dirección,
        // que es todo lo que hace falta para sonar en este servicio.
        isrc: null,
        name: t.name || "Sin título",
        artist: (t.artists ?? [])
          .map((a) => a?.name)
          .filter(Boolean)
          .join(", "),
        imageUrl: t.album?.images?.[0]?.url ?? null,
        durationMs: t.duration_ms ?? 0,
      }));
  }, []);

  /** Los dispositivos donde esta cuenta puede sonar (móvil, escritorio, altavoz). */
  const listarDispositivos = useCallback(async () => {
    const carga = (await llamarSpotify("/me/player/devices")) as {
      devices: { id: string; name: string; type: string; is_active: boolean }[];
    } | null;
    return carga?.devices ?? [];
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
