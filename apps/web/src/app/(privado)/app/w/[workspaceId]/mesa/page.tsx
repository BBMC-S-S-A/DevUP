"use client";

import { Bell, Files, Hash, KanbanSquare, LayoutGrid, Megaphone } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChannelChat } from "@/components/chat/ChannelChat";
import { NoticiasWidget, NotificacionesWidget } from "@/components/dashboard/DashboardWidgets";
import { FileLibrary } from "@/components/files/FileLibrary";
import { AnadirZona, Mesa, type Zona } from "@/components/mesa/Mesa";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { Desplegable } from "@/components/ui/Field";
import { Cargando, Fallo } from "@/components/ui/Pagina";
import { EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import type { Channel, Workspace } from "@/lib/api";
import { api, useRecurso } from "@/lib/datos";

/**
 * La mesa de trabajo.
 *
 * QUÉ PROBLEMA RESUELVE, dicho con precisión: hay veintiuna pantallas y todas
 * valen lo mismo, una lista plana en una barra. Pero trabajar es casi siempre
 * mirar dos cosas a la vez —el canal y el tablero, los archivos y el canal— y
 * hoy eso obliga a saltar entre pantallas perdiendo de vista una para ver la
 * otra.
 *
 * ES EL PRIMER PASO DE LA REORGANIZACIÓN POR SECTORES, y va antes que los
 * preajustes por rol a propósito: sin partición, un preajuste es un orden de
 * menú. Con partición, un rol es una disposición guardada — cuatro filas en una
 * tabla, no una funcionalidad nueva.
 *
 * EL CATÁLOGO SON COMPONENTES QUE YA EXISTEN. No hay ninguna herramienta escrita
 * para esto: el chat, el tablero y los archivos ya eran componentes
 * autocontenidos, y por eso esta pantalla es pequeña. Las que hoy son páginas
 * enteras —ventas, infraestructura— entran cuando se partan, que es trabajo de
 * otro sitio.
 */

const CATALOGO: Record<string, { titulo: string; icono: ReactNode }> = {
  chat: { titulo: "Canal", icono: <Hash size={13} /> },
  tablero: { titulo: "Tablero", icono: <KanbanSquare size={13} /> },
  archivos: { titulo: "Archivos", icono: <Files size={13} /> },
  noticias: { titulo: "Noticias", icono: <Megaphone size={13} /> },
  notificaciones: { titulo: "Notificaciones", icono: <Bell size={13} /> },
};

const ZONAS_MAX = 3;

type Guardado = { zonas: Zona[]; fracciones: number[] };

export default function MesaPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const espacio = useRecurso<{ workspace: Workspace }>(`/workspaces/${workspaceId}`);
  const canales = useRecurso<{ channels: Channel[] }>(`/workspaces/${workspaceId}/channels`);
  const guardado = useRecurso<Guardado>(`/me/mesa/${workspaceId}`);

  const [mesa, setMesa] = useState<Guardado | null>(null);

  // Lo guardado manda una sola vez, al llegar. Después manda lo que hay en
  // pantalla: si se reaplicara en cada revalidación, mover un divisor y que la
  // caché refrescara medio segundo después devolvería la mesa a su sitio.
  useEffect(() => {
    if (guardado.datos && mesa === null) setMesa(guardado.datos);
  }, [guardado.datos, mesa]);

  const orgId = espacio.datos?.workspace.organizationId ?? "";
  const listaCanales = canales.datos?.channels ?? [];

  const cambiar = useCallback(
    (zonas: Zona[], fracciones: number[]) => {
      setMesa({ zonas, fracciones });
      // Al soltar, no en cada fotograma: guardar durante el arrastre sería una
      // escritura por movimiento del ratón.
      void api.put(`/me/mesa/${workspaceId}`, { zonas, fracciones }).catch(() => {});
    },
    [workspaceId],
  );

  function anadir() {
    const zonas = mesa?.zonas ?? [];
    const primerCanal = listaCanales.find((c) => c.kind === "text")?.id ?? null;
    const nueva: Zona = zonas.some((z) => z.herramienta === "chat")
      ? { herramienta: "tablero", objetivo: null }
      : { herramienta: "chat", objetivo: primerCanal };
    const siguientes = [...zonas, nueva];
    // Al añadir se reparte a partes iguales. Conservar los anchos anteriores y
    // meter la nueva con lo que sobre daría una zona nueva diminuta, que es la
    // que se acaba de pedir mirar.
    cambiar(siguientes, siguientes.map(() => 1 / siguientes.length));
  }

  function cambiarObjetivo(indice: number, objetivo: string) {
    const zonas = (mesa?.zonas ?? []).map((z, k) => (k === indice ? { ...z, objetivo } : z));
    cambiar(zonas, mesa?.fracciones ?? []);
  }

  if (espacio.cargando || guardado.cargando) return <Cargando etiqueta="Preparando la mesa" />;

  const error = espacio.error ?? guardado.error;
  const zonas = mesa?.zonas ?? [];

  return (
    <div className="alto-util flex flex-col gap-3 p-3">
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <LayoutGrid size={15} className="text-faint" />
          <Rotulo>Mesa de trabajo</Rotulo>
        </div>
        <span className="flex-1" />
        <AnadirZona cuantas={zonas.length} maximo={ZONAS_MAX} onAnadir={anadir} />
      </header>

      {error && (
        <Fallo onReintentar={() => void guardado.recargar()}>{error}</Fallo>
      )}

      {zonas.length === 0 ? (
        <EstadoVacio
          icono={<LayoutGrid size={20} />}
          titulo="La mesa está vacía"
          pista="Parte la pantalla y pon en cada zona la herramienta que necesites: el canal y el tablero a la vez, o los archivos junto a la conversación."
        />
      ) : (
        <Mesa
          zonas={zonas}
          fracciones={mesa?.fracciones ?? []}
          onCambiar={cambiar}
          catalogo={CATALOGO}
        >
          {(zona, indice) => (
            <Herramienta
              zona={zona}
              indice={indice}
              workspaceId={workspaceId}
              orgId={orgId}
              canales={listaCanales}
              onObjetivo={cambiarObjetivo}
            />
          )}
        </Mesa>
      )}
    </div>
  );
}

