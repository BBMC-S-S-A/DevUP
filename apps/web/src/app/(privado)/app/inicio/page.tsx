"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Bot,
  CalendarClock,
  CheckCircle2,
  History,
  Home,
  Inbox,
  LayoutGrid,
} from "lucide-react";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useRecurso } from "@/lib/datos";
import { fechaCorta, hoyLocal } from "@/lib/fechas";
import { IconoDeTipo, TIPO_EN_PALABRAS, tonoDePrioridad } from "@/components/tasks/ficha";
import type { TipoDeTarea } from "@/lib/api";

/**
 * La portada: todo lo mío, de todos los espacios a la vez.
 *
 * QUÉ PROBLEMA RESUELVE, Y ES EL MÁS BÁSICO QUE TENÍA EL PRODUCTO. Hasta aquí
 * DevUP solo sabía contestar dentro de un espacio de trabajo: el tablero es de
 * un espacio, la auditoría es de un espacio, el panel es de un espacio. Quien
 * lleva tres clientes tenía que entrar a los tres y sumar de cabeza. Entrar a
 * la aplicación te dejaba en el último sitio donde estuviste, que es cómodo
 * para seguir y no sirve para EMPEZAR: para eso hace falta un sitio que no sea
 * de ningún espacio en concreto.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * EL ORDEN ES LA RESPUESTA, y por eso no hay filtros ni pestañas. Una lista de
 * cuarenta tareas ordenada por fecha de creación no contesta «¿qué hago
 * ahora?»: hay que leerla entera. Esta pone delante lo vencido —que es lo
 * único que ya está costando algo—, después lo urgente, después lo que vence
 * antes. El día cabe en las cinco primeras líneas. El orden lo decide la API,
 * no la pantalla, para que el MCP pueda contestar lo mismo.
 *
 * NO HAY UN NÚMERO ÚNICO DE PARTICIPACIÓN, Y ES DELIBERADO. Hay un desglose:
 * cerradas, creadas, movidas. Un total obligaría a decidir hoy cuánto vale
 * cerrar una tarea frente a crearla —la decisión que sigue abierta— y la
 * tomaría por la puerta de atrás: en cuanto un número así aparece en la
 * portada, es el marcador, y quitarlo después ya no es un cambio de interfaz.
 *
 * Y LO QUE HIZO EL ASISTENTE VA APARTE. Sumarlo a lo que uno teclea haría que
 * la portada le dijera a alguien que trabajó el doble de lo que trabajó.
 */

type TareaDeInicio = {
  id: string;
  title: string;
  vence: string | null;
  prioridad: number;
  tipo: TipoDeTarea | null;
  columna: string;
  espacioId: string;
  espacio: string;
  organizacionId: string;
  organizacion: string;
  area: string | null;
  evidencias: number;
};

type Hecho = {
  verbo: string;
  origen: "persona" | "regla" | "agente";
  /** Cómo se llamaba la cosa ENTONCES (ver la 0038). No es una frase: la frase
   *  la compone esta pantalla, porque el registro guarda hechos, no prosa. */
  sujetoNombre: string;
  sujetoTipo: string;
  ocurridoEn: string;
  espacioId: string | null;
  espacio: string | null;
};

type Inicio = {
  dias: number;
  tareas: TareaDeInicio[];
  resumen: { verbo: string; origen: string; veces: number }[];
  ultimos: Hecho[];
};

/**
 * Los verbos que se enseñan, en el orden en que se quieren leer.
 *
 * Cerrar primero porque es lo que se busca al abrir esto. Y no están todos: el
 * registro guarda una docena de verbos y enseñarlos todos convertiría un
 * recuento que se lee de un vistazo en una tabla que no lee nadie.
 */
const VERBOS: { verbo: string; texto: string }[] = [
  { verbo: "cerro", texto: "cerradas" },
  { verbo: "creo", texto: "creadas" },
  { verbo: "movio", texto: "movidas" },
  { verbo: "evidencio", texto: "con prueba" },
];

