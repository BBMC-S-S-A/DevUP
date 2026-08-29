"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  Files,
  Hash,
  KanbanSquare,
  Loader2,
  ScanSearch,
  SearchX,
  TrendingUp,
  Users,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { BotonIcono } from "@/components/ui/Boton";
import { EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import { ApiError, type SearchResult, api } from "@/lib/api";

/**
 * Búsqueda global (S6): mensajes, archivos, tareas, clientes, servicios y
 * oportunidades desde un solo sitio. Antes de esto, buscar significaba
 * abrir workspace por workspace.
 *
 * El enlace de cada resultado apunta a la pantalla más concreta que ya
 * existe hoy — el tablero o la biblioteca no tienen todavía un ancla por
 * tarjeta o por archivo, así que llega hasta ahí y no más allá.
 */

/**
 * Cada tipo con su icono y su color. El color no decora: es lo que deja
 * reconocer de qué es un resultado sin leer su etiqueta, que es justo lo que
 * pasa cuando se recorre una lista con el ojo. Van como cadenas `var(--…)` y
 * no como clases de Tailwind porque Tailwind no ve los nombres que se arman
 * en tiempo de ejecución y se los comería al compilar.
 */
const ENTIDADES: Record<
  SearchResult["entity"],
  { label: string; plural: string; icon: typeof Hash; color: string }
> = {
  message: { label: "Mensaje", plural: "Mensajes", icon: Hash, color: "var(--color-accent)" },
  file: { label: "Archivo", plural: "Archivos", icon: Files, color: "var(--color-cyan)" },
  task: { label: "Tarea", plural: "Tareas", icon: KanbanSquare, color: "var(--color-violet)" },
  client: { label: "Cliente", plural: "Clientes", icon: Users, color: "var(--color-live)" },
  service: { label: "Servicio", plural: "Servicios", icon: Wrench, color: "var(--color-warn)" },
  opportunity: {
    label: "Oportunidad",
    plural: "Ventas",
    icon: TrendingUp,
    color: "var(--color-accent-bright)",
  },
};

/** Orden fijo de los grupos: que salten de sitio entre búsquedas marearía. */
const ORDEN: SearchResult["entity"][] = [
  "message",
  "file",
  "task",
  "client",
  "service",
  "opportunity",
];

function destino(orgId: string, result: SearchResult): string {
  switch (result.entity) {
    case "message":
      return result.workspaceId && result.channelId
        ? `/app/w/${result.workspaceId}/c/${result.channelId}`
        : `/app`;
    case "file":
      return result.workspaceId ? `/app/w/${result.workspaceId}` : `/app`;
    case "task":
      return result.workspaceId ? `/app/w/${result.workspaceId}/board` : `/app`;
    case "client":
    case "service":
    case "opportunity":
      return `/app/o/${orgId}/ventas`;
  }
}

export default function BuscarPage() {
  return (
    <Suspense fallback={null}>
      <Buscador />
    </Suspense>
  );
}

function Buscador() {
  const { orgId } = useParams<{ orgId: string }>();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buscar = useCallback(
    async (termino: string) => {
      if (termino.trim().length === 0) {
        setResults(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { results } = await api.get<{ results: SearchResult[] }>(
          `/organizations/${orgId}/search?q=${encodeURIComponent(termino)}`,
        );
        setResults(results);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "no se pudo buscar");
      } finally {
        setLoading(false);
      }
    },
    [orgId],
  );

  // Buscar solo cuando la persona deja de escribir, no en cada tecla: seis
  // tablas a la vez por cada pulsación sería desperdiciar la mitad de las
  // peticiones antes de que termine la palabra.
  useEffect(() => {
    const timer = setTimeout(() => void buscar(q), 300);
    return () => clearTimeout(timer);
  }, [q, buscar]);

  /**
   * Agrupado por tipo, conservando dentro de cada grupo el orden por relevancia
   * en que llegó. `desde` guarda la posición global de cada grupo para que el
   * escalonado de entrada se lea como UNA secuencia de arriba abajo y no como
   * seis listas arrancando a la vez.
   */
  const grupos = useMemo(() => {
    if (results === null) return null;
    const salida: { entity: SearchResult["entity"]; items: SearchResult[]; desde: number }[] = [];
    let desde = 0;
    for (const entity of ORDEN) {
      const items = results.filter((result) => result.entity === entity);
      if (items.length === 0) continue;
      salida.push({ entity, items, desde });
      desde += items.length;
    }
    return salida;
  }, [results]);

  const vacio = results !== null && results.length === 0 && !loading;

  return (
    <div className="min-h-screen">
      <header className="filo-luz relative bg-surface/40">
        <div className="rejilla pointer-events-none absolute inset-0" aria-hidden />

        <div className="relative mx-auto max-w-2xl px-6 pb-9 pt-5">
          <div className="mt-8 text-center">
            <Rotulo>Búsqueda global</Rotulo>
            <h1 className="mt-2.5 text-2xl font-semibold">
              Todo lo de la <span className="texto-plasma">organización</span>
            </h1>
          </div>

          {/* El campo se escribe a mano en vez de usar `Entrada`: aquí es el
              protagonista y necesita 56 px de alto y un foco más ancho, y las
              medidas de `Entrada` son fijas por dentro. */}
          <div className="relative mt-6">
            <ScanSearch
              size={19}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <input
              autoFocus
              value={q}
              onChange={(event) => setQ(event.target.value)}
              aria-label="Buscar en la organización"
              placeholder="Buscar mensajes, archivos, tareas, clientes, ventas…"
              className="h-14 w-full rounded-2xl border border-line bg-canvas/70 pl-12 pr-12 text-base outline-none
                transition-[border-color,box-shadow,background-color] duration-200
                placeholder:text-faint
                hover:border-line-strong
                focus:border-accent/60 focus:bg-canvas
                focus:shadow-[0_0_0_4px_rgb(109_40_217/0.12),0_16px_40px_-16px_rgb(124_58_237/0.55)]"
            />
            {/* Fuera del botón: `.presionable` sustituye el `transform` al
                pulsar y se llevaría por delante el centrado vertical. */}
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {loading ? (
                <Loader2 size={16} className="mr-1.5 animate-spin text-accent" />
              ) : q.length > 0 ? (
                <BotonIcono etiqueta="Limpiar búsqueda" onClick={() => setQ("")}>
                  <X size={15} />
                </BotonIcono>
              ) : null}
            </span>
          </div>

          {/* Renglón de estado de alto fijo: si apareciera y desapareciera, el
              campo daría un salto en cada búsqueda. */}
          <p
            aria-live="polite"
            className="mt-3 flex min-h-4 items-center justify-center gap-2 text-center font-mono text-[11px] tabular-nums text-faint"
          >
            {loading
              ? "buscando…"
              : results !== null
                ? `${results.length} ${results.length === 1 ? "resultado" : "resultados"}`
                : "6 tipos · todos los workspaces"}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        {error && (
          <div className="devup-entrada mb-5 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/[0.07] px-3.5 py-2.5">
            <SearchX size={14} className="mt-px shrink-0 text-danger" />
            <p className="text-xs leading-relaxed text-danger">{error}</p>
          </div>
        )}

        {results === null && !loading && (
          <EstadoVacio
            icono={<ScanSearch size={20} />}
            titulo="Escribe y busca en toda la organización"
            pista="Un solo campo para lo que está repartido por todos los workspaces. Los resultados llegan agrupados por tipo."
            accion={
              <div className="flex flex-wrap justify-center gap-1.5">
                {ORDEN.map((entity) => {
                  const { plural, icon: Icono, color } = ENTIDADES[entity];
                  return (
                    <span
                      key={entity}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-raised/40 px-2.5 py-1"
                    >
                      <Icono size={11} style={{ color }} aria-hidden />
                      <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-muted">
                        {plural}
                      </span>
                    </span>
                  );
                })}
              </div>
            }
          />
        )}

        {vacio && (
          <EstadoVacio
            icono={<SearchX size={20} />}
            titulo={`Nada para «${q}»`}
            pista="Prueba con menos palabras o con otro término: la búsqueda ya mira los seis tipos a la vez, así que no hace falta acotarla."
          />
        )}

        {grupos !== null && grupos.length > 0 && (
          // Mientras vuelve la siguiente búsqueda lo de abajo ya es viejo. Se
          // apaga en vez de desaparecer: vaciar la lista haría saltar la página
          // en cada pausa al escribir.
          <div
            className={`space-y-6 transition-opacity duration-200 ${loading ? "opacity-45" : "opacity-100"}`}
          >
            {grupos.map((grupo) => {
              const { plural, label, icon: Icono, color } = ENTIDADES[grupo.entity];
              return (
                <section key={grupo.entity}>
                  <div className="mb-2.5 flex items-center gap-2.5">
                    <span
                      className="grid size-6 shrink-0 place-items-center rounded-lg border"
                      style={{
                        color,
                        borderColor: `color-mix(in oklab, ${color} 35%, transparent)`,
                        backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
                      }}
                    >
                      <Icono size={12} aria-hidden />
                    </span>
                    <Rotulo>{plural}</Rotulo>
                    <span className="font-mono text-[10px] tabular-nums text-faint">
                      {grupo.items.length}
                    </span>
                    <span
                      aria-hidden
                      className="h-px flex-1"
                      style={{
                        backgroundImage: `linear-gradient(90deg, color-mix(in oklab, ${color} 32%, transparent), transparent)`,
                      }}
                    />
                  </div>

                  <ul className="space-y-1.5">
                    {grupo.items.map((result, index) => (
                      <li
                        key={`${result.entity}-${result.id}`}
                        className="devup-entrada"
                        style={
                          {
                            // Topado a 8: el resultado número cuarenta no puede
                            // entrar segundo y pico después del primero.
                            "--retraso": `${Math.min(grupo.desde + index, 8) * 30}ms`,
                          } as React.CSSProperties
                        }
                      >
                        <Link
                          href={destino(orgId, result)}
                          className="presionable group flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3
                            hover:border-line-strong hover:bg-raised"
                        >
                          <span
                            className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border"
                            style={{
                              color,
                              borderColor: `color-mix(in oklab, ${color} 30%, transparent)`,
                              backgroundColor: `color-mix(in oklab, ${color} 10%, transparent)`,
                            }}
                          >
                            <Icono size={13} aria-hidden />
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {result.title}
                            </span>
                            {/* El fragmento va como TEXTO PLANO a propósito: el
                                servidor lo devuelve marcado y pintarlo como HTML
                                era una inyección con el nombre de un archivo por
                                vector. Se quitó y no vuelve. */}
                            {result.snippet && (
                              <span className="mt-0.5 block truncate text-xs text-muted">
                                {result.snippet}
                              </span>
                            )}
                          </span>

                          <span className="mt-0.5 flex shrink-0 items-center gap-2">
                            <span className="hidden font-display text-[10px] font-semibold uppercase tracking-wider text-faint sm:inline">
                              {label}
                            </span>
                            <ArrowUpRight
                              size={13}
                              aria-hidden
                              className="text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                            />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
