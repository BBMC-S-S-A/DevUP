"use client";

import {
  ArrowLeft,
  Building2,
  Check,
  Copy,
  ImagePlus,
  Link2,
  Loader2,
  Mail,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Desplegable, Entrada } from "@/components/ui/Field";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import {
  type OrganizationLink,
  type OrganizationMember,
  type PendingInvitation,
  ApiError,
  api,
} from "@/lib/api";
import { uploadOrgLogo } from "@/lib/files/upload";
import { useSession } from "@/lib/session";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Fallo, Pagina } from "@/components/ui/Pagina";

const ROLES: Record<OrganizationMember["role"], string> = {
  owner: "Propietario",
  admin: "Admin",
  member: "Miembro",
};

/**
 * Ajustes de la organización: la personalización de la entidad en sí, no de
 * quien la usa (eso es el panel, que es por persona). Tres piezas, cada una
 * su propia superficie: foto, miembros, enlaces.
 *
 * No hay comprobación de rol antes de pintar los mandos de escritura porque
 * ya la hace RLS del lado del servidor (0019 y 0001) — enseñar un botón que
 * el servidor va a rechazar es peor que simplemente dejar que el 403 llegue,
 * porque aquí sí sabemos de antemano quién administra: se lee una sola vez
 * de `/organizations/:orgId/members` y se usa para decidir qué enseñar.
 */
export default function OrganizationSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user } = useSession();

  const [members, setMembers] = useState<OrganizationMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { members } = await api.get<{ members: OrganizationMember[] }>(
        `/organizations/${orgId}/members`,
      );
      setMembers(members);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "no se pudo cargar");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const yo = members?.find((m) => m.userId === user?.id);
  const administro = yo ? yo.role === "owner" || yo.role === "admin" : false;

  return (
    <Pagina
      titulo="Ajustes"
      rotulo="Foto, miembros y enlaces de la organización"
      icono={<Settings size={20} />}
    >
      <div className="space-y-5">
        {error && (
          <Fallo onReintentar={() => void load()}>{error}</Fallo>
        )}

        <FotoOrganizacion orgId={orgId} puedeEditar={administro} />
        <Miembros orgId={orgId} members={members} yo={user?.id ?? null} administro={administro} onChange={load} />
        <Enlaces orgId={orgId} puedeEditar={administro} />
      </div>
    </Pagina>
  );
}

/* ============================================================================
 * Foto
 * ========================================================================= */

function FotoOrganizacion({ orgId, puedeEditar }: { orgId: string; puedeEditar: boolean }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [subiendo, setSubiendo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    const { url } = await api
      .get<{ url: string | null }>(`/organizations/${orgId}/logo-url`)
      .catch(() => ({ url: null }));
    setUrl(url);
  }, [orgId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const subir = async (file: File) => {
    setSubiendo(true);
    try {
      await uploadOrgLogo(orgId, file);
      toast.success("Foto actualizada");
      await cargar();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "no se pudo subir la foto");
    } finally {
      setSubiendo(false);
    }
  };

  const quitar = async () => {
    try {
      await api.delete(`/organizations/${orgId}/logo`);
      setUrl(null);
      toast.success("Foto quitada");
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "no se pudo quitar");
    }
  };

  return (
    <Tarjeta className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Rotulo>Foto de la organización</Rotulo>
        <span className="h-px flex-1 bg-line/70" aria-hidden />
      </div>

      <div className="flex items-center gap-4">
        <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line-strong bg-canvas/60 text-faint">
          {url === undefined ? (
            <Loader2 size={16} className="animate-spin" />
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="size-full object-cover" />
          ) : (
            <Building2 size={22} />
          )}
        </span>

        {puedeEditar && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void subir(file);
              }}
            />
            <Boton
              variante="secundario"
              tamano="sm"
              icono={<ImagePlus size={13} />}
              cargando={subiendo}
              onClick={() => inputRef.current?.click()}
            >
              {url ? "Cambiar foto" : "Subir foto"}
            </Boton>
            {url && (
              <Boton variante="fantasma" tamano="sm" onClick={() => void quitar()}>
                Quitar
              </Boton>
            )}
          </div>
        )}
      </div>
    </Tarjeta>
  );
}

