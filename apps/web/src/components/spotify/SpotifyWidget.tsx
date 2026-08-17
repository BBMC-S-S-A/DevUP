"use client";

import {
  ChevronLeft,
  Heart,
  Laptop2,
  Library,
  ListMusic,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Smartphone,
  Speaker,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  API_URL,
  ApiError,
  api,
  type SpotifyQueueTrack,
  type SpotifySession,
  type SpotifyTrack,
} from "@/lib/api";
import { useSpotify, type Ponible } from "@/lib/spotify/SpotifyProvider";
import { useSpotifyChannelFeed } from "@/lib/spotify/useSpotifyChannelFeed";
import { reloj, type Playlist, type useSpotifyPlayer } from "@/lib/spotify/useSpotifyPlayer";
import { BotonIcono } from "@/components/ui/Boton";
import { Rotulo } from "@/components/ui/Superficies";

/**
 * El reproductor de música de la sala.
 *
 * Es un reproductor completo, no un mando a distancia: carátula, barra que se
 * arrastra, transporte, volumen, aleatorio, repetición, cola y dispositivos.
 *
 * DOS FUENTES DE VERDAD, Y CUÁL MANDA EN CADA CASO. Quien reproduce (hace
 * falta Premium) tiene el SDK en su navegador y sabe la posición exacta al
 * milisegundo. El resto de la sala solo tiene lo que ese navegador haya
 * publicado en `channel_listening_sessions`. Así que: si el SDK tiene pista,
 * manda el SDK; si no, se pinta la sesión compartida. Mezclar las dos daría
 * una barra de progreso que salta hacia atrás cada vez que llega un aviso.
 *
 * Y LO QUE NO SUENA AQUÍ: el audio nunca entra en la llamada de voz. Eso
 * rompería su cifrado extremo a extremo (decisiones/0001) y el SDK de Spotify
 * tampoco lo permitiría. Lo que se comparte es el estado —qué suena y en qué
 * segundo—, no el sonido.
 */
type Estado = { connected: boolean; premium: boolean };
type Pestana = "cola" | "buscar" | "biblioteca" | "dispositivos";

