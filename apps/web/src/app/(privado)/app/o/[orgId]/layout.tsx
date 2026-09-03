"use client";

import {
  ArrowLeft,
  Code2,
  Database,
  Github,
  Lightbulb,
  LogOut,
  Megaphone,
  Search,
  Server,
  Settings,
  Target,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { BotonIcono } from "@/components/ui/Boton";
import { PaletaComandos } from "@/components/ui/PaletaComandos";
import { SelectorPresencia } from "@/components/ui/SelectorPresencia";
import { SelectorTema } from "@/components/ui/SelectorTema";
import { Armazon, EsqueletoArmazon } from "@/components/ui/Armazon";
import { Chip, Rotulo } from "@/components/ui/Superficies";
import { ItemNav } from "@/components/ui/ItemNav";
import { ApiError, type Organization, type Workspace, api } from "@/lib/api";
import { retraso } from "@/lib/animacion";
import { useSession } from "@/lib/session";

/**
 * El armazón de organización.
 *
 * EXISTE PORQUE NO HABÍA NINGUNO. Cada pantalla de organización llegó como una
 * pantalla completa e independiente, así que para ir de Ventas a GitHub había
 * que volver al inicio y volver a entrar — dos saltos para moverse entre dos
 * cosas de la misma organización. Y la cabecera de vuelta estaba copiada cinco
 * veces, con la deriva que era de esperar: cuatro la llamaban «Organizaciones»
 * y una «Workspaces», el mismo enlace al mismo sitio con dos nombres.
 *
 * La barra la pone <Armazon>, compartido con el del espacio de trabajo: mismo
 * cristal, mismo canto de luz, mismo cajón en móvil. Dos armazones que se
 * parecen se leen como un producto; dos que se parecen «casi» se leen como un
 * error, y dos escritos por separado acaban pareciéndose «casi».
 *
 * DEBAJO DE LAS PANTALLAS VAN LOS ESPACIOS DE TRABAJO de esta organización, y
 * no en una pantalla aparte: es el camino que más se recorre, y tenerlo en la
 * barra convierte el salto de dos pasos en uno.
 */

// `retraso` vivía aquí duplicado. Ahora es de `@/lib/animacion`.

export default function OrgLayout({ children }: { children: ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  const pathname = usePathname();
  const { user, signOut } = useSession();

  const [organizacion, setOrganizacion] = useState<Organization | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [logo, setLogo] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      // La lista entera y no `/organizations/:id`: no hay ruta para una sola, y
      // la lista ya trae el rol de quien mira, que es lo que decide si se ve
      // Ajustes.
      const { organizations } = await api.get<{ organizations: Organization[] }>("/organizations");
      const mia = organizations.find((o) => o.id === orgId) ?? null;
      setOrganizacion(mia);
      if (!mia) {
        setError("Esta organización no existe, o ya no perteneces a ella.");
        return;
      }

      const { workspaces: lista } = await api.get<{ workspaces: Workspace[] }>(
        `/organizations/${orgId}/workspaces`,
      );
      setWorkspaces(lista);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar la organización.");
    } finally {
      setCargando(false);
    }
  }, [orgId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // El logo va aparte porque es una petición que puede fallar sin que eso
  // impida usar nada: si no llega, queda la chapa con la inicial.
  useEffect(() => {
    if (!organizacion?.logoKey) {
      setLogo(null);
      return;
    }
    let vigente = true;
    api
      .get<{ url: string | null }>(`/organizations/${orgId}/logo-url`)
      .then(({ url }) => {
        if (vigente) setLogo(url);
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [orgId, organizacion?.logoKey]);

  // El entorno de desarrollo se queda sin barra. No es estética: esa pantalla
  // se sirve con las cabeceras de aislamiento que exige WebContainer y ocupa el
  // alto entero, y meterla en un hueco de 256 px menos la estrecha sin ganar
  // nada — desde ahí se sale por el enlace que ya tiene.
  const enDev = pathname === `/app/o/${orgId}/dev`;
  if (enDev) return <>{children}</>;

  if (cargando) return <EsqueletoArmazon />;

  if (error || !organizacion) {
    return (
      <div className="grid min-h-[100svh] place-items-center px-6">
        <div className="text-center">
          <p className="text-sm text-muted">{error ?? "No se pudo cargar la organización."}</p>
          <Link
            href="/app"
            className="presionable mt-4 inline-flex items-center gap-1.5 text-xs text-accent"
          >
            <ArrowLeft size={13} />
            Volver a organizaciones
          </Link>
        </div>
      </div>
    );
  }

  const inicial = organizacion.name.trim().charAt(0).toUpperCase();
  const puedeAjustar = organizacion.role === "owner" || organizacion.role === "admin";
  const base = `/app/o/${orgId}`;

  const pantallas = [
    { href: `${base}/ventas`, icono: <Target size={14} />, texto: "Ventas" },
    { href: `${base}/github`, icono: <Github size={14} />, texto: "GitHub" },
    { href: `${base}/noticias`, icono: <Megaphone size={14} />, texto: "Noticias" },
    { href: `${base}/infraestructura`, icono: <Server size={14} />, texto: "Infraestructura" },
    { href: `${base}/base-de-datos`, icono: <Database size={14} />, texto: "Base de datos" },
    { href: `${base}/integraciones`, icono: <Lightbulb size={14} />, texto: "Integraciones" },
  ];

  return (
    <Armazon titulo={organizacion.name} barra={
      <>

        <header className="filo-luz shrink-0 px-4 pb-3.5 pt-4">
          {/* «Organizaciones», una sola vez y en un solo sitio. Es el nombre que
              usaban cuatro de las cinco cabeceras copiadas. */}
          <Link
            href="/app"
            className="presionable -ml-1 mb-3 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5
              text-[11px] text-muted hover:text-accent-bright"
          >
            <ArrowLeft size={12} />
            Organizaciones
          </Link>

          <div className="flex items-center gap-2.5">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo}
                alt=""
                className="size-9 shrink-0 rounded-xl border border-line-strong object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-xl border border-line-strong
                  bg-accent-soft/70 font-display text-sm font-semibold text-accent-bright"
              >
                {inicial}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold" title={organizacion.name}>
                {organizacion.name}
              </h1>
              <p className="mt-0.5 text-[10px] capitalize text-faint">{organizacion.role}</p>
            </div>
          </div>
        </header>

        <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
          <Link
            href={`${base}/buscar`}
            style={retraso(0)}
            className="devup-entrada presionable flex h-9 items-center gap-2 rounded-xl border border-line
              bg-canvas/50 px-2.5 text-[13px] text-muted
              hover:border-line-strong hover:bg-canvas hover:text-ink"
          >
            <Search size={13} className="shrink-0 text-faint" />
            Buscar
          </Link>

          <div>
            <GrupoRotulo titulo="Organización" />
            {/* El rótulo va FUERA de la capa y los destinos dentro: la capa
                agrupa lo que se puede pulsar, y meter el título ahí lo haría
                parecer una fila más de la lista. */}
            <div className="capa space-y-0.5 rounded-2xl p-1.5">
            {pantallas.map((p, i) => (
              <ItemNav
                key={p.href}
                href={p.href}
                icono={p.icono}
                indice={i + 1}
                activo={pathname === p.href}
              >
                {p.texto}
              </ItemNav>
            ))}

            {/* NAVEGACIÓN DURA, Y NO <Link>. El entorno embebido necesita que la
                página se sirva con sus cabeceras de aislamiento, y una
                navegación de cliente no vuelve a pedirla al servidor: se
                quedaría sin ellas y WebContainer no arranca. Es el fallo menos
                evidente de este archivo, así que va anotado aquí y en
                docs/LO-QUE-HAY-Y-LO-QUE-FALTA.md. */}
            <a
              href={`${base}/dev`}
              style={retraso(4)}
              className="devup-entrada presionable relative flex items-center gap-2.5 rounded-lg py-1.5
                pl-3 pr-2 text-[13px] text-muted hover:bg-raised/70 hover:text-ink"
            >
              <span className="shrink-0 text-faint">
                <Code2 size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate">Entorno de desarrollo</span>
            </a>

            {puedeAjustar && (
              <ItemNav
                href={`${base}/ajustes`}
                icono={<Settings size={14} />}
                indice={5}
                activo={pathname === `${base}/ajustes`}
              >
                Ajustes
              </ItemNav>
            )}
            </div>
          </div>

          <div className="space-y-0.5">
            <GrupoRotulo titulo="Espacios de trabajo" contador={workspaces.length} />
            {workspaces.length === 0 ? (
              <p className="px-3 py-1.5 text-[11px] leading-relaxed text-faint">
                Todavía no hay ninguno. Se crean desde{" "}
                <Link href="/app" className="text-accent hover:underline">
                  organizaciones
                </Link>
                .
              </p>
            ) : (
              workspaces.map((w, i) => (
                <ItemNav
                  key={w.id}
                  href={`/app/w/${w.id}`}
                  icono={
                    w.visibility === "personal" ? <UserRound size={14} /> : <span aria-hidden>#</span>
                  }
                  indice={6 + i}
                  activo={false}
                >
                  {w.name}
                </ItemNav>
              ))
            )}
          </div>
        </nav>

        <footer className="relative shrink-0 px-3 py-3">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px
              bg-gradient-to-r from-transparent via-line-strong to-transparent"
          />
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
            <BotonIcono etiqueta="Cerrar sesión" onClick={() => void signOut()} className="group">
              <LogOut size={15} className="transition-colors group-hover:text-danger" />
            </BotonIcono>
          </div>
        </footer>
      </>
    }>
      {children}
      <PaletaComandos orgId={orgId} />
    </Armazon>
  );
}

function GrupoRotulo({ titulo, contador }: { titulo: string; contador?: number }) {
  return (
    <div className="flex items-center justify-between px-3 pb-1">
      <Rotulo>{titulo}</Rotulo>
      {contador !== undefined && contador > 0 && (
        <Chip tono="neutro" className="border-none px-0 text-faint">
          {contador}
        </Chip>
      )}
    </div>
  );
}

// `ItemNav` vivía aquí duplicado. Ahora es de `@/components/ui/ItemNav`.
