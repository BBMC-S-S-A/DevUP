"use client";

import { Loader2, Music } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSpotify, type Ponible } from "@/lib/spotify/SpotifyProvider";
import { explicarFalloSpotify } from "@/lib/spotify/reproductor";
import { useSpotifyChannelFeed } from "@/lib/spotify/useSpotifyChannelFeed";
import {
  Barra,
  Biblioteca,
  Buscador,
  Cola,
  Conectada,
  Conectar,
  Dispositivos,
  Ecualizador,
  PorQueNoSuena,
  Portada,
  Pestanas,
  Transporte,
  type Pestana,
} from "./piezas";

/**
 * El reproductor de música de la sala: el armazón.
 *
 * Aquí solo hay decisiones —qué se enseña, con qué datos y quién puede tocar
 * qué—. El aspecto de cada parte vive en `piezas.tsx`.
 *
 * DOS FUENTES DE VERDAD, Y CUÁL MANDA. Quien reproduce (hace falta Premium)
 * tiene el SDK en su navegador y sabe la posición exacta al milisegundo. El
 * resto de la sala solo tiene lo que ese navegador haya publicado en
 * `channel_listening_sessions`. Así que si el SDK tiene pista manda el SDK, y
 * si no se pinta la sesión compartida. Mezclarlas daría una barra de progreso
 * que salta hacia atrás cada vez que llega un aviso.
 *
 * Y LO QUE NO SUENA AQUÍ: el audio nunca entra en la llamada de voz. Rompería
 * su cifrado extremo a extremo (decisiones/0001) y el SDK de Spotify tampoco lo
 * permitiría. Se comparte el estado —qué suena y en qué segundo—, no el sonido.
 */

