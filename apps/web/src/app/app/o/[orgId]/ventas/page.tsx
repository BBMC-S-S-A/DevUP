"use client";

import { ArrowLeft, Loader2, Plus, Target, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

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

type Client = { id: string; name: string; contactEmail: string };
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

const STAGES: { id: Stage; label: string; accent: string }[] = [
  { id: "lead", label: "Contacto", accent: "var(--color-faint)" },
  { id: "qualified", label: "Cualificada", accent: "var(--color-accent)" },
  { id: "proposal", label: "Propuesta", accent: "var(--color-warn)" },
  { id: "won", label: "Ganada", accent: "var(--color-live)" },
  { id: "lost", label: "Perdida", accent: "var(--color-danger)" },
];

/** Céntimos a euros, sin decimales cuando son redondos. */
const money = (cents: number): string =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

export default function SalesPage() {
  const { orgId } = useParams<{ orgId: string }>();

  const [deals, setDeals] = useState<Opportunity[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [panel, setPanel] = useState<"deal" | "client" | "service" | "goal" | null>(null);

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
  const open = deals
    .filter((deal) => deal.stage !== "won" && deal.stage !== "lost")
    .reduce((sum, deal) => sum + deal.amountCents, 0);
  const won = totals.get("won")!.cents;

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="animate-spin text-faint" size={20} />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line px-6 py-4">
        <Link
          href="/app"
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-faint transition hover:text-muted"
        >
          <ArrowLeft size={13} />
          Workspaces
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Ventas</h1>
            <p className="mt-1 text-xs text-muted">
              <span className="text-ink">{money(open)}</span> en el embudo abierto ·{" "}
              <span className="text-live">{money(won)}</span> ganado
            </p>
          </div>
          <div className="flex gap-1.5">
            <Toolbar icon={<Target size={13} />} label="Objetivo" onClick={() => setPanel("goal")} />
            <Toolbar icon={<Users size={13} />} label="Clientes" onClick={() => setPanel("client")} />
            <Toolbar icon={<Wrench size={13} />} label="Servicios" onClick={() => setPanel("service")} />
            <button
              type="button"
              onClick={() => setPanel("deal")}
              disabled={clients.length === 0}
              title={clients.length === 0 ? "Primero hace falta un cliente" : undefined}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
            >
              <Plus size={13} />
              Nueva venta
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </header>

      {goals.length > 0 && (
        <div className="flex gap-3 overflow-x-auto border-b border-line px-6 py-4">
          {goals.map((goal) => {
            // Se acota al 100 % para pintar, pero el número de arriba no: pasar
            // del objetivo es una noticia y esconderla sería raro.
            const ratio = goal.targetCents > 0 ? goal.progressCents / goal.targetCents : 0;
            const done = ratio >= 1;
            return (
              <article
                key={goal.id}
                className="w-72 shrink-0 rounded-xl border border-line bg-surface p-3.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate text-xs font-semibold">{goal.name}</h3>
                  <span
                    className={`shrink-0 font-mono text-[11px] tabular-nums ${done ? "text-live" : "text-muted"}`}
                  >
                    {Math.round(ratio * 100)}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${done ? "bg-live" : "bg-accent"}`}
                    style={{ width: `${Math.min(100, ratio * 100)}%` }}
                  />
                </div>
                <p className="mt-2 font-mono text-[11px] tabular-nums text-ink">
                  {money(goal.progressCents)}{" "}
                  <span className="text-faint">de {money(goal.targetCents)}</span>
                </p>
                <p className="mt-0.5 text-[10px] text-faint">
                  {goal.dealCount === 0
                    ? "sin ventas cerradas todavía"
                    : `${goal.dealCount} venta${goal.dealCount === 1 ? "" : "s"} cerrada${goal.dealCount === 1 ? "" : "s"}`}
                  {" · hasta "}
                  {new Date(goal.endsOn).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                </p>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto p-6">
        {STAGES.map((stage) => {
          const total = totals.get(stage.id)!;
          return (
            <section
              key={stage.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData("text/plain") || dragging;
                if (id) void move(id, stage.id);
                setDragging(null);
              }}
              className="flex w-64 shrink-0 flex-col rounded-xl border border-line bg-surface"
            >
              <header className="border-b border-line px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: stage.accent }}
                    aria-hidden
                  />
                  <h2 className="text-xs font-semibold">{stage.label}</h2>
                  <span className="ml-auto text-[10px] text-faint">{total.count}</span>
                </div>
                <p className="mt-1 font-mono text-[11px] tabular-nums text-muted">
                  {money(total.cents)}
                </p>
              </header>

              <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                {deals
                  .filter((deal) => deal.stage === stage.id)
                  .map((deal) => (
                    <article
                      key={deal.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", deal.id);
                        setDragging(deal.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      className={`cursor-grab rounded-lg border border-line bg-raised p-2.5 transition active:cursor-grabbing ${
                        dragging === deal.id ? "opacity-40" : "hover:border-line-strong"
                      }`}
                    >
                      <p className="text-xs font-medium leading-snug">{deal.title}</p>
                      <p className="mt-1 truncate text-[11px] text-muted">{deal.clientName}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] tabular-nums text-ink">
                          {money(deal.amountCents)}
                        </span>
                        {deal.ownerName && (
                          <span className="truncate text-[10px] text-faint">{deal.ownerName}</span>
                        )}
                      </div>
                    </article>
                  ))}

                {total.count === 0 && (
                  <p className="px-1 py-3 text-center text-[11px] text-faint">
                    Arrastra una venta aquí
                  </p>
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
    </div>
  );
}

function Toolbar({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:text-ink"
    >
      {icon}
      {label}
    </button>
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
  kind: "deal" | "client" | "service" | "goal";
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
    client: "Nuevo cliente",
    service: "Nuevo servicio",
    goal: "Nuevo objetivo",
  } as const;

  const submit = async () => {
    setBusy(true);
    setFailed(null);
    try {
      if (kind === "client") {
        await api.post(`/organizations/${orgId}/clients`, { name, contactEmail: extra });
      } else if (kind === "goal") {
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
      await onDone();
    } catch {
      setFailed("no se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <h2 className="mb-4 text-sm font-semibold">{titles[kind]}</h2>

        <div className="space-y-3">
          {kind === "deal" && (
            <Field label="Cliente">
              <select
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-accent/60"
              >
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label={kind === "deal" ? "Qué se vende" : "Nombre"}>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={
                kind === "deal"
                  ? "Migración del backend"
                  : kind === "client"
                    ? "Nébula Studio"
                    : kind === "goal"
                      ? "Trimestre en curso"
                      : "Auditoría de infraestructura"
              }
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus:border-accent/60"
            />
          </Field>

          {kind === "client" && (
            <Field label="Correo de contacto">
              <input
                value={extra}
                onChange={(event) => setExtra(event.target.value)}
                placeholder="hola@cliente.com"
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus:border-accent/60"
              />
            </Field>
          )}

          {kind === "goal" && (
            <Field label="Objetivo del trimestre (€)">
              <input
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                inputMode="decimal"
                placeholder="50000"
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus:border-accent/60"
              />
            </Field>
          )}

          {kind === "service" && (
            <div className="flex gap-2">
              <Field label="Precio (€)">
                <input
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  inputMode="decimal"
                  placeholder="1500"
                  className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus:border-accent/60"
                />
              </Field>
              <Field label="Por">
                <input
                  value={extra}
                  onChange={(event) => setExtra(event.target.value)}
                  placeholder="jornada"
                  className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus:border-accent/60"
                />
              </Field>
            </div>
          )}

          {kind === "deal" && services.length > 0 && (
            <Field label="Servicios incluidos">
              <div className="flex flex-wrap gap-1">
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
                        className={`rounded-lg border px-2 py-1 text-[11px] transition ${
                          picked
                            ? "border-accent/50 bg-accent-soft text-accent"
                            : "border-line text-muted hover:text-ink"
                        }`}
                      >
                        {service.name} · {money(service.unitPriceCents)}
                      </button>
                    );
                  })}
              </div>
            </Field>
          )}
        </div>

        {failed && <p className="mt-3 text-xs text-danger">{failed}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:text-ink"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || name.trim().length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