/* ============================================================================
 * Miembros
 * ========================================================================= */

function Miembros({
  orgId,
  members,
  yo,
  administro,
  onChange,
}: {
  orgId: string;
  members: OrganizationMember[] | null;
  yo: string | null;
  administro: boolean;
  onChange: () => Promise<void>;
}) {
  const confirmar = useConfirmar();
  return (
    <Tarjeta className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Rotulo>Miembros</Rotulo>
        <span className="font-mono text-[10px] tabular-nums text-faint">{members?.length ?? ""}</span>
        <span className="h-px flex-1 bg-line/70" aria-hidden />
      </div>

      {members === null ? (
        <div className="space-y-1.5">
          <div className="devup-esqueleto h-11 rounded-xl" />
          <div className="devup-esqueleto h-11 rounded-xl" />
        </div>
      ) : (
        <ul className="space-y-1.5">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center gap-2.5 rounded-xl border border-line/70 bg-surface/60 px-3 py-2"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong bg-raised font-display text-[11px] font-semibold text-muted">
                {(member.displayName || "?").trim().charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {member.displayName}
                {member.userId === yo && <span className="ml-1.5 text-xs text-faint">(tú)</span>}
              </span>

              {administro && member.role !== "owner" && member.userId !== yo ? (
                <Desplegable
                  tamano="sm"
                  contenedor="shrink-0"
                  value={member.role}
                  onChange={async (event) => {
                    const role = event.target.value as "admin" | "member";
                    try {
                      await api.patch(`/organizations/${orgId}/members/${member.userId}`, { role });
                      await onChange();
                    } catch (caught) {
                      toast.error(caught instanceof ApiError ? caught.message : "no se pudo cambiar el rol");
                    }
                  }}
                >
                  <option className="bg-surface" value="member">
                    Miembro
                  </option>
                  <option className="bg-surface" value="admin">
                    Admin
                  </option>
                </Desplegable>
              ) : (
                <Chip tono={member.role === "member" ? "neutro" : "accent"}>{ROLES[member.role]}</Chip>
              )}

              {administro && member.role !== "owner" && member.userId !== yo && (
                <BotonIcono
                  etiqueta={`Expulsar a ${member.displayName}`}
                  onClick={async () => {
                    if (
                      !(await confirmar({
                        titulo: `¿Quitar a ${member.displayName} de la organización?`,
                        descripcion:
                          "Perderá el acceso a los espacios de trabajo de esta organización.",
                        accion: "Quitar",
                        peligro: true,
                      }))
                    )
                      return;
                    try {
                      await api.delete(`/organizations/${orgId}/members/${member.userId}`);
                      await onChange();
                    } catch (caught) {
                      toast.error(caught instanceof ApiError ? caught.message : "no se pudo quitar");
                    }
                  }}
                  className="hover:!text-danger"
                >
                  <Trash2 size={13} />
                </BotonIcono>
              )}
            </li>
          ))}
        </ul>
      )}

      {administro && (
        <div className="mt-3">
          <Invitar orgId={orgId} />
        </div>
      )}
    </Tarjeta>
  );
}

