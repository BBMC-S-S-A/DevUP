"use client";

import {
  ArrowLeft,
  Building2,
  Check,
  Copy,
  ImagePlus,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Desplegable, Entrada } from "@/components/ui/Field";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import {
  type OrganizationLink,
  type OrganizationMember,
  type PendingInvitation,
  type Workspace,
  ApiError,
  api,
} from "@/lib/api";
import { useOrgId } from "@/lib/workspace-context";
import { useRecurso } from "@/lib/datos";
import { uploadOrgLogo } from "@/lib/files/upload";
import { useSession } from "@/lib/session";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Fallo, Pagina } from "@/components/ui/Pagina";
import { TarjetaPersona } from "@/components/perfil/TarjetaPersona";
import { useWorkspaceIdOpcional } from "@/lib/workspace-context";

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
  const orgId = useOrgId();
  const { user } = useSession();

  // Cuatro lecturas de esta pantalla estaban escritas a mano, cada una con su
  // `useState`, su `useCallback` y su efecto — unas quince líneas por sitio
  // para hacer lo mismo. Por la capa de datos son una línea, y además comparten
  // caché con quien pida lo mismo desde otra pantalla.
  const equipo = useRecurso<{ members: OrganizationMember[] }>(
    `/organizations/${orgId}/members`,
  );
  const members = equipo.datos?.members ?? null;
  const load = equipo.recargar;

  const yo = members?.find((m) => m.userId === user?.id);
  const administro = yo ? yo.role === "owner" || yo.role === "admin" : false;

  return (
    <Pagina
      titulo="Ajustes"
      rotulo="Foto, miembros y enlaces de la organización"
      icono={<Settings size={20} />}
    >
      <div className="space-y-5">
        {equipo.error && (
          <Fallo onReintentar={() => void load()}>{equipo.error}</Fallo>
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
  const [subiendo, setSubiendo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const logo = useRecurso<{ url: string | null }>(`/organizations/${orgId}/logo-url`);
  // `undefined` mientras carga y `null` cuando no hay foto: son dos estados
  // distintos y la pantalla los pinta distinto —esqueleto o hueco—, así que no
  // se pueden colapsar en uno.
  const url = logo.cargando ? undefined : (logo.datos?.url ?? null);
  const cargar = logo.recargar;

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
      await cargar();
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
  /** A quién se le está mirando la ficha, si a alguien. */
  const [mirando, setMirando] = useState<OrganizationMember | null>(null);
  // Esta pantalla se monta también bajo `/app/w/…`, y entonces sí hay espacio
  // del que hablar. Bajo `/app/o/…` no lo hay, y la tarjeta se calla lo que
  // esa persona está haciendo en vez de contarlo de un espacio cualquiera.
  const espacio = useWorkspaceIdOpcional();

  return (
    <Tarjeta className="p-4">
      {mirando && (
        <TarjetaPersona
          miembro={mirando}
          workspaceId={espacio ?? undefined}
          onCerrar={() => setMirando(null)}
        />
      )}
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
              {/* Pulsar a alguien enseña quién es y, si se mira desde un
                  espacio, en qué anda. El mismo gesto que en el panel: una
                  persona debería poder mirarse desde donde aparezca. */}
              <button
                type="button"
                onClick={() => setMirando(member)}
                className="presionable flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong bg-raised font-display text-[11px] font-semibold text-muted">
                  {(member.displayName || "?").trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {member.displayName}
                  {member.userId === yo && <span className="ml-1.5 text-xs text-faint">(tú)</span>}
                </span>
                {/* El cargo, debajo del nombre. Lo escribe cada cual en su
                    perfil y hasta ahora no se veía en ninguna parte fuera de
                    DevVerse — o sea, casi nunca. Es lo que contesta «¿a quién
                    le pregunto esto?» sin tener que preguntar primero a quién
                    preguntar. */}
                  {member.title && (
                    <span className="block truncate text-[11px] text-faint">{member.title}</span>
                  )}
                </span>
              </button>

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

  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  // Mientras el dominio de correo no esté verificado, el enlace es la vía
  // fiable: se enseña aquí para que quien invita lo mande por su cuenta,
  // en vez de confiar en que el correo llegue.
  const [enlace, setEnlace] = useState<string | null>(null);
  /**
   * El código corto que devuelve la 0040, y que hasta ahora se tiraba.
   *
   * SOLO EXISTE AQUÍ Y AHORA. En la base vive su hash, no él, así que ni la API
   * puede volver a leerlo: esta respuesta es la única vez que se ve. Por eso se
   * enseña grande y con su botón de copiar, y por eso la lista de pendientes de
   * abajo ofrece pedir otro en vez de enseñar el que hubo.
   */
  const [codigo, setCodigo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<"enlace" | "codigo" | null>(null);
  // Vacío = toda la organización. Los personales no salen: a un workspace
  // personal no se invita a nadie, es de una sola persona por definición.
  const [workspaceId, setWorkspaceId] = useState("");

  // Clave `null` mientras el panel está cerrado: `useRecurso` entonces no pide
  // nada. Es lo mismo que hacía el `if (abierto)` del efecto de antes, pero sin
  // efecto — y al abrirlo la segunda vez ya está en caché y sale puesto.
  const invitaciones = useRecurso<{ invitations: PendingInvitation[] }>(
    abierto ? `/organizations/${orgId}/invitations` : null,
  );
  const espacios = useRecurso<{ workspaces: Workspace[] }>(
    abierto ? `/organizations/${orgId}/workspaces` : null,
  );
  const pendientes = (invitaciones.datos?.invitations ?? []).filter((i) => !i.acceptedAt);
  const compartidos = (espacios.datos?.workspaces ?? []).filter((w) => w.visibility === "shared");
  const cargar = invitaciones.recargar;

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
            const { url, code } = await api.post<{
              sent: boolean;
              url: string;
              code: string | null;
            }>(`/organizations/${orgId}/invitations`, {
              email,
              role: rol,
              workspaceId: workspaceId || null,
            });
            setEnlace(url);
            setCodigo(code);
            setCopiado(null);
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
        {compartidos.length > 0 && (
          <Desplegable
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
            aria-label="A dónde entra"
          >
            <option className="bg-surface" value="">
              Toda la organización
            </option>
            {compartidos.map((workspace) => (
              <option className="bg-surface" key={workspace.id} value={workspace.id}>
                Solo «{workspace.name}»
              </option>
            ))}
          </Desplegable>
        )}
        <Boton type="submit" variante="primario" cargando={busy}>
          Enviar
        </Boton>
        <Boton
          type="button"
          variante="fantasma"
          onClick={() => {
            setAbierto(false);
            setEnlace(null);
            setCodigo(null);
          }}
        >
          Cerrar
        </Boton>
      </form>

      {/*
        EL CÓDIGO VA PRIMERO Y MÁS GRANDE QUE EL ENLACE, y no es una cuestión
        de gusto: las dos puertas llevan a la misma invitación, pero el enlace
        ya va en el correo y el código no va a ninguna parte. Si alguien cierra
        este panel sin apuntarlo, no se recupera — en la base solo está su
        hash—. Lo que se pierde por no verse tiene que verse antes.
      */}
      {codigo && (
        <div className="devup-entrada mt-3 rounded-lg border border-accent/30 bg-accent-soft/30 px-3 py-2.5">
          <div className="flex items-center gap-3">
            <KeyRound size={14} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 font-mono text-lg font-semibold tracking-[0.2em] text-ink">
              {codigo}
            </span>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(codigo);
                setCopiado("codigo");
                toast.success("Código copiado");
              }}
              className="presionable flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-display text-[10px] font-semibold uppercase tracking-wider text-accent hover:bg-accent/10"
            >
              {copiado === "codigo" ? <Check size={12} /> : <Copy size={12} />}
              {copiado === "codigo" ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Se puede dictar por teléfono. <span className="text-faint">No se guarda en claro:
            esta es la única vez que se ve. Si se pierde, se pide otro desde la lista de abajo
            y el anterior deja de valer.</span>
          </p>
        </div>
      )}

      {enlace && (
        <div className="devup-entrada mt-2 flex items-center gap-2 rounded-lg border border-line bg-canvas/40 px-2.5 py-2">
          <Link2 size={13} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
            {enlace}
          </span>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(enlace);
              setCopiado("enlace");
              toast.success("Enlace copiado");
            }}
            className="presionable flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-display text-[10px] font-semibold uppercase tracking-wider text-accent hover:bg-accent/10"
          >
            {copiado === "enlace" ? <Check size={12} /> : <Copy size={12} />}
            {copiado === "enlace" ? "Copiado" : "Copiar"}
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
              {invitacion.workspaceName && <Chip tono="accent">{invitacion.workspaceName}</Chip>}
              <Chip>{invitacion.role}</Chip>
              {/* PEDIR OTRO CÓDIGO, no ver el que hubo: el que hubo no existe
                  en ninguna parte. Es la consecuencia de guardarlo cifrado, y
                  la alternativa —borrar la invitación y rehacerla— invalidaría
                  también su enlace, que a estas alturas puede estar ya abierto
                  en el móvil de la otra persona. */}
              <button
                type="button"
                title={
                  invitacion.hasCode
                    ? "Dar un código nuevo. El anterior deja de valer."
                    : "Esta invitación no tiene código corto. Pedir uno."
                }
                onClick={async () => {
                  try {
                    const { code } = await api.post<{ code: string }>(
                      `/invitations/${invitacion.id}/code`,
                      {},
                    );
                    await navigator.clipboard.writeText(code).catch(() => {});
                    toast.success(`Código ${code} — copiado`);
                    await cargar();
                  } catch (caught) {
                    toast.error(
                      caught instanceof ApiError ? caught.message : "no se pudo dar un código",
                    );
                  }
                }}
                className="presionable flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5
                  font-display text-[10px] font-semibold uppercase tracking-wider
                  text-faint hover:bg-accent/10 hover:text-accent"
              >
                <KeyRound size={11} />
                {invitacion.hasCode ? "Otro código" : "Dar código"}
              </button>
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
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const recurso = useRecurso<{ links: OrganizationLink[] }>(`/organizations/${orgId}/links`);
  const links = recurso.cargando ? null : (recurso.datos?.links ?? []);
  const load = recurso.recargar;

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
                      await load();
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
              await api.post<{ link: OrganizationLink }>(`/organizations/${orgId}/links`, {
                label,
                url,
              });
              await load();
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