/** La frase de un renglón, compuesta aquí. En pasado, como el verbo guardado. */
const EN_CASTELLANO: Record<string, string> = {
  creo: "creó",
  movio: "movió",
  cerro: "cerró",
  reabrio: "reabrió",
  asigno: "asignó",
  desasigno: "quitó el responsable de",
  renombro: "renombró",
  comento: "comentó en",
  adjunto: "adjuntó a",
  etiqueto: "etiquetó",
  borro: "borró",
  reclasifico: "cambió de área",
  priorizo: "repriorizó",
  enlazo: "enlazó una rama a",
  evidencio: "dejó prueba en",
};

const PERIODOS = [7, 30, 90] as const;

export default function InicioPage() {
  const [dias, setDias] = useState<number>(30);
  const inicio = useRecurso<Inicio>(`/me/inicio?dias=${dias}`);
  const hoy = hoyLocal();
  const anio = hoy.slice(0, 4);

  const tareas = useMemo(() => inicio.datos?.tareas ?? [], [inicio.datos]);

  /**
   * Las tareas agrupadas por espacio, para el mapa de la derecha.
   *
   * SE AGRUPA AQUÍ Y NO EN LA API a propósito: la API devuelve hechos —las
   * tareas, ordenadas como se miran— y es la pantalla la que decide cómo
   * presentarlos. Así el MCP puede pedir lo mismo y contestarlo en prosa sin
   * arrastrar una forma pensada para una cuadrícula.
   */
  const porEspacio = useMemo(() => {
    const mapa = new Map<string, { nombre: string; organizacion: string; cuantas: number }>();
    for (const t of tareas) {
      const ya = mapa.get(t.espacioId);
      if (ya) ya.cuantas += 1;
      else mapa.set(t.espacioId, { nombre: t.espacio, organizacion: t.organizacion, cuantas: 1 });
    }
    return [...mapa.entries()].sort((a, b) => b[1].cuantas - a[1].cuantas);
  }, [tareas]);

  if (inicio.error) {
    return (
      <Pagina titulo="Inicio" icono={<Home size={20} />}>
        <Fallo onReintentar={() => void inicio.recargar()}>{inicio.error}</Fallo>
      </Pagina>
    );
  }

  const vencidas = tareas.filter((t) => t.vence && t.vence.slice(0, 10) < hoy).length;

  return (
    <Pagina
      titulo="Inicio"
      rotulo={
        inicio.cargando
          ? "Reuniendo tu trabajo"
          : tareas.length === 0
            ? "No tienes nada asignado"
            : `${tareas.length} ${tareas.length === 1 ? "tarea" : "tareas"} en ${porEspacio.length} ${
                porEspacio.length === 1 ? "espacio" : "espacios"
              }${vencidas > 0 ? ` · ${vencidas} vencida${vencidas === 1 ? "" : "s"}` : ""}`
      }
      icono={<Home size={20} />}
      ancho="xl"
    >
      {inicio.cargando || !inicio.datos ? (
        <Cargando etiqueta="Reuniendo tu trabajo de todos los espacios" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
          <div className="min-w-0 space-y-5">
            <TusTareas tareas={tareas} hoy={hoy} anio={anio} />
            <LoUltimo hechos={inicio.datos.ultimos} dias={inicio.datos.dias} />
          </div>

          <div className="space-y-5">
            <DondeEstaTuTrabajo espacios={porEspacio} />
            <LoQueHasHecho
              resumen={inicio.datos.resumen}
              dias={dias}
              onDias={setDias}
            />
          </div>
        </div>
      )}
    </Pagina>
  );
}

/* ========================================================================== */

