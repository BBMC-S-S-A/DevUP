"use client";

import { Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FileLibrary } from "@/components/files/FileLibrary";
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
      <div className="grid h-screen place-items-center">
        <Loader2 className="animate-spin text-faint" size={20} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-base font-semibold">Biblioteca</h1>
        <p className="mt-1 text-xs text-faint">
          Todos los archivos de {workspace.name}. Se acceden por enlace firmado con caducidad,
          nunca desde un bucket público.
        </p>
      </header>

      <FileLibrary workspaceId={workspaceId} organizationId={workspace.organizationId} />
    </div>
  );
}
