"use client";

import { X } from "lucide-react";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { BotonIcono } from "@/components/ui/Boton";
import { Rotulo } from "@/components/ui/Superficies";

/**
 * El tablero, flotando sobre DevVerse.
 *
 * MISMO COMPONENTE QUE LA PANTALLA DE AFUERA (`board/page.tsx`), sin salir
 * del mundo: `TaskBoard` ya era autocontenido —lo mismo que ya aprovecha la
 * mesa de trabajo—, así que no hay una versión "de DevVerse" del tablero,
 * solo un sitio nuevo donde montarlo. Ver la cabecera de `findAction` en
 * `WorldView.tsx`: es el mismo puente entre las dos vistas que ya usaba el
 * enlace, ahora sin navegar.
 *
 * MISMO PATRÓN QUE LA PIZARRA de una llamada (`Pizarra.tsx` +
 * `Cercania.tsx`): un `cristal-denso` fijo encima del lienzo del mundo, que
 * se cierra con su propio botón, no con `router.push`.
 */
export function PanelTablero({
  workspaceId,
  organizationId,
  onCerrar,
}: {
  workspaceId: string;
  organizationId: string;
  onCerrar: () => void;
}) {
  return (
    <div className="devup-materializa cristal-denso flex h-full w-full flex-col overflow-hidden rounded-2xl">
      <header className="filo-luz flex shrink-0 items-center justify-between gap-3 px-3 py-2">
        <Rotulo>Tablero</Rotulo>
        <BotonIcono etiqueta="Cerrar el tablero" onClick={onCerrar}>
          <X size={14} />
        </BotonIcono>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <TaskBoard workspaceId={workspaceId} organizationId={organizationId} />
      </div>
    </div>
  );
}
