"use client";

import { LayoutDashboard, Music, TriangleAlert, X } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AnadirWidget,
  CATALOGO_WIDGETS,
  EnlacesWidget,
  NoticiasWidget,
  NotificacionesWidget,
} from "@/components/dashboard/DashboardWidgets";
import {
  COLUMNAS,
  Rejilla,
  disposicionPorDefecto,
  type Casilla,
  type Disposicion,
} from "@/components/dashboard/Rejilla";
import { SpotifyWidget } from "@/components/spotify/SpotifyWidget";
import { BotonIcono } from "@/components/ui/Boton";
import { EstadoVacio } from "@/components/ui/Superficies";
import { type DashboardPrefs, type DashboardWidget, type Workspace, ApiError, api } from "@/lib/api";
import { useSpotify } from "@/lib/spotify/SpotifyProvider";
import { useSession } from "@/lib/session";

/**
 * El panel personal.
 *
 * «Personal» en dos sentidos a la vez: vive por persona (`/me/dashboard`, no
 * por organización) y se lee por dispositivo con la misma sesión, así que quien
 * lo coloca en el portátil lo encuentra igual en el escritorio. Ningún compañero
 * puede ver ni tocar el de otro — ver 0019, `user_dashboard_prefs`.
 *
 * Es una rejilla, no una lista: cada tarjeta va donde se la ponga y con el
 * tamaño que se le dé. La mecánica del arrastre vive en `Rejilla`; aquí solo
 * queda qué se pinta dentro de cada celda y qué se guarda.
 */

/**
 * Cuántas filas ocupa cada widget cuando nadie ha dicho lo contrario.
 *
 * No es un capricho de diseño: un widget con menos alto del que su contenido
 * necesita nace con barra de desplazamiento, y eso en un panel se lee como que
 * está roto. Estos son los altos con los que cada uno se ve entero.
 */
const ALTO_NATURAL: Record<DashboardWidget, number> = {
  spotify: 4,
  noticias: 3,
  notificaciones: 3,
  enlaces: 2,
};

/** «Buenos días» / «Buenas tardes» / «Buenas noches», según la hora local. */
function saludo(): string {
  const hora = new Date().getHours();
  if (hora < 12) return "Buenos días";
  if (hora < 19) return "Buenas tardes";
  return "Buenas noches";
}

