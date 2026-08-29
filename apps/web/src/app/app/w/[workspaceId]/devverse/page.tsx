"use client";

import { useParams } from "next/navigation";
import { WorldView } from "@/components/world/WorldView";

/**
 * DevVerse, el espacio inmersivo del workspace (antes "la oficina" — mismo
 * espacio, mismas reglas de 0002, nombre propio).
 *
 * Ocupa la altura completa y no lleva relleno: el lienzo se dimensiona solo a
 * lo que le den, y un margen aquí saldría como una franja negra alrededor del
 * mundo.
 */
export default function DevVersePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return (
    <div className="h-[100svh] w-full">
      <WorldView workspaceId={workspaceId} />
    </div>
  );
}
