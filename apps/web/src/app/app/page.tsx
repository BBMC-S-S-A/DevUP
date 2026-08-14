"use client";

import {
  Building2,
  ChevronRight,
  LogOut,
  Mail,
  Plus,
  Terminal,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type Organization, type PendingInvitation, type Workspace, api } from "@/lib/api";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useSession } from "@/lib/session";

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

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
            <Terminal size={20} />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">DevUP</h1>
            <p className="text-xs text-faint">{user?.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:border-line-strong hover:text-ink"
          >
            <LogOut size={14} />
            Salir
          </button>
        </div>
      </header>

      {error && <p className="mb-6 text-sm text-danger">{error}</p>}

      {loading ? (
        <p className="text-sm text-faint">Cargando…</p>
      ) : (
        <div className="space-y-8">
          {organizations.map((org) => (
            <section key={org.id}>
              <div className="mb-3 flex items-center gap-2">
                <Building2 size={15} className="text-faint" />
                <h2 className="text-sm font-medium">{org.name}</h2>
                <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-faint">
                  {org.role}
                </span>
              </div>

              <div className="space-y-2">
                {(workspaces[org.id] ?? []).map((workspace) => (
                  <Link
                    key={workspace.id}
                    href={`/app/w/${workspace.id}`}
                    className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-line-strong hover:bg-raised"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      {workspace.visibility === "personal" ? (
                        <UserRound size={14} className="text-faint" />
                      ) : (
                        <Users size={14} className="text-faint" />
                      )}
                      {workspace.name}
                      {workspace.visibility === "personal" && (
                        <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-faint">
                          personal
                        </span>
                      )}
                    </span>
                    <ChevronRight size={16} className="text-faint" />
                  </Link>
                ))}

                <NewWorkspace organizationId={org.id} onCreated={load} />
              </div>

              {org.role !== "member" && <Invitaciones organizationId={org.id} />}
            </section>
          ))}

          <NewOrganization onCreated={load} hasAny={organizations.length > 0} />
        </div>
      )}
    </main>
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
  const [aviso, setAviso] = useState<string | null>(null);
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
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-3 flex items-center gap-1.5 text-xs text-faint transition hover:text-muted"
      >
        <Mail size={13} />
        Invitar a alguien
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface p-4">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setAviso(null);
          setBusy(true);
          try {
            await api.post(`/organizations/${organizationId}/invitations`, { email, role: rol });
            setAviso(`Invitación enviada a ${email}.`);
            setEmail("");
            await cargar();
          } catch (caught) {
            setAviso(caught instanceof ApiError ? caught.message : "no se pudo invitar");
          } finally {
            setBusy(false);
          }
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          autoFocus
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="correo@empresa.com"
          className="min-w-48 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-accent/60"
        />
        <select
          value={rol}
          onChange={(event) => setRol(event.target.value as "member" | "admin")}
          className="rounded-lg border border-line bg-canvas px-2 py-2 text-sm outline-none"
        >
          <option value="member">Miembro</option>
          <option value="admin">Administrador</option>
        </select>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-canvas disabled:opacity-40"
        >
          Enviar
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
        >
          Cerrar
        </button>
      </form>

      {aviso && <p className="mt-2 text-xs text-muted">{aviso}</p>}

      {pendientes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {pendientes.map((invitacion) => (
            <li
              key={invitacion.id}
              className="flex items-center justify-between gap-2 text-xs text-faint"
            >
              <span className="min-w-0 truncate">
                {invitacion.email} · {invitacion.role}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await api.delete(`/invitations/${invitacion.id}`);
                  await cargar();
                }}
                className="shrink-0 transition hover:text-danger"
              >
                revocar
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
        className="flex w-full items-center gap-2 rounded-xl border border-dashed border-line px-4 py-3 text-sm text-faint transition hover:border-line-strong hover:text-muted"
      >
        <Plus size={15} />
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
          setName("");
          setVisibility("shared");
          setOpen(false);
          await onCreated();
        } finally {
          setBusy(false);
        }
      }}
      className="space-y-2 rounded-xl border border-line bg-surface p-3"
    >
      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nombre del workspace"
          className="flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-accent/60"
        />
        <button
          type="submit"
          disabled={busy || name.trim().length === 0}
          className="rounded-lg bg-accent px-4 text-sm font-medium text-canvas disabled:opacity-40"
        >
          Crear
        </button>
      </div>

      <div className="flex gap-1">
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
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition ${
              visibility === value
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-line text-muted hover:text-ink"
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-faint">
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
        className="flex items-center gap-2 text-xs text-faint transition hover:text-muted"
      >
        <Plus size={14} />
        Nueva organización
      </button>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="mb-1 text-sm font-medium">Nueva organización</h2>
      <p className="mb-4 text-xs text-faint">
        Es la frontera de aislamiento: nada de una organización es visible desde otra.
      </p>

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setBusy(true);
          try {
            await api.post("/organizations", { name, slug });
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
        className="space-y-3"
      >
        <input
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
          placeholder="Nombre"
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-accent/60"
        />
        <input
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          placeholder="identificador"
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-sm outline-none placeholder:text-faint focus:border-accent/60"
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || name.trim().length === 0}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-canvas disabled:opacity-40"
          >
            Crear
          </button>
          {hasAny && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-line px-4 py-2 text-sm text-muted"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
