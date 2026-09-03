"use client";

import {
  AtSign,
  CalendarClock,
  ClipboardList,
  Megaphone,
  Music,
  Rocket,
  Server,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SpotifyWidget } from "@/components/spotify/SpotifyWidget";
import { EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import {
  type Despliegue,
  type Entorno,
  type EstadoDespliegue,
  type Notification,
  type OrganizationMember,
  type Presencia,
  type Workspace,
} from "@/lib/api";
import { useRecurso } from "@/lib/datos";
import { useSession } from "@/lib/session";
import { useSpotify } from "@/lib/spotify/SpotifyProvider";
import { tinte } from "@/lib/tinte";

/**
 * El panel personal.
 *
 * ANTES ERA UNA REJILLA CONFIGURABLE, y el mock (SalaPanel) proponía en su
 * lugar una composición fija en tres columnas. La primera pasada de la
 * dirección Sala trasladó el material a esa rejilla pero conservó la
 * composición (e7e81bf), razonando que sustituir algo configurable por una
 * pantalla estática sería peor que no tocarla. Juan pidió después fidelidad
 * literal a los mocks, así que esta es la segunda pasada: la composición de
 * SalaPanel, con datos reales detrás de cada columna en vez de la rejilla que
 * cada quien se armaba.
 *
 * LAS TRES COLUMNAS Y DE DÓNDE SALE CADA UNA:
 *  - «Te espera»: notificaciones sin leer (`/notifications`) y ventas abiertas
 *    que vencen pronto (`/organizations/:id/pipeline`, el mismo umbral de tres
 *    días que ya usa el embudo). No hay menciones de PR ni de commits porque
 *    no existe ese dato en el producto — el mock lo dibuja, aquí no se inventa.
 *  - «Infraestructura»: los entornos reales (`/organizations/:id/environments`),
 *    los mismos que ve la pantalla de infraestructura.
 *  - «Quién está»: los miembros de la organización con su presencia
 *    (`/organizations/:id/members`), que hasta hoy solo se leía de uno mismo
 *    en `/auth/me` — se amplió el SELECT para que la propia fila ya la trajera.
 *
 * LO QUE SE RETIRÓ: la rejilla arrastrable, `/me/dashboard` y el catálogo de
 * widgets. El endpoint y la tabla siguen en pie por si hace falta volver atrás,
 * pero nada del frontend los llama ya.
 */

/** «Buenos días» / «Buenas tardes» / «Buenas noches», según la hora local. */
function saludo(): string {
  const hora = new Date().getHours();
  if (hora < 12) return "Buenos días";
  if (hora < 19) return "Buenas tardes";
  return "Buenas noches";
}

/** «hace 4 min», igual que en la pantalla de infraestructura. */
function hace(iso: string | null): string {
  if (!iso) return "sin desplegar todavía";
  const segundos = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (segundos < 60) return "hace un momento";
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "ayer" : `hace ${dias} días`;
}

const ESTADO_TONO: Record<EstadoDespliegue, { color: string; label: string }> = {
  pending: { color: "var(--c-faint)", label: "en cola" },
  running: { color: "var(--c-accent)", label: "desplegando" },
  success: { color: "var(--c-live)", label: "en pie" },
  failure: { color: "var(--c-danger)", label: "falló" },
  cancelled: { color: "var(--c-warn)", label: "cancelado" },
};

const PRESENCIA: Record<Presencia, { color: string; label: string }> = {
  available: { color: "var(--c-live)", label: "disponible" },
  busy_open: { color: "var(--c-warn)", label: "ocupado" },
  do_not_disturb: { color: "var(--c-danger)", label: "no molestar" },
};

/** Días que faltan para una fecha, contra un único «hoy» por pantalla. */
function diasRestantes(iso: string, hoy: Date): number {
  const msPorDia = 1000 * 60 * 60 * 24;
  return Math.round((new Date(iso).getTime() - hoy.getTime()) / msPorDia);
}

const UMBRAL_URGENCIA = 3;

type Venta = {
  id: string;
  title: string;
  clientName: string;
  amountCents: number;
  expectedClose: string | null;
  stage: string;
};

type Espera =
  | { tipo: "venta"; id: string; dias: number; titulo: string; subtitulo: string }
  | { tipo: "notificacion"; id: string; kind: Notification["kind"]; titulo: string; subtitulo: string; link: string };

const ICONO_NOTIFICACION: Record<Notification["kind"], typeof AtSign> = {
  mention: AtSign,
  task_assigned: ClipboardList,
  invitation: UserPlus,
  recording: Rocket,
  announcement: Megaphone,
};

const money = (cents: number): string =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    cents / 100,
  );

