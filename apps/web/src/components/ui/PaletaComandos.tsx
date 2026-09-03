"use client";

import {
  ArrowRight,
  CornerDownLeft,
  Files,
  Hash,
  KanbanSquare,
  Loader2,
  Search,
  TrendingUp,
  Users,
  Wrench,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/lib/api";
import { api } from "@/lib/datos";
import { Rotulo } from "./Superficies";

/**
 * La paleta de comandos.
 *
 * POR QUÉ HACE FALTA: hay dieciocho pantallas y para llegar a cualquiera hay
 * que acordarse de en qué organización y en qué espacio vive. Con ⌘K se escribe
 * lo que se busca y ya. No sustituye a la pantalla de búsqueda —esa sirve para
 * mirar resultados con calma— sino al recorrido de tres clics para llegar a
 * algo que ya sabes cómo se llama.
 *
 * NO ES UN BUSCADOR NUEVO. Usa la misma ruta que `/buscar`, con su mismo
 * aislamiento y su mismo orden. Escribir un segundo buscador habría significado
 * dos sitios donde arreglar el día que la búsqueda cambie, y dos comportamientos
 * que se separan sin que nadie lo note.
 *
 * SE ESPERA A QUE PARE DE ESCRIBIR. Una petición por tecla es una petición por
 * tecla: con «cliente» son siete búsquedas de las que solo importa la última, y
 * las seis primeras compiten con ella por la red.
 */

const ICONOS: Record<SearchResult["entity"], typeof Hash> = {
  message: Hash,
  file: Files,
  task: KanbanSquare,
  client: Users,
  service: Wrench,
  opportunity: TrendingUp,
};

const NOMBRES: Record<SearchResult["entity"], string> = {
  message: "Mensaje",
  file: "Archivo",
  task: "Tarea",
  client: "Cliente",
  service: "Servicio",
  opportunity: "Venta",
};

function destino(orgId: string, workspaceId: string | undefined, r: SearchResult): string {
  switch (r.entity) {
    case "message":
      return r.workspaceId && r.channelId
        ? `/app/w/${r.workspaceId}/c/${r.channelId}`
        : "/app";
    case "file":
      return r.workspaceId ? `/app/w/${r.workspaceId}` : "/app";
    case "task":
      return r.workspaceId ? `/app/w/${r.workspaceId}/board` : "/app";
    default:
      // Ventas no es de ningún workspace en concreto, pero si se está mirando
      // desde uno, entrar ahí no debe cambiar de armazón — mismo motivo que
      // `NavegacionOrganizacion`.
      return workspaceId ? `/app/w/${workspaceId}/ventas` : `/app/o/${orgId}/ventas`;
  }
}

export function PaletaComandos({
  orgId,
  workspaceId,
}: {
  orgId: string;
  /** Cuando se abre desde dentro de un workspace, para no salir de su armazón. */
  workspaceId?: string;
}) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<SearchResult[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [activo, setActivo] = useState(0);
  const campo = useRef<HTMLInputElement>(null);

  // ⌘K en Mac, Ctrl+K en el resto. Se escucha en captura para ganarle a
  // cualquier campo que también quiera la K.
  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent) => {
      if ((evento.metaKey || evento.ctrlKey) && evento.key.toLowerCase() === "k") {
        evento.preventDefault();
        setAbierta((previo) => !previo);
      }
    };
    window.addEventListener("keydown", alPulsar, true);
    return () => window.removeEventListener("keydown", alPulsar, true);
  }, []);

  useEffect(() => {
    if (abierta) campo.current?.focus();
    else {
      setQ("");
      setResultados([]);
      setActivo(0);
    }
  }, [abierta]);

  useEffect(() => {
    const termino = q.trim();
    if (termino.length < 2) {
      setResultados([]);
      return;
    }
    // 180 ms: por debajo se nota como que va lento al escribir, y por encima se
    // nota como que va lento al parar.
    const id = setTimeout(async () => {
      setBuscando(true);
      try {
        const { results } = await api.get<{ results: SearchResult[] }>(
          `/organizations/${orgId}/search?q=${encodeURIComponent(termino)}`,
        );
        setResultados(results.slice(0, 8));
        setActivo(0);
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 180);
    return () => clearTimeout(id);
  }, [q, orgId]);

  const ir = useCallback(
    (r: SearchResult) => {
      setAbierta(false);
      router.push(destino(orgId, workspaceId, r));
    },
    [orgId, workspaceId, router],
  );

  if (!abierta) return null;

  return (
    <div
      className="devup-velo fixed inset-0 z-[60] flex items-start justify-center bg-canvas/70 p-4 pt-[12svh] backdrop-blur-md"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) setAbierta(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar e ir"
        className="devup-materializa cristal-denso w-full max-w-xl overflow-hidden rounded-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={15} className="shrink-0 text-faint" />
          <input
            ref={campo}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === "Escape") setAbierta(false);
              if (evento.key === "ArrowDown") {
                evento.preventDefault();
                setActivo((i) => Math.min(i + 1, resultados.length - 1));
              }
              if (evento.key === "ArrowUp") {
                evento.preventDefault();
                setActivo((i) => Math.max(i - 1, 0));
              }
              if (evento.key === "Enter" && resultados[activo]) {
                evento.preventDefault();
                ir(resultados[activo]);
              }
            }}
            placeholder="Buscar mensajes, archivos, tareas, clientes…"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
          {buscando && <Loader2 size={14} className="shrink-0 animate-spin text-faint" />}
        </div>

        {resultados.length > 0 ? (
          <ul className="max-h-[50svh] overflow-y-auto p-1.5">
            {resultados.map((r, i) => {
              const Icono = ICONOS[r.entity];
              return (
                <li key={`${r.entity}-${r.id}`}>
                  <button
                    type="button"
                    // El ratón mueve la selección en vez de tener su propio
                    // resaltado: con dos, uno bajo el ratón y otro bajo las
                    // flechas, Intro va a un sitio distinto del que se mira.
                    onMouseEnter={() => setActivo(i)}
                    onClick={() => ir(r)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left
                      ${activo === i ? "bg-accent-soft/70" : "hover:bg-raised/60"}`}
                  >
                    <Icono size={14} className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{r.title}</span>
                      {r.snippet && (
                        <span className="block truncate text-[11px] text-faint">{r.snippet}</span>
                      )}
                    </span>
                    <Rotulo className="shrink-0">{NOMBRES[r.entity]}</Rotulo>
                    {activo === i && (
                      <CornerDownLeft size={12} className="shrink-0 text-accent" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-faint">
              {q.trim().length < 2
                ? "Escribe al menos dos letras."
                : buscando
                  ? "Buscando…"
                  : "Nada por aquí."}
            </p>
          </div>
        )}

        <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-2">
          <span className="flex items-center gap-1.5 text-[10px] text-faint">
            <Tecla>↑</Tecla>
            <Tecla>↓</Tecla>
            moverse
            <Tecla>↵</Tecla>
            ir
            <Tecla>esc</Tecla>
            cerrar
          </span>
          <button
            type="button"
            onClick={() => {
              setAbierta(false);
              const base = workspaceId ? `/app/w/${workspaceId}` : `/app/o/${orgId}`;
              router.push(`${base}/buscar?q=${encodeURIComponent(q.trim())}`);
            }}
            className="presionable inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
          >
            Ver todo
            <ArrowRight size={11} />
          </button>
        </footer>
      </div>
    </div>
  );
}

function Tecla({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-raised/60 px-1 py-px font-sans text-[10px] text-muted">
      {children}
    </kbd>
  );
}