function Invitar({ orgId }: { orgId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [pendientes, setPendientes] = useState<PendingInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  // Mientras el dominio de correo no esté verificado, el enlace es la vía
  // fiable: se enseña aquí para que quien invita lo mande por su cuenta,
  // en vez de confiar en que el correo llegue.
  const [enlace, setEnlace] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    const { invitations } = await api
      .get<{ invitations: PendingInvitation[] }>(`/organizations/${orgId}/invitations`)
      .catch(() => ({ invitations: [] }));
    setPendientes(invitations.filter((i) => !i.acceptedAt));
  }, [orgId]);

  useEffect(() => {
    if (abierto) void cargar();
  }, [abierto, cargar]);

  if (!abierto) {
    return (
      <Boton variante="fantasma" tamano="sm" icono={<Mail size={13} />} onClick={() => setAbierto(true)}>
        Invitar a alguien
      </Boton>
    );
  }

  return (
    <div className="devup-entrada rounded-xl border border-line bg-canvas/40 p-3">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            const { url } = await api.post<{ sent: boolean; url: string }>(
              `/organizations/${orgId}/invitations`,
              { email, role: rol },
            );
            setEnlace(url);
            setCopiado(false);
            toast.success(`Invitación creada para ${email}`);
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
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="correo@empresa.com"
          className="min-w-48 flex-1"
        />
        <Desplegable
          value={rol}
          onChange={(event) => setRol(event.target.value as "member" | "admin")}
          aria-label="Rol de la invitación"
        >
          <option className="bg-surface" value="member">
            Miembro
          </option>
          <option className="bg-surface" value="admin">
            Administrador
          </option>
        </Desplegable>
        <Boton type="submit" variante="primario" cargando={busy}>
          Enviar
        </Boton>
        <Boton
          type="button"
          variante="fantasma"
          onClick={() => {
            setAbierto(false);
            setEnlace(null);
          }}
        >
          Cerrar
        </Boton>
      </form>

      {enlace && (
        <div className="devup-entrada mt-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft/30 px-2.5 py-2">
          <Link2 size={13} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
            {enlace}
          </span>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(enlace);
              setCopiado(true);
              toast.success("Enlace copiado");
            }}
            className="presionable flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-display text-[10px] font-semibold uppercase tracking-wider text-accent hover:bg-accent/10"
          >
            {copiado ? <Check size={12} /> : <Copy size={12} />}
            {copiado ? "Copiado" : "Copiar"}
          </button>
        </div>
      )}

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

/* ============================================================================
 * Enlaces
 * ========================================================================= */

function Enlaces({ orgId, puedeEditar }: { orgId: string; puedeEditar: boolean }) {
  const [links, setLinks] = useState<OrganizationLink[] | null>(null);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { links } = await api
      .get<{ links: OrganizationLink[] }>(`/organizations/${orgId}/links`)
      .catch(() => ({ links: [] }));
    setLinks(links);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Tarjeta className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Rotulo>Enlaces</Rotulo>
        <span className="h-px flex-1 bg-line/70" aria-hidden />
      </div>

      {links === null ? (
        <div className="devup-esqueleto h-11 rounded-xl" />
      ) : links.length === 0 ? (
        <EstadoVacio
          icono={<Link2 size={18} />}
          titulo="Sin enlaces todavía"
          pista="El repositorio, la documentación, lo que el equipo quiera tener a mano."
        />
      ) : (
        <ul className="space-y-1.5">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center gap-2.5 rounded-xl border border-line/70 bg-surface/60 px-3 py-2"
            >
              <Link2 size={13} className="shrink-0 text-faint" />
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-sm text-ink hover:text-accent-bright"
              >
                {link.label}
              </a>
              {puedeEditar && (
                <BotonIcono
                  etiqueta={`Quitar ${link.label}`}
                  onClick={async () => {
                    try {
                      await api.delete(`/organizations/${orgId}/links/${link.id}`);
                      setLinks((prev) => prev?.filter((l) => l.id !== link.id) ?? null);
                    } catch (caught) {
                      toast.error(caught instanceof ApiError ? caught.message : "no se pudo quitar");
                    }
                  }}
                  className="hover:!text-danger"
                >
                  <X size={13} />
                </BotonIcono>
              )}
            </li>
          ))}
        </ul>
      )}

      {puedeEditar && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              const { link } = await api.post<{ link: OrganizationLink }>(
                `/organizations/${orgId}/links`,
                { label, url },
              );
              setLinks((prev) => [...(prev ?? []), link]);
              setLabel("");
              setUrl("");
            } catch (caught) {
              toast.error(caught instanceof ApiError ? caught.message : "no se pudo añadir");
            } finally {
              setBusy(false);
            }
          }}
          className="mt-3 flex flex-wrap gap-2"
        >
          <Entrada
            required
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Nombre"
            className="w-32"
          />
          <Entrada
            required
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…"
            className="min-w-48 flex-1"
          />
          <Boton type="submit" variante="secundario" tamano="sm" icono={<Plus size={13} />} cargando={busy}>
            Añadir
          </Boton>
        </form>
      )}
    </Tarjeta>
  );
}
