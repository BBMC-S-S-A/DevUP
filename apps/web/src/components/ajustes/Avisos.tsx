"use client";

import { AtSign, Bell, Megaphone, Radio, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import { Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useRecurso } from "@/lib/datos";

/**
 * De qué te avisa la campana.
 *
 * POR QUÉ HACE FALTA. Quien trabaja con el tablero abierto recibe un aviso por
 * cada tarea que le asignan, y termina ignorando la campana entera. Una bandeja
 * que se ignora no avisa de nada: la que se pierde es la que importaba.
 *
 * LOS INTERRUPTORES ESTÁN EN POSITIVO —«avísame»— y no en negativo. Por dentro
 * se guarda lo silenciado, que es lo correcto para la base: lo normal es querer
 * todo, y una lista de excepciones no crece al añadir clases nuevas. Pero una
 * pantalla de casillas que hay que DESmarcar para recibir algo se lee al revés
 * la primera vez, y la primera vez es la única que importa aquí.
 *
 * LA INVITACIÓN NO ESTÁ EN LA LISTA, y se dice por qué en vez de dejar un hueco.
 * Un ajuste que falta sin explicación se lee como un olvido, y alguien acabará
 * pidiéndolo. Con el motivo escrito, se entiende a la primera.
 */

type Clase = "mention" | "task_assigned" | "recording" | "announcement";

const CLASES: { clase: Clase; icono: typeof Bell; titulo: string; cuando: string }[] = [
  {
    clase: "mention",
    icono: AtSign,
    titulo: "Cuando te nombran",
    cuando: "Alguien escribe tu nombre en un canal al que llegas.",
  },
  {
    clase: "task_assigned",
    icono: Radio,
    titulo: "Cuando te asignan una tarea",
    cuando: "Pasas a ser su delegado: es tuya hasta que la cierres o la muevas.",
  },
  {
    clase: "recording",
    icono: Video,
    titulo: "Cuando una grabación está lista",
    cuando: "Se termina de procesar lo que se grabó en una llamada.",
  },
  {
    clase: "announcement",
    icono: Megaphone,
    titulo: "Cuando se publica un anuncio",
    cuando: "Alguien pone algo en el tablón de la organización.",
  },
];

export function Avisos() {
  const guardados = useRecurso<{ silenciados: string[] }>("/me/avisos");
  const [silenciados, setSilenciados] = useState<string[] | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Se siembra cuando llega y no se vuelve a pisar: reasignarlo en cada
  // renderizado haría que cada clic se deshiciera solo al recargar los datos.
  useEffect(() => {
    if (silenciados === null && guardados.datos) setSilenciados(guardados.datos.silenciados);
  }, [guardados.datos, silenciados]);

  const cambiar = async (clase: Clase, avisar: boolean) => {
    const previos = silenciados ?? [];
    const siguientes = avisar ? previos.filter((c) => c !== clase) : [...previos, clase];

    // Se pinta antes de que el servidor conteste: un interruptor que tarda
    // medio segundo en moverse se pulsa dos veces, y entonces acaba como
    // estaba. Si falla, se devuelve a donde estaba y se dice.
    setSilenciados(siguientes);
    setOcupado(true);
    try {
      await api.put("/me/avisos", { silenciados: siguientes });
    } catch (fallo) {
      setSilenciados(previos);
      toast.error(fallo instanceof ApiError ? fallo.message : "no se pudo guardar");
    } finally {
      setOcupado(false);
    }
  };

  if (guardados.error || !silenciados) return null;

  return (
    <Tarjeta className="p-4">
      <div className="flex items-center gap-1.5">
        <Bell size={12} className="text-faint" />
        <Rotulo>De qué te avisa la campana</Rotulo>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        Lo que apagues aquí no se guarda en ningún sitio: no llega, y no cuenta
        en el contador de no leídos.
      </p>

      <ul className="mt-4 space-y-1.5">
        {CLASES.map(({ clase, icono: Icono, titulo, cuando }) => {
          const avisar = !silenciados.includes(clase);
          return (
            <li key={clase}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-raised/50">
                <input
                  type="checkbox"
                  checked={avisar}
                  disabled={ocupado}
                  onChange={(e) => void cambiar(clase, e.target.checked)}
                  className="mt-0.5 size-3.5 shrink-0 accent-[var(--accent)]"
                />
                <Icono size={13} className={`mt-0.5 shrink-0 ${avisar ? "text-accent" : "text-faint"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-ink">{titulo}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">
                    {cuando}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {/* El hueco explicado. Sin esto se lee como un olvido y alguien lo pide. */}
      <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-relaxed text-faint">
        Las invitaciones no se pueden apagar. De todo lo demás puedes enterarte
        por tu cuenta —la mención está en el canal, la tarea en tu tablero— pero
        de una invitación no: todavía no estás en esa organización, así que no
        hay ninguna pantalla donde descubrirla.
      </p>
    </Tarjeta>
  );
}
