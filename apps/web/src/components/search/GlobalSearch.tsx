"use client";

import { FileText, Hash, Loader2, Search, SquareCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { type SearchResult, api } from "@/lib/api";

const ICONOS = { message: Hash, file: FileText, task: SquareCheck } as const;
const ETIQUETAS = { message: "Mensaje", file: "Archivo", task: "Tarea" } as const;

/**
 * Buscador global de la organización.
 *
 * Se abre con Ctrl/Cmd+K. Mientras haya que recordar en cuál de las tres cosas
 * estaba aquello —un mensaje, un archivo o una tarea— la gente sigue buscando
 * en la herramienta de la que se pretende que se vayan.
 */
export function GlobalSearch({ organizationId }: { organizationId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<SearchResult[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [seleccion, setSeleccion] = useState(0);
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  // Descarta respuestas que llegan tarde: sin esto una consulta lenta pisa el
  // resultado de otra posterior.
  const peticion = useRef(0);

  useEffect(() => {
    const atajo = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setAbierto((v) => !v);
      }
      if (event.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", atajo);
    return () => window.removeEventListener("keydown", atajo);
  }, []);

  useEffect(() => {
    if (abierto) entrada.current?.focus();
    else {
      setTexto("");
      setResultados([]);
      setSeleccion(0);
    }
  }, [abierto]);

  const buscar = useCallback(
    async (valor: string) => {
      if (valor.trim().length < 2) {
        setResultados([]);
        return;
      }
      const mia = ++peticion.current;
      setBuscando(true);
      try {
        const { results } = await api.get<{ results: SearchResult[] }>(
          `/organizations/${organizationId}/search?q=${encodeURIComponent(valor.trim())}`,
        );
        if (mia !== peticion.current) return;
        setResultados(results);
        setSeleccion(0);
      } finally {
        if (mia === peticion.current) setBuscando(false);
      }
    },
    [organizationId],
  );

  // Espera a que deje de escribir: sin esto, «informe» son siete consultas.
  useEffect(() => {
    const temporizador = setTimeout(() => void buscar(texto), 250);
    return () => clearTimeout(temporizador);
  }, [texto, buscar]);

  const ir = useCallback(
    (resultado: SearchResult) => {
      setAbierto(false);
      router.push(resultado.link);
    },
    [router],
  );

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs text-faint transition hover:border-line-strong hover:text-muted"
      >
        <Search size={13} />
        <span className="flex-1 text-left">Buscar</span>
        <kbd className="rounded border border-line px-1 font-mono text-[10px]">⌘K</kbd>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-6 pt-24"
      onClick={() => setAbierto(false)}
      role="presentation"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} className="shrink-0 text-faint" />
          <input
            ref={entrada}
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSeleccion((s) => Math.min(s + 1, resultados.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSeleccion((s) => Math.max(s - 1, 0));
              }
              if (event.key === "Enter" && resultados[seleccion]) {
                event.preventDefault();
                ir(resultados[seleccion]);
              }
            }}
            placeholder="Buscar en mensajes, archivos y tareas"
            className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-faint"
          />
          {buscando && <Loader2 size={14} className="animate-spin text-faint" />}
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="text-faint transition hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {texto.trim().length < 2 ? (
            <p className="px-4 py-8 text-center text-xs text-faint">
              Escribe al menos dos caracteres.
            </p>
          ) : resultados.length === 0 && !buscando ? (
            <p className="px-4 py-8 text-center text-xs text-faint">Nada coincide.</p>
          ) : (
            <ul>
              {resultados.map((resultado, indice) => {
                const Icono = ICONOS[resultado.kind];
                return (
                  <li key={`${resultado.kind}-${resultado.id}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setSeleccion(indice)}
                      onClick={() => ir(resultado)}
                      className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition ${
                        indice === seleccion ? "bg-raised" : "hover:bg-raised/60"
                      }`}
                    >
                      <Icono size={14} className="mt-0.5 shrink-0 text-accent" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-sm">{resultado.title}</span>
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">
                            {ETIQUETAS[resultado.kind]} · {resultado.workspaceName}
                          </span>
                        </span>
                        {resultado.snippet && (
                          <span className="mt-0.5 block truncate text-xs text-faint">
                            {resultado.snippet}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
