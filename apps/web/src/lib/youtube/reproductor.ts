"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * El reproductor de YouTube, hermano del de Spotify.
 *
 * POR QUÉ HAY DOS. La aplicación de Spotify vive en «modo desarrollo»: cinco
 * cuentas, dadas de alta a mano en su panel, y salir de ahí exige ser una
 * organización con 250.000 usuarios activos al mes. YouTube no tiene lista
 * blanca ni pide Premium para sonar, así que es la puerta para todo el que se
 * registre. Spotify se queda para quien lo tenga: mejor catálogo y mejor
 * sonido.
 *
 * MISMA FORMA QUE `spotify/reproductor.ts` a propósito. El widget no debería
 * tener que saber cuál de los dos está usando: pide «pon esto», «pausa»,
 * «ve al segundo tal», y lee un estado con los mismos campos. Lo único que
 * decide cuál manda es el prefijo del `trackUri` de la pista.
 *
 * EL IFRAME TIENE QUE VERSE. No es una decisión de diseño: los términos de
 * YouTube exigen que el reproductor esté visible y sin tapar. Un reproductor
 * de solo audio escondido detrás de una carátula sería más bonito y estaría
 * fuera de las reglas, con el riesgo de que corten la clave — que es
 * exactamente lo que le pasó a los bots de música de Discord en 2021. Por eso
 * el widget pinta el vídeo cuando la fuente es esta.
 */

/** El id de vídeo dentro de `youtube:VIDEO_ID`, o null si no es de aquí. */
export function idDeUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const m = /^youtube:([\w-]{11})$/.exec(uri.trim());
  return m ? m[1]! : null;
}

export function esDeYoutube(uri: string | null | undefined): boolean {
  return idDeUri(uri) !== null;
}

export type EstadoYoutube = {
  /** El reproductor está montado y listo para recibir órdenes. */
  listo: boolean;
  /**
   * No arrancó, o el vídeo no se puede poner aquí. Se guarda para poder
   * DECIRLO: un reproductor mudo y sin explicación es indistinguible de uno
   * roto, que es la misma razón por la que el de Spotify guarda su fallo.
   */
  fallo: string | null;
  videoId: string | null;
  /** El título que reporta el propio reproductor, que puede diferir del de la cola. */
  titulo: string | null;
  posicionMs: number;
  duracionMs: number;
  reproduciendo: boolean;
};

const ESTADO_INICIAL: EstadoYoutube = {
  listo: false,
  fallo: null,
  videoId: null,
  titulo: null,
  posicionMs: 0,
  duracionMs: 0,
  reproduciendo: false,
};

