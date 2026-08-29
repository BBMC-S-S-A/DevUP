"use client";

import {
  ArrowLeft,
  Files,
  Gamepad2,
  Hash,
  KanbanSquare,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  Plus,
  Search,
  TriangleAlert,
  UserRound,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ApiError, type Channel, type Workspace, api } from "@/lib/api";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Armazon, EsqueletoArmazon } from "@/components/ui/Armazon";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Entrada } from "@/components/ui/Field";
import { PaletaComandos } from "@/components/ui/PaletaComandos";
import { SelectorPresencia } from "@/components/ui/SelectorPresencia";
import { SelectorTema } from "@/components/ui/SelectorTema";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useSession } from "@/lib/session";
import { useViewMode } from "@/lib/view-mode";

/**
 * Retraso del escalonado de entrada.
 *
 * El índice se topa a propósito: sin tope, en un workspace con cuarenta canales
 * el último entraría segundo y medio después del primero y la barra parecería
 * rota, no coreografiada.
 */
function retraso(indice: number): CSSProperties {
  return { "--retraso": `${Math.min(indice, 8) * 35}ms` } as CSSProperties;
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useSession();
  const { mode, setMode, ready: modeReady } = useViewMode();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [{ workspace }, { channels }] = await Promise.all([
        api.get<{ workspace: Workspace }>(`/workspaces/${workspaceId}`),
        api.get<{ channels: Channel[] }>(`/workspaces/${workspaceId}/channels`),
      ]);
      setWorkspace(workspace);
      setChannels(channels);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "no se pudo cargar el workspace");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const loadUnread = useCallback(async () => {
    const { unread } = await api
      .get<{ unread: Record<string, number> }>(`/workspaces/${workspaceId}/unread`)
      .catch(() => ({ unread: {} }));
    setUnread(unread);
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Los no leídos se consultan al entrar, al cambiar de canal y cada medio
  // minuto. Empujarlos por el socket exigiría que el servidor supiera, para
  // cada persona conectada, a qué canales privados tiene acceso — una consulta
  // por miembro y por mensaje. A este tamaño no compensa; cuando compense, el
  // sitio es el hub.
  useEffect(() => {
    void loadUnread();
    const timer = setInterval(() => void loadUnread(), 30_000);
    return () => clearInterval(timer);
  }, [loadUnread, pathname]);

  const officeHref = `/app/w/${workspaceId}/devverse`;
  const inOffice = pathname === officeHref;

  // Recordar la preferencia significa esto: quien dejó DevVerse abierto lo
  // encuentra abierto. Solo desde la raíz del workspace — entrar directo a un
  // canal es una intención explícita y no se pisa.
  useEffect(() => {
    if (!modeReady) return;
    if (mode !== "immersive") return;
    if (pathname !== `/app/w/${workspaceId}`) return;
    router.replace(officeHref);
  }, [modeReady, mode, pathname, workspaceId, officeHref, router]);

  if (loading) {
    // Camino a DevVerse no se pinta el esqueleto de la barra: sería el
    // destello de una barra que en ese destino no va a existir, y un elemento
    // que aparece para desaparecer se lee como un fallo.
    return inOffice ? (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="animate-spin text-faint" size={20} />
      </div>
    ) : (
      <EsqueletoArmazon filas={6} />
    );
  }

  if (error || !workspace) {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <EstadoVacio
          icono={<TriangleAlert size={20} className="text-danger" />}
          titulo={error ?? "workspace no encontrado"}
          pista="Puede que ya no exista, o que esta cuenta no tenga acceso."
          accion={
            <Link
              href="/app"
              className="presionable inline-flex h-8 items-center gap-1.5 rounded-lg border border-line
                bg-raised/60 px-3 text-xs text-ink hover:border-line-strong hover:bg-raised"
            >
              <ArrowLeft size={13} />
              Volver a los workspaces
            </Link>
          }
        />
      </div>
    );
  }

  const voice = channels.filter((c) => c.kind === "voice");
  const text = channels.filter((c) => c.kind === "text");

  // Dentro de DevVerse la barra lateral desaparece: media pantalla de lista
  // de canales al lado de un espacio que existe para recorrerse rompe justo
  // lo que la vista inmersiva aporta. Queda un solo botón para volver.
  if (inOffice) {
    return (
      <div className="relative h-screen">
        {children}
        <button
          type="button"
          onClick={() => {
            setMode("professional");
            router.push(`/app/w/${workspaceId}`);
          }}
          className="presionable cristal absolute bottom-4 left-4 z-10 flex items-center gap-2
            rounded-xl px-3 py-2 text-xs text-muted hover:text-ink"
        >
          <ArrowLeft size={13} />
          Vista profesional
        </button>
      </div>
    );
  }

  const inicial = workspace.name.trim().charAt(0).toUpperCase();

  return (
    <Armazon
      titulo={workspace.name}
      barra={
        <>

        <header className="filo-luz shrink-0 px-4 pb-3.5 pt-4">
          <Link
            href="/app"
            className="presionable -ml-1 mb-3 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5
              text-[11px] text-muted hover:text-accent-bright"
          >
            <ArrowLeft size={12} />
            Workspaces
          </Link>

          <div className="flex items-center gap-2.5">
            {/* La inicial en una chapa hace que dos workspaces con nombres
                parecidos se distingan por la forma antes que por la lectura. */}
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-line-strong
                bg-accent-soft/70 font-display text-sm font-semibold text-accent-bright"
            >
              {inicial}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold" title={workspace.name}>
                {workspace.name}
              </h1>
              {workspace.visibility === "personal" && (
                <p className="mt-0.5 flex items-center gap-1 text-[10px] text-faint">
                  <UserRound size={9} className="shrink-0" />
                  Solo tú ves este workspace
                </p>
              )}
            </div>
          </div>
        </header>

        {/* min-h-0 es lo que permite que el desplazamiento viva aquí dentro: sin
            él, un flex en columna crece con su contenido y el pie con la sesión
            se va por debajo del borde de la pantalla. */}
        <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
          {/* Buscar es de la organización entera, no de este workspace, así que
              va fuera del grupo y con forma de campo: la caja dice «aquí se
              busca» antes de leer la palabra. */}
          <Link
            href={`/app/o/${workspace.organizationId}/buscar`}
            style={retraso(0)}
            className="devup-entrada presionable flex h-9 items-center gap-2 rounded-xl border border-line
              bg-canvas/50 px-2.5 text-[13px] text-muted
              hover:border-line-strong hover:bg-canvas hover:text-ink"
          >
            <Search size={13} className="shrink-0 text-faint" />
            Buscar
          </Link>

          <div>
            <GrupoRotulo titulo="Espacio" />
            <ul className="space-y-0.5">
              <li>
                {/* El panel es la única pieza de esta lista que no es de este
                    workspace en sentido estricto —vive por persona, ver
                    /me/dashboard— pero entrar desde aquí es lo natural: es donde
                    ya se está mirando este espacio de trabajo. */}
                <ItemNav
                  href={`/app/w/${workspaceId}/panel`}
                  icono={<LayoutDashboard size={15} />}
                  activo={pathname === `/app/w/${workspaceId}/panel`}
                  indice={0}
                >
                  Panel
                </ItemNav>
              </li>
              <li>
                <ItemNav
                  href={`/app/w/${workspaceId}`}
                  icono={<Files size={15} />}
                  activo={pathname === `/app/w/${workspaceId}`}
                  indice={1}
                >
                  Biblioteca
                </ItemNav>
              </li>
              <li>
                <ItemNav
                  href={`/app/w/${workspaceId}/board`}
                  icono={<KanbanSquare size={15} />}
                  activo={pathname === `/app/w/${workspaceId}/board`}
                  indice={2}
                >
                  Tablero
                </ItemNav>
              </li>
              <li>
                {/* DevVerse es opcional y se entra a ella a propósito. Va la
                    última del grupo y sin resaltar: quien no la quiera no debería
                    tropezarse con ella. */}
                <ItemNav
                  href={officeHref}
                  icono={<Gamepad2 size={15} />}
                  activo={false}
                  indice={3}
                  onClick={() => setMode("immersive")}
                  sufijo={<Chip>beta</Chip>}
                >
                  DevVerse
                </ItemNav>
              </li>
            </ul>
          </div>

          {text.length > 0 && (
            <ChannelGroup
              title="Texto"
              channels={text}
              workspaceId={workspaceId}
              pathname={pathname}
              unread={unread}
            />
          )}
          <ChannelGroup
            title="Voz"
            channels={voice}
            workspaceId={workspaceId}
            pathname={pathname}
            unread={unread}
          />

          <NewChannel workspaceId={workspaceId} onCreated={load} />
        </nav>

        <footer className="relative shrink-0 px-3 py-3">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px
              bg-gradient-to-r from-transparent via-line-strong to-transparent"
          />
          {/* El tema vive en el pie de la barra, con la cuenta y no en unos
              ajustes: es una preferencia de la persona —como el volumen— y no
              una configuración del producto. Aquí se alcanza desde cualquier
              pantalla sin salir de lo que se está haciendo. */}
          <div className="mb-2 flex items-center justify-between gap-2">
            <Rotulo>Estado</Rotulo>
            <SelectorPresencia />
          </div>
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <Rotulo>Tema</Rotulo>
            <SelectorTema />
          </div>

          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong
                bg-raised font-display text-[11px] font-semibold text-muted"
            >
              {(user?.displayName ?? "?").trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-ink" title={user?.displayName}>
                {user?.displayName}
              </p>
              <p className="truncate text-[10px] text-faint" title={user?.email}>
                {user?.email}
              </p>
            </div>
            <NotificationBell />
            {/* El tinte de peligro se pinta sobre el icono y no sobre el botón
                porque BotonIcono ya declara su propio color al pasar por encima
                y dos utilidades de la misma propiedad se pisan sin aviso. */}
            <BotonIcono etiqueta="Cerrar sesión" onClick={() => void signOut()} className="group">
              <LogOut size={15} className="transition-colors group-hover:text-danger" />
            </BotonIcono>
          </div>
        </footer>
        </>
      }
    >
      {children}
      <PaletaComandos orgId={workspace.organizationId} />
    </Armazon>
  );
}

function GrupoRotulo({ titulo, contador }: { titulo: string; contador?: number }) {
  return (
    <div className="mb-1.5 flex items-center gap-2 px-3">
      <Rotulo>{titulo}</Rotulo>
      <span aria-hidden className="h-px flex-1 bg-line" />
      {contador !== undefined && (
        <span className="font-mono text-[10px] tabular-nums text-faint">{contador}</span>
      )}
    </div>
  );
}

/**
 * Una fila de la barra.
 *
 * Los tres estados son los que ya distinguía la barra anterior y siguen
 * significando lo mismo: activo, con algo pendiente, y en reposo. El activo se
 * marca con un listón de acento a la izquierda en vez de con más brillo —el
 * halo está reservado a lo que está pasando ahora mismo (regla 2 del sistema),
 * y «estoy aquí» no es un evento, es una posición.
 */
function ItemNav({
  href,
  icono,
  activo,
  indice,
  resaltado = false,
  onClick,
  sufijo,
  children,
}: {
  href: string;
  icono: ReactNode;
  activo: boolean;
  indice: number;
  /** Tiene pendientes: se lee más fuerte sin llegar a marcarse como activo. */
  resaltado?: boolean;
  onClick?: () => void;
  sufijo?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={activo ? "page" : undefined}
      style={retraso(indice)}
      className={`devup-entrada presionable relative flex items-center gap-2.5 rounded-lg py-1.5 pl-3 pr-2 text-[13px] ${
        activo
          ? "bg-accent-soft/70 text-ink"
          : resaltado
            ? "font-medium text-ink hover:bg-raised/70"
            : "text-muted hover:bg-raised/70 hover:text-ink"
      }`}
    >
      {activo && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-accent"
        />
      )}
      <span className={`shrink-0 ${activo ? "text-accent" : resaltado ? "text-muted" : "text-faint"}`}>
        {icono}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {sufijo}
    </Link>
  );
}