export function SpotifyWidget({
  channelId,
  panelDirection = "down",
  variante = "boton",
}: {
  channelId: string;
  /** "up" cuando el icono vive cerca del borde inferior (la barra de llamada). */
  panelDirection?: "up" | "down";
  /**
   * "boton": el icono de siempre, que abre un popover — así vive en la cabecera
   * del canal de voz y en la barra de llamada.
   *
   * "expandido": el reproductor entero, fijo, sin icono ni popover — para el
   * panel personalizable, donde alguien puede querer que Spotify se vea «como si
   * fuera literalmente Spotify» en vez de un mando escondido. Es la misma pieza
   * puesta en una tarjeta en lugar de en un menú.
   */
  variante?: "boton" | "expandido";
}) {
  const [abierto, setAbierto] = useState(false);
  const [pestana, setPestana] = useState<Pestana>("cola");
  const contenedor = useRef<HTMLDivElement>(null);

  // El reproductor y la cola no viven aquí: viven en SpotifyProvider, montado en
  // el layout de /app. Por eso la música sobrevive a irse al tablero o a la
  // biblioteca — esto es solo el mando, y no guarda copia de nada. Tener dos
  // copias de la cola era justo lo que rompía el encadenado.
  const {
    player,
    cuenta,
    cola,
    sesion,
    verCanal,
    refrescar,
    poner,
    poniendo,
    encolar,
    quitar,
    desconectar,
  } = useSpotify();
  const { estado: repro } = player;

  const conectado = cuenta?.connected ?? false;
  const puedeControlar = repro.listo && !repro.sinPremium;

  // Declarar qué sala se está mirando: el proveedor trae su cola y su sesión.
  useEffect(() => {
    verCanal(channelId);
  }, [channelId, verCanal]);

  useSpotifyChannelFeed(channelId, () => {
    void refrescar(channelId);
  });

  // Cerrar al pulsar fuera, como la campana de notificaciones. En "expandido" no
  // hay nada que cerrar: no existe el estado abierto/cerrado.
  useEffect(() => {
    if (variante !== "boton" || !abierto) return;
    const fuera = (evento: MouseEvent) => {
      if (!contenedor.current?.contains(evento.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [variante, abierto]);

  /**
   * Los errores se cuentan con su motivo, no con un «no se pudo». Dos fallos de
   * esta misma integración tardaron horas en encontrarse precisamente porque el
   * motivo real quedaba tapado por un mensaje genérico.
   */
  const reproducir = useCallback(
    async (pista: Ponible) => {
      try {
        await poner(pista);
      } catch (fallo) {
        toast.error("No se pudo reproducir", {
          description: explicarFalloSpotify(fallo),
        });
      }
    },
    [poner],
  );

  const reproducirContexto = player.reproducirContexto;

  /** Poner una lista entera. Ver `reproducirContexto` para por qué no son URIs. */
  const reproducirLista = useCallback(
    async (contextoUri: string) => {
      try {
        await reproducirContexto(contextoUri);
      } catch (fallo) {
        toast.error("No se pudo poner la lista", {
          description: explicarFalloSpotify(fallo),
        });
      }
    },
    [reproducirContexto],
  );

  if (cuenta === null) return null;

  // Solo quien tiene el SDK sonando es «el que pincha»: es quien publica el
  // estado al resto y el único con transporte.
  const pinchando = repro.pista !== null;

  // Lo que se pinta arriba: el SDK si estamos pinchando, la sesión compartida si
  // no. Ver la cabecera del archivo.
  const enPortada = pinchando
    ? {
        nombre: repro.pista!.nombre,
        artista: repro.pista!.artista,
        caratula: repro.pista!.caratula,
        posicionMs: repro.posicionMs,
        duracionMs: repro.duracionMs || repro.pista!.duracionMs,
        sonando: repro.reproduciendo,
      }
    : sesion?.trackName
      ? {
          nombre: sesion.trackName,
          artista: sesion.trackArtist ?? "",
          caratula: sesion.trackImageUrl,
          posicionMs: sesion.positionMs,
          duracionMs: sesion.durationMs ?? 0,
          sonando: sesion.isPlaying,
        }
      : null;

  const sonandoAlgo = enPortada?.sonando ?? false;

  // El contenido es idéntico en los dos modos: lo único que cambia es lo que lo
  // envuelve (un popover que aparece y desaparece, o una tarjeta fija). Un solo
  // cuerpo evita que "expandido" y "boton" acaben divergiendo con el tiempo, que
  // es como dos reproductores acaban contando historias distintas.
  const contenido = (
    <>
      {/* Buscar y encolar NO exigen cuenta conectada: la búsqueda va con el
          token de aplicación del servidor. Por eso el aviso de conectar es una
          franja arriba y no una pantalla que tape el reproductor — quien no
          tiene Spotify sigue pudiendo proponer canciones, que es media función
          del widget. Conectada, esa misma franja es el único sitio donde se
          cierra la sesión: ni la aplicación ni Spotify ofrecen otro. */}
      {conectado ? <Conectada onDesconectar={desconectar} /> : <Conectar />}

      <Portada
        pista={enPortada}
        pinchando={pinchando}
        sinPremium={conectado && (repro.sinPremium || !cuenta.premium)}
      />

      {/* Por qué no hay botones de reproducción. Sin esta línea, un reproductor
          sin transporte es indistinguible de uno roto — y las tres razones piden
          reacciones distintas de quien mira. */}
      {conectado && !puedeControlar && (
        <PorQueNoSuena sinPremium={repro.sinPremium || !cuenta.premium} fallo={repro.fallo} />
      )}

      {/* La orden tarda un momento en confirmarse contra Spotify. Decirlo es lo
          que evita que se vuelva a pulsar, y dos órdenes solapadas se estorban
          hasta que no suena ninguna. */}
      {poniendo && (
        <p className="flex items-center gap-2 border-y border-line bg-canvas/40 px-4 py-2 text-[11px] text-faint">
          <Loader2 size={11} className="animate-spin" />
          Poniendo…
        </p>
      )}

      {puedeControlar && enPortada && (
        <>
          <Barra
            posicionMs={repro.posicionMs}
            duracionMs={repro.duracionMs || repro.pista?.duracionMs || 0}
            onEmpezar={player.empezarArrastre}
            onArrastrar={player.arrastrarA}
            onSoltar={player.soltarEn}
          />
          <Transporte player={player} />
        </>
      )}

      <Pestanas
        actual={pestana}
        onCambiar={setPestana}
        conteoCola={cola.length}
        /* Ojear tus playlists NO exige reproductor: solo ponerlas. Tenerla
           detrás de `puedeControlar` la escondía justo cuando el SDK tarda en
           arrancar, y desde fuera eso se ve como que no tienes ninguna. */
        conBiblioteca={conectado}
        conDispositivos={puedeControlar}
      />

      <div
        className={`overflow-y-auto px-3 pb-3 ${variante === "expandido" ? "max-h-96" : "max-h-64"}`}
      >
        {pestana === "cola" && (
          <Cola
            cola={cola}
            puedeReproducir={puedeControlar}
            onReproducir={reproducir}
            onQuitar={(id) => quitar(id)}
          />
        )}
        {pestana === "buscar" && (
          <Buscador
            channelId={channelId}
            puedeReproducir={puedeControlar}
            onEncolada={encolar}
            onReproducir={reproducir}
          />
        )}
        {pestana === "biblioteca" && (
          <Biblioteca
            listar={player.listarPlaylists}
            listarPistas={player.listarPistas}
            onPonerLista={reproducirLista}
            puedeReproducir={puedeControlar}
            channelId={channelId}
            onEncolada={encolar}
          />
        )}
        {pestana === "dispositivos" && puedeControlar && (
          <Dispositivos
            listar={player.listarDispositivos}
            transferir={player.transferirA}
            esteDispositivo={repro.dispositivoId}
          />
        )}
      </div>
    </>
  );

  if (variante === "expandido") {
    // Sin cristal ni sombra propia: la tarjeta que lo aloja (en el panel) ya
    // pone la superficie. Esto solo aporta la estructura interior.
    return (
      <div className="overflow-hidden rounded-2xl border border-line bg-raised/40">{contenido}</div>
    );
  }

  return (
    <div ref={contenedor} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label={enPortada ? `Música: ${enPortada.nombre}` : "Música compartida"}
        aria-expanded={abierto}
        title={enPortada ? `${enPortada.nombre} · ${enPortada.artista}` : "Música compartida"}
        className={`presionable relative grid size-8 place-items-center rounded-lg
          ${sonandoAlgo ? "text-live" : "text-muted hover:bg-raised hover:text-ink"}`}
      >
        {sonandoAlgo ? <Ecualizador /> : <Music size={14} />}
      </button>

      {abierto && (
        <div
          className={`devup-emerge cristal absolute z-50 w-[22rem] overflow-hidden rounded-2xl
            ${panelDirection === "up" ? "bottom-full mb-2 origin-bottom-right" : "top-full mt-2 origin-top-right"}
            right-0`}
        >
          {contenido}
        </div>
      )}
    </div>
  );
}
