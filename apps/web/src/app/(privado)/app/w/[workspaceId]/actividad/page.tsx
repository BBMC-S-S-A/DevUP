"use client";

import { Bot, History, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import { actorLegible, fraseDeRenglon, type Renglon } from "@/lib/actividad";
import { iniciales } from "@/lib/fechas";
import { useWorkspaceId } from "@/lib/workspace-context";

/**
 * «¿Qué ha pasado aquí desde que me fui?»
 *
 * ESTA ES LA PANTALLA DEL REMOTE, y conviene decir qué significa eso porque no
 * es una frase bonita: es con lo que alguien vuelve el lunes, entra desde otro
 * ordenador, o llega a un proyecto que no tocaba en dos semanas. Hasta hoy eso
 * empezaba por preguntarle a alguien. La tabla lleva días llenándose y no había
 * dónde mirarla.
 *
 * SE PAGINA POR MARCA DE TIEMPO Y NO POR NÚMERO DE PÁGINA, y hay que respetarlo
 * al pedir más: la tabla solo crece por arriba, así que «página 2» significaría
 * una cosa distinta cada vez que alguien escribe algo mientras se lee. Se manda
 * `antes` con la marca del último renglón que ya se tiene, y así ni se repite
 * ni se salta nada aunque el equipo esté trabajando a la vez.
 *
 * LOS DÍAS SON UN SUELO, NO UN FILTRO DE LISTA. «Desde ayer» quiere decir
 * «enséñame todo lo que ha pasado desde ayer», así que al cambiarlo se empieza
 * de cero en vez de recortar lo que ya está en pantalla — recortar daría la
 * sensación de que hubo menos actividad de la que hubo.
 *
 * NO SE USA `useRecurso` AQUÍ, y es la única pantalla donde lo digo. La caché
 * guarda por URL, y esto es una lista que se va acumulando en trozos: cada
 * «ver más» es otra URL, y lo que hay que conservar es la suma de todas. Meter
 * eso en una caché por URL sería guardar cinco entradas que por separado no
 * son la pantalla.
 */

/** Desde cuándo mirar. Son las tres formas en que alguien vuelve al trabajo. */
const VENTANAS = [
  { dias: 1, etiqueta: "Desde ayer" },
  { dias: 7, etiqueta: "Última semana" },
  { dias: 30, etiqueta: "Último mes" },
] as const;

export default function ActividadPage() {
  const workspaceId = useWorkspaceId();
  const [dias, setDias] = useState<number>(7);
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [cargando, setCargando] = useState(true);
  const [trayendoMas, setTrayendoMas] = useState(false);
  const [hayMas, setHayMas] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const desde = useCallback(
    () => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString(),
    [dias],
  );

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const { actividad, hayMas: mas } = await api.get<{
        actividad: Renglon[];
        hayMas: boolean;
      }>(`/workspaces/${workspaceId}/actividad?desde=${encodeURIComponent(desde())}`);
      setRenglones(actividad);
      setHayMas(mas);
    } catch {
      setError("no se pudo cargar lo que ha pasado aquí");
    } finally {
      setCargando(false);
    }
  }, [workspaceId, desde]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const verMas = async () => {
    const ultimo = renglones[renglones.length - 1];
    if (!ultimo) return;
    setTrayendoMas(true);
    try {
      const { actividad, hayMas: mas } = await api.get<{
        actividad: Renglon[];
        hayMas: boolean;
      }>(
        `/workspaces/${workspaceId}/actividad?desde=${encodeURIComponent(desde())}` +
          `&antes=${encodeURIComponent(ultimo.cuando)}`,
      );
      setRenglones((previos) => [...previos, ...actividad]);
      setHayMas(mas);
    } catch {
      setError("no se pudo traer el resto");
    } finally {
      setTrayendoMas(false);
    }
  };

  const dias_ = agruparPorDia(renglones);

  return (
    <Pagina
      titulo="Qué ha pasado aquí"
      rotulo="desde que te fuiste"
      icono={<History size={18} />}
      ancho="lg"
      acciones={
        <div className="flex flex-wrap gap-1.5">
          {VENTANAS.map((v) => (
            <Boton
              key={v.dias}
              tamano="sm"
              variante={v.dias === dias ? "primario" : "fantasma"}
              onClick={() => setDias(v.dias)}
            >
              {v.etiqueta}
            </Boton>
          ))}
        </div>
      }
    >
      {error ? (
        <Fallo onReintentar={() => void cargar()}>{error}</Fallo>
      ) : cargando ? (
        <Cargando etiqueta="Reconstruyendo lo que pasó" />
      ) : renglones.length === 0 ? (
        <EstadoVacio
          icono={<History size={20} />}
          titulo="Nada en esta ventana"
          pista="Aquí aterriza lo que el equipo mueve, cierra y asigna. Si acabas de empezar, prueba con una ventana más larga."
        />
      ) : (
        <div className="space-y-6">
          {dias_.map(([dia, delDia]) => (
            <section key={dia}>
              <div className="mb-2.5 flex items-center gap-2">
                <Rotulo>{dia}</Rotulo>
                <span aria-hidden className="h-px flex-1 bg-line" />
                <span className="font-mono text-[10px] tabular-nums text-faint">
                  {delDia.length}
                </span>
              </div>

              <ol className="space-y-2">
                {delDia.map((renglon) => (
                  <li key={renglon.id} className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className="mt-px grid size-6 shrink-0 place-items-center rounded-full border
                        border-line bg-raised font-display text-[9px] font-semibold text-muted"
                    >
                      {renglon.procedencia === "agente" ? (
                        <Bot size={11} />
                      ) : (
                        iniciales(actorLegible(renglon))
                      )}
                    </span>

                    <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted">
                      <span className="font-medium text-ink">{actorLegible(renglon)}</span>{" "}
                      {/* Con el nombre de la cosa: fuera de ella es lo único
                          que dice de qué se está hablando. */}
                      {fraseDeRenglon(renglon)}
                      <span className="ml-1.5 whitespace-nowrap font-mono text-[10px] tabular-nums text-faint">
                        {hora(renglon.cuando)}
                      </span>
                      {renglon.procedencia === "agente" && (
                        <Chip className="ml-1.5 align-middle">agente</Chip>
                      )}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          ))}

          {hayMas && (
            <Boton variante="fantasma" onClick={() => void verMas()} disabled={trayendoMas}>
              {trayendoMas ? <Loader2 size={14} className="animate-spin" /> : null}
              Ver más atrás
            </Boton>
          )}
        </div>
      )}
    </Pagina>
  );
}

/**
 * Agrupa por día, en el huso de quien mira.
 *
 * EN EL HUSO DE QUIEN MIRA Y NO EN UTC, que es el mismo error que el embudo
 * tenía con las fechas de cierre: en Colombia —UTC−5— todo lo de después de las
 * siete de la tarde caería en «mañana». Un registro que dice que trabajaste
 * mañana no se lee dos veces.
 *
 * Se conserva el orden que trae la API —lo más nuevo primero— porque `Map`
 * recuerda el orden de inserción y los renglones ya vienen ordenados.
 */
function agruparPorDia(renglones: Renglon[]): [string, Renglon[]][] {
  const mapa = new Map<string, Renglon[]>();
  for (const renglon of renglones) {
    const cuando = new Date(renglon.cuando);
    if (Number.isNaN(cuando.getTime())) continue;
    const dia = cuando.toLocaleDateString("es", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const ya = mapa.get(dia);
    if (ya) ya.push(renglon);
    else mapa.set(dia, [renglon]);
  }
  return [...mapa.entries()];
}

function hora(iso: string): string {
  const cuando = new Date(iso);
  if (Number.isNaN(cuando.getTime())) return "";
  return cuando.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}
