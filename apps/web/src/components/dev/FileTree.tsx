"use client";

import { ChevronRight, File, Folder } from "lucide-react";
import { useState } from "react";
import type { ArbolNodo } from "@/lib/dev/tree";

/** Árbol de archivos recursivo. No hay nada reusable en `FileLibrary` — esa
 * biblioteca es plana con etiquetas, no jerárquica. */
export function FileTree({
  nodos,
  rutaActiva,
  onAbrir,
}: {
  nodos: ArbolNodo[];
  rutaActiva: string | null;
  onAbrir: (ruta: string) => void;
}) {
  if (nodos.length === 0) {
    return <p className="px-2 py-3 text-xs text-faint">Sin archivos todavía</p>;
  }

  return (
    <ul className="space-y-0.5 text-sm">
      {nodos.map((nodo) => (
        <NodoArbol key={nodo.ruta} nodo={nodo} rutaActiva={rutaActiva} onAbrir={onAbrir} nivel={0} />
      ))}
    </ul>
  );
}

function NodoArbol({
  nodo,
  rutaActiva,
  onAbrir,
  nivel,
}: {
  nodo: ArbolNodo;
  rutaActiva: string | null;
  onAbrir: (ruta: string) => void;
  nivel: number;
}) {
  // La raíz empieza abierta; el resto, cerrado — igual que casi cualquier
  // explorador de archivos, para no volcar el repo entero de un vistazo.
  const [abierto, setAbierto] = useState(nivel === 0);
  const relleno = { paddingLeft: `${nivel * 14 + 8}px` };

  if (nodo.tipo === "archivo") {
    return (
      <li>
        <button
          onClick={() => onAbrir(nodo.ruta)}
          style={relleno}
          className={`presionable flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-xs
            ${
              rutaActiva === nodo.ruta
                ? "bg-accent-soft/60 text-accent"
                : "text-muted hover:bg-raised hover:text-ink"
            }`}
        >
          <File size={12} className="shrink-0" />
          <span className="truncate">{nodo.nombre}</span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <button
        onClick={() => setAbierto((v) => !v)}
        style={relleno}
        className="presionable flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-xs text-muted hover:bg-raised hover:text-ink"
      >
        <ChevronRight
          size={12}
          className={`shrink-0 transition-transform duration-150 ${abierto ? "rotate-90" : ""}`}
        />
        <Folder size={12} className="shrink-0" />
        <span className="truncate">{nodo.nombre}</span>
      </button>

      {abierto && nodo.hijos && nodo.hijos.length > 0 && (
        <ul>
          {nodo.hijos.map((hijo) => (
            <NodoArbol key={hijo.ruta} nodo={hijo} rutaActiva={rutaActiva} onAbrir={onAbrir} nivel={nivel + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
