"use client";

import {
  ArrowLeft,
  Files,
  Hash,
  KanbanSquare,
  Loader2,
  Search,
  TrendingUp,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
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
const ENTIDADES: Record<
  SearchResult["entity"],
  { label: string; icon: typeof Hash }
> = {
  message: { label: "Mensaje", icon: Hash },
  file: { label: "Archivo", icon: Files },
  task: { label: "Tarea", icon: KanbanSquare },
  client: { label: "Cliente", icon: Users },
  service: { label: "Servicio", icon: Wrench },
  opportunity: { label: "Oportunidad", icon: TrendingUp },
};

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

  return (
    <div className="min-h-screen">
      <header className="border-b border-line px-6 py-4">
        <Link
          href="/app"
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-faint transition hover:text-muted"
        >
          <ArrowLeft size={13} />
          Organizaciones
        </Link>
        <div className="relative max-w-xl">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Buscar mensajes, archivos, tareas, clientes, ventas…"
            className="w-full rounded-lg border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-faint focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
          />
          {loading && (
            <Loader2
              size={15}
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-faint"
            />
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        {error && <p className="mb-4 text-sm text-danger">{error}</p>}

        {results === null && !loading && (
          <p className="devup-entrada text-sm text-faint">
            Escribe para buscar en toda la organización, no solo en este workspace.
          </p>
        )}

        {results !== null && results.length === 0 && !loading && (
          <p className="devup-entrada text-sm text-faint">
            Nada encontrado para «{q}».
          </p>
        )}

        {results !== null && results.length > 0 && (
          <ul className="space-y-1.5">
            {results.map((result, index) => {
              const { label, icon: Icon } = ENTIDADES[result.entity];
              return (
                <li
                  key={`${result.entity}-${result.id}`}
                  className="devup-entrada"
                  style={{ "--retraso": `${Math.min(index, 8) * 25}ms` } as React.CSSProperties}
                >
                  <Link
                    href={destino(orgId, result)}
                    className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-line-strong hover:bg-raised"
                  >
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                      <Icon size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{result.title}</span>
                        <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-faint">
                          {label}
                        </span>
                      </span>
                      {result.snippet && (
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {result.snippet}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