export default function PanelPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { canal, sesion } = useSpotify();
  const { user } = useSession();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [prefs, setPrefs] = useState<DashboardPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api.get<{ workspace: Workspace }>(`/workspaces/${workspaceId}`),
      api.get<DashboardPrefs>("/me/dashboard"),
    ])
      .then(([{ workspace }, prefs]) => {
        setWorkspace(workspace);
        setPrefs(prefs);
      })
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : "no se pudo cargar el panel"),
      );
  }, [workspaceId]);

  /** Optimista siempre: nada aquí es tan importante como para hacer esperar a un
   *  arrastre a que el servidor confirme. Si falla, un aviso basta. */
  const guardar = useCallback(async (siguiente: DashboardPrefs) => {
    setPrefs(siguiente);
    try {
      await api.put("/me/dashboard", siguiente);
    } catch {
      toast.error("No se pudo guardar la disposición del panel");
    }
  }, []);

  /**
   * La disposición efectiva. Si nunca se ha colocado nada a mano, se deriva del
   * orden guardado en vez de dejar el panel vacío: quien viene de la versión en
   * columna encuentra sus widgets en el mismo orden de lectura, ya repartidos en
   * dos columnas.
   */
  const disposicion = useMemo<Disposicion<DashboardWidget>>(() => {
    if (!prefs) return {};
    const guardada = prefs.layout ?? {};
    const faltan = prefs.widgets.filter((id) => !guardada[id]);
    if (faltan.length === 0) return guardada;

    // Los que ya tenían sitio lo conservan; los que no, se colocan debajo.
    const usadas = Object.values(guardada) as Casilla[];
    const primeraLibre = usadas.reduce((max, c) => Math.max(max, c.y + c.h), 0);
    const nuevos = disposicionPorDefecto(faltan, (id) => ALTO_NATURAL[id]);
    for (const casilla of Object.values(nuevos) as Casilla[]) casilla.y += primeraLibre;
    return { ...guardada, ...nuevos };
  }, [prefs]);

  const quitar = (id: DashboardWidget) => {
    if (!prefs) return;
    // La casilla se va con el widget: si vuelve a añadirse, se coloca de nuevo
    // en un hueco libre en vez de reaparecer donde estaba y pisar a otro.
    const layout = { ...(prefs.layout ?? {}) };
    delete layout[id];
    void guardar({ ...prefs, widgets: prefs.widgets.filter((w) => w !== id), layout });
  };

  const anadir = (id: DashboardWidget) => {
    if (!prefs) return;
    const usadas = Object.values(disposicion) as Casilla[];
    const abajo = usadas.reduce((max, c) => Math.max(max, c.y + c.h), 0);
    void guardar({
      ...prefs,
      widgets: [...prefs.widgets, id],
      layout: {
        ...disposicion,
        [id]: { x: 0, y: abajo, w: 2, h: ALTO_NATURAL[id] },
      },
    });
  };

  const ponerModoSpotify = (modo: "boton" | "expandido") => {
    if (!prefs) return;
    void guardar({ ...prefs, spotifyMode: modo, layout: disposicion });
  };

  if (error) {
    return (
      <div className="grid min-h-[60svh] place-items-center px-6">
        <EstadoVacio icono={<TriangleAlert size={20} className="text-danger" />} titulo={error} />
      </div>
    );
  }

  if (!workspace || !prefs) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${COLUMNAS}, 1fr)` }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="devup-esqueleto col-span-2 h-60 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const ocultos = (Object.keys(CATALOGO_WIDGETS) as DashboardWidget[]).filter(
    (id) => !prefs.widgets.includes(id),
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Del mock se toma la composición del saludo, no su rejilla fija: esta
          es la parte que es verdad para cualquiera, tenga los widgets que
          tenga — el mock de tres columnas fijas ("te espera" / "infraestructura"
          / "quién está") habría significado sustituir un panel configurable por
          una pantalla estática, y eso no se hizo (ver e7e81bf). */}
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {saludo()}
          {user ? `, ${user.displayName.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-xs text-faint">
          {new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })}
          {" · "}arrastra las tarjetas para acomodarlas — nadie más en la organización ve tu panel así
        </p>
      </header>

      {prefs.widgets.length === 0 ? (
        <EstadoVacio
          icono={<LayoutDashboard size={20} />}
          titulo="Sin widgets"
          pista="Añade alguno de la lista de abajo para empezar a personalizar tu panel."
        />
      ) : (
        <Rejilla
          orden={prefs.widgets}
          disposicion={disposicion}
          onCambiar={(siguiente) => void guardar({ ...prefs, layout: siguiente })}
        >
          {(id) => {
            const { titulo, icono: Icono } = CATALOGO_WIDGETS[id];
            // Regla 2 de la cabecera de globals.css: «el brillo señala estado,
            // no jerarquía [...] hay alguien hablando, algo sonando, una
            // llamada abierta». La sala de voz y el tablero ya la aplican con
            // `.panel-vivo`; el panel personal todavía no tenía ningún widget
            // que se encendiera cuando de verdad pasa algo, y «algo sonando» es
            // justo el ejemplo que da la propia regla.
            const sonando = id === "spotify" && Boolean(sesion?.isPlaying);
            return (
              // `capa-flotante` y no `panel`: el panel es opaco y tapa la
              // atmósfera, y en esta dirección las tarjetas flotan SOBRE ella
              // — es lo que las hace leer como material y no como recortes
              // pegados. La combinación con `panel-vivo` cuando `sonando` es
              // cierto se resuelve por orden de la cascada, no en línea: ver
              // el comentario de `.capa-flotante` en globals.css.
              <div
                className={`capa-flotante flex h-full min-h-0 flex-col overflow-hidden rounded-2xl
                  transition-[box-shadow,border-color] duration-200 ${sonando ? "panel-vivo" : ""}`}
              >
                <div className="flex shrink-0 items-center gap-2 border-b border-line/70 bg-raised/20 px-3.5 py-2.5">
                  <Icono size={14} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">{titulo}</span>

                  {/* El único widget con más de una forma de pintarse: el resto
                      no necesita elegir modo, así que el selector solo aparece
                      aquí y no como un ajuste general del panel. */}
                  {id === "spotify" && (
                    <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-canvas/60 p-0.5">
                      {(["boton", "expandido"] as const).map((modo) => (
                        <button
                          key={modo}
                          type="button"
                          onClick={() => ponerModoSpotify(modo)}
                          aria-pressed={prefs.spotifyMode === modo}
                          className={`presionable rounded-md px-2 py-1 font-display text-[9px] font-semibold uppercase tracking-wider
                            ${
                              prefs.spotifyMode === modo
                                ? "bg-accent-soft text-accent"
                                : "text-faint hover:text-muted"
                            }`}
                        >
                          {modo === "boton" ? "Botón" : "Expandido"}
                        </button>
                      ))}
                    </div>
                  )}

                  <BotonIcono
                    etiqueta={`Quitar ${titulo} del panel`}
                    onClick={() => quitar(id)}
                    className="!size-6"
                  >
                    <X size={12} />
                  </BotonIcono>
                </div>

                {/* El cuerpo se desplaza por dentro: una tarjeta más pequeña que
                    su contenido no debe desbordar la celda ni estirar la rejilla. */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {id === "spotify" &&
                    (canal ? (
                      <SpotifyWidget channelId={canal} variante={prefs.spotifyMode} />
                    ) : (
                      <div className="px-4 py-6 text-center">
                        <Music size={18} className="mx-auto mb-2 text-faint" />
                        <p className="text-[11px] leading-relaxed text-faint">
                          Entra a un canal de voz para compartir música aquí.
                        </p>
                      </div>
                    ))}
                  {id === "noticias" && <NoticiasWidget organizationId={workspace.organizationId} />}
                  {id === "notificaciones" && <NotificacionesWidget />}
                  {id === "enlaces" && <EnlacesWidget organizationId={workspace.organizationId} />}
                </div>
              </div>
            );
          }}
        </Rejilla>
      )}

      <div className="mt-5">
        <AnadirWidget ocultos={ocultos} onAnadir={anadir} />
      </div>
    </div>
  );
}