export function SpotifyWidget({
  channelId,
  panelDirection = "down",
}: {
  channelId: string;
  /** "up" cuando el icono vive cerca del borde inferior (la barra de llamada). */
  panelDirection?: "up" | "down";
}) {
  const [abierto, setAbierto] = useState(false);
  const [pestana, setPestana] = useState<Pestana>("cola");
  const contenedor = useRef<HTMLDivElement>(null);

  // El reproductor y la cola ya no viven aquí: viven en SpotifyProvider,
  // montado en el layout de /app. Por eso la música sobrevive a irse al tablero
  // o a la biblioteca — este componente es solo el mando, y no guarda copia de
  // nada (tener dos copias de la cola era lo que rompía el encadenado).
  const { player, cuenta, cola, sesion, verCanal, refrescar, poner, poniendo, encolar, quitar } =
    useSpotify();
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

  // Cerrar al pulsar fuera, como la campana de notificaciones.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (evento: MouseEvent) => {
      if (!contenedor.current?.contains(evento.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  /**
   * Los errores se cuentan con su motivo, no con un «no se pudo».
   *
   * Dos bugs de esta misma integración se tardaron en encontrar justamente
   * porque el fallo real quedaba tapado por un mensaje genérico.
   */
  const reproducir = useCallback(
    async (pista: Ponible) => {
      try {
        await poner(pista);
      } catch (fallo) {
        toast.error("No se pudo reproducir", {
          description: fallo instanceof Error ? fallo.message : undefined,
        });
      }
    },
    [poner],
  );

  /** Poner una playlist entera. Ver `reproducirContexto` para por qué no son URIs. */
  const reproducirLista = useCallback(
    async (contextoUri: string) => {
      try {
        await player.reproducirContexto(contextoUri);
      } catch (fallo) {
        toast.error("No se pudo poner la lista", {
          description: fallo instanceof Error ? fallo.message : undefined,
        });
      }
    },
    [player],
  );

  if (cuenta === null) return null;

  // Solo quien tiene el SDK sonando es «el que pincha»: es quien publica el
  // estado al resto y el único con transporte.
  const pinchando = repro.pista !== null;
  const colaVista = cola;
  const sesionVista = sesion;

  // Lo que se pinta arriba: el SDK si estamos pinchando, la sesión compartida
  // si no. Ver la cabecera del archivo.
  const enPortada = pinchando
    ? {
        nombre: repro.pista!.nombre,
        artista: repro.pista!.artista,
        caratula: repro.pista!.caratula,
        posicionMs: repro.posicionMs,
        duracionMs: repro.duracionMs || repro.pista!.duracionMs,
        sonando: repro.reproduciendo,
      }
    : sesionVista?.trackName
      ? {
          nombre: sesionVista.trackName,
          artista: sesionVista.trackArtist ?? "",
          caratula: sesionVista.trackImageUrl,
          posicionMs: sesionVista.positionMs,
          duracionMs: sesionVista.durationMs ?? 0,
          sonando: sesionVista.isPlaying,
        }
      : null;

  const sonandoAlgo = enPortada?.sonando ?? false;

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
          {/* Buscar y encolar NO exigen tener cuenta conectada: la búsqueda va
              con el token de aplicación del servidor. Por eso el aviso de
              conectar es una franja arriba y no una pantalla que tape el
              reproductor — quien no tiene Spotify sigue pudiendo proponer
              canciones, que es media función del widget. */}
          {!conectado && <Conectar />}

          <Portada
            pista={enPortada}
            pinchando={pinchando}
            sinPremium={conectado && (repro.sinPremium || !cuenta.premium)}
          />

          {/* Por qué no hay botones de reproducción. Sin esta línea, un
              reproductor sin transporte es indistinguible de uno roto — y las
              tres razones piden reacciones distintas de quien mira. */}
          {conectado && !puedeControlar && (
            <PorQueNoSuena
              sinPremium={repro.sinPremium || !cuenta.premium}
              fallo={repro.fallo}
            />
          )}

          {/* La orden tarda un momento en confirmarse contra Spotify. Decirlo
              es lo que evita que se vuelva a pulsar, y dos órdenes solapadas se
              estorban hasta que no suena ninguna. */}
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
            conteoCola={colaVista.length}
            /* Ojear tus playlists NO exige reproductor: solo ponerlas. Tenerla
               detrás de `puedeControlar` la escondía justo cuando el SDK tarda
               en arrancar, y desde fuera eso se ve como que no tienes ninguna. */
            conBiblioteca={conectado}
            conDispositivos={puedeControlar}
          />

          <div className="max-h-64 overflow-y-auto px-3 pb-3">
            {pestana === "cola" && (
              <Cola
                cola={colaVista}
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
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * Piezas
 * ========================================================================= */

/**
 * El ecualizador del icono. Los fotogramas y su variante de movimiento
 * reducido viven en globals.css — aquí solo va la forma.
 */
function Ecualizador() {
  return (
    <span className="devup-ecualizador flex h-3.5 items-end gap-[2px]" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * Franja de conectar, no pantalla de conectar: quien no tiene Spotify sigue
 * viendo lo que suena y sigue pudiendo proponer canciones. Taparle el
 * reproductor entero sería quitarle media función por no tener cuenta.
 */
function Conectar() {
  return (
    <div className="flex items-center gap-3 border-b border-line bg-[#1db954]/8 px-4 py-3">
      <div className="min-w-0 flex-1">
        <Rotulo className="block">Sin conectar</Rotulo>
        <p className="mt-0.5 text-[11px] leading-snug text-muted">
          Conecta tu cuenta para poder reproducir aquí.
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          window.location.href = `${API_URL}/integrations/spotify/authorize`;
        }}
        className="presionable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#1db954]
          px-3 text-[11px] font-semibold text-black hover:brightness-110"
      >
        <Music size={12} />
        Conectar
      </button>
    </div>
  );
}

/**
 * Las tres razones por las que puede no haber transporte, en orden de lo que
 * puede hacer quien lo lee: si es la cuenta, no hay nada que esperar; si es el
 * navegador, se arregla abriéndolo en otro; si todavía está montando, basta
 * esperar unos segundos.
 */
function PorQueNoSuena({ sinPremium, fallo }: { sinPremium: boolean; fallo: string | null }) {
  if (sinPremium) {
    return (
      <p className="border-y border-warn/20 bg-warn/8 px-4 py-2 text-[11px] leading-snug text-warn">
        Spotify solo deja reproducir desde aquí con Premium. Puedes proponer canciones y las pondrá
        quien lo tenga.
      </p>
    );
  }

  if (fallo) {
    return (
      <p className="border-y border-danger/20 bg-danger/8 px-4 py-2 text-[11px] leading-snug text-danger">
        {fallo}. Puedes seguir proponiendo canciones a la cola.
      </p>
    );
  }

  return (
    <p className="flex items-center gap-2 border-y border-line bg-canvas/40 px-4 py-2 text-[11px] text-faint">
      <Loader2 size={11} className="animate-spin" />
      Preparando el reproductor…
    </p>
  );
}

/** La carátula grande con su halo, tomado del propio arte de la portada. */
function Portada({
  pista,
  pinchando,
  sinPremium,
}: {
  pista: {
    nombre: string;
    artista: string;
    caratula: string | null;
    posicionMs: number;
    duracionMs: number;
    sonando: boolean;
  } | null;
  pinchando: boolean;
  sinPremium: boolean;
}) {
  if (!pista) {
    return (
      <div className="flex items-center gap-3 p-4">
        <div className="grid size-16 shrink-0 place-items-center rounded-xl border border-line bg-raised text-faint">
          <Music size={20} />
        </div>
        <div className="min-w-0">
          <p className="font-display text-sm font-medium text-muted">Nada sonando</p>
          <p className="mt-0.5 text-xs text-faint">
            {sinPremium
              ? "Propón una canción: la pondrá quien tenga Premium."
              : "Busca una canción para empezar."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden p-4">
      {/* La carátula difuminada como luz de fondo: es lo que hace que el panel
          se tiña del color del disco que suena, igual que el propio Spotify. */}
      {pista.caratula && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 scale-125 opacity-25 blur-2xl"
          style={{ backgroundImage: `url(${pista.caratula})`, backgroundSize: "cover" }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-surface/40 to-surface/90" />

      <div className="relative flex items-center gap-3">
        {pista.caratula ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pista.caratula}
            alt=""
            className="size-16 shrink-0 rounded-xl object-cover shadow-[0_8px_24px_-8px_rgb(0_0_0/0.9)]"
          />
        ) : (
          <div className="grid size-16 shrink-0 place-items-center rounded-xl border border-line bg-raised text-faint">
            <Music size={20} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-semibold tracking-tight">{pista.nombre}</p>
          <p className="mt-0.5 truncate text-xs text-muted">{pista.artista}</p>
          <p className="mt-1.5 text-[10px] uppercase tracking-wider text-faint">
            {pinchando ? "Sonando en este equipo" : "Sonando en la sala"}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * La barra de progreso, arrastrable.
 *
 * Con Pointer Events y `setPointerCapture` para que el arrastre siga vivo
 * aunque el dedo se salga de la barra — sin eso, mover el ratón un píxel por
 * encima corta el gesto y la canción salta a donde estuviera el puntero.
 *
 * Pulsar en cualquier punto salta a ese punto: en una barra de reproducción esa
 * es la convención, al revés que al arrastrar una tarjeta, donde hay que
 * respetar por dónde se agarró.
 */
function Barra({
  posicionMs,
  duracionMs,
  onEmpezar,
  onArrastrar,
  onSoltar,
}: {
  posicionMs: number;
  duracionMs: number;
  onEmpezar: () => void;
  onArrastrar: (ms: number) => void;
  onSoltar: (ms: number) => Promise<void>;
}) {
  const pista = useRef<HTMLDivElement>(null);
  const [agarrando, setAgarrando] = useState(false);

  const msDesdeEvento = (clientX: number): number => {
    const caja = pista.current?.getBoundingClientRect();
    if (!caja || caja.width === 0) return 0;
    const razon = Math.min(1, Math.max(0, (clientX - caja.left) / caja.width));
    return razon * duracionMs;
  };

  const progreso = duracionMs > 0 ? Math.min(100, (posicionMs / duracionMs) * 100) : 0;

  return (
    <div className="px-4 pb-2">
      <div
        ref={pista}
        role="slider"
        aria-label="Posición de la canción"
        aria-valuemin={0}
        aria-valuemax={Math.round(duracionMs / 1000)}
        aria-valuenow={Math.round(posicionMs / 1000)}
        aria-valuetext={reloj(posicionMs)}
        tabIndex={0}
        onPointerDown={(evento) => {
          evento.currentTarget.setPointerCapture(evento.pointerId);
          setAgarrando(true);
          onEmpezar();
          onArrastrar(msDesdeEvento(evento.clientX));
        }}
        onPointerMove={(evento) => {
          if (!agarrando) return;
          onArrastrar(msDesdeEvento(evento.clientX));
        }}
        onPointerUp={(evento) => {
          if (!agarrando) return;
          setAgarrando(false);
          void onSoltar(msDesdeEvento(evento.clientX));
        }}
        onKeyDown={(evento) => {
          // Cinco segundos por pulsación: el mismo salto que usan los
          // reproductores de escritorio, y suficiente para no tener que
          // machacar la tecla para cruzar una canción.
          if (evento.key !== "ArrowLeft" && evento.key !== "ArrowRight") return;
          evento.preventDefault();
          const delta = evento.key === "ArrowRight" ? 5000 : -5000;
          void onSoltar(Math.min(duracionMs, Math.max(0, posicionMs + delta)));
        }}
        className="group relative h-4 cursor-pointer touch-none select-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-line-strong">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-cyan"
            style={{ width: `${progreso}%` }}
          />
        </div>
        {/* El tirador solo aparece al acercarse o al agarrar: una barra en
            reposo se lee mejor sin un punto encima. */}
        <span
          className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink
            shadow-[0_0_8px_rgb(91_140_255/0.8)] transition-opacity duration-150
            ${agarrando ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          style={{ left: `${progreso}%` }}
        />
      </div>

      <div className="flex justify-between font-mono text-[10px] tabular-nums text-faint">
        <span>{reloj(posicionMs)}</span>
        <span>{reloj(duracionMs)}</span>
      </div>
    </div>
  );
}

function Transporte({ player }: { player: ReturnType<typeof useSpotifyPlayer> }) {
  const { estado, alternarPausa, siguiente, anterior, alternarAleatorio, ciclarRepeticion } = player;
  const [volumenAbierto, setVolumenAbierto] = useState(false);

  const IconoVolumen = estado.volumen === 0 ? VolumeX : estado.volumen < 0.5 ? Volume1 : Volume2;

  return (
    <div className="flex items-center justify-between gap-1 px-4 pb-3">
      <BotonIcono
        etiqueta={estado.aleatorio ? "Desactivar aleatorio" : "Reproducción aleatoria"}
        onClick={() => void alternarAleatorio()}
        className={estado.aleatorio ? "!text-accent" : ""}
      >
        <Shuffle size={14} />
      </BotonIcono>

      <div className="flex items-center gap-1">
        <BotonIcono etiqueta="Anterior" onClick={() => void anterior()}>
          <SkipBack size={16} />
        </BotonIcono>

        <button
          type="button"
          onClick={() => void alternarPausa()}
          aria-label={estado.reproduciendo ? "Pausar" : "Reproducir"}
          className="presionable grid size-10 place-items-center rounded-full
            bg-gradient-to-b from-accent-bright to-accent text-canvas
            shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_4px_16px_-6px_rgb(91_140_255/0.8)]
            hover:brightness-110"
        >
          {estado.reproduciendo ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
        </button>

        <BotonIcono etiqueta="Siguiente" onClick={() => void siguiente()}>
          <SkipForward size={16} />
        </BotonIcono>
      </div>

      <div className="relative flex items-center">
        <BotonIcono
          etiqueta={
            estado.repeticion === 0
              ? "Repetir"
              : estado.repeticion === 1
                ? "Repetir: lista"
                : "Repetir: esta canción"
          }
          onClick={() => void ciclarRepeticion()}
          className={estado.repeticion > 0 ? "!text-accent" : ""}
        >
          {estado.repeticion === 2 ? <Repeat1 size={14} /> : <Repeat size={14} />}
        </BotonIcono>

        <BotonIcono
          etiqueta="Volumen"
          onClick={() => setVolumenAbierto((v) => !v)}
          className={volumenAbierto ? "!text-accent" : ""}
        >
          <IconoVolumen size={14} />
        </BotonIcono>

        {volumenAbierto && (
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(estado.volumen * 100)}
            onChange={(evento) => void player.ponerVolumen(Number(evento.target.value) / 100)}
            aria-label="Volumen"
            className="ml-1 h-1 w-16 cursor-pointer appearance-none rounded-full bg-line-strong
              accent-[var(--color-accent)]"
          />
        )}
      </div>
    </div>
  );
}

function Pestanas({
  actual,
  onCambiar,
  conteoCola,
  conBiblioteca,
  conDispositivos,
}: {
  actual: Pestana;
  onCambiar: (p: Pestana) => void;
  conteoCola: number;
  /** Sin reproductor propio no se puede poner una playlist, así que la pestaña sobra. */
  conBiblioteca: boolean;
  /** Sin Premium no hay reproductor propio, así que la lista de equipos sobra. */
  conDispositivos: boolean;
}) {
  const pestanas = [
    { id: "cola" as const, etiqueta: "Cola", icono: ListMusic, insignia: conteoCola },
    { id: "buscar" as const, etiqueta: "Buscar", icono: Search, insignia: 0 },
    ...(conBiblioteca
      ? [{ id: "biblioteca" as const, etiqueta: "Tu música", icono: Library, insignia: 0 }]
      : []),
    ...(conDispositivos
      ? [{ id: "dispositivos" as const, etiqueta: "Equipos", icono: Speaker, insignia: 0 }]
      : []),
  ];

  return (
    <div className="flex gap-1 border-y border-line bg-canvas/40 px-3 py-1.5">
      {pestanas.map(({ id, etiqueta, icono: Icono, insignia }) => (
        <button
          key={id}
          type="button"
          onClick={() => onCambiar(id)}
          aria-pressed={actual === id}
          className={`presionable flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5
            font-display text-[11px] font-semibold uppercase tracking-wider
            ${actual === id ? "bg-accent-soft text-accent" : "text-faint hover:text-muted"}`}
        >
          <Icono size={12} />
          {etiqueta}
          {insignia > 0 && (
            <span className="font-mono text-[10px] tabular-nums opacity-70">{insignia}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function Cola({
  cola,
  puedeReproducir,
  onReproducir,
  onQuitar,
}: {
  cola: SpotifyQueueTrack[];
  puedeReproducir: boolean;
  onReproducir: (pista: Ponible) => Promise<void>;
  onQuitar: (id: string) => Promise<void>;
}) {
  if (cola.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-xs text-faint">
        La cola está vacía. Busca algo y añádelo.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5 pt-2">
      {cola.map((pista, indice) => (
        <li
          key={pista.id}
          className="devup-entrada group flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-raised/60"
          style={{ "--retraso": `${Math.min(indice, 8) * 30}ms` } as React.CSSProperties}
        >
          <span className="w-4 shrink-0 text-center font-mono text-[10px] tabular-nums text-faint">
            {indice + 1}
          </span>
          {pista.trackImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pista.trackImageUrl} alt="" className="size-8 shrink-0 rounded object-cover" />
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded bg-raised text-faint">
              <Music size={12} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs">{pista.trackName}</span>
            <span className="block truncate text-[10px] text-faint">{pista.trackArtist}</span>
          </span>

          {puedeReproducir && (
            <BotonIcono
              etiqueta={`Reproducir ${pista.trackName}`}
              onClick={() => void onReproducir(pista)}
              className="!size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Play size={12} />
            </BotonIcono>
          )}
          <BotonIcono
            etiqueta={`Quitar ${pista.trackName} de la cola`}
            onClick={() => void onQuitar(pista.id)}
            className="!size-7 opacity-0 hover:!text-danger group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Trash2 size={12} />
          </BotonIcono>
        </li>
      ))}
    </ul>
  );
}

function Buscador({
  channelId,
  puedeReproducir,
  onEncolada,
  onReproducir,
}: {
  channelId: string;
  puedeReproducir: boolean;
  onEncolada: (pista: SpotifyQueueTrack) => Promise<void>;
  onReproducir: (pista: Ponible) => Promise<void>;
}) {
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<SpotifyTrack[]>([]);
  const [buscando, setBuscando] = useState(false);

  // Se busca cuando se deja de escribir, no en cada tecla: una petición por
  // letra desperdicia la mitad antes de que la palabra esté completa.
  useEffect(() => {
    if (consulta.trim().length === 0) {
      setResultados([]);
      return;
    }
    const temporizador = setTimeout(async () => {
      setBuscando(true);
      try {
        const { tracks } = await api.get<{ tracks: SpotifyTrack[] }>(
          `/spotify/search?q=${encodeURIComponent(consulta)}`,
        );
        setResultados(tracks);
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => clearTimeout(temporizador);
  }, [consulta]);

  const anadir = async (pista: SpotifyTrack) => {
    try {
      const { track } = await api.post<{ track: SpotifyQueueTrack }>(
        `/channels/${channelId}/spotify/queue`,
        {
          trackUri: pista.uri,
          trackName: pista.name,
          trackArtist: pista.artist,
          trackImageUrl: pista.imageUrl,
          durationMs: pista.durationMs,
        },
      );
      onEncolada(track);
      toast.success(`«${pista.name}» añadida a la cola`);
    } catch (fallo) {
      toast.error(fallo instanceof ApiError ? fallo.message : "no se pudo añadir");
    }
  };

  return (
    <div className="pt-2">
      <div className="relative mb-2">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
        <input
          autoFocus
          value={consulta}
          onChange={(evento) => setConsulta(evento.target.value)}
          placeholder="Canción, artista o álbum…"
          className="h-9 w-full rounded-xl border border-line bg-canvas/60 pl-8 pr-8 text-xs outline-none
            transition-[border-color,box-shadow] duration-200 placeholder:text-faint
            focus:border-accent/60 focus:shadow-[0_0_0_3px_rgb(91_140_255/0.14)]"
        />
        {buscando && (
          <Loader2
            size={12}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-faint"
          />
        )}
      </div>

      {resultados.length === 0 && consulta.trim().length > 0 && !buscando && (
        <p className="px-1 py-4 text-center text-xs text-faint">Nada encontrado.</p>
      )}

      <ul className="space-y-0.5">
        {resultados.map((pista, indice) => (
          <li
            key={pista.uri}
            className="devup-entrada group flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-raised/60"
            style={{ "--retraso": `${Math.min(indice, 8) * 25}ms` } as React.CSSProperties}
          >
            {pista.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pista.imageUrl} alt="" className="size-8 shrink-0 rounded object-cover" />
            ) : (
              <span className="grid size-8 shrink-0 place-items-center rounded bg-raised text-faint">
                <Music size={12} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs">{pista.name}</span>
              <span className="block truncate text-[10px] text-faint">{pista.artist}</span>
            </span>
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
              {reloj(pista.durationMs)}
            </span>

            {puedeReproducir && (
              <BotonIcono
                etiqueta={`Reproducir ${pista.name} ahora`}
                onClick={() =>
                  void onReproducir({
                    trackUri: pista.uri,
                    trackName: pista.name,
                    trackArtist: pista.artist,
                  })
                }
                className="!size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Play size={12} />
              </BotonIcono>
            )}
            <BotonIcono
              etiqueta={`Añadir ${pista.name} a la cola`}
              onClick={() => void anadir(pista)}
              className="!size-7"
            >
              <Plus size={13} />
            </BotonIcono>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Tus playlists y tus canciones guardadas.
 *
 * Poner una lista NO pasa por nuestra cola: se le entrega a Spotify como
 * contexto (`reproducirContexto`) y es él quien la sostiene, así que el
 * aleatorio, la repetición y el «siguiente» funcionan sobre la lista entera
 * como en su propia aplicación. Nuestra cola sigue siendo para lo que propone
 * la sala — las dos cosas conviven porque responden a preguntas distintas:
 * «pon este disco» y «pon esto después».
 */
function Biblioteca({
  listar,
  listarPistas,
  onPonerLista,
  puedeReproducir,
  channelId,
  onEncolada,
}: {
  listar: () => Promise<Playlist[]>;
  listarPistas: (id: string) => Promise<SpotifyTrack[]>;
  onPonerLista: (uri: string) => Promise<void>;
  /** Ojear las listas no lo exige; poner una, sí. */
  puedeReproducir: boolean;
  channelId: string;
  onEncolada: (pista: SpotifyQueueTrack) => Promise<void>;
}) {
  const [listas, setListas] = useState<Playlist[] | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<Playlist | null>(null);
  const [pistas, setPistas] = useState<SpotifyTrack[] | null>(null);

  useEffect(() => {
    void listar()
      .then((l) => {
        setListas(l);
        setFallo(null);
      })
      .catch((caido: Error) => {
        // Cualquier fallo tiene que DECIRSE. La primera versión caía en
        // `setListas([])` para todo, así que un token sin permisos, una red
        // caída y una cuenta sin playlists se veían igual: «no hay playlists en
        // esta cuenta». Es la clase de mentira que hace perder una tarde
        // buscando en el sitio equivocado.
        if (caido.message === "sin_permiso") setSinPermiso(true);
        else setFallo(caido.message);
        setListas([]);
      });
  }, [listar]);

  useEffect(() => {
    if (!abierta) return;
    setPistas(null);
    void listarPistas(abierta.id)
      .then(setPistas)
      .catch(() => setPistas([]));
  }, [abierta, listarPistas]);

  if (sinPermiso) {
    return (
      <div className="px-1 py-5 text-center">
        <p className="text-[11px] leading-relaxed text-warn">
          Tu cuenta se conectó antes de que pidiéramos acceso a tus playlists.
        </p>
        <button
          type="button"
          onClick={() => {
            window.location.href = `${API_URL}/integrations/spotify/authorize`;
          }}
          className="presionable mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1db954]
            px-3 text-[11px] font-semibold text-black hover:brightness-110"
        >
          <Music size={12} />
          Volver a conectar
        </button>
      </div>
    );
  }

  if (fallo) {
    return (
      <div className="px-1 py-5 text-center">
        <p className="text-[11px] leading-relaxed text-danger">
          No se pudieron leer tus listas.
        </p>
        <p className="mt-1 break-words font-mono text-[10px] text-faint">{fallo}</p>
      </div>
    );
  }

  if (listas === null) {
    return (
      <div className="grid place-items-center py-6">
        <Loader2 size={14} className="animate-spin text-faint" />
      </div>
    );
  }

  // Dentro de una lista concreta.
  if (abierta) {
    return (
      <div className="pt-2">
        <div className="mb-2 flex items-center gap-1.5">
          <BotonIcono etiqueta="Volver a tus listas" onClick={() => setAbierta(null)} className="!size-7">
            <ChevronLeft size={14} />
          </BotonIcono>
          <span className="min-w-0 flex-1 truncate font-display text-xs font-semibold">
            {abierta.nombre}
          </span>
          {puedeReproducir && (
            <BotonIcono
              etiqueta={`Poner ${abierta.nombre}`}
              onClick={() => void onPonerLista(abierta.uri)}
              className="!size-7 !text-accent"
            >
              <Play size={13} />
            </BotonIcono>
          )}
        </div>

        {pistas === null ? (
          <div className="grid place-items-center py-5">
            <Loader2 size={13} className="animate-spin text-faint" />
          </div>
        ) : pistas.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-faint">Esta lista está vacía.</p>
        ) : (
          <ul className="space-y-0.5">
            {pistas.map((pista, indice) => (
              <li
                key={`${pista.uri}-${indice}`}
                className="group flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-raised/60"
              >
                <span className="w-4 shrink-0 text-center font-mono text-[10px] tabular-nums text-faint">
                  {indice + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">{pista.name}</span>
                  <span className="block truncate text-[10px] text-faint">{pista.artist}</span>
                </span>
                <BotonIcono
                  etiqueta={`Añadir ${pista.name} a la cola`}
                  onClick={async () => {
                    try {
                      const { track } = await api.post<{ track: SpotifyQueueTrack }>(
                        `/channels/${channelId}/spotify/queue`,
                        {
                          trackUri: pista.uri,
                          trackName: pista.name,
                          trackArtist: pista.artist,
                          trackImageUrl: pista.imageUrl,
                          durationMs: pista.durationMs,
                        },
                      );
                      await onEncolada(track);
                      toast.success(`«${pista.name}» añadida a la cola`);
                    } catch (fallo) {
                      toast.error(fallo instanceof ApiError ? fallo.message : "no se pudo añadir");
                    }
                  }}
                  className="!size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Plus size={13} />
                </BotonIcono>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (listas.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-xs text-faint">
        No hay playlists en esta cuenta.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5 pt-2">
      {listas.map((lista, indice) => (
        <li
          key={lista.id}
          className="devup-entrada group flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-raised/60"
          style={{ "--retraso": `${Math.min(indice, 8) * 25}ms` } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={() => setAbierta(lista)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            {lista.caratula ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lista.caratula} alt="" className="size-9 shrink-0 rounded object-cover" />
            ) : (
              <span className="grid size-9 shrink-0 place-items-center rounded bg-accent-soft text-accent">
                <Heart size={13} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs">{lista.nombre}</span>
              <span className="block truncate text-[10px] text-faint">
                {/* El recuento solo si Spotify lo mandó: en `/me/playlists` no
                    siempre viene, y un «0 canciones» en una lista llena es peor
                    que no decir nada. */}
                {lista.pistas > 0 && (
                  <>
                    <span className="font-mono tabular-nums">{lista.pistas}</span> ·{" "}
                  </>
                )}
                {lista.de}
              </span>
            </span>
          </button>

          {puedeReproducir && (
            <BotonIcono
              etiqueta={`Poner ${lista.nombre}`}
              onClick={() => void onPonerLista(lista.uri)}
              className="!size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Play size={13} />
            </BotonIcono>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Los equipos donde esta cuenta puede sonar (Spotify Connect).
 *
 * Existe porque el reproductor del navegador es solo uno más: quien tenga el
 * móvil o un altavoz a mano casi siempre prefiere que suene ahí, y sin esta
 * lista tendría que salirse a la aplicación de Spotify para cambiarlo.
 */
function Dispositivos({
  listar,
  transferir,
  esteDispositivo,
}: {
  listar: () => Promise<{ id: string; name: string; type: string; is_active: boolean }[]>;
  transferir: (id: string) => Promise<void>;
  esteDispositivo: string | null;
}) {
  const [equipos, setEquipos] = useState<
    { id: string; name: string; type: string; is_active: boolean }[] | null
  >(null);

  useEffect(() => {
    void listar()
      .then(setEquipos)
      .catch(() => setEquipos([]));
  }, [listar]);

  if (equipos === null) {
    return (
      <div className="grid place-items-center py-6">
        <Loader2 size={14} className="animate-spin text-faint" />
      </div>
    );
  }

  if (equipos.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-xs text-faint">
        No hay ningún equipo disponible. Abre Spotify en el móvil o en el escritorio y aparecerá
        aquí.
      </p>
    );
  }

  const iconoDe = (tipo: string) =>
    tipo === "Smartphone" ? Smartphone : tipo === "Computer" ? Laptop2 : Speaker;

  return (
    <ul className="space-y-0.5 pt-2">
      {equipos.map((equipo) => {
        const Icono = iconoDe(equipo.type);
        const esEste = equipo.id === esteDispositivo;
        return (
          <li key={equipo.id}>
            <button
              type="button"
              onClick={async () => {
                try {
                  await transferir(equipo.id);
                  toast.success(`Sonando en ${equipo.name}`);
                } catch {
                  toast.error("No se pudo cambiar de equipo");
                }
              }}
              className={`presionable flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left
                ${equipo.is_active ? "bg-accent-soft/60 text-accent" : "text-muted hover:bg-raised/60 hover:text-ink"}`}
            >
              <Icono size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-xs">
                {equipo.name}
                {esEste && <span className="ml-1 text-[10px] text-faint">(este navegador)</span>}
              </span>
              {equipo.is_active && <Ecualizador />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
