"use client";

import {
  AlertTriangle,
  Building2,
  ChevronRight,
  Code2,
  Github,
  LogOut,
  Mail,
  Megaphone,
  Plus,
  Search,
  Settings,
  UserRound,
  Users,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, type Organization, type PendingInvitation, type Workspace, api } from "@/lib/api";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Boton } from "@/components/ui/Boton";
import { Entrada } from "@/components/ui/Field";
import { Logo } from "@/components/ui/Logo";
import { Chip, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useSession } from "@/lib/session";

/** El callback de Spotify vuelve aquí con `?spotify=...`; esto lo avisa y lo limpia de la URL. */
function SpotifyRedirectToast() {
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const spotify = params.get("spotify");
    if (!spotify) return;

    // Cada motivo pide una reacción distinta, así que se dicen por separado:
    // un «no se pudo conectar» a secas deja a quien lo lee sin nada que hacer.
    if (spotify === "conectado") {
      toast.success("Spotify conectado");
    } else if (spotify === "denegado") {
      toast.error("No diste permiso a Spotify");
    } else if (spotify === "fallo-canje") {
      toast.error("Spotify rechazó la conexión. Vuelve a intentarlo desde el reproductor.", {
        // El código de autorización es de un solo uso: recargar la página del
        // callback falla siempre, y hay que empezar la conexión otra vez.
        description: "Si acabas de recargar la página, empieza el proceso de nuevo.",
      });
    } else {
      toast.error("No se pudo conectar Spotify");
    }
    router.replace("/app");
  }, [params, router]);

  return null;
}

/**
 * Ventas, búsqueda y GitHub son de la organización, no de un workspace: el
 * embudo y buscar en todo lo del equipo no son de un sitio de trabajo concreto.
 *
 * Están declarados aquí fuera y no incrustados en el JSX porque así los tres
 * son obligatoriamente el mismo control: tres enlaces escritos a mano uno
 * debajo de otro es como uno acaba con tres tamaños distintos.
 */
const ACCESOS = [
  { ruta: "buscar", icono: Search, titulo: "Buscar", pista: "En todo el equipo" },
  { ruta: "ventas", icono: TrendingUp, titulo: "Ventas", pista: "Embudo y clientes" },
  { ruta: "github", icono: Github, titulo: "GitHub", pista: "Repos y actividad" },
  { ruta: "dev", icono: Code2, titulo: "Entorno de dev", pista: "Editor y terminal real" },
  { ruta: "noticias", icono: Megaphone, titulo: "Noticias", pista: "Lo que publica el equipo" },
  { ruta: "ajustes", icono: Settings, titulo: "Ajustes", pista: "Miembros, foto y enlaces" },
] as const;

/** El rol viene en inglés de la API; aquí solo se traduce para leerlo. */
const ROLES: Record<Organization["role"], string> = {
  owner: "Propietario",
  admin: "Admin",
  member: "Miembro",
};

