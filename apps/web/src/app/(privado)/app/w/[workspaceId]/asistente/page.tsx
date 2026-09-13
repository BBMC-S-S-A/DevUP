"use client";

import { Bot } from "lucide-react";
import { useParams } from "next/navigation";
import { Asistente } from "@/components/asistente/Asistente";
import { Chip } from "@/components/ui/Superficies";
import { Pagina } from "@/components/ui/Pagina";

/**
 * El asistente, en su propia pantalla.
 *
 * Todo lo que hace vive en `components/asistente/Asistente.tsx`: aquí solo
 * queda el marco. Se partió así para poder montarlo también dentro de DevVerse,
 * en el muñeco de la sala «Agente IA», sin una segunda copia del chat — el
 * mismo camino que ya había hecho el tablero.
 */
export default function AsistentePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  return (
    <Pagina
      titulo="Asistente"
      rotulo="pregúntale por tu trabajo"
      icono={<Bot size={16} />}
      ancho="lg"
      junto={<Chip tono="accent">tu propio modelo</Chip>}
    >
      <Asistente workspaceId={workspaceId} />
    </Pagina>
  );
}