export default function PanelPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { canal, sesion } = useSpotify();
  const { user } = useSession();

  const espacio = useRecurso<{ workspace: Workspace }>(`/workspaces/${workspaceId}`);
  const orgId = espacio.datos?.workspace.organizationId ?? null;

  const notis = useRecurso<{ notifications: Notification[] }>("/notifications?unreadOnly=true&limit=6");
  const ventas = useRecurso<{ opportunities: Venta[] }>(
    orgId ? `/organizations/${orgId}/pipeline` : null,
  );
  const entornos = useRecurso<{ environments: Entorno[] }>(
    orgId ? `/organizations/${orgId}/environments` : null,
  );
  const miembros = useRecurso<{ members: OrganizationMember[] }>(
    orgId ? `/organizations/${orgId}/members` : null,
  );

  if (espacio.error) {
    return (
      <div className="grid min-h-[60svh] place-items-center px-6">
        <EstadoVacio icono={<TriangleAlert size={20} className="text-danger" />} titulo={espacio.error} />
      </div>
    );
  }

  if (espacio.cargando || !espacio.datos) return <EsqueletoPanel />;

  const hoy = new Date();

  // Ventas abiertas a punto de vencer, la más urgente primero.
  const ventasUrgentes: Espera[] = (ventas.datos?.opportunities ?? [])
    .filter((v) => v.stage !== "won" && v.stage !== "lost" && v.expectedClose)
    .map((v) => ({ ...v, dias: diasRestantes(v.expectedClose!, hoy) }))
    .filter((v) => v.dias <= UMBRAL_URGENCIA)
    .sort((a, b) => a.dias - b.dias)
    .map((v) => ({
      tipo: "venta" as const,
      id: v.id,
      dias: v.dias,
      titulo: v.title,
      subtitulo: `${v.clientName} · ${money(v.amountCents)}`,
    }));

  const avisos: Espera[] = (notis.datos?.notifications ?? []).map((n) => ({
    tipo: "notificacion" as const,
    id: n.id,
    kind: n.kind,
    titulo: n.title,
    subtitulo: n.body,
    link: n.link,
  }));

  const espera = [...ventasUrgentes, ...avisos].slice(0, 5);

  const lista = entornos.datos?.environments ?? [];
  const todoEnPie = lista.length > 0 && lista.every((e) => e.ultimo?.state !== "failure");
  const ultimoDespliegue = lista
    .map((e) => e.ultimo)
    .filter((d): d is Despliegue => d !== null)
    .sort((a, b) => new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime())[0];

  const listaMiembros = miembros.datos?.members ?? [];

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-[100rem] flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {saludo()}
            {user ? `, ${user.displayName.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-xs text-faint">
            {new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })}
            {" · "}
            {espera.length === 0
              ? "nada pendiente"
              : `${espera.length} ${espera.length === 1 ? "cosa te espera" : "cosas te esperan"}`}
          </p>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_21rem]">
        {/* Te espera */}
        <section className="capa-flotante flex min-h-0 flex-col gap-3.5 rounded-2xl p-4">
          <div className="flex shrink-0 items-center gap-2">
            <Rotulo>Te espera</Rotulo>
            <span className="ml-auto font-mono text-[11px] text-faint">{espera.length}</span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
            {espera.length === 0 ? (
              <p className="mt-2 text-xs leading-relaxed text-faint">
                Nada de esto lo anotó nadie: se deduce de lo que pasó, y ahora mismo no pasa nada
                urgente.
              </p>
            ) : (
              espera.map((item) =>
                item.tipo === "venta" ? (
                  <div
                    key={`venta-${item.id}`}
                    className="rounded-xl border border-warn/30 bg-gradient-to-br from-warn/15 to-transparent p-3"
                  >
                    <div className="flex items-center gap-2">
                      <CalendarClock size={12} className="shrink-0 text-warn" />
                      <Rotulo className="!text-warn">
                        vence en {Math.max(item.dias, 0)} día{item.dias === 1 ? "" : "s"}
                      </Rotulo>
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-ink">{item.titulo}</p>
                    <p className="mt-0.5 text-xs text-faint">{item.subtitulo}</p>
                  </div>
                ) : (
                  <Link
                    key={`noti-${item.id}`}
                    href={item.link || "#"}
                    className="presionable block rounded-xl bg-raised/40 p-3 hover:bg-raised/70"
                  >
                    <div className="flex items-center gap-2">
                      {(() => {
                        const Icono = ICONO_NOTIFICACION[item.kind];
                        return <Icono size={12} className="shrink-0 text-accent" />;
                      })()}
                      <Rotulo>{item.titulo}</Rotulo>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs text-muted">{item.subtitulo}</p>
                  </Link>
                ),
              )
            )}
          </div>
        </section>

        {/* Infraestructura */}
        <section className="capa-flotante flex min-h-0 flex-col gap-3.5 rounded-2xl p-4">
          <div className="flex shrink-0 items-center gap-2">
            <Rotulo>Infraestructura</Rotulo>
            {lista.length > 0 && (
              <span
                className="ml-auto flex items-center gap-1.5 text-[11px]"
                style={{ color: todoEnPie ? "var(--c-live)" : "var(--c-danger)" }}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{
                    background: "currentColor",
                    boxShadow: `0 0 8px ${todoEnPie ? "var(--c-live)" : "var(--c-danger)"}`,
                  }}
                />
                {todoEnPie ? "todo en pie" : "algo falló"}
              </span>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            {lista.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                <Server size={18} className="text-faint" />
                <p className="text-xs text-faint">
                  Sin entornos conectados todavía. Se configuran en Infraestructura.
                </p>
              </div>
            ) : (
              lista.map((entorno) => {
                const estado = entorno.ultimo ? ESTADO_TONO[entorno.ultimo.state] : ESTADO_TONO.pending;
                return (
                  <div
                    key={entorno.id}
                    className="flex items-center gap-2.5 rounded-xl bg-raised/30 px-3 py-2"
                  >
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: estado.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs">{entorno.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-faint">{estado.label}</span>
                  </div>
                );
              })
            )}
          </div>

          {ultimoDespliegue && (
            <div className="shrink-0 rounded-xl border border-accent/20 bg-gradient-to-br from-accent-soft/60 to-transparent p-3">
              <Rotulo className="!text-accent">Último despliegue</Rotulo>
              <p className="mt-1 truncate text-xs text-ink">
                {ultimoDespliegue.commitMessage ?? "sin mensaje de commit"}
              </p>
              <p className="mt-1 font-mono text-[10px] text-faint">
                {hace(ultimoDespliegue.startedAt)}
                {ultimoDespliegue.author ? ` · ${ultimoDespliegue.author}` : ""}
              </p>
            </div>
          )}
        </section>

        {/* Quién está + música */}
        <div className="flex min-h-0 flex-col gap-4">
          <section className="capa-flotante flex shrink-0 flex-col gap-3 rounded-2xl p-4">
            <div className="flex items-center gap-2">
              <Rotulo>Quién está</Rotulo>
              <span className="ml-auto font-mono text-[11px] text-faint">{listaMiembros.length}</span>
            </div>

            <div className="flex flex-col gap-2.5">
              {listaMiembros.length === 0 ? (
                <p className="text-xs text-faint">Sin compañeros todavía en esta organización.</p>
              ) : (
                listaMiembros.slice(0, 5).map((miembro) => {
                  const p = PRESENCIA[miembro.presence];
                  return (
                    <div key={miembro.userId} className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        style={{ backgroundImage: tinte(miembro.displayName) }}
                        className="grid size-7 shrink-0 place-items-center rounded-full font-display text-[11px] font-semibold text-canvas"
                      >
                        {miembro.displayName.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs">{miembro.displayName}</span>
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: p.color, boxShadow: `0 0 7px ${p.color}` }}
                        title={p.label}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section
            className="capa-flotante flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl transition-[box-shadow,border-color] duration-200"
            style={
              sesion?.isPlaying
                ? {
                    borderColor: "color-mix(in oklab, var(--c-accent) 45%, transparent)",
                    boxShadow: "var(--halo-accent), inset 0 1px 0 var(--brillo-canto)",
                  }
                : undefined
            }
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-line/70 px-4 py-2.5">
              <Music size={13} className="shrink-0 text-muted" />
              <Rotulo>Suena en la sala</Rotulo>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {canal ? (
                <SpotifyWidget channelId={canal} variante="expandido" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center">
                  <Music size={18} className="text-faint" />
                  <p className="text-[11px] leading-relaxed text-faint">
                    Entra a un canal de voz para compartir música aquí.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function EsqueletoPanel() {
  return (
    <div className="mx-auto max-w-[100rem] px-6 py-6">
      <div className="devup-esqueleto h-7 w-56 rounded-lg" />
      <div className="devup-esqueleto mt-2 h-3.5 w-72 rounded" />
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_21rem]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="devup-esqueleto h-96 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
