"use client";

import { useState } from "react";
import { Bot, History, ScrollText } from "lucide-react";
import { Cargando, Fallo } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useRecurso } from "@/lib/datos";
import { useOrgId } from "@/lib/workspace-context";

/**
 * La auditoría por persona, leída del REGISTRO.
 *
 * POR QUÉ ES UNA TERCERA MITAD Y NO UN CAMBIO EN «EL EQUIPO». Las dos miran a
 * la gente, pero no dicen lo mismo ni valen lo mismo. «El equipo» cruza
 * mensajes, llamadas y el estado de las tarjetas: contesta cómo se trabaja
 * junto, y lo hace con aproximaciones —una tarea no guardaba cuándo se cerró,
 * así que lo más cercano era cuándo se tocó por última vez—. Esto lee la tabla
 * `activity` de la 0038, donde cada línea es un hecho fechado. Sustituir aquella
 * por esta sería perder los mensajes y las llamadas, que el registro no ve.
 *
 * LO QUE HACE HONESTA A ESTA PANTALLA, Y ES LA DECISIÓN PRINCIPAL: no hay un
 * número por persona. Hay un desglose. Un total obligaría a decidir hoy cuánto
 * vale cerrar una tarea frente a crearla —la decisión de participación que
 * sigue abierta— y la tomaría por la puerta de atrás: en cuanto un número
 * único aparece en una pantalla, se convierte en el marcador, y deshacer eso
 * después ya no es un cambio de interfaz.
 *
 * Y LO QUE HIZO EL ASISTENTE DE ALGUIEN VA APARTE. Sin esa separación, quien
 * le pide diez tareas a su agente aparece trabajando el doble que quien las
 * escribió a mano. Las dos cosas cuentan; no son la misma y no se suman solas.
 */

type Fila = {
  actorId: string;
  actorNombre: string | null;
  verbo: string;
  origen: "persona" | "regla" | "agente";
  veces: number;
  ultimaVez: string;
};

type Cierre = { actorId: string; cerradas: number; diasMediana: number | null };

/**
 * Los verbos, en el orden en que se quieren leer y no en el alfabético.
 *
 * Cerrar primero porque es lo que se busca al abrir esto. Borrar al final
 * porque es lo raro, y cuando aparece se quiere ver, no que se pierda en medio.
 */
const VERBOS: { verbo: string; texto: string }[] = [
  { verbo: "tarea.cerrada", texto: "cerradas" },
  { verbo: "tarea.creada", texto: "creadas" },
  { verbo: "tarea.movida", texto: "movidas" },
  { verbo: "tarea.asignada", texto: "asignadas" },
  { verbo: "tarea.reclasificada", texto: "reclasificadas" },
  { verbo: "tarea.reabierta", texto: "reabiertas" },
  { verbo: "tarea.borrada", texto: "borradas" },
];

/** Periodos redondos. Tres opciones: más son un formulario, no un filtro. */
const PERIODOS = [
  { dias: 7, texto: "7 días" },
  { dias: 30, texto: "30 días" },
  { dias: 90, texto: "90 días" },
] as const;

const comoSeLlama = (nombre: string | null) => nombre || "Sin nombre";

