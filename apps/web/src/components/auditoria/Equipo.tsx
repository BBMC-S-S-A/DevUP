"use client";

import { CircleSlash, Clock, TriangleAlert, Users } from "lucide-react";
import { Cargando, Fallo } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useRecurso } from "@/lib/datos";

/**
 * La auditoría del EQUIPO: cómo trabaja la gente junta.
 *
 * LA OTRA MITAD DE ESTA PANTALLA MIRA EL REPOSITORIO, y las dos se llaman
 * auditoría con razón. Esta nació después porque la palabra se había leído
 * solo en su sentido técnico.
 *
 * TRES PREGUNTAS Y NADA MÁS. Quién trabaja con quién, cómo se reparte la
 * carga, y dónde se atasca el trabajo. Un panel que contesta tres cosas se
 * mira; uno que enseña quince cifras se cierra.
 *
 * LOS NÚMEROS VIENEN CON SU LETRA PEQUEÑA, Y NO ES ADORNO. Una tarea no guarda
 * cuándo se terminó —lo más cercano es cuándo se tocó por última vez—, así que
 * «cuánto tarda en cerrarse» es una aproximación y se dice. Un número sin esa
 * advertencia se convierte en una decisión sobre una persona, y esa es
 * exactamente la forma en que un panel así hace daño.
 *
 * NO ES UNA PUNTUACIÓN DE NADIE. Está escrito en la pantalla, no solo aquí:
 * quien no aparece acompañado puede estar de vacaciones, trabajando solo por
 * su cuenta, o hablando en canales privados que quien mira no ve. Es una
 * pregunta para llevar a una conversación, no una conclusión.
 */

type Pareja = {
  a: string;
  b: string;
  nombreA: string;
  nombreB: string;
  mensajes: number;
  llamadas: number;
  total: number;
};

type Carga = { userId: string; displayName: string; abiertas: number; hechas: number };

type Parada = {
  id: string;
  titulo: string;
  columna: string;
  responsable: string | null;
  dias: number;
};

type Equipo = {
  dias: number;
  juntos: Pareja[];
  sueltos: { userId: string; displayName: string | null }[];
  carga: Carga[];
  sinResponsable: number;
  cierre: { diasMediana: number | null; terminadas: number };
  columnas: { columna: string; abiertas: number; diasSinTocar: number | null }[];
  paradas: Parada[];
  umbralParada: number;
};

const dia = (n: number) => `${n} día${n === 1 ? "" : "s"}`;

