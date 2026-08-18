"use client";

import { GripVertical, LayoutDashboard, Music, TriangleAlert, X } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import {
  AnadirWidget,
  CATALOGO_WIDGETS,
  EnlacesWidget,
  NoticiasWidget,
  NotificacionesWidget,
} from "@/components/dashboard/DashboardWidgets";
import { SpotifyWidget } from "@/components/spotify/SpotifyWidget";
import { BotonIcono } from "@/components/ui/Boton";
import { EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import { type DashboardPrefs, type DashboardWidget, type Workspace, ApiError, api } from "@/lib/api";
import { useSpotify } from "@/lib/spotify/SpotifyProvider";

/** Igual que en la barra del workspace: el índice se topa para que el panel
 *  número nueve no entre más de medio segundo tarde. */
function retraso(indice: number): CSSProperties {
  return { "--retraso": `${Math.min(indice, 6) * 45}ms` } as CSSProperties;
}

/**
 * El panel personal.
 *
 * «Personal» en dos sentidos a la vez: vive por persona (`/me/dashboard`, no
 * por organización) y se lee por dispositivo con la misma sesión, así que
 * quien lo ordena en el portátil lo encuentra igual en el escritorio. Ningún
 * compañero puede ver ni tocar el de otro — ver 0019, `user_dashboard_prefs`.
 *
 * Arrastrar y soltar sigue el mismo patrón nativo que ya usa el tablero de
 * tareas (`TaskBoard`): sin librería nueva, con `draggable` y los eventos de
 * toda la vida. Aquí hay una sola columna, así que reordenar es más simple:
 * soltar sobre una tarjeta la intercambia de sitio con la que se soltó.
 */
export default function PanelPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { canal } = useSpotify();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [prefs, setPrefs] = useState<DashboardPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arrastrado, setArrastrado] = useState<DashboardWidget | null>(null);
  const [sobrevolado, setSobrevolado] = useState<DashboardWidget | null>(null);

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

  /** Optimista siempre: nada aquí es tan importante como para hacer esperar a
   *  un arrastre a que el servidor confirme. Si falla, un aviso basta. */
  const guardar = useCallback(async (siguiente: DashboardPrefs) => {
    setPrefs(siguiente);
    try {
      await api.put("/me/dashboard", siguiente);
    } catch {
      toast.error("No se pudo guardar el orden del panel");
    }
  }, []);

  const mover = (origen: DashboardWidget, destino: DashboardWidget) => {
    if (!prefs || origen === destino) return;
    const lista = [...prefs.widgets];
    const iOrigen = lista.indexOf(origen);
    const iDestino = lista.indexOf(destino);
    if (iOrigen === -1 || iDestino === -1) return;
    lista.splice(iOrigen, 1);
    lista.splice(iDestino, 0, origen);
    void guardar({ ...prefs, widgets: lista });
  };

  const quitar = (id: DashboardWidget) => {
    if (!prefs) return;
    void guardar({ ...prefs, widgets: prefs.widgets.filter((w) => w !== id) });
  };

  const anadir = (id: DashboardWidget) => {
    if (!prefs) return;
    void guardar({ ...prefs, widgets: [...prefs.widgets, id] });
  };

  const ponerModoSpotify = (modo: "boton" | "expandido") => {
    if (!prefs) return;
    void guardar({ ...prefs, spotifyMode: modo });
  };

  if (error) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-6">
        <EstadoVacio icono={<TriangleAlert size={20} className="text-danger" />} titulo={error} />
      </div>
    );
  }

  if (!workspace || !prefs) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-6 py-8">
        {[0, 1, 2].map((i) => (
          <div key={i} className="devup-esqueleto h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  const ocultos = (Object.keys(CATALOGO_WIDGETS) as DashboardWidget[]).filter(
    (id) => !prefs.widgets.includes(id),
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <Rotulo className="block">Panel</Rotulo>
        <h1 className="mt-1 text-xl font-semibold">Tu panel</h1>
        <p className="mt-1 text-xs text-faint">
          Arrastra cada tarjeta para reordenarla a tu gusto. Es tuyo — nadie más en la organización
          lo ve así.
        </p>
      </header>

      {prefs.widgets.length === 0 ? (
        <EstadoVacio
          icono={<LayoutDashboard size={20} />}
          titulo="Sin widgets"
          pista="Añade alguno de la lista de abajo para empezar a personalizar tu panel."
        />
      ) : (
        <div className="space-y-3">
          {prefs.widgets.map((id, indice) => {
            const { titulo, icono: Icono } = CATALOGO_WIDGETS[id];
            const sobrevoladoAqui = sobrevolado === id && arrastrado !== null && arrastrado !== id;

            return (
              <div
                key={id}
                draggable
                onDragStart={() => setArrastrado(id)}
                onDragEnd={() => {
                  setArrastrado(null);
                  setSobrevolado(null);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setSobrevolado(id);
                }}
                onDragLeave={() => setSobrevolado((actual) => (actual === id ? null : actual))}
                onDrop={(event) => {
                  event.preventDefault();
                  if (arrastrado) mover(arrastrado, id);
                  setSobrevolado(null);
                }}
                style={retraso(indice)}
                className={`devup-entrada panel overflow-hidden rounded-2xl
                  transition-[transform,opacity] duration-[var(--dur-hover)] ease-[var(--ease-out)]
                  motion-reduce:transition-none
                  ${arrastrado === id ? "opacity-50" : ""}
                  ${sobrevoladoAqui ? "panel-vivo" : ""}`}
              >
                <div className="flex cursor-grab items-center gap-2 border-b border-line/70 bg-raised/30 px-3.5 py-2.5 active:cursor-grabbing">
                  <GripVertical size={13} className="shrink-0 text-faint" aria-hidden />
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
            );
          })}
        </div>
      )}

      <div className="mt-5">
        <AnadirWidget ocultos={ocultos} onAnadir={anadir} />
      </div>
    </div>
  );
}