/** «hace 3 días», que es como se lee una fecha reciente. */
function hace(iso: string): string {
  const dias = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

export function AuditoriaDelRegistro({ workspaceId }: { workspaceId: string }) {
  const orgId = useOrgId();
  const [dias, setDias] = useState<number>(30);

  const datos = useRecurso<{ resumen: Fila[]; cierres: Cierre[] }>(
    `/organizations/${orgId}/activity/summary?workspaceId=${workspaceId}&dias=${dias}`,
  );

  if (datos.error) {
    return <Fallo onReintentar={() => void datos.recargar()}>{datos.error}</Fallo>;
  }
  if (datos.cargando || !datos.datos) return <Cargando etiqueta="Leyendo el registro" />;

  const filas = datos.datos.resumen;
  const cierres = datos.datos.cierres;

  const selector = (
    <div className="flex gap-1">
      {PERIODOS.map((p) => (
        <button
          key={p.dias}
          type="button"
          onClick={() => setDias(p.dias)}
          className={`presionable rounded-full border px-2.5 py-0.5 font-display text-[10px]
            font-semibold uppercase tracking-wider transition-colors
            ${
              dias === p.dias
                ? "border-accent/40 bg-accent-soft/60 text-accent"
                : "border-line text-faint hover:text-muted"
            }`}
        >
          {p.texto}
        </button>
      ))}
    </div>
  );

  if (filas.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Rotulo>Los últimos {dias} días</Rotulo>
          {selector}
        </div>
        <EstadoVacio
          icono={<ScrollText size={20} />}
          titulo="El registro todavía no tiene nada que contar"
          pista={`Nadie ha creado, movido ni cerrado tareas en este espacio en los últimos ${dias} días. El registro empezó a escribirse con la migración 0038: lo anterior a eso no está aquí, y no se puede reconstruir.`}
        />
      </div>
    );
  }

  // Una tarjeta por persona, ordenadas por cuánto hicieron. Que se agrupe aquí
  // y no en la consulta es a propósito: la API devuelve hechos contados por
  // (persona, verbo, origen), que es la forma útil para cualquiera que lea de
  // ella, y es la PANTALLA la que decide cómo se presentan.
  const personas = new Map<string, { nombre: string | null; filas: Fila[]; total: number }>();
  for (const f of filas) {
    const ya = personas.get(f.actorId);
    if (ya) {
      ya.filas.push(f);
      ya.total += f.veces;
    } else personas.set(f.actorId, { nombre: f.actorNombre, filas: [f], total: f.veces });
  }
  const ordenadas = [...personas.entries()].sort((a, b) => b[1].total - a[1].total);
  const masActiva = Math.max(1, ...ordenadas.map(([, p]) => p.total));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Rotulo>Los últimos {dias} días</Rotulo>
        {selector}
      </div>

      {ordenadas.map(([actorId, persona]) => {
        const cierre = cierres.find((c) => c.actorId === actorId);
        const porAgente = persona.filas
          .filter((f) => f.origen === "agente")
          .reduce((suma, f) => suma + f.veces, 0);
        const ultima = persona.filas
          .map((f) => f.ultimaVez)
          .sort()
          .at(-1);

        return (
          <Tarjeta key={actorId} className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
                {comoSeLlama(persona.nombre)}
              </h2>
              {porAgente > 0 && (
                <Chip tono="accent">
                  <Bot size={10} /> {porAgente} con asistente
                </Chip>
              )}
              {ultima && <span className="text-[11px] text-faint">última vez, {hace(ultima)}</span>}
            </div>

            {/* La barra compara con quien más hizo, no con un máximo inventado:
                lo que se lee de un vistazo es el reparto, no la cifra. */}
            <span className="mb-3 block h-1.5 w-full overflow-hidden rounded-full bg-raised">
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${(persona.total / masActiva) * 100}%` }}
              />
            </span>

            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {VERBOS.map(({ verbo, texto }) => {
                const veces = persona.filas
                  .filter((f) => f.verbo === verbo)
                  .reduce((suma, f) => suma + f.veces, 0);
                // Un cero no se enseña: una lista de siete filas con cinco
                // ceros esconde las dos que dicen algo.
                if (veces === 0) return null;
                return (
                  <li key={verbo} className="text-xs">
                    <span className="font-mono tabular-nums text-ink">{veces}</span>{" "}
                    <span className="text-muted">{texto}</span>
                  </li>
                );
              })}
            </ul>

            {cierre && cierre.diasMediana !== null && (
              <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
                Lo que cierra tarda{" "}
                <span className="text-ink">
                  {cierre.diasMediana === 0 ? "menos de un día" : `${cierre.diasMediana} días`}
                </span>{" "}
                desde que se creó{" "}
                {/* El recuento va pegado a la mediana y no aparte: una mediana
                    de dos casos no es un dato, es una anécdota, y sin el número
                    al lado no hay forma de saberlo. */}
                <span className="text-faint">
                  (mediana de {cierre.cerradas} {cierre.cerradas === 1 ? "tarea" : "tareas"})
                </span>
                .
              </p>
            )}
          </Tarjeta>
        );
      })}

      {/*
        LA LETRA PEQUEÑA VA EN LA PANTALLA Y NO SOLO EN EL CÓDIGO. Estos números
        se van a leer sobre personas, y el que los lea tiene que poder saber qué
        dejan fuera antes de sacar una conclusión sobre alguien.
      */}
      <p className="text-xs leading-relaxed text-faint">
        <History size={11} className="mr-1 inline align-[-1px]" />
        Esto cuenta hechos del tablero, no trabajo. Lo que no pasa por una tarjeta
        —revisar el código de otro, una llamada larga, sacar a alguien de un atasco— no
        aparece aquí. El registro empezó con la migración 0038: lo anterior no está y no
        se puede reconstruir, así que <span className="text-muted">«cuánto tarda en cerrarse»</span>{" "}
        solo mide tareas cuya creación quedó anotada. No hay un total por persona a
        propósito: cuánto vale cerrar una tarea frente a crearla es una decisión que no
        está tomada.
      </p>
    </div>
  );
}