export function AuditoriaDelEquipo({ workspaceId }: { workspaceId: string }) {
  const equipo = useRecurso<Equipo>(`/workspaces/${workspaceId}/auditoria/equipo`);

  if (equipo.error) {
    return <Fallo onReintentar={() => void equipo.recargar()}>{equipo.error}</Fallo>;
  }
  if (equipo.cargando || !equipo.datos) return <Cargando etiqueta="Mirando cómo trabaja el equipo" />;

  const d = equipo.datos;
  const sinNada =
    d.juntos.length === 0 && d.carga.length === 0 && d.paradas.length === 0 && d.cierre.terminadas === 0;

  if (sinNada) {
    return (
      <EstadoVacio
        icono={<Users size={20} />}
        titulo="Todavía no hay de qué sacar conclusiones"
        pista={`En los últimos ${d.dias} días no hay conversaciones con respuesta, llamadas ni tareas asignadas en este espacio. Esto se llena solo según se trabaje.`}
      />
    );
  }

  const masCargado = Math.max(1, ...d.carga.map((c) => c.abiertas + c.hechas));

  return (
    <div className="space-y-5">
      <Rotulo>Los últimos {d.dias} días</Rotulo>

      {/* --- Quién trabaja con quién ------------------------------------- */}
      <Tarjeta className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Users size={14} className="text-accent" />
          <h2 className="text-sm font-semibold">Quién trabaja con quién</h2>
        </div>

        {d.juntos.length === 0 ? (
          <p className="text-xs text-faint">
            Nadie ha respondido a nadie ni ha coincidido en una llamada. Puede ser un espacio
            recién abierto, o que la conversación esté ocurriendo fuera de aquí.
          </p>
        ) : (
          <ul className="space-y-2">
            {d.juntos.map((p) => (
              <li key={`${p.a}|${p.b}`} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-xs">
                  <span className="text-ink">{p.nombreA}</span>
                  <span className="mx-1.5 text-faint">·</span>
                  <span className="text-ink">{p.nombreB}</span>
                </span>
                {/* La barra es relativa al par más fuerte: lo que importa es
                    quién se habla más que quién, no el número absoluto. */}
                <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-raised">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${Math.round((p.total / d.juntos[0]!.total) * 100)}%` }}
                  />
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
                  {p.mensajes > 0 && `${p.mensajes} resp.`}
                  {p.mensajes > 0 && p.llamadas > 0 && " · "}
                  {p.llamadas > 0 && `${p.llamadas} llam.`}
                </span>
              </li>
            ))}
          </ul>
        )}

        {d.sueltos.length > 0 && (
          <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-muted">
            <span className="text-ink">Sin aparecer con nadie:</span>{" "}
            {d.sueltos.map((s) => s.displayName || "Sin nombre").join(", ")}.{" "}
            <span className="text-faint">
              No es un juicio: puede ser vacaciones, trabajo en solitario, o conversaciones en
              canales privados que tú no ves. Es una pregunta, no una conclusión.
            </span>
          </p>
        )}
      </Tarjeta>

      {/* --- Cómo se reparte la carga ------------------------------------ */}
      <Tarjeta className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Users size={14} className="text-accent" />
          <h2 className="text-sm font-semibold">Cómo se reparte la carga</h2>
        </div>

        {d.carga.length === 0 ? (
          <p className="text-xs text-faint">Ninguna tarea tiene responsable todavía.</p>
        ) : (
          <ul className="space-y-2.5">
            {d.carga.map((c) => (
              <li key={c.userId}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-xs text-ink">{c.displayName}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
                    {c.abiertas} abierta{c.abiertas === 1 ? "" : "s"} · {c.hechas} hecha
                    {c.hechas === 1 ? "" : "s"}
                  </span>
                </div>
                <span className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-raised">
                  <span
                    className="block h-full bg-accent"
                    style={{ width: `${(c.abiertas / masCargado) * 100}%` }}
                  />
                  <span
                    className="block h-full bg-live/70"
                    style={{ width: `${(c.hechas / masCargado) * 100}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}

        {d.sinResponsable > 0 && (
          <p className="mt-3 text-xs text-warn">
            {d.sinResponsable} tarea{d.sinResponsable === 1 ? "" : "s"} sin responsable: no
            aparecen en el reparto de arriba porque no son de nadie.
          </p>
        )}
      </Tarjeta>

      {/* --- Dónde se atasca --------------------------------------------- */}
      <Tarjeta className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Clock size={14} className="text-accent" />
          <h2 className="text-sm font-semibold">Dónde se atasca el trabajo</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {d.cierre.diasMediana === null ? (
            <Chip tono="neutro">Todavía no se ha terminado ninguna tarea</Chip>
          ) : (
            <Chip tono="live">
              Una tarea tarda {dia(d.cierre.diasMediana)} en cerrarse (mediana de{" "}
              {d.cierre.terminadas})
            </Chip>
          )}
          {d.paradas.length > 0 && (
            <Chip tono="warn">
              {d.paradas.length} parada{d.paradas.length === 1 ? "" : "s"} más de{" "}
              {dia(d.umbralParada)}
            </Chip>
          )}
        </div>

        {d.columnas.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
            {d.columnas.map((c) => (
              <li key={c.columna} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-muted">{c.columna}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
                  {c.abiertas} abierta{c.abiertas === 1 ? "" : "s"}
                  {c.diasSinTocar !== null && c.abiertas > 0 && ` · ${dia(c.diasSinTocar)} sin tocar`}
                </span>
              </li>
            ))}
          </ul>
        )}

        {d.paradas.length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <Rotulo>Las que llevan más tiempo quietas</Rotulo>
            <ul className="mt-2 space-y-1.5">
              {d.paradas.map((p) => (
                <li key={p.id} className="flex items-baseline gap-2.5 text-xs">
                  <TriangleAlert size={11} className="mt-0.5 shrink-0 text-warn" />
                  <span className="min-w-0 flex-1 truncate text-ink">{p.titulo}</span>
                  <span className="shrink-0 text-faint">{p.responsable ?? "sin responsable"}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-warn">
                    {dia(p.dias)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Tarjeta>

      {/* La letra pequeña. Va al final y completa, porque estos números se
          usan para hablar de personas y merecen saberse mal medidos antes de
          que alguien los use para decidir algo. */}
      <Tarjeta className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <CircleSlash size={13} className="text-faint" />
          <Rotulo>Qué NO dice esto</Rotulo>
        </div>
        <ul className="space-y-1.5 text-xs leading-relaxed text-muted">
          <li>
            <b className="text-ink">«Cuánto tarda en cerrarse» es aproximado.</b> Una tarea no
            guarda cuándo se terminó: se usa cuándo se tocó por última vez. Si se editó después de
            darla por hecha, el número sale más alto de lo real.
          </li>
          <li>
            <b className="text-ink">Solo se ve lo que tú ves.</b> Los canales privados a los que no
            perteneces no cuentan, así que dos personas pueden colaborar mucho y no salir aquí.
          </li>
          <li>
            <b className="text-ink">No hay historia.</b> Esto es una foto de hoy, no un registro de
            lo que pasó: DevUP todavía no anota los hechos uno a uno.
          </li>
          <li>
            <b className="text-ink">No mide desempeño.</b> Escribir mucho no es trabajar mucho, y
            cerrar tareas pequeñas no es cerrar trabajo grande.
          </li>
        </ul>
      </Tarjeta>
    </div>
  );
}