export default function OrganizationsPage() {
  const { user, signOut } = useSession();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [workspaces, setWorkspaces] = useState<Record<string, Workspace[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { organizations } = await api.get<{ organizations: Organization[] }>("/organizations");
      setOrganizations(organizations);

      // Una llamada por organización. Con las tres o cuatro que tiene un
      // equipo es irrelevante; si algún día son cientos, esto pide un endpoint
      // que las devuelva juntas.
      const entries = await Promise.all(
        organizations.map(async (org) => {
          const { workspaces } = await api.get<{ workspaces: Workspace[] }>(
            `/organizations/${org.id}/workspaces`,
          );
          return [org.id, workspaces] as const;
        }),
      );
      setWorkspaces(Object.fromEntries(entries));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "no se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalWorkspaces = Object.values(workspaces).reduce((suma, lista) => suma + lista.length, 0);

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-6">
      <Suspense fallback={null}>
        <SpotifyRedirectToast />
      </Suspense>

      {/* Cabecera de cabina: identidad a la izquierda, mandos a la derecha y una
          fila de cifras debajo. La rejilla va en una capa aparte para que su
          máscara radial no recorte también el texto. */}
      <Tarjeta className="relative mb-8 overflow-hidden px-5 py-5">
        <div className="rejilla pointer-events-none absolute inset-0" aria-hidden />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Logo size={44} animated />
            <div className="min-w-0">
              <Rotulo className="block">Centro de mando</Rotulo>
              <h1 className="mt-0.5 text-xl font-semibold">DevUP</h1>
              <p className="mt-1 truncate font-mono text-[11px] text-muted">{user?.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <NotificationBell />
            <Boton
              variante="secundario"
              tamano="sm"
              icono={<LogOut size={14} />}
              onClick={() => void signOut()}
            >
              Salir
            </Boton>
          </div>
        </div>

        {!loading && (
          <div className="relative mt-5 flex items-end gap-8 border-t border-line/70 pt-4">
            <Cifra etiqueta="Organizaciones" valor={organizations.length} />
            <Cifra etiqueta="Workspaces" valor={totalWorkspaces} />
          </div>
        )}
      </Tarjeta>

      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-4" role="status" aria-label="Cargando organizaciones">
          <EsqueletoOrganizacion />
          <EsqueletoOrganizacion />
        </div>
      ) : (
        <div className="space-y-4">
          {organizations.map((org, index) => {
            const lista = workspaces[org.id] ?? [];
            return (
              <Tarjeta
                key={org.id}
                className="devup-entrada overflow-hidden"
                // El índice va topado: sin esto la organización número veinte
                // entraría más de un segundo tarde y parecería que falla.
                style={{ "--retraso": `${Math.min(index, 8) * 60}ms` } as React.CSSProperties}
              >
                {/* Cabecera de instrumento */}
                <header className="filo-luz flex flex-wrap items-center gap-x-3 gap-y-2 bg-raised/30 px-4 py-3.5">
                  <InsigniaOrganizacion organization={org} />
                  <div className="min-w-0 flex-1">
                    <Rotulo className="block">Organización</Rotulo>
                    <h2 className="mt-0.5 truncate text-base font-semibold">{org.name}</h2>
                  </div>
                  <span className="font-mono text-[11px] text-faint">/{org.slug}</span>
                  <Chip tono={org.role === "member" ? "neutro" : "accent"}>{ROLES[org.role]}</Chip>
                </header>

                <div className="grid gap-2 border-b border-line/60 p-3 sm:grid-cols-3">
                  {ACCESOS.map(({ ruta, icono: Icono, titulo, pista }) => (
                    <Link
                      key={ruta}
                      href={`/app/o/${org.id}/${ruta}`}
                      className="presionable group flex items-center gap-2.5 rounded-xl border border-line bg-raised/40 px-3 py-2.5 hover:border-accent/40 hover:bg-accent-soft/40"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-canvas/70 text-muted transition-colors duration-[160ms] group-hover:border-accent/40 group-hover:text-accent">
                        <Icono size={15} />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-display text-xs font-semibold tracking-wide text-ink">
                          {titulo}
                        </span>
                        <span className="block truncate text-[11px] text-faint">{pista}</span>
                      </span>
                    </Link>
                  ))}
                </div>

                <div className="p-3">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <Rotulo>Workspaces</Rotulo>
                    <span className="font-mono text-[10px] tabular-nums text-faint">
                      {lista.length}
                    </span>
                    <span className="h-px flex-1 bg-line/70" aria-hidden />
                  </div>

                  <div className="space-y-1.5">
                    {lista.map((workspace) => (
                      <Link
                        key={workspace.id}
                        href={`/app/w/${workspace.id}`}
                        className="presionable group flex items-center gap-3 rounded-xl border border-line/70 bg-surface/60 px-3 py-2.5 hover:border-line-strong hover:bg-raised"
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-canvas/60 text-faint transition-colors duration-[160ms] group-hover:text-accent">
                          {workspace.visibility === "personal" ? (
                            <UserRound size={14} />
                          ) : (
                            <Users size={14} />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{workspace.name}</span>
                        {workspace.visibility === "personal" && <Chip>Personal</Chip>}
                        <ChevronRight
                          size={15}
                          className="shrink-0 text-faint transition-transform duration-[160ms] group-hover:translate-x-0.5"
                        />
                      </Link>
                    ))}

                    <NewWorkspace organizationId={org.id} onCreated={load} />
                  </div>
                </div>

                {org.role !== "member" && (
                  <div className="border-t border-line/60 px-3 py-3">
                    <Invitaciones organizationId={org.id} />
                  </div>
                )}
              </Tarjeta>
            );
          })}

          <NewOrganization onCreated={load} hasAny={organizations.length > 0} />
        </div>
      )}
    </main>
  );
}

/**
 * La chapa con la inicial se sustituye por la foto real en cuanto hay una.
 * Pide la URL firmada solo si `logoKey` viene puesto —la mayoría de
 * organizaciones no tendrán foto todavía— para no gastar una petición por
 * tarjeta sin necesidad.
 */
function InsigniaOrganizacion({ organization }: { organization: Organization }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!organization.logoKey) {
      setUrl(null);
      return;
    }
    let cancelado = false;
    void api
      .get<{ url: string | null }>(`/organizations/${organization.id}/logo-url`)
      .then((respuesta) => {
        if (!cancelado) setUrl(respuesta.url);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [organization.id, organization.logoKey]);

  return (
    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-line-strong bg-canvas/60 text-accent">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <Building2 size={16} />
      )}
    </span>
  );
}