function ChannelGroup({
  title,
  channels,
  workspaceId,
  pathname,
  unread,
}: {
  title: string;
  channels: Channel[];
  workspaceId: string;
  pathname: string;
  unread: Record<string, number>;
}) {
  return (
    <div>
      <GrupoRotulo titulo={title} contador={channels.length} />
      {channels.length === 0 ? (
        <p className="px-3 text-[11px] text-faint">Ninguno todavía.</p>
      ) : (
        <ul className="space-y-0.5">
          {channels.map((channel, indice) => {
            const href = `/app/w/${workspaceId}/c/${channel.id}`;
            const active = pathname === href;
            const pending = unread[channel.id] ?? 0;

            return (
              <li key={channel.id}>
                <ItemNav
                  href={href}
                  icono={channel.kind === "voice" ? <Volume2 size={15} /> : <Hash size={15} />}
                  activo={active}
                  resaltado={pending > 0}
                  indice={indice}
                  sufijo={
                    <>
                      {channel.isPrivate && (
                        <Lock size={11} className="shrink-0 text-faint" aria-label="Canal privado" />
                      )}
                      {pending > 0 && !active && (
                        // Cifra, no mancha: el contorno y el relleno al 15 % la
                        // dejan legible de un vistazo sin que la barra entera
                        // parezca una alarma. Mono y tabular porque el ancho no
                        // debe bailar cuando pasa de 9 a 10.
                        <span
                          title={`${pending} sin leer`}
                          className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center
                            rounded-full border border-accent/30 bg-accent/15 px-1
                            font-mono text-[10px] font-medium tabular-nums text-accent-bright"
                        >
                          {pending > 99 ? "99+" : pending}
                        </span>
                      )}
                    </>
                  }
                >
                  {channel.name}
                </ItemNav>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NewChannel({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"text" | "voice">("text");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="presionable flex w-full items-center gap-2 rounded-xl border border-dashed border-line
          px-3 py-2 text-[13px] text-faint
          hover:border-line-strong hover:bg-raised/40 hover:text-muted"
      >
        <Plus size={14} className="shrink-0" />
        Nuevo canal
      </button>
    );
  }

  return (
    // Crece desde el borde de arriba, que es donde estaba el botón que lo abrió:
    // un panel que nace de su propio centro se despega de lo que lo invocó.
    <Tarjeta className="devup-emerge origin-top p-2.5">
      <Rotulo className="mb-2 block">Nuevo canal</Rotulo>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await api.post(`/workspaces/${workspaceId}/channels`, {
              name,
              kind,
              isPrivate,
            });
            setName("");
            setKind("text");
            setIsPrivate(false);
            setOpen(false);
            await onCreated();
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-2.5"
      >
        {/* Mono porque el nombre de canal es un identificador, no una frase: se
            escribe en minúsculas y con guiones y así se ve mientras se teclea. */}
        <Entrada
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="nombre-del-canal"
          className="font-mono"
        />

        <div className="flex gap-1.5">
          {(["text", "voice"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              aria-pressed={kind === option}
              className={`presionable flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-1.5
                font-display text-[10px] font-semibold uppercase tracking-wider ${
                  kind === option
                    ? "border-accent/40 bg-accent-soft text-accent"
                    : "border-line text-faint hover:border-line-strong hover:text-muted"
                }`}
            >
              {option === "text" ? <Hash size={11} /> : <Volume2 size={11} />}
              {option === "text" ? "Texto" : "Voz"}
            </button>
          ))}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted hover:text-ink">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(event) => setIsPrivate(event.target.checked)}
            className="size-3.5 accent-[var(--color-accent)]"
          />
          <Lock size={11} className="text-faint" />
          Privado
        </label>

        <div className="flex items-center gap-1.5 pt-0.5">
          {/* El ancho lo pone el envoltorio: Boton trae `shrink-0` de fábrica y
              un `flex-1` encima sería una carrera de utilidades. */}
          <div className="flex-1">
            <Boton
              type="submit"
              variante="primario"
              tamano="sm"
              cargando={busy}
              disabled={busy || name.trim().length === 0}
              className="w-full"
            >
              Crear
            </Boton>
          </div>
          <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setOpen(false)}>
            Cancelar
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