function TusTareas({
  tareas,
  hoy,
  anio,
}: {
  tareas: TareaDeInicio[];
  hoy: string;
  anio: string;
}) {
  if (tareas.length === 0) {
    return (
      <EstadoVacio
        icono={<Inbox size={20} />}
        titulo="Nada asignado a tu nombre"
        pista="Ni en este espacio ni en ninguno otro. Cuando alguien te asigne una tarea —o la archives en un área que llevas tú— aparecerá aquí."
      />
    );
  }

  return (
    <Tarjeta className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Inbox size={14} className="text-accent" />
        <h2 className="text-sm font-semibold">Lo que tienes</h2>
        <span className="ml-auto text-[11px] text-faint">
          lo vencido primero, luego lo urgente
        </span>
      </div>

      <ul className="space-y-1.5">
        {tareas.map((t) => {
          const dia = t.vence?.slice(0, 10) ?? null;
          const vencida = dia !== null && dia < hoy;
          const prioridad = tonoDePrioridad(t.prioridad);

          return (
            <li key={t.id}>
              {/* Lleva AL TABLERO DE SU ESPACIO, no a un detalle propio: una
                  tarea se trabaja en su tablero, con sus columnas y sus
                  compañeras al lado. Una pantalla de tarea suelta sería un
                  sitio más donde estar, que es justo de lo que esta portada
                  viene a sacar a la gente. */}
              <Link
                href={`/app/w/${t.espacioId}/board`}
                className="capa flex items-center gap-2.5 rounded-xl px-3 py-2 transition-[filter] duration-[var(--dur-hover)] hover:brightness-125"
              >
                {prioridad && (
                  <span
                    className={`shrink-0 rounded-full border px-1.5 py-0.5 font-display text-[9px]
                      font-semibold uppercase tracking-wider ${prioridad.clase}`}
                  >
                    {prioridad.texto}
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{t.title}</span>
                  {/* De dónde es, SIEMPRE. En una lista que cruza espacios,
                      una tarea sin su procedencia obliga a abrirla para saber
                      de qué cliente era. */}
                  <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-faint">
                    <span className="text-muted">{t.organizacion}</span>
                    <span>/</span>
                    <span className="text-muted">{t.espacio}</span>
                    <span>·</span>
                    <span>{t.columna}</span>
                    {t.area && (
                      <>
                        <span>·</span>
                        <span>{t.area}</span>
                      </>
                    )}
                  </span>
                </span>

                {t.tipo && (
                  <span
                    title={TIPO_EN_PALABRAS[t.tipo]}
                    className="hidden shrink-0 text-faint sm:block"
                  >
                    <IconoDeTipo tipo={t.tipo} size={12} />
                  </span>
                )}

                {dia && (
                  <span
                    className={`flex shrink-0 items-center gap-1 rounded-lg border px-1.5 py-0.5
                      font-mono text-[10px] tabular-nums
                      ${
                        vencida
                          ? "border-danger/40 bg-danger/10 text-danger"
                          : "border-line text-faint"
                      }`}
                  >
                    <CalendarClock size={10} />
                    {fechaCorta(dia, anio)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </Tarjeta>
  );
}

/* ========================================================================== */

function DondeEstaTuTrabajo({
  espacios,
}: {
  espacios: [string, { nombre: string; organizacion: string; cuantas: number }][];
}) {
  if (espacios.length === 0) return null;
  const mayor = Math.max(...espacios.map(([, e]) => e.cuantas));

  return (
    <Tarjeta className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <LayoutGrid size={14} className="text-accent" />
        <h2 className="text-sm font-semibold">Dónde está</h2>
      </div>

      {/* Esto es lo que convierte la portada en un sitio desde el que
          ORQUESTAR y no solo desde el que mirar: de un vistazo se ve dónde se
          está acumulando, y se salta ahí. */}
      <ul className="space-y-2">
        {espacios.map(([id, e]) => (
          <li key={id}>
            <Link href={`/app/w/${id}/board`} className="group block">
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-xs text-ink group-hover:text-accent">
                  {e.nombre}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
                  {e.cuantas}
                </span>
              </span>
              <span className="block truncate text-[10px] text-faint">{e.organizacion}</span>
              <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-raised">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${(e.cuantas / mayor) * 100}%` }}
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

/* ========================================================================== */

function LoQueHasHecho({
  resumen,
  dias,
  onDias,
}: {
  resumen: { verbo: string; origen: string; veces: number }[];
  dias: number;
  onDias: (d: number) => void;
}) {
  const cuenta = (verbo: string, agente: boolean) =>
    resumen
      .filter((r) => r.verbo === verbo && (r.origen === "agente") === agente)
      .reduce((s, r) => s + r.veces, 0);

  const conAsistente = resumen
    .filter((r) => r.origen === "agente")
    .reduce((s, r) => s + r.veces, 0);

  return (
    <Tarjeta className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <CheckCircle2 size={14} className="text-accent" />
        <h2 className="text-sm font-semibold">Lo que has hecho</h2>
      </div>

      <div className="mb-3 flex gap-1">
        {PERIODOS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onDias(p)}
            aria-pressed={dias === p}
            className={`presionable rounded-full border px-2 py-0.5 font-display text-[10px]
              font-semibold uppercase tracking-wider transition-colors
              ${
                dias === p
                  ? "border-accent/40 bg-accent-soft/60 text-accent"
                  : "border-line text-faint hover:text-muted"
              }`}
          >
            {p} días
          </button>
        ))}
      </div>

      {resumen.length === 0 ? (
        <p className="text-xs text-faint">
          Nada en este periodo. El registro empezó con la migración 0038: lo anterior no está.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {VERBOS.map(({ verbo, texto }) => {
            const propias = cuenta(verbo, false);
            if (propias === 0) return null;
            return (
              <li key={verbo} className="flex items-baseline gap-2 text-xs">
                <span className="font-mono tabular-nums text-ink">{propias}</span>
                <span className="text-muted">{texto}</span>
              </li>
            );
          })}
        </ul>
      )}

      {conAsistente > 0 && (
        <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
          <Bot size={11} className="mt-0.5 shrink-0" />
          <span>
            Otras <span className="text-muted">{conAsistente}</span> las hizo tu asistente. Van
            aparte: cuentan, pero no son lo mismo que lo que tecleaste.
          </span>
        </p>
      )}

      {/* La letra pequeña va en la pantalla y no solo en el código: estos
          números se leen sobre uno mismo, y saber qué dejan fuera es parte de
          poder interpretarlos. */}
      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        Son hechos del tablero, no trabajo. Revisar el código de otro o sacar a alguien de un
        atasco no pasa por ninguna tarjeta. No hay un total a propósito: cuánto vale cerrar
        frente a crear es una decisión que no está tomada.
      </p>
    </Tarjeta>
  );
}

/* ========================================================================== */

function LoUltimo({ hechos, dias }: { hechos: Hecho[]; dias: number }) {
  if (hechos.length === 0) return null;

  return (
    <Tarjeta className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <History size={14} className="text-accent" />
        <h2 className="text-sm font-semibold">En qué andabas</h2>
        <Rotulo className="ml-auto">últimos {dias} días</Rotulo>
      </div>

      <ul className="space-y-1.5">
        {hechos.map((h, i) => (
          <li key={`${h.ocurridoEn}-${i}`} className="flex items-baseline gap-2 text-xs">
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
              {h.ocurridoEn.slice(5, 10)}
            </span>
            <span className="min-w-0 flex-1">
              {/* El verbo en gris y el nombre en tinta: lo que se busca al
                  repasar es QUÉ cosa, no qué se le hizo. */}
              <span className="text-muted">{EN_CASTELLANO[h.verbo] ?? h.verbo}</span>{" "}
              <span className="text-ink">{h.sujetoNombre || "algo sin nombre"}</span>
              {h.espacio && <span className="ml-1.5 text-faint">· {h.espacio}</span>}
            </span>
            {h.origen === "agente" && (
              <Chip tono="accent">
                <Bot size={10} />
              </Chip>
            )}
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}
