"use client";

import dynamic from "next/dynamic";

// Monaco necesita `window` para montarse: cargarlo con `ssr: false` evita
// que Next intente ejecutarlo durante el renderizado del servidor.
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const LENGUAJE_POR_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  py: "python",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
};

function lenguajeDe(ruta: string): string {
  const extension = ruta.split(".").pop() ?? "";
  return LENGUAJE_POR_EXTENSION[extension] ?? "plaintext";
}

export function CodeEditor({
  ruta,
  contenido,
  onChange,
}: {
  ruta: string | null;
  contenido: string;
  onChange: (valor: string) => void;
}) {
  if (!ruta) {
    return (
      <div className="grid h-full place-items-center text-sm text-faint">
        Abre un archivo del árbol para editarlo
      </div>
    );
  }

  return (
    <MonacoEditor
      // La `key` fuerza a Monaco a recrear el modelo al cambiar de archivo en
      // vez de reescribir el contenido del actual — evita que el historial de
      // deshacer de un archivo se mezcle con el de otro.
      key={ruta}
      path={ruta}
      language={lenguajeDe(ruta)}
      value={contenido}
      onChange={(valor) => onChange(valor ?? "")}
      theme="vs-dark"
      options={{ fontSize: 13, minimap: { enabled: false }, automaticLayout: true }}
    />
  );
}