function Herramienta({
  zona,
  indice,
  workspaceId,
  orgId,
  canales,
  onObjetivo,
}: {
  zona: Zona;
  indice: number;
  workspaceId: string;
  orgId: string;
  canales: Channel[];
  onObjetivo: (indice: number, objetivo: string) => void;
}) {
  if (zona.herramienta === "chat") {
    const deTexto = canales.filter((c) => c.kind === "text");
    if (!zona.objetivo) {
      return (
        <div className="p-3">
          <Rotulo className="mb-1.5 block">Qué canal</Rotulo>
          <Desplegable
            contenedor="w-full"
            value=""
            onChange={(e) => onObjetivo(indice, e.target.value)}
            aria-label="Canal de esta zona"
          >
            <option className="bg-surface" value="">
              Elige uno
            </option>
            {deTexto.map((c) => (
              <option className="bg-surface" key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </Desplegable>
        </div>
      );
    }
    return <ChannelChat channelId={zona.objetivo} />;
  }

  if (zona.herramienta === "tablero") {
    return <TaskBoard workspaceId={workspaceId} organizationId={orgId} />;
  }

  if (zona.herramienta === "archivos") {
    return <FileLibrary workspaceId={workspaceId} organizationId={orgId} />;
  }

  // Noticias y notificaciones son los widgets del panel, reutilizados tal cual:
  // son los mismos componentes y no tiene sentido escribirlos otra vez. La
  // música se queda fuera de esta primera rebanada porque necesita un canal y
  // un modo de pintado, que son dos parámetros más en una zona.
  return (
    <div className="p-3">
      {zona.herramienta === "noticias" ? (
        <NoticiasWidget organizationId={orgId} />
      ) : (
        <NotificacionesWidget />
      )}
    </div>
  );
}
