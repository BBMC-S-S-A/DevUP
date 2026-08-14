"use client";

import { Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { type Workspace, api } from "@/lib/api";

export default function BoardPage() {
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
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="text-base font-semibold">Tablero</h1>
        <p className="mt-1 text-xs text-faint">
          {workspace.visibility === "personal"
            ? "Este workspace es personal: nadie más de la organización ve estas tareas."
            : `Qué está haciendo el equipo en ${workspace.name}.`}
        </p>
      </header>

      <TaskBoard workspaceId={workspaceId} organizationId={workspace.organizationId} />
    </div>
  );
}
