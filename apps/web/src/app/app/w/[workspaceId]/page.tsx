"use client";

import { Files, Loader2, ShieldCheck } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FileLibrary } from "@/components/files/FileLibrary";
import { Chip, Rotulo } from "@/components/ui/Superficies";
import { type Workspace, api } from "@/lib/api";

export default function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    void api
      .get<{ workspace: Workspace }>(`/workspaces/${workspaceId}`)
      .then(({ workspace }) => setWorkspace(workspace))
      .catch(() => setWorkspace(null));
  }, [workspaceId]);

  if (!workspace) {
    return (
      <div className="alto-util-fijo grid place-items-center">
        <span className="flex items-center gap-2 text-faint">
          <Loader2 className="animate-spin" size={16} />
          <Rotulo>abriendo la biblioteca</Rotulo>
        </span>
      </div>
    );
  }

  return (
    <div className="alto-util">
      {/* La cabecera lleva la rejilla y el filo de luz porque es la única
          superficie fija de la vista: da profundidad al fondo y marca dónde
          acaba el rótulo y empieza el almacén, sin un borde duro de por medio. */}
      <header className="rejilla filo-luz px-6 pb-6 pt-7 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent-soft/60 text-accent-bright">
              <Files size={18} />
            </span>
            <div className="min-w-0">
              <Rotulo>almacén · {workspace.name}</Rotulo>
              <h1 className="mt-0.5 truncate text-xl font-semibold">Biblioteca</h1>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Chip tono="accent">
              <ShieldCheck size={11} />
              enlace firmado
            </Chip>
            <p className="max-w-xl text-xs leading-relaxed text-muted">
              Todos los archivos de {workspace.name}. Se acceden por enlace firmado con caducidad,
              nunca desde un bucket público.
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 pb-16 pt-6 sm:px-8">
        <FileLibrary workspaceId={workspaceId} organizationId={workspace.organizationId} />
      </div>
    </div>
  );
}
