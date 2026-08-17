"use client";

import { ArrowLeft, Loader2, Pencil, Plus, Target, Trash2, Users, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
            <Toolbar icon={<Users size={13} />} label="Clientes" onClick={() => setClientsOpen(true)} />
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
                      onClick={() => setSelectedDeal(deal)}
                      className={`cursor-grab rounded-lg border border-line bg-raised p-2.5 transition active:cursor-grabbing ${
                        dragging === deal.id ? "opacity-40" : "hover:border-line-strong hover:bg-surface"
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
    <div className="fixed inset-0 z-40 grid place-items-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Clientes</h2>
          <button type="button" onClick={onClose} className="text-faint transition hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          {clients.map((client) =>
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
                className="flex items-start justify-between gap-3 rounded-xl border border-line bg-canvas px-3.5 py-2.5"
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
                  <button
                    type="button"
                    onClick={() => setEditing(client.id)}
                    className="rounded-lg p-1.5 text-faint transition hover:bg-raised hover:text-ink"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
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
                    className="rounded-lg p-1.5 text-faint transition hover:bg-raised hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
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
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3.5 py-2.5 text-xs text-faint transition hover:border-line-strong hover:text-muted"
            >
              <Plus size={13} />
              Nuevo cliente
            </button>
          )}
        </div>
      </div>
    </div>
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
    <div className="space-y-2 rounded-xl border border-accent/30 bg-canvas p-3">
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Nombre del cliente"
        className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus:border-accent/60"
      />
      <div className="flex gap-2">
        <input
          value={contactName}
          onChange={(event) => setContactName(event.target.value)}
          placeholder="Persona de contacto"
          className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus:border-accent/60"
        />
        <input
          value={contactEmail}
          onChange={(event) => setContactEmail(event.target.value)}
          placeholder="Correo"
          className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus:border-accent/60"
        />
      </div>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Notas"
        rows={2}
        className="w-full resize-none rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus:border-accent/60"
      />
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:text-ink"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={busy || name.trim().length === 0}
          onClick={async () => {
            setBusy(true);
            await onSave({ name, contactName, contactEmail, notes });
            setBusy(false);
          }}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          Guardar
        </button>
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

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{deal.title}</h2>
            <p className="text-xs text-faint">{deal.clientName}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-faint transition hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {items === null && <Loader2 className="animate-spin text-faint" size={16} />}

          {items?.length === 0 && (
            <p className="text-xs text-faint">Sin líneas todavía.</p>
          )}

          {items?.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-xl border border-line bg-canvas px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
              <input
                type="number"
                min={0.01}
                step="any"
                defaultValue={item.quantity}
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (value > 0 && value !== item.quantity) void patchItem(item.id, { quantity: value });
                }}
                className="w-16 shrink-0 rounded-lg border border-line bg-surface px-2 py-1 text-right text-xs outline-none focus:border-accent/60"
              />
              <span className="shrink-0 text-xs text-faint">×</span>
              <input
                type="number"
                min={0}
                step="0.01"
                defaultValue={(item.unitPriceCents / 100).toFixed(2)}
                onBlur={(event) => {
                  const cents = Math.round(Number(event.target.value) * 100);
                  if (cents >= 0 && cents !== item.unitPriceCents) void patchItem(item.id, { unitPriceCents: cents });
                }}
                className="w-20 shrink-0 rounded-lg border border-line bg-surface px-2 py-1 text-right text-xs outline-none focus:border-accent/60"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await api.delete(`/opportunity-items/${item.id}`);
                    await load();
                    await onChanged();
                  } catch (caught) {
                    toast.error(caught instanceof ApiError ? caught.message : "no se pudo quitar la línea");
                  }
                }}
                className="shrink-0 rounded-lg p-1 text-faint transition hover:text-danger"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          {addingService ? (
            <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-canvas p-2.5">
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
                    className="rounded-lg border border-line px-2 py-1 text-[11px] text-muted transition hover:border-accent/40 hover:text-ink"
                  >
                    {service.name} · {money(service.unitPriceCents)}
                  </button>
                ))}
              {services.length === 0 && (
                <p className="text-[11px] text-faint">No hay servicios en el catálogo todavía.</p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingService(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2 text-xs text-faint transition hover:border-line-strong hover:text-muted"
            >
              <Plus size={13} />
              Añadir línea
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
          <span className="text-xs text-faint">Total</span>
          <span className="font-mono text-sm font-medium tabular-nums">{money(total)}</span>
        </div>
      </div>
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
                  : kind === "goal"
                    ? "Trimestre en curso"
                    : "Auditoría de infraestructura"
              }
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none placeholder:text-faint focus:border-accent/60"
            />
          </Field>

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