/** Cifra de instrumento. Va con cero delante para que no baile de ancho al
 *  pasar de 9 a 10, que es lo que hace que un contador parezca un aguja suelta. */
function Cifra({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div>
      <Rotulo className="block">{etiqueta}</Rotulo>
      <p className="texto-plasma mt-1 font-mono text-2xl font-semibold tabular-nums">
        {String(valor).padStart(2, "0")}
      </p>
    </div>
  );
}

/** El hueco de una tarjeta mientras carga, con su forma real: un esqueleto que
 *  no se parece a lo que va a llegar solo consigue que la página dé un salto. */
function EsqueletoOrganizacion() {
  return (
    <Tarjeta className="overflow-hidden" aria-hidden>
      <div className="flex items-center gap-3 bg-raised/30 px-4 py-3.5">
        <div className="devup-esqueleto size-9 rounded-xl" />
        <div className="space-y-2">
          <div className="devup-esqueleto h-2.5 w-32 rounded-full" />
          <div className="devup-esqueleto h-2 w-20 rounded-full" />
        </div>
      </div>
      <div className="grid gap-2 border-t border-line/60 p-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="devup-esqueleto h-[52px] rounded-xl" />
        ))}
      </div>
      <div className="space-y-1.5 p-3">
        <div className="devup-esqueleto h-11 rounded-xl" />
        <div className="devup-esqueleto h-11 rounded-xl" />
      </div>
    </Tarjeta>
  );
}

/**
 * Invitar gente y ver las invitaciones vivas.
 *
 * Solo para quien administra: la API lo comprueba igualmente dentro de
 * `create_invitation`, esto solo evita enseñar un botón que va a fallar.
 */
