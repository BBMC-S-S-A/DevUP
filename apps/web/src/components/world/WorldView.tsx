"use client";

import { Loader2, Volume2, Users, Shirt, Pencil, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useVoiceCall } from "@/lib/voice/VoiceCallProvider";
import { TILE } from "@/lib/world/atlas";
import { render, type Camera } from "@/lib/world/renderer";
import { seatsOf } from "@/lib/world/props";
import { buildScene, type Scene } from "@/lib/world/scene";
import type { Input } from "@/lib/world/useWorld";
import { useWorld } from "@/lib/world/useWorld";
import { useEditor } from "@/lib/world/useEditor";
import type { Avatar, LiveData, WorldMap, Zone } from "@/lib/world/types";
import { AvatarEditor } from "./AvatarEditor";
import { DevVerseEntrance } from "./DevVerseEntrance";
import { ZoneEditor } from "./ZoneEditor";
import { useLlamada } from "@/lib/world/useLlamada";
import { LlamadaEntrante, MenuCercania, PanelLlamada } from "./Cercania";
import { ProximityAudio } from "./ProximityAudio";

/**
 * Hasta dónde se oye, en casillas. Ver el documento 0002: es lo que reparte la
 * malla WebRTC en corrillos pequeños en vez de exigir N−1 conexiones por
 * persona, que es donde se rompe por encima de seis.
 */
export const AUDIBLE_RADIUS = 5.5;

/**
 * A qué distancia se ofrece hablar con alguien.
 *
 * Más corto que el radio en que se le oye, y a propósito: oír a media sala
 * está bien, pero que el menú de «llamar» salte por cada persona que pasa
 * cerca lo convierte en ruido que se aprende a ignorar. Dos casillas y media
 * es ponerse delante de alguien, no cruzarse con él.
 */
const RADIO_MENU = 2.5;

const KEYS: Record<string, keyof Input> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

