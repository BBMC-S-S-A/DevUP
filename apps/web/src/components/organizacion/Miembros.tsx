"use client";

import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Desplegable, Entrada } from "@/components/ui/Field";
import { Cargando } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useConfirmar } from "@/components/ui/Confirmar";
import { TarjetaPersona } from "@/components/perfil/TarjetaPersona";
import { Avatar } from "@/components/perfil/Avatar";
import {
  type OrganizationMember,
  type PendingInvitation,
  type Workspace,
  ApiError,
  api,
} from "@/lib/api";
import { useWorkspaceIdOpcional } from "@/lib/workspace-context";
import { useRecurso } from "@/lib/datos";

/**
 * La gente de una organización: quién está, quién administra, y cómo entra o
 * sale alguien.
 *
 * VIVÍA DENTRO DE LOS AJUSTES, escrito a mano en una pantalla de 797 líneas
 * junto a la foto de la organización, sus enlaces y el diagnóstico técnico.
 * Invitar a alguien es un gesto de PLANTILLA, no de configuración: se hace
 * desde donde se mira a la gente, que ahora es la portada de la organización.
 *
 * SE EXTRAJO EN VEZ DE COPIARSE, y esa es toda la decisión de este fichero.
 * Dos copias del alta de miembros se separan —lo hicieron ya una vez las cinco
 * cabeceras de pantalla de este mismo producto— y la que se queda atrás es
 * siempre la que pierde una comprobación de permisos. Aquí eso significa dar
 * de alta a alguien como administrador sin que nadie lo revise.
 *
 * Sigue usándose desde Ajustes, además de desde la portada: quien ya sabía
 * dónde estaba no tiene que aprender un sitio nuevo.
 */

/**
 * Cuánto le queda a un código, dicho como se dice en voz alta.
 *
 * En horas y no en días porque dura UNO: «caduca mañana» sobre algo que se
 * muere en cuarenta minutos es la clase de redondeo que hace que alguien lo
 * dicte tarde.
 */
function cuandoCaduca(iso: string): string {
  const minutos = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (minutos < 60) return `${Math.max(1, minutos)} min`;
  return `${Math.round(minutos / 60)} h`;
}

const ROLES: Record<OrganizationMember["role"], string> = {
  owner: "Propietario",
  admin: "Admin",
  member: "Miembro",
};

/** Si un instante ya pasó. */
function caducado(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now();
}

/* ============================================================================
 * Miembros
 * ========================================================================= */

export function Miembros({
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
  /** Cuál se está renovando, para apagar solo su botón y no todos. */
  const [renovando, setRenovando] = useState<string | null>(null);
  const confirmar = useConfirmar();
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
            // `codigo` y no `code`: al fusionar los dos caminos ganó el
            // nombre del tronco. Mientras estuvo mal, el código se generaba,
            // viajaba en la respuesta y la pantalla lo tiraba — la función
            // entera invisible sin que nada fallara.
            const { url, codigo: recien } = await api.post<{
              sent: boolean;
              url: string;
              codigo: string | null;
            }>(`/organizations/${orgId}/invitations`, {
              email,
              role: rol,
              workspaceId: workspaceId || null,
            });
            setEnlace(url);
            setCodigo(recien);
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
              {/* LA CADUCIDAD DEL CÓDIGO, que NO es la de la invitación: un día
                  contra siete. Sin decirlo, quien ve «caduca en 6 días» arriba
                  dicta por teléfono un código que dejó de valer anoche, y se
                  encuentra con que la otra persona no entra sin nada que
                  explique por qué. */}
              {invitacion.hasCode && invitacion.codeExpiresAt && (
                <Chip tono={caducado(invitacion.codeExpiresAt) ? "neutro" : "warn"}>
                  {caducado(invitacion.codeExpiresAt)
                    ? "código caducado"
                    : `código ${cuandoCaduca(invitacion.codeExpiresAt)}`}
                </Chip>
              )}
              {/* PEDIR OTRO CÓDIGO, no ver el que hubo: el que hubo no existe
                  en ninguna parte. Es la consecuencia de guardarlo cifrado, y
                  la alternativa —borrar la invitación y rehacerla— invalidaría
                  también su enlace, que a estas alturas puede estar ya abierto
                  en el móvil de la otra persona.

                  ESTUVO DESACTIVADO porque faltaba `set_invitation_code`: dar
                  otro código a una invitación que ya existía no tenía ruta
                  detrás, y la salida era reinvitar —que además rompe el enlace
                  que la otra persona pueda tener abierto—. La 0047 lo resolvió.

                  SE PREGUNTA ANTES SOLO SI YA HAY CÓDIGO, y esa asimetría es la
                  gracia: pedir el primero no invalida nada, así que preguntar
                  sería un trámite. Pedir OTRO sí — el que la otra persona tiene
                  apuntado deja de valer en ese instante. Quien solo quería
                  volver a verlo tiene que enterarse ANTES de pulsar, porque
                  después ya no hay vuelta: en la base solo está el hash. */}
              <button
                type="button"
                disabled={renovando === invitacion.id}
                title={
                  invitacion.hasCode
                    ? "Genera otro código. El anterior deja de valer."
                    : "Genera un código corto para dictarlo por teléfono."
                }
                onClick={async () => {
                  if (invitacion.hasCode) {
                    const seguro = await confirmar({
                      titulo: "¿Otro código para esta invitación?",
                      descripcion:
                        "El código anterior deja de valer en cuanto se cree el nuevo. Si alguien lo tiene apuntado, ya no le servirá. El enlace del correo NO se toca: sigue funcionando.",
                      accion: "Sí, dame otro",
                    });
                    if (!seguro) return;
                  }
                  setRenovando(invitacion.id);
                  try {
                    const { codigo: nuevo } = await api.post<{ codigo: string }>(
                      `/invitations/${invitacion.id}/codigo`,
                      {},
                    );
                    // Se enseña por el mismo panel que el de invitar: es el que
                    // ya dice que es la única vez que se ve, y tener dos sitios
                    // donde aparece un código sería dos sitios donde
                    // acordarse de decirlo.
                    setCodigo(nuevo);
                    setCopiado(null);
                    await cargar();
                  } catch (caught) {
                    toast.error(
                      caught instanceof ApiError ? caught.message : "no se pudo dar el código",
                    );
                  } finally {
                    setRenovando(null);
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
