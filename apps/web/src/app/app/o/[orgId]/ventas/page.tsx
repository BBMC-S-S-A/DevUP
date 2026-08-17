"use client";

import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CalendarDays,
  Pencil,
  Plus,
  Target,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Entrada } from "@/components/ui/Field";
import { Chip, Dialogo, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { ApiError, api } from "@/lib/api";

/**
 * El embudo de ventas.
 *
 * Cinco columnas fijas y arrastrar para cambiar de etapa. Las etapas son un
 * enum de la base y no una tabla configurable: con etapas libres, «ganada»
 * dejaría de ser un valor y pasaría a ser una convención, y el objetivo
 * trimestral de la semana 5 —que avanza solo al cerrarse una venta— no
 * tendría de dónde colgarse.
 *
 * Los importes llegan en céntimos enteros y solo se dividen para pintarlos.
 * Convertirlos antes es cómo se acaba con una suma que no cuadra por un
 * céntimo.
 *
 * Visualmente es la pantalla más densa de la aplicación, así que el color se
 * raciona: cada etapa tiene el suyo y solo lo gasta en el filo superior de su
 * columna y en el lavado de su cabecera. El halo del acento queda reservado
 * para la única cosa que pasa «ahora mismo» aquí — la columna sobre la que se
 * está soltando una tarjeta.
 */

type Stage = "lead" | "qualified" | "proposal" | "won" | "lost";

type Opportunity = {
  id: string;
  title: string;
  stage: Stage;
  clientId: string;
  clientName: string;
  ownerName: string | null;
  amountCents: number;
  expectedClose: string | null;
  closedAt: string | null;
};

type Client = {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
  notes: string;
};
type OpportunityItem = {
  id: string;
  serviceId: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
};
type Goal = {
  id: string;
  name: string;
  targetCents: number;
  progressCents: number;
  dealCount: number;
  startsOn: string;
  endsOn: string;
};
type Service = { id: string; name: string; unitPriceCents: number; unit: string; active: boolean };

/**
 * Las cinco etapas con su color, en triplete crudo.
 *
 * Sin envolver en `rgb()` porque casi todos los usos piden alfa —el lavado de
 * la cabecera, el resplandor del filo, el estado de arrastre— y a un
 * `var(--color-*)` no se le puede poner alfa sin `color-mix`.
 *
 * El color del rótulo se guarda aparte: el gris de «contacto» funciona como
 * filo de 2 px pero se queda corto de contraste como texto, y una etiqueta que
 * hay que adivinar no es una etiqueta.
 */
const STAGES: {
  id: Stage;
  label: string;
  rgb: string;
  rgbTexto: string;
  tono: "neutro" | "accent" | "live" | "warn" | "danger";
}[] = [
  { id: "lead", label: "Contacto", rgb: "91 102 120", rgbTexto: "141 153 174", tono: "neutro" },
  { id: "qualified", label: "Cualificada", rgb: "91 140 255", rgbTexto: "91 140 255", tono: "accent" },
  { id: "proposal", label: "Propuesta", rgb: "245 181 63", rgbTexto: "245 181 63", tono: "warn" },
  { id: "won", label: "Ganada", rgb: "52 211 153", rgbTexto: "52 211 153", tono: "live" },
  { id: "lost", label: "Perdida", rgb: "251 113 133", rgbTexto: "251 113 133", tono: "danger" },
];

/** Céntimos a euros, sin decimales cuando son redondos. */
const money = (cents: number): string =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

const fecha = (iso: string): string =>
  new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });

/**
 * Escalón de entrada de una lista. El índice va topado a propósito: en un
 * embudo con cuarenta tarjetas, sin tope la última entraría dos segundos tarde
 * y el escalonado dejaría de leerse como una secuencia para leerse como una
 * pantalla que carga mal.
 */
const retraso = (indice: number, paso = 55): React.CSSProperties =>
  ({ "--retraso": `${Math.min(indice, 8) * paso}ms` }) as React.CSSProperties;