function Invitaciones({ organizationId }: { organizationId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [pendientes, setPendientes] = useState<PendingInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    const { invitations } = await api
      .get<{ invitations: PendingInvitation[] }>(`/organizations/${organizationId}/invitations`)
      .catch(() => ({ invitations: [] }));
    setPendientes(invitations.filter((i) => !i.acceptedAt));
  }, [organizationId]);

  useEffect(() => {
    if (abierto) void cargar();
  }, [abierto, cargar]);

  if (!abierto) {
    return (
      <Boton
        variante="fantasma"
        tamano="sm"
        icono={<Mail size={13} />}
        onClick={() => setAbierto(true)}
      >
        Invitar a alguien
      </Boton>
    );
  }

  return (
    <div className="devup-entrada rounded-xl border border-line bg-canvas/40 p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <Rotulo>Invitaciones</Rotulo>
        <span className="h-px flex-1 bg-line/70" aria-hidden />
      </div>

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await api.post(`/organizations/${organizationId}/invitations`, { email, role: rol });
            toast.success(`Invitación enviada a ${email}`);
            setEmail("");
            await cargar();
          } catch (caught) {
            toast.error(caught instanceof ApiError ? caught.message : "no se pudo invitar");
          } finally {
            setBusy(false);
          }
        }}
        className="flex flex-wrap gap-2"
      >
        <Entrada
          autoFocus
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="correo@empresa.com"
          className="min-w-48 flex-1"
        />
        <select
          value={rol}
          onChange={(event) => setRol(event.target.value as "member" | "admin")}
          aria-label="Rol de la invitación"
          className="h-10 rounded-xl border border-line bg-canvas/60 px-3 text-sm outline-none
            transition-[border-color,box-shadow] duration-200
            hover:border-line-strong
            focus:border-accent/60 focus:shadow-[0_0_0_3px_rgb(91_140_255/0.14)]"
        >
          {/* El fondo va en cada opción: el desplegable nativo de Windows lo
              pinta blanco si no se le dice otra cosa. */}
          <option className="bg-surface" value="member">
            Miembro
          </option>
          <option className="bg-surface" value="admin">
            Administrador
          </option>
        </select>
        <Boton type="submit" variante="primario" cargando={busy}>
          Enviar
        </Boton>
        <Boton type="button" variante="fantasma" onClick={() => setAbierto(false)}>
          Cerrar
        </Boton>
      </form>

      {pendientes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {pendientes.map((invitacion) => (
            <li
              key={invitacion.id}
              className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface/60 px-2.5 py-1.5"
            >
              <Mail size={12} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
                {invitacion.email}
              </span>
              <Chip>{invitacion.role}</Chip>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await api.delete(`/invitations/${invitacion.id}`);
                    toast.success("Invitación revocada");
                    await cargar();
                  } catch (caught) {
                    toast.error(caught instanceof ApiError ? caught.message : "no se pudo revocar");
                  }
                }}
                className="presionable shrink-0 rounded-lg px-2 py-1 font-display text-[10px] font-semibold uppercase tracking-wider text-faint hover:bg-danger/10 hover:text-danger"
              >
                Revocar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewWorkspace({
  organizationId,
  onCreated,
}: {
  organizationId: string;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"shared" | "personal">("shared");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="presionable flex w-full items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-faint hover:border-accent/40 hover:bg-accent-soft/20 hover:text-muted"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-dashed border-line">
          <Plus size={14} />
        </span>
        Nuevo workspace
      </button>
    );
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await api.post(`/organizations/${organizationId}/workspaces`, { name, visibility });
          toast.success(`Workspace «${name}» creado`);
          setName("");
          setVisibility("shared");
          setOpen(false);
          await onCreated();
        } catch (caught) {
          toast.error(caught instanceof ApiError ? caught.message : "no se pudo crear el workspace");
        } finally {
          setBusy(false);
        }
      }}
      className="devup-entrada space-y-2 rounded-xl border border-accent/25 bg-canvas/40 p-3"
    >
      <div className="flex gap-2">
        <Entrada
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nombre del workspace"
          className="flex-1"
        />
        <Boton
          type="submit"
          variante="primario"
          cargando={busy}
          disabled={name.trim().length === 0}
        >
          Crear
        </Boton>
      </div>

      <div className="flex gap-1.5">
        {(
          [
            ["shared", <Users key="s" size={13} />, "De equipo", "Lo ve toda la organización"],
            ["personal", <UserRound key="p" size={13} />, "Personal", "Solo lo ves tú"],
          ] as const
        ).map(([value, icon, label, hint]) => (
          <button
            key={value}
            type="button"
            onClick={() => setVisibility(value)}
            title={hint}
            aria-pressed={visibility === value}
            className={`presionable flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 font-display text-xs font-medium ${
              visibility === value
                ? "border-accent/40 bg-accent-soft text-accent shadow-[0_0_16px_-6px_rgb(91_140_255/0.8)]"
                : "border-line text-muted hover:border-line-strong hover:text-ink"
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        {visibility === "personal"
          ? "Un espacio para trabajar solo: sus archivos, canales y tareas no los ve nadie más, ni siquiera quien administra la organización."
          : "Todo el equipo verá sus archivos, canales y tareas."}
      </p>
    </form>
  );
}

function NewOrganization({
  onCreated,
  hasAny,
}: {
  onCreated: () => Promise<void>;
  hasAny: boolean;
}) {
  const [open, setOpen] = useState(!hasAny);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="presionable flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-line px-4 py-4 text-sm text-faint hover:border-accent/40 hover:bg-accent-soft/20 hover:text-muted"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-dashed border-line">
          <Plus size={16} />
        </span>
        Nueva organización
      </button>
    );
  }

  return (
    <Tarjeta className="relative overflow-hidden p-5">
      <div className="rejilla pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative">
        <Rotulo className="block">Nueva</Rotulo>
        <h2 className="mt-0.5 text-base font-semibold">Organización</h2>
        <p className="mb-4 mt-1.5 max-w-md text-xs leading-relaxed text-muted">
          Es la frontera de aislamiento: nada de una organización es visible desde otra.
        </p>

        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            setBusy(true);
            try {
              await api.post("/organizations", { name, slug });
              toast.success(`Organización «${name}» creada`);
              setName("");
              setSlug("");
              setOpen(false);
              await onCreated();
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : "no se pudo crear");
            } finally {
              setBusy(false);
            }
          }}
          className="max-w-md space-y-3"
        >
          <label className="block">
            <Rotulo className="mb-1.5 block">Nombre</Rotulo>
            <Entrada
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                // El identificador se propone a partir del nombre, pero se puede
                // editar: es lo que aparece en las URL y no debería cambiar luego.
                setSlug(
                  event.target.value
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
                    .slice(0, 40),
                );
              }}
              placeholder="Equipo de producto"
            />
          </label>

          <label className="block">
            <Rotulo className="mb-1.5 block">Identificador</Rotulo>
            <Entrada
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="equipo-de-producto"
              className="font-mono"
            />
          </label>

          {error && (
            <p className="flex items-center gap-1.5 text-xs text-danger">
              <AlertTriangle size={12} className="shrink-0" />
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Boton
              type="submit"
              variante="primario"
              cargando={busy}
              disabled={name.trim().length === 0}
            >
              Crear organización
            </Boton>
            {hasAny && (
              <Boton type="button" variante="fantasma" onClick={() => setOpen(false)}>
                Cancelar
              </Boton>
            )}
          </div>
        </form>
      </div>
    </Tarjeta>
  );
}
