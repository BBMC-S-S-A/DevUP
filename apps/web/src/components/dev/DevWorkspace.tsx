"use client";

import type { FileSystemTree } from "@webcontainer/api";
import { Loader2, TriangleAlert } from "lucide-react";
import { useCallback, useState } from "react";
import { EstadoVacio } from "@/components/ui/Superficies";
import { ApiError, api } from "@/lib/api";
import { construirArbol, type ArbolNodo } from "@/lib/dev/tree";
import { CodeEditor } from "./CodeEditor";
import { DevTerminal } from "./DevTerminal";
import { FileTree } from "./FileTree";
import { IniciarProyecto, type ProyectoElegido } from "./IniciarProyecto";
import { useWebContainer } from "./useWebContainer";

/**
 * Plantilla en blanco: lo mínimo que arranca sin depender de GitHub. Vive en
 * memoria, no en la bóveda ni en Postgres — esta fase no persiste ningún
 * proyecto, es sandbox puro (ver "Fase 0" en el plan de esta funcionalidad).
 */
const PLANTILLA_EN_BLANCO: FileSystemTree = {
  "package.json": {
    file: {
      contents: JSON.stringify(
        { name: "proyecto-devup", version: "1.0.0", type: "module", scripts: { start: "node index.js" } },
        null,
        2,
      ),
    },
  },
  "index.js": {
    file: { contents: 'console.log("Hola desde el entorno de desarrollo de DevUP");\n' },
  },
};

const CONTENIDO_PLANTILLA: Record<string, string> = {
  "package.json": (PLANTILLA_EN_BLANCO["package.json"] as { file: { contents: string } }).file.contents,
  "index.js": (PLANTILLA_EN_BLANCO["index.js"] as { file: { contents: string } }).file.contents,
};

export function DevWorkspace({ orgId }: { orgId: string }) {
  const { status, error: errorArranque, instance } = useWebContainer();
  const [proyecto, setProyecto] = useState<ProyectoElegido | null>(null);
  const [arbol, setArbol] = useState<ArbolNodo[]>([]);
  const [rutaActiva, setRutaActiva] = useState<string | null>(null);
  const [contenido, setContenido] = useState("");
  const [cargandoArchivo, setCargandoArchivo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const elegirProyecto = useCallback(
    async (elegido: ProyectoElegido) => {
      setProyecto(elegido);
      setError(null);
      setRutaActiva(null);
      setContenido("");

      if (elegido.tipo === "blanco") {
        setArbol(
          construirArbol([
            { path: "package.json", type: "blob" },
            { path: "index.js", type: "blob" },
          ]),
        );
        if (instance.current) await instance.current.mount(PLANTILLA_EN_BLANCO);
        return;
      }

      try {
        const { tree } = await api.get<{
          tree: { path: string; type: "blob" | "tree"; size?: number }[];
        }>(`/github/repos/${elegido.repoId}/tree`);
        setArbol(construirArbol(tree));
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "no se pudo leer el repositorio");
      }
    },
    [instance],
  );

  const abrirArchivo = useCallback(
    async (ruta: string) => {
      setRutaActiva(ruta);
      setCargandoArchivo(true);
      setError(null);
      try {
        if (proyecto?.tipo === "blanco") {
          setContenido(CONTENIDO_PLANTILLA[ruta] ?? "");
          return;
        }

        if (proyecto?.tipo === "github") {
          const { content } = await api.get<{ path: string; content: string }>(
            `/github/repos/${proyecto.repoId}/file?path=${encodeURIComponent(ruta)}`,
          );
          setContenido(content);

          // Se escribe al disco virtual solo cuando se abre, no de golpe
          // para todo el repo: evita un aluvión de peticiones a GitHub por
          // cada archivo que nadie va a mirar en esta sesión.
          if (instance.current) {
            const carpeta = ruta.includes("/") ? ruta.slice(0, ruta.lastIndexOf("/")) : "";
            if (carpeta) await instance.current.fs.mkdir(carpeta, { recursive: true });
            await instance.current.fs.writeFile(ruta, content);
          }
        }
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "no se pudo abrir el archivo");
      } finally {
        setCargandoArchivo(false);
      }
    },
    [proyecto, instance],
  );

  const cambiarContenido = useCallback(
    (valor: string) => {
      setContenido(valor);
      if (rutaActiva && instance.current) {
        void instance.current.fs.writeFile(rutaActiva, valor);
      }
    },
    [rutaActiva, instance],
  );

  if (status === "arrancando") {
    return (
      <div className="grid h-[70vh] place-items-center">
        <div className="flex flex-col items-center gap-3 text-sm text-faint">
          <Loader2 size={20} className="animate-spin" />
          Arrancando el entorno de desarrollo…
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <EstadoVacio
        icono={<TriangleAlert size={20} />}
        titulo="El entorno no pudo arrancar"
        pista={errorArranque ?? "prueba con Chrome o Edge de escritorio actualizados"}
      />
    );
  }

  if (!proyecto) {
    return <IniciarProyecto orgId={orgId} onElegir={elegirProyecto} />;
  }

  return (
    <div className="space-y-3">
      <div className="grid h-[70vh] grid-cols-[220px_1fr] grid-rows-[1fr_220px] gap-3">
        <div className="row-span-2 overflow-y-auto rounded-2xl border border-line bg-raised/30 p-2">
          <FileTree nodos={arbol} rutaActiva={rutaActiva} onAbrir={abrirArchivo} />
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-canvas">
          {cargandoArchivo ? (
            <div className="grid h-full place-items-center">
              <Loader2 size={16} className="animate-spin text-faint" />
            </div>
          ) : (
            <CodeEditor ruta={rutaActiva} contenido={contenido} onChange={cambiarContenido} />
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-[#0a0a0a] p-1">
          <DevTerminal webcontainer={instance.current} />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-xs text-danger">
          {error}
        </div>
      )}
    </div>
  );
}