export default function SalesPage() {
  const { orgId } = useParams<{ orgId: string }>();

  const [deals, setDeals] = useState<Opportunity[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // Solo pinta: qué columna es ahora mismo el destino del arrastre.
  const [sobreEtapa, setSobreEtapa] = useState<Stage | null>(null);
  const [panel, setPanel] = useState<"deal" | "service" | "goal" | null>(null);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Opportunity | null>(null);

  const load = useCallback(async () => {
    try {
      const [pipeline, clientList, serviceList, goalList] = await Promise.all([
        api.get<{ opportunities: Opportunity[] }>(`/organizations/${orgId}/pipeline`),
        api.get<{ clients: Client[] }>(`/organizations/${orgId}/clients`),
        api.get<{ services: Service[] }>(`/organizations/${orgId}/services`),
        api.get<{ goals: Goal[] }>(`/organizations/${orgId}/goals`),
      ]);
      setDeals(pipeline.opportunities);
      setClients(clientList.clients);
      setServices(serviceList.services);
      setGoals(goalList.goals);
    } catch {
      setError("no se pudo cargar el embudo");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Mover una venta de etapa.
   *
   * Se pinta el cambio antes de que responda el servidor y se revierte si
   * falla. Esperar la respuesta para mover la tarjeta hace que arrastrar se
   * sienta pegajoso, y aquí el fallo es raro: es un UPDATE de una columna.
   */
  const move = useCallback(
    async (dealId: string, stage: Stage) => {
      const previous = deals;
      setDeals((current) =>
        current.map((deal) => (deal.id === dealId ? { ...deal, stage } : deal)),
      );
      try {
        await api.patch(`/opportunities/${dealId}`, { stage });
        // Se recarga porque la fecha de cierre la pone un disparador de la
        // base: el cliente no la puede adivinar.
        await load();
      } catch {
        setDeals(previous);
        setError("no se pudo mover la venta");
      }
    },
    [deals, load],
  );

  const totals = useMemo(() => {
    const byStage = new Map<Stage, { count: number; cents: number }>();
    for (const stage of STAGES) byStage.set(stage.id, { count: 0, cents: 0 });
    for (const deal of deals) {
      const entry = byStage.get(deal.stage)!;
      entry.count += 1;
      entry.cents += deal.amountCents;
    }
    return byStage;
  }, [deals]);

  // El embudo abierto: lo que sigue vivo. Ganado y perdido no son previsión.
  const openDeals = deals.filter((deal) => deal.stage !== "won" && deal.stage !== "lost");
  const open = openDeals.reduce((sum, deal) => sum + deal.amountCents, 0);
  const won = totals.get("won")!.cents;
  const wonCount = totals.get("won")!.count;

  if (loading) return <EsqueletoEmbudo />;

  return (
    <div className="min-h-screen">
      {/* La cabecera es el tablero de instrumentos: rejilla de fondo, filo de
          luz en vez de borde duro y las dos cifras que resumen la pantalla. */}
      <header className="filo-luz relative px-6 pb-5 pt-4">
        <div aria-hidden className="rejilla pointer-events-none absolute inset-0" />

        <div className="relative">
          <Link
            href="/app"
            className="presionable inline-flex items-center gap-1.5 text-xs text-faint hover:text-muted"
          >
            <ArrowLeft size={13} />
            Workspaces
          </Link>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div className="flex flex-wrap items-end gap-x-7 gap-y-4">
              <div>
                <h1 className="text-lg font-semibold">Ventas</h1>
                <Rotulo className="mt-1.5 block">Embudo comercial</Rotulo>
              </div>

              <span aria-hidden className="hidden h-11 w-px bg-line sm:block" />

              <Lectura
                rotulo="Embudo abierto"
                valor={money(open)}
                plasma
                nota={`${openDeals.length} ${openDeals.length === 1 ? "operación viva" : "operaciones vivas"}`}
              />

              <span aria-hidden className="hidden h-11 w-px bg-line sm:block" />

              <Lectura
                rotulo="Ganado"
                valor={money(won)}
                tono="text-live"
                nota={`${wonCount} ${wonCount === 1 ? "cierre" : "cierres"}`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Boton tamano="sm" icono={<Target size={13} />} onClick={() => setPanel("goal")}>
                Objetivo
              </Boton>
              <Boton tamano="sm" icono={<Users size={13} />} onClick={() => setClientsOpen(true)}>
                Clientes
              </Boton>
              <Boton tamano="sm" icono={<Wrench size={13} />} onClick={() => setPanel("service")}>
                Servicios
              </Boton>
              {/* El título va en la envoltura y no en el botón: un botón
                  deshabilitado no recibe eventos de puntero, y el motivo por el
                  que está apagado es justo lo que hay que poder leer. */}
              <span
                className="inline-flex"
                title={clients.length === 0 ? "Primero hace falta un cliente" : undefined}
              >
                <Boton
                  tamano="sm"
                  variante="primario"
                  icono={<Plus size={13} />}
                  onClick={() => setPanel("deal")}
                  disabled={clients.length === 0}
                >
                  Nueva venta
                </Boton>
              </span>
            </div>
          </div>

          {error && <Aviso>{error}</Aviso>}
        </div>
      </header>

      {goals.length > 0 && (
        <section className="border-b border-line px-6 py-4">
          <div className="mb-2.5 flex items-center gap-1.5">
            <Target size={11} className="text-faint" />
            <Rotulo>Objetivos</Rotulo>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-1">
            {goals.map((goal, index) => {
              // Se acota al 100 % para pintar, pero el número de arriba no: pasar
              // del objetivo es una noticia y esconderla sería raro.
              const ratio = goal.targetCents > 0 ? goal.progressCents / goal.targetCents : 0;
              const done = ratio >= 1;
              return (
                <Tarjeta
                  key={goal.id}
                  className="devup-entrada w-72 shrink-0 p-4"
                  style={retraso(index, 45)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-xs font-semibold">{goal.name}</h3>
                      <p className="mt-1 flex items-center gap-1 text-[10px] text-faint">
                        <CalendarDays size={10} />
                        hasta {fecha(goal.endsOn)}
                      </p>
                    </div>
                    {/* Cumplido pasa a verde: el degradado del acento es la
                        lectura normal, y el semántico gana cuando hay noticia. */}
                    <span
                      className={`shrink-0 font-mono text-2xl font-semibold leading-none tabular-nums ${
                        done ? "text-live" : "texto-plasma"
                      }`}
                    >
                      {Math.round(ratio * 100)}
                      <span className="text-sm">%</span>
                    </span>
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-full border border-line bg-canvas">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ${
                        done ? "from-live to-cyan" : "from-accent to-cyan"
                      }`}
                      style={{
                        width: `${Math.min(100, ratio * 100)}%`,
                        transitionTimingFunction: "var(--ease-out)",
                      }}
                    />
                  </div>

                  <p className="mt-2.5 font-mono text-xs tabular-nums text-ink">
                    {money(goal.progressCents)}{" "}
                    <span className="text-faint">de {money(goal.targetCents)}</span>
                  </p>
                  <p className="mt-1 text-[10px] text-faint">
                    {goal.dealCount === 0
                      ? "sin ventas cerradas todavía"
                      : `${goal.dealCount} venta${goal.dealCount === 1 ? "" : "s"} cerrada${goal.dealCount === 1 ? "" : "s"}`}
                  </p>
                </Tarjeta>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex gap-3 overflow-x-auto px-6 pb-10 pt-5">
        {STAGES.map((stage, index) => {
          const total = totals.get(stage.id)!;
          const activa = sobreEtapa === stage.id;
          return (
            <section
              key={stage.id}
              onDragOver={(event) => {
                event.preventDefault();
                // `dragover` y no `dragenter`: se dispara sin parar mientras el
                // puntero está encima, así que pasar de una tarjeta a otra
                // dentro de la misma columna no apaga el resaltado ni un frame.
                setSobreEtapa(stage.id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setSobreEtapa(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                setSobreEtapa(null);
                const id = event.dataTransfer.getData("text/plain") || dragging;
                if (id) void move(id, stage.id);
                setDragging(null);
              }}
              style={retraso(index, 50)}
              className={`panel devup-entrada relative flex w-64 shrink-0 flex-col overflow-hidden rounded-2xl
                transition-[box-shadow,border-color] duration-200 ${activa ? "panel-vivo" : ""}`}
            >
              {/* El filo de la etapa. Es lo que identifica la columna de un
                  vistazo cuando hay cinco en fila y el ojo va rápido. */}
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 z-10 h-[2px]"
                style={{
                  background: `linear-gradient(90deg, rgb(${stage.rgb}), rgb(${stage.rgb} / 0.12))`,
                  boxShadow: `0 0 14px -2px rgb(${stage.rgb} / 0.55)`,
                }}
              />

              <header
                className="relative border-b border-line px-3 pb-2.5 pt-3"
                style={{ background: `linear-gradient(180deg, rgb(${stage.rgb} / 0.08), transparent)` }}
              >
                <div className="flex items-center gap-2">
                  <h2
                    className="text-[11px] font-semibold uppercase tracking-[0.16em]"
                    style={{ color: `rgb(${stage.rgbTexto})` }}
                  >
                    {stage.label}
                  </h2>
                  <span className="ml-auto font-mono text-[11px] tabular-nums text-faint">
                    {total.count}
                  </span>
                </div>
                <p className="mt-1.5 font-mono text-sm font-medium tabular-nums text-ink">
                  {money(total.cents)}
                </p>
              </header>

              <div className="flex min-h-28 flex-1 flex-col gap-2 p-2">
                {deals
                  .filter((deal) => deal.stage === stage.id)
                  .map((deal) => (
                    <article
                      key={deal.id}
                      draggable
                      role="button"
                      tabIndex={0}
                      aria-label={`${deal.title} — ${deal.clientName}, ${money(deal.amountCents)}`}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", deal.id);
                        setDragging(deal.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setSobreEtapa(null);
                      }}
                      onClick={() => setSelectedDeal(deal)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedDeal(deal);
                        }
                      }}
                      // `elevable` y no `presionable`: hundir la tarjeta al bajar
                      // el dedo pelea con la imagen fantasma del arrastre, que
                      // se captura en ese mismo instante.
                      className={`elevable cursor-grab rounded-xl border border-line bg-raised p-2.5
                        hover:border-line-strong hover:bg-elevated active:cursor-grabbing
                        ${dragging === deal.id ? "opacity-40" : ""}`}
                    >
                      <p className="text-xs font-medium leading-snug">{deal.title}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted">{deal.clientName}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-medium tabular-nums text-ink">
                          {money(deal.amountCents)}
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {deal.expectedClose && (
                            <span className="font-mono text-[10px] tabular-nums text-faint">
                              {fecha(deal.expectedClose)}
                            </span>
                          )}
                          {deal.ownerName && <Inicial nombre={deal.ownerName} />}
                        </div>
                      </div>
                    </article>
                  ))}

                {total.count === 0 && (
                  <div
                    className={`grid flex-1 place-items-center rounded-xl border border-dashed px-2 py-6
                      text-center text-[10px] uppercase tracking-[0.14em] transition-colors duration-200 ${
                        dragging
                          ? "border-accent/50 bg-accent-soft/40 text-accent"
                          : "border-line text-faint"
                      }`}
                  >
                    <span className="font-display">Arrastra una venta aquí</span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {panel && (
        <NewThing
          kind={panel}
          orgId={orgId}
          clients={clients}
          services={services}
          onClose={() => setPanel(null)}
          onDone={async () => {
            setPanel(null);
            await load();
          }}
        />
      )}

      {clientsOpen && (
        <ClientsPanel orgId={orgId} clients={clients} onClose={() => setClientsOpen(false)} onChanged={load} />
      )}

      {selectedDeal && (
        <DealDetail
          deal={selectedDeal}
          services={services}
          onClose={() => setSelectedDeal(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Piezas del tablero
 * -------------------------------------------------------------------------- */

/**
 * Una lectura de instrumento: rótulo pequeño, cifra grande en mono y una nota
 * de contexto debajo. La cifra siempre en `tabular-nums` porque estas dos
 * cambian al mover una venta, y sin cifras de ancho fijo el número entero
 * baila al recalcularse.
 */
function Lectura({
  rotulo,
  valor,
  nota,
  plasma = false,
  tono = "text-ink",
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  plasma?: boolean;
  tono?: string;
}) {
  return (
    <div className="min-w-0">
      <Rotulo className="block">{rotulo}</Rotulo>
      <p
        className={`mt-1.5 font-mono text-2xl font-semibold leading-none tabular-nums ${
          plasma ? "texto-plasma" : tono
        }`}
      >
        {valor}
      </p>
      {nota && <p className="mt-1.5 text-[11px] text-muted">{nota}</p>}
    </div>
  );
}

/** Aviso en línea. Rojo con cuerpo, no un párrafo suelto que se pierde. */
function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 inline-flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs text-danger">
      <AlertCircle size={13} className="shrink-0" />
      {children}
    </p>
  );
}

/**
 * La inicial de quien lleva la venta. Un disco de 20 px ocupa lo que tres
 * letras y no le disputa el sitio al importe, que es lo que se viene a leer en
 * esta tarjeta.
 */
function Inicial({ nombre }: { nombre: string }) {
  return (
    <span title={nombre} className="shrink-0">
      <span
        aria-hidden
        className="grid size-5 place-items-center rounded-full border border-line-strong bg-elevated font-display text-[9px] font-semibold uppercase text-muted"
      >
        {nombre.trim().charAt(0) || "?"}
      </span>
      <span className="sr-only">{nombre}</span>
    </span>
  );
}

/**
 * Esqueleto de carga. Dibuja ya la geometría real —cinco columnas, cabecera de
 * instrumentos— para que al llegar los datos nada salte de sitio: un giro
 * centrado en pantalla vacía no dice cuánto va a ocupar lo que viene.
 */
function EsqueletoEmbudo() {
  return (
    <div className="min-h-screen" aria-busy="true">
      <header className="filo-luz relative px-6 pb-5 pt-4">
        <div aria-hidden className="rejilla pointer-events-none absolute inset-0" />
        <div className="relative">
          <div className="devup-esqueleto h-3 w-24 rounded" />
          <div className="mt-4 flex flex-wrap items-end gap-7">
            <div className="devup-esqueleto h-9 w-28 rounded-lg" />
            <div className="devup-esqueleto h-9 w-36 rounded-lg" />
            <div className="devup-esqueleto h-9 w-32 rounded-lg" />
          </div>
        </div>
      </header>

      <div className="flex gap-3 overflow-hidden px-6 pb-10 pt-5">
        {STAGES.map((stage, index) => (
          <div
            key={stage.id}
            className="panel devup-entrada w-64 shrink-0 rounded-2xl p-3"
            style={retraso(index, 50)}
          >
            <div className="devup-esqueleto h-3 w-20 rounded" />
            <div className="devup-esqueleto mt-2 h-4 w-24 rounded" />
            <div className="mt-4 space-y-2">
              <div className="devup-esqueleto h-16 rounded-xl" />
              <div className="devup-esqueleto h-16 rounded-xl" />
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only">Cargando el embudo…</span>
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Diálogos
 * -------------------------------------------------------------------------- */

/**
 * Clientes: listar, renombrar sus datos de contacto, borrar, o dar de alta
 * uno nuevo. Antes de esto, el botón «Clientes» solo abría el alta — no
 * había forma de ver ni de corregir uno que ya existiera.
 */
function ClientsPanel({
  orgId,
  clients,
  onClose,
  onChanged,
}: {
  orgId: string;
  clients: Client[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Dialogo
      titulo="Clientes"
      descripcion={clients.length === 1 ? "1 cliente" : `${clients.length} clientes`}
      onCerrar={onClose}
      ancho="lg"
    >
      <div className="space-y-2">
        {clients.map((client, index) =>
          editing === client.id ? (
            <ClientForm
              key={client.id}
              initial={client}
              onCancel={() => setEditing(null)}
              onSave={async (values) => {
                try {
                  await api.patch(`/clients/${client.id}`, values);
                  toast.success("Cliente actualizado");
                  setEditing(null);
                  await onChanged();
                } catch (caught) {
                  toast.error(caught instanceof ApiError ? caught.message : "no se pudo guardar");
                }
              }}
            />
          ) : (
            <div
              key={client.id}
              style={retraso(index, 35)}
              className="devup-entrada flex items-start justify-between gap-3 rounded-xl border border-line
                bg-canvas/50 px-3.5 py-2.5 transition-colors duration-200 hover:border-line-strong"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{client.name}</p>
                {(client.contactName || client.contactEmail) && (
                  <p className="truncate text-xs text-faint">
                    {[client.contactName, client.contactEmail].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <BotonIcono etiqueta={`Editar ${client.name}`} onClick={() => setEditing(client.id)}>
                  <Pencil size={13} />
                </BotonIcono>
                <BotonIcono
                  etiqueta={`Borrar ${client.name}`}
                  className="hover:text-danger"
                  onClick={async () => {
                    if (!confirm(`¿Borrar «${client.name}»?`)) return;
                    try {
                      await api.delete(`/clients/${client.id}`);
                      toast.success("Cliente borrado");
                      await onChanged();
                    } catch (caught) {
                      toast.error(
                        caught instanceof ApiError
                          ? caught.message
                          : "no se pudo borrar — hace falta administrar la organización",
                      );
                    }
                  }}
                >
                  <Trash2 size={13} />
                </BotonIcono>
              </div>
            </div>
          ),
        )}

        {adding ? (
          <ClientForm
            onCancel={() => setAdding(false)}
            onSave={async (values) => {
              try {
                await api.post(`/organizations/${orgId}/clients`, values);
                toast.success(`Cliente «${values.name}» creado`);
                setAdding(false);
                await onChanged();
              } catch (caught) {
                toast.error(caught instanceof ApiError ? caught.message : "no se pudo crear");
              }
            }}
          />
        ) : clients.length === 0 ? (
          <EstadoVacio
            icono={<Building2 size={20} />}
            titulo="Sin clientes todavía"
            pista="Toda venta cuelga de un cliente, así que este es el primer eslabón del embudo."
            accion={
              <Boton
                tamano="sm"
                variante="primario"
                icono={<Plus size={13} />}
                onClick={() => setAdding(true)}
              >
                Nuevo cliente
              </Boton>
            }
          />
        ) : (
          <BotonPunteado onClick={() => setAdding(true)}>Nuevo cliente</BotonPunteado>
        )}
      </div>
    </Dialogo>
  );
}

function ClientForm({
  initial,
  onCancel,
  onSave,
}: {
  initial?: Client;
  onCancel: () => void;
  onSave: (values: {
    name: string;
    contactName: string;
    contactEmail: string;
    notes: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [contactName, setContactName] = useState(initial?.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <div className="devup-emerge origin-top space-y-2 rounded-xl border border-accent/40 bg-accent-soft/25 p-3">
      <Entrada
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Nombre del cliente"
      />
      <div className="flex gap-2">
        <Entrada
          value={contactName}
          onChange={(event) => setContactName(event.target.value)}
          placeholder="Persona de contacto"
        />
        <Entrada
          value={contactEmail}
          onChange={(event) => setContactEmail(event.target.value)}
          placeholder="Correo"
        />
      </div>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Notas"
        rows={2}
        className="w-full resize-none rounded-xl border border-line bg-canvas/60 px-3.5 py-2.5 text-sm outline-none
          transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-faint
          hover:border-line-strong focus:border-accent/60 focus:bg-canvas
          focus:shadow-[0_0_0_3px_rgb(91_140_255/0.14)]"
      />
      <div className="flex justify-end gap-1.5">
        <Boton tamano="sm" variante="fantasma" onClick={onCancel}>
          Cancelar
        </Boton>
        <Boton
          tamano="sm"
          variante="primario"
          cargando={busy}
          disabled={name.trim().length === 0}
          onClick={async () => {
            setBusy(true);
            await onSave({ name, contactName, contactEmail, notes });
            setBusy(false);
          }}
        >
          Guardar
        </Boton>
      </div>
    </div>
  );
}

/**
 * Detalle de una venta: su desglose, editable. Antes de esto las líneas se
 * añadían solo al crear la venta y no se podían corregir después — había que
 * borrar la línea entera y añadir otra, perdiendo el orden.
 */
function DealDetail({
  deal,
  services,
  onClose,
  onChanged,
}: {
  deal: Opportunity;
  services: Service[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [items, setItems] = useState<OpportunityItem[] | null>(null);
  const [addingService, setAddingService] = useState(false);

  const load = useCallback(async () => {
    const { items } = await api.get<{ items: OpportunityItem[] }>(`/opportunities/${deal.id}/items`);
    setItems(items);
  }, [deal.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = (items ?? []).reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);

  const patchItem = async (itemId: string, values: Partial<Pick<OpportunityItem, "quantity" | "unitPriceCents">>) => {
    try {
      await api.patch(`/opportunity-items/${itemId}`, values);
      await load();
      await onChanged();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "no se pudo guardar la línea");
    }
  };

  const etapa = STAGES.find((stage) => stage.id === deal.stage)!;

  return (
    <Dialogo titulo={deal.title} descripcion={deal.clientName} onCerrar={onClose} ancho="lg">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Chip tono={etapa.tono}>{etapa.label}</Chip>
        {deal.ownerName && <span className="text-[11px] text-muted">{deal.ownerName}</span>}
        {deal.expectedClose && (
          <span className="ml-auto font-mono text-[11px] tabular-nums text-faint">
            cierre previsto {fecha(deal.expectedClose)}
          </span>
        )}
      </div>

      <Rotulo className="mb-2 block">Líneas de la cotización</Rotulo>

      <div className="space-y-2">
        {items === null && (
          <>
            <div className="devup-esqueleto h-20 rounded-xl" />
            <div className="devup-esqueleto h-20 rounded-xl" />
          </>
        )}

        {items?.length === 0 && (
          <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-faint">
            Sin líneas todavía.
          </p>
        )}

        {items?.map((item, index) => (
          <div
            key={item.id}
            style={retraso(index, 35)}
            className="devup-entrada rounded-xl border border-line bg-canvas/50 px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
              {/* El subtotal es la cifra que se revisa al leer la cotización;
                  cantidad y precio son los mandos que la mueven. */}
              <span className="shrink-0 font-mono text-sm font-medium tabular-nums text-ink">
                {money(item.unitPriceCents * item.quantity)}
              </span>
              <BotonIcono
                etiqueta={`Quitar ${item.name}`}
                className="hover:text-danger"
                onClick={async () => {
                  try {
                    await api.delete(`/opportunity-items/${item.id}`);
                    await load();
                    await onChanged();
                  } catch (caught) {
                    toast.error(caught instanceof ApiError ? caught.message : "no se pudo quitar la línea");
                  }
                }}
              >
                <Trash2 size={13} />
              </BotonIcono>
            </div>

            {/* Los dos mandos se guardan al perder el foco y no en cada tecla:
                escribir «15» dispararía primero un guardado de «1». */}
            <div className="mt-2.5 flex items-end gap-2">
              <label className="min-w-0 flex-1">
                <Rotulo className="mb-1 block">Cantidad</Rotulo>
                <input
                  type="number"
                  min={0.01}
                  step="any"
                  defaultValue={item.quantity}
                  onBlur={(event) => {
                    const value = Number(event.target.value);
                    if (value > 0 && value !== item.quantity) void patchItem(item.id, { quantity: value });
                  }}
                  className={CONTROL_NUMERICO}
                />
              </label>
              <span aria-hidden className="pb-2 text-xs text-faint">
                ×
              </span>
              <label className="min-w-0 flex-1">
                <Rotulo className="mb-1 block">Precio unitario (€)</Rotulo>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={(item.unitPriceCents / 100).toFixed(2)}
                  onBlur={(event) => {
                    const cents = Math.round(Number(event.target.value) * 100);
                    if (cents >= 0 && cents !== item.unitPriceCents) void patchItem(item.id, { unitPriceCents: cents });
                  }}
                  className={CONTROL_NUMERICO}
                />
              </label>
            </div>
          </div>
        ))}

        {addingService ? (
          <div className="devup-emerge origin-top rounded-xl border border-accent/40 bg-accent-soft/25 p-3">
            <Rotulo className="mb-2 block">Del catálogo</Rotulo>
            <div className="flex flex-wrap gap-1.5">
              {services
                .filter((service) => service.active)
                .map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    onClick={async () => {
                      try {
                        await api.post(`/opportunities/${deal.id}/items`, { serviceId: service.id, quantity: 1 });
                        setAddingService(false);
                        await load();
                        await onChanged();
                      } catch (caught) {
                        toast.error(caught instanceof ApiError ? caught.message : "no se pudo añadir la línea");
                      }
                    }}
                    className="presionable rounded-lg border border-line bg-raised/60 px-2.5 py-1.5 text-[11px] text-muted
                      hover:border-accent/50 hover:text-ink"
                  >
                    {service.name}{" "}
                    <span className="font-mono tabular-nums text-faint">
                      {money(service.unitPriceCents)}
                    </span>
                  </button>
                ))}
              {services.length === 0 && (
                <p className="text-[11px] text-faint">No hay servicios en el catálogo todavía.</p>
              )}
            </div>
          </div>
        ) : (
          <BotonPunteado onClick={() => setAddingService(true)}>Añadir línea</BotonPunteado>
        )}
      </div>

      <div className="mt-5 flex items-end justify-between gap-3 border-t border-line pt-3">
        <Rotulo>Total de la cotización</Rotulo>
        <span className="texto-plasma font-mono text-xl font-semibold leading-none tabular-nums">
          {money(total)}
        </span>
      </div>
    </Dialogo>
  );
}

/**
 * Alta de cliente, servicio o venta.
 *
 * Un solo diálogo para los tres: los campos cambian pero el ciclo —abrir,
 * validar, guardar, recargar— es idéntico, y tres componentes con el mismo
 * ciclo se desincronizan en cuanto uno gana un estado de error y los otros no.
 */
function NewThing({
  kind,
  orgId,
  clients,
  services,
  onClose,
  onDone,
}: {
  kind: "deal" | "service" | "goal";
  orgId: string;
  clients: Client[];
  services: Service[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [extra, setExtra] = useState("");
  const [price, setPrice] = useState("");
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const titles = {
    deal: "Nueva venta",
    service: "Nuevo servicio",
    goal: "Nuevo objetivo",
  } as const;

  // Cada alta tiene una regla que no se ve en sus campos. Decirla aquí evita
  // que se descubra después, mirando un objetivo que abarca un trimestre que
  // nadie eligió.
  const pistas = {
    deal: "Cuelga de un cliente. Las líneas se pueden ajustar luego desde el detalle.",
    service: "Entra en el catálogo y se puede reutilizar en cualquier cotización.",
    goal: "Se fija sobre el trimestre natural en curso.",
  } as const;

  const submit = async () => {
    setBusy(true);
    setFailed(null);
    try {
      if (kind === "goal") {
        const cents = Math.round(Number(price.replace(",", ".")) * 100) || 0;
        // Por defecto, el trimestre natural en curso. Es el caso común y evita
        // dos selectores de fecha en el camino más habitual.
        const now = new Date();
        const quarter = Math.floor(now.getMonth() / 3);
        const startsOn = new Date(Date.UTC(now.getFullYear(), quarter * 3, 1));
        const endsOn = new Date(Date.UTC(now.getFullYear(), quarter * 3 + 3, 0));
        await api.post(`/organizations/${orgId}/goals`, {
          name,
          targetCents: cents,
          startsOn: startsOn.toISOString().slice(0, 10),
          endsOn: endsOn.toISOString().slice(0, 10),
        });
      } else if (kind === "service") {
        // El precio se escribe en euros y se manda en céntimos. Redondear aquí
        // y una sola vez evita que un 1500,005 llegue a la base.
        const cents = Math.round(Number(price.replace(",", ".")) * 100) || 0;
        await api.post(`/organizations/${orgId}/services`, {
          name,
          unitPriceCents: cents,
          unit: extra || "unidad",
        });
      } else {
        const { opportunity } = await api.post<{ opportunity: { id: string } }>(
          `/organizations/${orgId}/opportunities`,
          { clientId, title: name },
        );
        // Las líneas se añaden en serie y no en paralelo: el orden en que
        // aparecen en la cotización es el orden en que se eligieron, y con
        // Promise.all se barajan.
        for (const serviceId of serviceIds) {
          await api.post(`/opportunities/${opportunity.id}/items`, { serviceId, quantity: 1 });
        }
      }
      toast.success(`${titles[kind]} — hecho`);
      await onDone();
    } catch {
      setFailed("no se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialogo titulo={titles[kind]} descripcion={pistas[kind]} onCerrar={onClose} ancho="md">
      <div className="space-y-3">
        {kind === "deal" && (
          <Campo label="Cliente">
            <select
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-canvas/60 px-3 text-sm outline-none
                transition-[border-color,box-shadow,background-color] duration-200
                hover:border-line-strong focus:border-accent/60 focus:bg-canvas
                focus:shadow-[0_0_0_3px_rgb(91_140_255/0.14)]"
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </Campo>
        )}

        <Campo label={kind === "deal" ? "Qué se vende" : "Nombre"}>
          <Entrada
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={
              kind === "deal"
                ? "Migración del backend"
                : kind === "goal"
                  ? "Trimestre en curso"
                  : "Auditoría de infraestructura"
            }
          />
        </Campo>

        {kind === "goal" && (
          <Campo label="Objetivo del trimestre (€)">
            <Entrada
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="decimal"
              placeholder="50000"
              className="font-mono tabular-nums"
            />
          </Campo>
        )}

        {kind === "service" && (
          <div className="flex gap-2">
            <Campo label="Precio (€)">
              <Entrada
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                inputMode="decimal"
                placeholder="1500"
                className="font-mono tabular-nums"
              />
            </Campo>
            <Campo label="Por">
              <Entrada
                value={extra}
                onChange={(event) => setExtra(event.target.value)}
                placeholder="jornada"
              />
            </Campo>
          </div>
        )}

        {/* Un <div> y no un <label> como el resto de campos: un label que
            envuelve botones se asocia al primero de ellos y el clic acaba
            llegando dos veces. */}
        {kind === "deal" && services.length > 0 && (
          <div>
            <Rotulo className="mb-1.5 block">Servicios incluidos</Rotulo>
            <div className="flex flex-wrap gap-1.5">
              {services
                .filter((service) => service.active)
                .map((service) => {
                  const picked = serviceIds.includes(service.id);
                  return (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() =>
                        setServiceIds((current) =>
                          picked
                            ? current.filter((id) => id !== service.id)
                            : [...current, service.id],
                        )
                      }
                      aria-pressed={picked}
                      className={`presionable rounded-lg border px-2.5 py-1.5 text-[11px] ${
                        picked
                          ? "border-accent/50 bg-accent-soft text-accent"
                          : "border-line bg-raised/60 text-muted hover:border-line-strong hover:text-ink"
                      }`}
                    >
                      {service.name}{" "}
                      <span className={`font-mono tabular-nums ${picked ? "" : "text-faint"}`}>
                        {money(service.unitPriceCents)}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {failed && <Aviso>{failed}</Aviso>}

      <div className="mt-5 flex justify-end gap-2">
        <Boton tamano="sm" variante="fantasma" onClick={onClose}>
          Cancelar
        </Boton>
        <Boton
          tamano="sm"
          variante="primario"
          onClick={() => void submit()}
          cargando={busy}
          disabled={name.trim().length === 0}
        >
          Crear
        </Boton>
      </div>
    </Dialogo>
  );
}

/* -----------------------------------------------------------------------------
 * Controles compartidos de los diálogos
 * -------------------------------------------------------------------------- */

/** Rótulo de instrumento sobre su control. */
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 flex-1">
      <Rotulo className="mb-1.5 block">{label}</Rotulo>
      {children}
    </label>
  );
}

/**
 * El «añadir otro» de una lista. Punteado y no relleno porque no es una acción
 * al mismo nivel que guardar: es el hueco siguiente de la lista, dibujado.
 */
function BotonPunteado({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="presionable flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed
        border-line px-3.5 py-2.5 text-xs text-faint hover:border-accent/40 hover:bg-accent-soft/20 hover:text-accent"
    >
      <Plus size={13} />
      {children}
    </button>
  );
}

/** Los mandos numéricos del desglose: alineados a la derecha y en mono, que es
 *  como se comparan dos importes de un vistazo. */
const CONTROL_NUMERICO =
  "h-9 w-full rounded-lg border border-line bg-canvas/60 px-2.5 text-right font-mono text-xs tabular-nums " +
  "outline-none transition-[border-color,box-shadow,background-color] duration-200 " +
  "hover:border-line-strong focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_rgb(91_140_255/0.14)]";
