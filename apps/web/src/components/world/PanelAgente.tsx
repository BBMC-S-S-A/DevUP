"use client";

import { X } from "lucide-react";
import { Asistente } from "@/components/asistente/Asistente";
import { BotonIcono } from "@/components/ui/Boton";
import { Rotulo } from "@/components/ui/Superficies";

/**
 * Hablar con el agente sin salir de DevVerse.
 *
 * MISMO COMPONENTE QUE LA PANTALLA DE AFUERA, igual que el tablero: el chat
 * vive en `components/asistente/Asistente.tsx` y aquí solo hay un sitio nuevo
 * donde montarlo. No hay una versión «de DevVerse» del asistente, y eso es lo
 * que importa — dos copias de un chat con herramientas divergen por donde más
 * duele, que son las herramientas que puede usar.
 *
 * POR QUÉ ABRIR ENCIMA Y NO NAVEGAR. El muñeco está dentro del mundo; mandar a
 * la pantalla de afuera para preguntarle algo es exactamente el salto que el
 * documento 0002 llama «el puente entre las dos vistas» y que ya se quitó del
 * tablero y de la pizarra. Se pregunta donde está el muñeco.
 *
 * EL RÓTULO DICE DE QUIÉN ES EL MODELO. El asistente habla con la clave de
 * quien pregunta —su cuenta, su gasto—, y dentro de un mundo compartido eso se
 * puede malinterpretar fácilmente como «el bot de la oficina». No lo es: es tu
 * agente, y la frase que dice el muñeco solo la ves tú.
 */
export function PanelAgente({
  workspaceId,
  onCerrar,
}: {
  workspaceId: string;
  onCerrar: () => void;
}) {
  return (
    <div className="devup-materializa cristal-denso flex h-full w-full flex-col overflow-hidden rounded-2xl">
      <header className="filo-luz flex shrink-0 items-center justify-between gap-3 px-3 py-2">
        <Rotulo>Agente IA · tu propio modelo</Rotulo>
        <BotonIcono etiqueta="Cerrar el agente" onClick={onCerrar}>
          <X size={14} />
        </BotonIcono>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <Asistente workspaceId={workspaceId} />
      </div>
    </div>
  );
}