export function WorldView({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const { user } = useSession();
  const { joinChannel, leaveChannel, activeChannelId, room } = useVoiceCall();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<Input>({ up: false, down: false, left: false, right: false });
  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 2 });

  const [map, setMap] = useState<WorldMap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  /** La caja de escribir. Abierta, el teclado deja de mover al avatar. */
  const [talking, setTalking] = useState(false);
  const [draft, setDraft] = useState("");
  const talkingRef = useRef(false);
  talkingRef.current = talking;

  const loadMap = useCallback(
    () =>
      api
        .get<WorldMap>(`/workspaces/${workspaceId}/world`)
        .then((data) => setMap(data))
        .catch(() => {}),
    [workspaceId],
  );

  /**
   * Los datos que muestran los muebles.
   *
   * Se piden cada medio minuto, la misma cadencia que los no leídos de la
   * barra lateral. Empujarlos por el socket exigiría que el servidor supiera,
   * por cada persona conectada, qué canales privados ve — una consulta por
   * miembro y por tarea movida. A este tamaño no compensa.
   */
  const [live, setLive] = useState<LiveData | null>(null);

  useEffect(() => {
    const load = () =>
      api
        .get<LiveData>(`/workspaces/${workspaceId}/world/live`)
        .then(setLive)
        .catch(() => {});
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [workspaceId]);

  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const editingZone = map?.zones.find((z) => z.id === editingZoneId) ?? null;

  const editor = useEditor(editingZone, loadMap);

  /**
   * La escena.
   *
   * Editando, se reconstruye con lo que hay en el editor en vez de con lo
   * guardado. Así la vista previa **es** el mundo —con sus colisiones, su
   * orden por Y y su perspectiva— y no una capa dibujada encima que se
   * parezca. Colocar un sofá y no poder rodearlo hasta guardar sería el tipo
   * de detalle que hace que un editor no se sienta fiable.
   */
  const scene: Scene | null = useMemo(() => {
    if (!map?.room) return null;
    if (!editor.active || !editingZoneId) return buildScene(map.room, map.zones, live);

    const zones = map.zones.map((zone) =>
      zone.id === editingZoneId
        ? {
            ...zone,
            customized: true,
            props: editor.items.map((item, index) => ({
              id: `preview-${index}`,
              kind: item.kind,
              x: Math.round(item.x),
              y: Math.round(item.y),
              facing: item.facing,
              tone: item.tone,
            })),
          }
        : zone,
    );
    return buildScene(map.room, zones, live);
  }, [map, live, editor.active, editor.items, editingZoneId]);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<WorldMap>(`/workspaces/${workspaceId}/world`)
      .then((data) => {
        if (!cancelled) setMap(data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLoadError(caught instanceof ApiError ? caught.message : "no se pudo cargar la oficina");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  /**
   * Las funciones de la llamada, tras una referencia.
   *
   * `joinChannel` y `leaveChannel` se recrean en cada renderizado del
   * proveedor de llamada — no están memoizadas—, así que usarlas como
   * dependencia de un efecto hace que ese efecto se vuelva a montar
   * continuamente. Con el efecto de limpieza de abajo eso era un bucle
   * infinito: al desmontar llamaba a `leaveChannel`, que cambia el estado del
   * proveedor, que vuelve a renderizar, que vuelve a desmontar el efecto.
   *
   * Lo cazó la prueba de navegador, no la de tipos ni la de la base: el
   * síntoma era «Maximum update depth exceeded» y solo aparece ejecutando la
   * aplicación de verdad.
   */
  const voiceRef = useRef({ joinChannel, leaveChannel });
  voiceRef.current = { joinChannel, leaveChannel };

  /**
   * Cruzar una puerta es entrar en el canal.
   *
   * Aquí es donde la regla del documento 0002 deja de ser prosa: una zona de
   * voz no abre «una sala del mundo», abre el canal que proyecta, con su mismo
   * historial y su mismo consentimiento de grabación. Quien esté en la vista
   * profesional ve exactamente la misma llamada.
   */
  const onZoneChange = useCallback(
    (zone: Zone | null) => {
      if (!zone || zone.channelKind !== "voice") {
        // Una zona de texto no arrastra a nadie a una llamada: se entra y se
        // sale de un canal de texto leyendo, no hablando.
        voiceRef.current.leaveChannel();
        return;
      }
      voiceRef.current.joinChannel(zone.channelId, workspaceId, zone.channelName);
    },
    [workspaceId],
  );

  const zoneRef = useRef<Zone | null>(null);

  // El manejador viaja por una referencia porque useWorld se monta antes que
  // useLlamada y esta necesita el `enviar` de aquella. Pasar la función
  // directamente sería una dependencia circular; pasar una que la busca en el
  // momento, no.
  const recibirLlamadaRef = useRef<((m: never) => void) | null>(null);

  const world = useWorld({
    workspaceId,
    scene,
    displayName: user?.displayName ?? "tú",
    selfUserId: user?.id ?? "",
    onZoneChange,
    onDirecto: (mensaje) => recibirLlamadaRef.current?.(mensaje as never),
  });

  const llamada = useLlamada(world.enviar);
  recibirLlamadaRef.current = llamada.recibir as never;

  // El teclado se monta una sola vez; el editor cambia en cada renderizado.
  // Sin estas referencias, el efecto se volvería a montar constantemente — es
  // el mismo fallo que provocó el bucle infinito con `leaveChannel`.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const editorActiveRef = useRef(editor.active);
  editorActiveRef.current = editor.active;

  // --- Teclado --------------------------------------------------------------
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      // Escribiendo tampoco se camina, ni se abre nada con E: cada tecla es
      // una letra. Sin esto, escribir «hasta luego» manda al avatar a dar una
      // vuelta por la sala mientras se teclea.
      if (talkingRef.current) return;

      if (event.code === "KeyT" && zoneRef.current) {
        event.preventDefault();
        setTalking(true);
        return;
      }
      if (event.code.startsWith("Digit") && !event.metaKey && !event.ctrlKey) {
        const kinds = ["wave", "yes", "clap", "hand"] as const;
        const index = Number(event.code.slice(5)) - 1;
        if (index >= 0 && index < kinds.length) {
          event.preventDefault();
          emoteRef.current(kinds[index]!);
          return;
        }
      }

      // Editando no se camina. Con las dos cosas a la vez, colocar un mueble
      // con la W pulsada manda al avatar contra la pared del fondo.
      if (editorActiveRef.current) {
        if (event.code === "KeyR") editorRef.current.rotateSelected();
        if (event.code === "Delete" || event.code === "Backspace") {
          event.preventDefault();
          editorRef.current.deleteSelected();
        }
        if (event.code === "KeyZ" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          editorRef.current.undo();
        }
        if (event.code === "Escape") editorRef.current.close();
        return;
      }
      if (event.code === "KeyE" && actionRef.current) {
        event.preventDefault();
        const current = actionRef.current;
        if (current.kind === "sit") sitRef.current(current.seat);
        else if (current.kind === "stand") sitRef.current(null);
        else router.push(current.href);
        return;
      }
      const key = KEYS[event.code];
      if (!key) return;
      // Sin esto, las flechas desplazan la página por debajo del lienzo.
      event.preventDefault();
      inputRef.current[key] = true;
    };
    const up = (event: KeyboardEvent) => {
      const key = KEYS[event.code];
      if (!key) return;
      inputRef.current[key] = false;
    };
    // Cambiar de pestaña con una tecla pulsada deja el avatar andando solo
    // contra una pared para siempre.
    const blur = () => {
      inputRef.current = { up: false, down: false, left: false, right: false };
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  zoneRef.current = world.zone;

  // --- Bucle de animación ---------------------------------------------------
  const { step, stateRef, avatars, sit, say, emote, selfBubbleRef, selfEmoteRef } = world;
  const emoteRef = useRef(emote);
  emoteRef.current = emote;
  const sitRef = useRef(sit);
  sitRef.current = sit;
  const selfUserId = user?.id ?? "";
  const displayName = user?.displayName ?? "tú";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scene) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let last = performance.now();
    const started = last;

    const resize = () => {
      // El lienzo se dimensiona en píxeles reales del dispositivo. Sin esto,
      // en una pantalla con densidad doble todo sale borroso — y con arte de
      // píxel el desenfoque es lo primero que se ve.
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      // 1,2 y no 2. Con el doble, una casilla ocupa 64 px y en pantalla caben
      // seis: se ve el suelo y poco más, y una oficina que existe para
      // recorrerse se convierte en un pasillo estrecho. Lo cazó la prueba de
      // navegador — mirando el renderizador aislado no se nota, porque allí la
      // cámara la fija la propia prueba.
      cameraRef.current.scale = 1.2 * ratio;
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = (now: number) => {
      // El delta se acota: volver a una pestaña dormida entrega un salto de
      // varios segundos y el avatar aparecería al otro lado del mapa.
      const dt = Math.min(64, now - last);
      last = now;

      step(dt, inputRef.current);

      const self = stateRef.current.self;
      const camera = cameraRef.current;
      const targetX = self.x * TILE;
      const targetY = self.y * TILE;
      // La cámara persigue con retraso: pegada al avatar, cada paso sacude la
      // pantalla entera.
      const k = 1 - Math.exp(-dt / 90);
      camera.x += (targetX - camera.x) * k;
      camera.y += (targetY - camera.y) * k;

      render(ctx, {
        scene,
        self: {
          ...self,
          displayName,
          bubble: selfBubbleRef.current?.text,
          emote: selfEmoteRef.current?.kind,
          emoteProgress: selfEmoteRef.current
            ? Math.max(0, Math.min(1, 1 - (selfEmoteRef.current.until - now) / 2200))
            : 0,
        },
        peers: [...stateRef.current.peers.values()],
        avatars,
        selfUserId,
        camera,
        time: now - started,
        audibleRadius: AUDIBLE_RADIUS,
      });

      // Solo se toca el estado si el rótulo cambia: llamar a setAction en
      // cada fotograma sería un renderizado de React sesenta veces por
      // segundo para escribir el mismo texto.
      const next = findActionRef.current();
      if (next?.label !== actionRef.current?.label) setAction(next);

      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [scene, step, stateRef, avatars, selfUserId, displayName, selfBubbleRef, selfEmoteRef]);

  /**
   * Del clic a la casilla.
   *
   * Deshace exactamente la transformación del renderizador: escala, y traslada
   * por la cámara. Tenerlo en un solo sitio importa — si la conversión y el
   * dibujo divergen, se coloca un mueble y aparece dos casillas más allá, que
   * es de los fallos más difíciles de diagnosticar mirando el código.
   */
  const onCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!editor.active || !editingZone) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const camera = cameraRef.current;
      const viewW = canvas.width / camera.scale;
      const viewH = canvas.height / camera.scale;

      const worldX = ((event.clientX - rect.left) * ratio) / camera.scale + camera.x - viewW / 2;
      const worldY = ((event.clientY - rect.top) * ratio) / camera.scale + camera.y - viewH / 2;

      // Relativas a la sala, que es como se guardan.
      const rx = Math.floor(worldX / TILE) - editingZone.x;
      const ry = Math.floor(worldY / TILE) - editingZone.y;

      if (editor.brush) editor.place(rx, ry);
      else if (editor.selected >= 0) editor.moveSelected(rx, ry);
      else editor.selectAt(rx, ry);
    },
    [editor, editingZone],
  );

  /**
   * Qué se puede hacer aquí de pie.
   *
   * EL PUENTE ENTRE LAS DOS VISTAS. Pulsar E delante de la pizarra abre el
   * tablero; delante de la estantería, la biblioteca. No una versión del mundo
   * de esas cosas: la de la vista profesional, la misma que usa quien nunca
   * abrió la oficina. Es lo que impide que acaben siendo dos productos, y es
   * también lo que hace que el mueble no sea un adorno con un número encima.
   */
  /**
   * Qué se puede hacer aquí de pie.
   *
   * EL PUENTE ENTRE LAS DOS VISTAS. Pulsar E delante de la pizarra abre el
   * tablero; delante de la estantería, la biblioteca. No una versión del mundo
   * de esas cosas: la de la vista profesional, la misma que usa quien nunca
   * abrió la oficina. Es lo que impide que acaben siendo dos productos.
   *
   * SE CALCULA EN EL BUCLE, NO EN UN MEMO. La posición vive en una referencia
   * mutable —cambia sin renderizar—, así que un `useMemo` sobre la sala se
   * calculaba una vez al cruzar la puerta y no volvía a mirar: el aviso no
   * aparecía nunca por muy pegado a la pizarra que estuvieras. Aquí se
   * recorre por fotograma pero solo se toca el estado cuando el rótulo
   * cambia, que es unas pocas veces por minuto.
   */
  type Action =
    | { kind: "link"; label: string; href: string }
    | { kind: "sit"; label: string; seat: { x: number; y: number; facing: "n" | "s" | "e" | "o" } }
    | { kind: "stand"; label: string };

  const [action, setAction] = useState<Action | null>(null);
  const actionRef = useRef(action);
  actionRef.current = action;

  const findAction = useCallback((): Action | null => {
    if (!scene || editor.active) return null;
    const self = stateRef.current.self;
    const zone = zoneRef.current;

    // Sentado, la única acción es levantarse. Ofrecer «ver el tablero» a quien
    // está en una silla obligaría a decidir si levantarse primero, y no hay
    // respuesta buena.
    if (self.sitting) return { kind: "stand", label: "Levantarse" };

    let best: Action | null = null;
    let bestDistance = 2.1;

    // Las plazas primero: si hay una silla al lado, sentarse gana sobre abrir
    // un panel. Es la acción más inmediata y la que menos cuesta deshacer.
    for (const piece of scene.props) {
      for (const seat of seatsOf(piece)) {
        const distance = Math.hypot(seat.x + 0.5 - self.x, seat.y + 0.9 - self.y);
        // 1,8 y no 1,4. Con 1,4, estar de pie en la fila del escritorio y la
        // silla justo debajo daba 1,49 — fuera por cinco centésimas, y desde
        // fuera parece que sentarse no funciona. Una casilla y media es lo que
        // se lee como «estoy al lado de esta silla».
        if (distance > 1.8 || distance > bestDistance) continue;
        best = { kind: "sit", label: "Sentarse", seat };
        bestDistance = distance;
      }
    }

    for (const piece of [...scene.props, ...scene.wallProps]) {
      const distance = Math.hypot(piece.x + 0.5 - self.x, piece.y + 0.9 - self.y);
      if (distance > bestDistance) continue;

      if (piece.kind === "whiteboard" || piece.kind === "flipchart") {
        best = { kind: "link", label: "Ver el tablero", href: `/app/w/${workspaceId}/board` };
        bestDistance = distance;
      } else if (piece.kind === "bookshelf") {
        best = { kind: "link", label: "Abrir la biblioteca", href: `/app/w/${workspaceId}` };
        bestDistance = distance;
      } else if ((piece.kind === "monitor" || piece.kind === "dualMonitor") && zone) {
        best = {
          kind: "link",
          label: `Abrir #${zone.channelName}`,
          href: `/app/w/${workspaceId}/c/${zone.channelId}`,
        };
        bestDistance = distance;
      }
    }
    return best;
  }, [scene, editor.active, stateRef, workspaceId]);

  const findActionRef = useRef(findAction);
  findActionRef.current = findAction;

  // Salir de la oficina cuelga la llamada: quedarse dentro de un canal al que
  // se entró caminando, después de cerrar la vista, no lo espera nadie.
  // Sin dependencias y a través de la referencia: ver el comentario de
  // `voiceRef`. Con `[leaveChannel]` esto era un bucle infinito.
  useEffect(() => () => voiceRef.current.leaveChannel(), []);

  const { refreshAvatars } = world;
  /**
   * Guardar el aspecto, con dos destinos posibles.
   *
   * «Solo aquí» lo guarda como atuendo de esta organización; «en todas
   * partes», como el personaje de siempre. La distinción existe porque
   * mucha gente quiere ir de una manera con su equipo y de otra con el
   * cliente, y hasta ahora tenía que elegir una sola para todo.
   *
   * El personaje base es el que manda donde no hay atuendo, así que
   * guardar «en todas partes» NO borra los atuendos que ya existan: cambia
   * el fondo, no lo que está puesto encima. Quitarse uno es explícito.
   */
  const saveAvatar = useCallback(
    async (look: Avatar, soloAqui: boolean) => {
      await api.put(
        soloAqui ? `/world/avatar?workspace=${workspaceId}` : "/world/avatar",
        look,
      );
      await refreshAvatars();
      setEditing(false);
    },
    [refreshAvatars, workspaceId],
  );

  /** Quitarse el atuendo de aquí y volver al personaje de siempre. */
  const quitarAtuendo = useCallback(async () => {
    await api.delete(`/world/outfit/${workspaceId}`);
    await refreshAvatars();
    setEditing(false);
  }, [refreshAvatars, workspaceId]);

  if (loadError) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <p className="text-sm text-danger">{loadError}</p>
      </div>
    );
  }

  if (!scene) {
    return <DevVerseEntrance />;
  }

  const nearby = [...world.roster].filter((peer) => {
    const self = stateRef.current.self;
    return Math.hypot(peer.x - self.x, peer.y - self.y) <= AUDIBLE_RADIUS;
  });

  // Solo la persona más cercana, y solo una. Un menú por cada uno de los que
  // hay alrededor sería una fila de tarjetas tapando la oficina; y con dos a
  // la misma distancia, elegir la más cercana es la regla que menos sorprende.
  const cerca = nearby
    .map((peer) => ({
      peer,
      d: Math.hypot(peer.x - stateRef.current.self.x, peer.y - stateRef.current.self.y),
    }))
    .filter(({ d }) => d <= RADIO_MENU)
    .sort((a, b) => a.d - b.d)[0]?.peer;

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      <canvas
        ref={canvasRef}
        onClick={onCanvasClick}
        className={`h-full w-full ${editor.active ? "cursor-crosshair" : ""}`}
      />

      {/* El audio de cada par, con el volumen que le toque por distancia. */}
      <ProximityAudio
        participants={room.participants}
        stateRef={stateRef}
        radius={AUDIBLE_RADIUS}
      />

      {/* --- Estado de la oficina --- */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-line bg-surface/90 px-3 py-2 backdrop-blur">
          <Users size={14} className="text-faint" />
          <span className="text-xs text-muted">
            {world.roster.length + 1} en la oficina
            {nearby.length > 0 && (
              <span className="text-faint"> · {nearby.length} a tu alcance</span>
            )}
          </span>
          {world.status === "connecting" && (
            <Loader2 size={12} className="animate-spin text-faint" />
          )}
          {world.status === "error" && <span className="text-xs text-danger">sin conexión</span>}
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {world.zone && (
            <div className="flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2">
              {world.zone.channelKind === "voice" ? (
                <Volume2 size={13} className="text-accent" />
              ) : (
                <span className="text-accent">#</span>
              )}
              <span className="text-xs font-medium text-accent">{world.zone.channelName}</span>
              {activeChannelId === world.zone.channelId && (
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-live animate-pulse-slow" />
              )}
            </div>
          )}
          {world.zone && !editor.active && (
            <button
              type="button"
              onClick={() => {
                setEditingZoneId(world.zone!.id);
                // El estado del editor se siembra en el siguiente ciclo, cuando
                // `editingZone` ya apunta a la sala elegida.
                setTimeout(() => editorRef.current.open(), 0);
              }}
              title="Amueblar esta sala"
              className="flex items-center gap-1.5 rounded-xl border border-line bg-surface/90 px-3 py-2 text-xs text-muted backdrop-blur transition hover:text-ink"
            >
              <Pencil size={13} />
              Amueblar
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 rounded-xl border border-line bg-surface/90 px-3 py-2 text-xs text-muted backdrop-blur transition hover:text-ink"
          >
            <Shirt size={13} />
            Mi personaje
          </button>
        </div>
      </div>

      {/* --- Ayuda, solo mientras no se haya movido nadie --- */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
        {action ? (
          <p className="rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-[11px] text-accent backdrop-blur">
            <kbd className="rounded bg-canvas/60 px-1.5 py-0.5 font-semibold">E</kbd> {action.label}
          </p>
        ) : (
          <p className="rounded-xl border border-line bg-surface/90 px-3 py-2 text-[11px] text-faint backdrop-blur">
            Muévete con <kbd className="text-muted">WASD</kbd> ·{" "}
            <kbd className="text-muted">T</kbd> para hablar ·{" "}
            <kbd className="text-muted">1-4</kbd> gestos
          </p>
        )}
      </div>

      {talking && world.zone && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft;
            setDraft("");
            setTalking(false);
            if (text.trim()) void say(text, world.zone!.channelId).catch(() => {});
          }}
          className="pointer-events-auto absolute inset-x-0 bottom-16 z-30 flex justify-center px-4"
        >
          <div className="flex w-full max-w-md items-center gap-2 rounded-xl border border-accent/40 bg-surface/95 px-3 py-2 backdrop-blur">
            <MessageSquare size={14} className="shrink-0 text-accent" />
            <input
              autoFocus
              value={draft}
              maxLength={200}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Escape cierra sin mandar. El evento se para aquí para que no
                // llegue al manejador global, que lo usa para cerrar el editor.
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setDraft("");
                  setTalking(false);
                }
              }}
              onBlur={() => setTalking(false)}
              placeholder={`Decir algo en #${world.zone.channelName}…`}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
            <span className="shrink-0 text-[10px] text-faint">queda en el canal</span>
          </div>
        </form>
      )}

      {/* El menú al acercarse. No aparece con el editor abierto: ahí uno está
          amueblando, no socializando, y la tarjeta taparía justo lo que se
          está colocando. */}
      {cerca && !editor.active && llamada.estado.fase === "libre" && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 z-30 -translate-x-1/2">
          <MenuCercania
            nombre={cerca.displayName}
            title={cerca.title}
            presence={cerca.presence}
            ocupado={false}
            onSaludar={() => world.emote("wave")}
            onLlamar={() => llamada.llamar(cerca.peerId, cerca.displayName)}
          />
        </div>
      )}

      {llamada.estado.fase === "entrante" && (
        <LlamadaEntrante
          nombre={llamada.estado.nombre}
          title={llamada.estado.title}
          onAceptar={() => void llamada.responder(true)}
          onRechazar={() => void llamada.responder(false)}
        />
      )}

      <PanelLlamada
        estado={llamada.estado}
        remoto={llamada.remoto}
        conVideo={llamada.conVideo}
        onColgar={llamada.colgar}
        onCamara={() => void llamada.encenderCamara()}
        enviarPorCanal={llamada.enviarPorCanal}
        escucharCanal={llamada.escucharCanal}
      />

      {editor.active && editingZone && <ZoneEditor zone={editingZone} editor={editor} />}

      {editing && (
        <AvatarEditor
          initial={avatars.get(selfUserId)}
          onCancel={() => setEditing(false)}
          onSave={saveAvatar}
          llevaAtuendo={world.conAtuendoPropio}
          onQuitarAtuendo={quitarAtuendo}
        />
      )}
    </div>
  );
}
