"use client";

import { Bot, History } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Rotulo } from "@/components/ui/Superficies";
import { actorLegible, fraseDeRenglon, type Renglon } from "@/lib/actividad";
import { Avatar } from "@/components/perfil/Avatar";
import { ignorar } from "@/lib/fallo";

/**
 * Lo que le ha pasado a esta tarea.
 *
 * LA PRIMERA PANTALLA QUE ENSEÑA EL REGISTRO DE ACTIVIDAD. La tabla existe
 * desde la migración 0038 y la API lleva días escribiendo en ella cada vez que
 * alguien mueve, cierra o asigna algo. No se veía en ningún sitio: DevUP sabía
 * lo que había pasado y no lo contaba.
 *
 * AQUÍ Y NO EN UNA PANTALLA DE AUDITORÍA. La pregunta —«¿por qué lleva tres
 * días en En curso?», «¿quién se la quedó?»— se hace mirando la tarea. Nadie
 * abre un registro general para eso, y un registro que nadie abre da igual que
 * no exista.
 *
 * SE PIDE AL ABRIR LA TAREA, no con el tablero. Un tablero de cuarenta
 * tarjetas serían cuarenta peticiones para algo que se mira de una en una.
 *
 * SI FALLA, NO SE DICE NADA EN ROJO. Es información de apoyo al lado de un
 * formulario que sí importa: una franja de error aquí interrumpiría la edición
 * de la tarea por no haber podido pintar su historia. Se queda callado y el
 * motivo va a la consola.
 */
export function HistorialDeTarea({ taskId }: { taskId: string }) {
  const [renglones, setRenglones] = useState<Renglon[] | null>(null);

  useEffect(() => {
    let vigente = true;
    api
      .get<{ actividad: Renglon[] }>(`/actividad/de/${taskId}`)
      .then(({ actividad }) => {
        if (vigente) setRenglones(actividad);
      })
      .catch(ignorar("no se pudo cargar el historial de la tarea"));
    return () => {
      vigente = false;
    };
  }, [taskId]);

  // Mientras carga no se pinta nada, y en eso hay una decisión: un esqueleto
  // aquí haría saltar el alto del diálogo justo donde alguien está escribiendo.
  if (!renglones) return null;

  // Sin renglones tampoco se pinta. Una tarea creada antes de que existiera el
  // registro no tiene historia, y «Sin actividad» encima de un formulario dice
  // menos que el silencio.
  if (renglones.length === 0) return null;

  return (
    <div className="border-t border-line pt-4">
      <div className="mb-2.5 flex items-center gap-2">
        <History size={12} className="shrink-0 text-faint" />
        <Rotulo>Historial</Rotulo>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>

      <ol className="space-y-2">
        {renglones.map((renglon) => (
          <li key={renglon.id} className="flex items-start gap-2.5">
            {/* El agente conserva su icono y su chapa propia: lo que hizo una
                regla no debe parecer que lo hizo una persona, que es media
                tesis del registro. Las personas traen su cara. */}
            {renglon.procedencia === "agente" ? (
              <span
                aria-hidden
                className="mt-px grid size-6 shrink-0 place-items-center rounded-full border
                  border-line bg-raised text-muted"
              >
                <Bot size={11} />
              </span>
            ) : (
              <Avatar
                userId={renglon.actorId}
                nombre={actorLegible(renglon)}
                tamano={24}
                className="mt-px"
              />
            )}

            <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted">
              <span className="font-medium text-ink">{actorLegible(renglon)}</span>{" "}
              {/* Sin el nombre de la tarea: estamos dentro de ella. */}
              {fraseDeRenglon(renglon, false)}
              <span className="ml-1.5 whitespace-nowrap font-mono text-[10px] tabular-nums text-faint">
                {hace(renglon.cuando)}
              </span>
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Tiempo relativo corto.
 *
 * En un historial, «hace 12 min» dice más que una fecha completa: lo que se
 * está preguntando es cuánto lleva algo parado, y eso es una distancia, no un
 * instante. A partir de una semana sí se pone la fecha, porque «hace 6 sem» ya
 * no sitúa a nadie.
 */
function hace(iso: string): string {
  const marca = new Date(iso).getTime();
  if (Number.isNaN(marca)) return "";
  const segundos = Math.max(0, (Date.now() - marca) / 1000);
  if (segundos < 60) return "ahora";
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias < 7) return `hace ${dias} d`;
  return new Date(marca).toLocaleDateString("es", { day: "numeric", month: "short" });
}
