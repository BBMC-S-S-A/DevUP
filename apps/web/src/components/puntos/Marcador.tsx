"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";
import type { AsientoDePuntos, PuntosDePersona } from "@/lib/api";
import { Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useRecurso } from "@/lib/datos";
import { iniciales } from "@/lib/fechas";

/**
 * El marcador de una organización.
 *
 * QUÉ MIDE, Y QUÉ NO. Los puntos se ganan al CERRAR una tarea (10) y al dejar
 * prueba escrita de cómo se hizo (5 más). No dependen de la prioridad ni de
 * ningún campo que ponga quien los gana — si el precio lo pone quien cobra, el
 * precio es infinito.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PANTALLA NO PUEDE HACER: enseñar el total y callarse «a solas»
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Como se ganan cerrando tareas, quien quiera inflar su número puede crear
 * tareas fáciles y cerrárselas. NO se prohíbe: alguien puede montar su proyecto
 * aquí él solo, y eso es justo lo que atrae. Se DICE. `aSolas` es cuánto de ese
 * total se ganó en tareas por las que no pasó nadie más, y por eso va **en la
 * misma línea que el total** — debajo, en una pestaña o en un emergente es
 * exactamente lo mismo que no tenerlo: nadie abre la segunda vista. Con esto,
 * un número inflado sigue ahí y se le ve el inflado.
 *
 * Y LOS ASIENTOS VAN AQUÍ, no en otra pantalla. Un total sin asientos detrás es
 * un número que hay que creerse; con ellos es una afirmación que se puede ir a
 * comprobar tarea por tarea.
 *
 * NO ES UN RANKING DE PRODUCTIVIDAD, y por eso no hay podio, ni medallas, ni
 * posiciones. Cuenta tareas cerradas, que no es lo mismo que trabajo hecho:
 * quien pasa un mes con una sola tarea difícil sale último. Un podio convierte
 * eso en una acusación.
 */
export function Marcador({ orgId, dias = 30 }: { orgId: string; dias?: number }) {
  const marcador = useRecurso<{ dias: number; gente: PuntosDePersona[] }>(
    `/organizations/${orgId}/puntos?dias=${dias}`,
  );
  const [abierta, setAbierta] = useState<string | null>(null);

  const gente = marcador.datos?.gente ?? [];
  const total = gente.reduce((s, p) => s + p.total, 0);
  const solas = gente.reduce((s, p) => s + p.aSolas, 0);

  // Mientras carga no se pinta nada: un marcador vacío que luego se llena hace
  // pensar por medio segundo que nadie ha hecho nada.
  if (marcador.cargando || marcador.error) return null;

  return (
    <Tarjeta className="p-4">
      <div className="flex items-center gap-1.5">
        <Sparkles size={12} className="text-faint" />
        <Rotulo>Puntos · últimos {marcador.datos?.dias ?? dias} días</Rotulo>
        <span className="h-px flex-1 bg-line/70" aria-hidden />
      </div>

      {gente.length === 0 ? (
        <p className="mt-3 text-xs text-faint">
          Nadie ha ganado puntos todavía. Se ganan al cerrar una tarea, y un poco
          más por dejar escrito cómo se hizo.
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-1">
            {gente.map((p) => (
              <FilaDePersona
                key={p.id}
                persona={p}
                orgId={orgId}
                dias={dias}
                abierta={abierta === p.id}
                onAbrir={() => setAbierta(abierta === p.id ? null : p.id)}
              />
            ))}
          </ul>

          {/* EL CASO QUE SOLO SE VE MIRANDO EL CONJUNTO. Línea a línea cada
              persona se lee normal; que nadie haya revisado nada de nadie no
              aparece en ninguna de ellas. */}
          {solas === total && total > 0 && (
            <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-relaxed text-warn">
              Todo lo de este periodo se ganó a solas: ninguna tarea pasó por dos
              personas.
            </p>
          )}
        </>
      )}
    </Tarjeta>
  );
}

const MOTIVOS: Record<string, string> = {
  cerro_tarea: "por cerrar",
  dejo_prueba: "por dejar prueba",
};

function cuando(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function FilaDePersona({
  persona,
  orgId,
  dias,
  abierta,
  onAbrir,
}: {
  persona: PuntosDePersona;
  orgId: string;
  dias: number;
  abierta: boolean;
  onAbrir: () => void;
}) {
  // Los asientos se piden al abrir y no antes: con diez personas serían diez
  // peticiones para enseñar una.
  const asientos = useRecurso<{ asientos: AsientoDePuntos[] }>(
    abierta ? `/organizations/${orgId}/puntos/${persona.id}?dias=${dias}` : null,
  );

  const desglose = Object.entries(persona.porMotivo)
    .map(([motivo, cuanto]) => `${cuanto} ${MOTIVOS[motivo] ?? motivo}`)
    .join(" · ");

  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        aria-expanded={abierta}
        className="presionable flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-raised/60"
      >
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-full border border-line-strong bg-raised font-display text-[9px] font-semibold text-muted"
        >
          {iniciales(persona.nombre ?? "?")}
        </span>

        <span className="min-w-0 flex-1 truncate text-xs text-ink">
          {persona.nombre ?? "alguien"}
        </span>

        {/* AQUÍ, PEGADO AL TOTAL. Ver la cabecera del fichero: separarlos
            deshace la única defensa que tiene el sistema. */}
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink">
          {persona.total}
          {persona.aSolas > 0 && (
            <span className="ml-1.5 text-[10px] font-normal text-warn">
              {persona.aSolas} a solas
            </span>
          )}
        </span>

        <ChevronDown
          size={13}
          className={`shrink-0 text-faint transition-transform duration-[160ms] ${abierta ? "rotate-180" : ""}`}
        />
      </button>

      {abierta && (
        <div className="ml-8 border-l border-line pl-3">
          <p className="py-1 font-mono text-[10px] text-faint">
            {desglose} · {persona.tareas} tarea(s)
          </p>

          {asientos.cargando ? (
            <div className="h-6 animate-pulse rounded bg-line/40" aria-busy="true" />
          ) : (
            <ul className="space-y-0.5 pb-1">
              {(asientos.datos?.asientos ?? []).map((a) => (
                <li key={a.id} className="flex items-baseline gap-2 text-[11px]">
                  <span className="shrink-0 font-mono tabular-nums text-live">+{a.cantidad}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {a.titulo || "sin título"}
                  </span>
                  {a.aSolas && <span className="shrink-0 text-[10px] text-warn">a solas</span>}
                  <span className="shrink-0 text-[10px] text-faint">{cuando(a.cuando)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
