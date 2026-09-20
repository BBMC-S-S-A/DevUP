"use client";

import { Files, ShieldCheck } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FileLibrary } from "@/components/files/FileLibrary";
import { Cargando, Pagina } from "@/components/ui/Pagina";
import { Chip } from "@/components/ui/Superficies";
import { type Workspace, api } from "@/lib/api";

/**
 * La biblioteca de archivos del workspace.
 *
 * Vivía en la raíz (`/app/w/[workspaceId]`) hasta que el estudio de flujo del
 * 5 de septiembre de 2026 encontró que era la primera pantalla que veía
 * cualquiera que acabara de crear un workspace — vacía, sin nada que hacer, y
 * sin ser lo que el propio menú lateral dice que es lo primero (el Panel es
 * `indice={0}`; esto era `indice={1}` y aun así la raíz). Se movió aquí, y la
 * raíz ahora manda directa al canal general.
 *
 * LA CABECERA ERA PROPIA Y AHORA ES LA DE TODOS. Tenía su chapa de icono, su
 * rejilla, su filo de luz y su `max-w-6xl` —un sexto ancho, distinto de los
 * cinco que ya había—, escritos aquí porque cuando llegó esta pantalla no
 * existía el marco. Todo eso lo pone `Pagina`, con la diferencia de que ahí se
 * decide una vez.
 */
export default function WorkspaceFilesPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    void api
      .get<{ workspace: Workspace }>(`/workspaces/${workspaceId}`)
      .then(({ workspace }) => setWorkspace(workspace))
      .catch(() => setWorkspace(null));
  }, [workspaceId]);

  return (
    <Pagina
      titulo="Biblioteca"
      rotulo={workspace ? `almacén · ${workspace.name}` : "almacén"}
      icono={<Files size={18} />}
      // Se llena de contenido: son filas de archivos con su tamaño, su fecha y
      // quién lo subió, no párrafos.
      ancho="trabajo"
      acciones={
        <Chip tono="accent">
          <ShieldCheck size={11} />
          enlace firmado
        </Chip>
      }
    >
      {workspace ? (
        <>
          {/* Esta frase se queda, aunque sea de las que explican el producto
              dentro del producto: es una de las doce preguntas que hizo GESTEK
              por escrito, y la contesta donde se hace. */}
          <p className="mb-5 max-w-xl text-xs leading-relaxed text-muted">
            Todos los archivos de {workspace.name}. Se acceden por enlace firmado con caducidad,
            nunca desde un bucket público.
          </p>
          <FileLibrary workspaceId={workspaceId} organizationId={workspace.organizationId} />
        </>
      ) : (
        // La cabecera ya está pintada mientras esto llega, así que la espera no
        // es una pantalla en blanco: es un hueco dentro de algo que ya se lee.
        <Cargando etiqueta="Abriendo la biblioteca" />
      )}
    </Pagina>
  );
}