type ReproductorYt = {
  loadVideoById: (id: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (segundos: number, permitirAdelantar: boolean) => void;
  setVolume: (v: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getVideoData: () => { title?: string; author?: string };
  destroy: () => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opciones: unknown) => ReproductorYt;
      PlayerState: { ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

/**
 * Carga el script del IFrame API una sola vez.
 *
 * `onYouTubeIframeAPIReady` es global y YouTube solo la llama UNA vez, así que
 * dos componentes que la sobrescriban se pisan y el segundo no se entera nunca
 * de que la API ya está. Por eso la promesa se guarda a nivel de módulo: quien
 * llegue después se cuelga de la misma.
 */
let cargando: Promise<void> | null = null;
function cargarApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  cargando ??= new Promise<void>((resolver, rechazar) => {
    const anterior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      anterior?.();
      resolver();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => rechazar(new Error("no se pudo cargar el reproductor de YouTube"));
    document.head.appendChild(script);
  });
  return cargando;
}

/** Los códigos de error del IFrame API, en algo que se pueda leer. */
function explicarError(codigo: number): string {
  switch (codigo) {
    case 2:
      return "el enlace del vídeo no es válido";
    case 5:
      return "este vídeo no se puede reproducir en el navegador";
    case 100:
      return "el vídeo no existe o es privado";
    case 101:
    case 150:
      return "su dueño no permite reproducirlo fuera de YouTube";
    default:
      return `YouTube devolvió el error ${codigo}`;
  }
}

/**
 * @param contenedor  Dónde montar el iframe. Lo pone el widget, y tiene que
 *                    estar visible: ver la cabecera del archivo.
 * @param alTerminar  Se llama cuando el vídeo acaba, para encadenar la cola.
 *                    Es el equivalente al cambio de pista del SDK de Spotify.
 */
export function useYoutubePlayer(
  contenedor: React.RefObject<HTMLDivElement | null>,
  alTerminar?: () => void,
) {
  const [estado, setEstado] = useState<EstadoYoutube>(ESTADO_INICIAL);
  const player = useRef<ReproductorYt | null>(null);
  const pendiente = useRef<string | null>(null);
  const terminar = useRef(alTerminar);
  terminar.current = alTerminar;

  // --- Montaje ----------------------------------------------------------------
  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    let vivo = true;

    void (async () => {
      try {
        await cargarApi();
        if (!vivo || !window.YT?.Player || !contenedor.current) return;

        player.current = new window.YT.Player(contenedor.current, {
          height: "100%",
          width: "100%",
          playerVars: {
            // Sin controles propios: los del widget son los que mandan, y dos
            // juegos de botones que dicen cosas distintas es peor que uno.
            controls: 0,
            // En iPhone, sin esto el vídeo se abre a pantalla completa y saca
            // a la persona de la aplicación en cuanto le da a reproducir.
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onReady: () => {
              if (!vivo) return;
              setEstado((e) => ({ ...e, listo: true, fallo: null }));
              // Si pidieron un vídeo mientras esto se montaba, va ahora.
              if (pendiente.current) {
                player.current?.loadVideoById(pendiente.current);
                pendiente.current = null;
              }
            },
            onStateChange: (evento: { data: number }) => {
              if (!vivo) return;
              const st = window.YT!.PlayerState;
              if (evento.data === st.ENDED) {
                setEstado((e) => ({ ...e, reproduciendo: false }));
                terminar.current?.();
                return;
              }
              const datos = player.current?.getVideoData();
              setEstado((e) => ({
                ...e,
                reproduciendo: evento.data === st.PLAYING,
                titulo: datos?.title ?? e.titulo,
                duracionMs: Math.round((player.current?.getDuration() ?? 0) * 1000),
              }));
            },
            onError: (evento: { data: number }) => {
              if (!vivo) return;
              setEstado((e) => ({ ...e, fallo: explicarError(evento.data), reproduciendo: false }));
            },
          },
        });
      } catch (fallo) {
        if (!vivo) return;
        setEstado((e) => ({
          ...e,
          fallo: fallo instanceof Error ? fallo.message : "no se pudo montar el reproductor",
        }));
      }
    })();

    return () => {
      vivo = false;
      try {
        player.current?.destroy();
      } catch {
        // Destruir un reproductor a medio montar tira una excepción que no
        // significa nada para nadie.
      }
      player.current = null;
    };
  }, [contenedor]);

  // --- La posición, preguntando -----------------------------------------------
  //
  // El IFrame API no avisa del avance: hay que preguntarle. Medio segundo es
  // suficiente para una barra de progreso y no calienta el portátil de nadie.
  // Solo mientras suena: preguntar en pausa es gastar por gusto.
  useEffect(() => {
    if (!estado.reproduciendo) return;
    const t = setInterval(() => {
      const p = player.current;
      if (!p) return;
      setEstado((e) => ({
        ...e,
        posicionMs: Math.round(p.getCurrentTime() * 1000),
        duracionMs: Math.round(p.getDuration() * 1000) || e.duracionMs,
      }));
    }, 500);
    return () => clearInterval(t);
  }, [estado.reproduciendo]);

  const poner = useCallback((uri: string) => {
    const id = idDeUri(uri);
    if (!id) throw new Error("esa pista no es de YouTube");
    setEstado((e) => ({ ...e, videoId: id, fallo: null, posicionMs: 0 }));
    if (player.current) player.current.loadVideoById(id);
    // Todavía montándose: se guarda y lo pone `onReady`.
    else pendiente.current = id;
  }, []);

  const pausar = useCallback(() => player.current?.pauseVideo(), []);
  const reanudar = useCallback(() => player.current?.playVideo(), []);
  const irA = useCallback((ms: number) => {
    player.current?.seekTo(ms / 1000, true);
    setEstado((e) => ({ ...e, posicionMs: ms }));
  }, []);
  const volumen = useCallback((v: number) => {
    // El SDK de Spotify usa 0–1 y el de YouTube 0–100. Se traduce aquí para
    // que el widget hable en una sola escala.
    player.current?.setVolume(Math.round(Math.min(1, Math.max(0, v)) * 100));
  }, []);

  return { estado, poner, pausar, reanudar, irA, volumen };
}
