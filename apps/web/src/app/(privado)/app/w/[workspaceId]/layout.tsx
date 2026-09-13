"use client";

import {
  ArrowLeft,
  Bot,
  Files,
  Gamepad2,
  Hash,
  KanbanSquare,
  History,
  Home,
  LayoutDashboard,
  PhoneCall,
  LayoutGrid,
  Loader2,
  Lock,
  Plus,
  Search,
  TriangleAlert,
  UserRound,
  Volume2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ApiError, type Channel, type Organization, type Workspace, api } from "@/lib/api";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { MenuDeUsuario } from "@/components/ui/MenuDeUsuario";
import { Armazon, EsqueletoArmazon } from "@/components/ui/Armazon";
import { useHayRiel } from "@/components/ui/RielOrganizaciones";
import { guardarUltimoEspacio, olvidarUltimoEspacio } from "@/lib/ultimo-espacio";
import { ignorar } from "@/lib/fallo";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Entrada } from "@/components/ui/Field";
import { NavegacionOrganizacion } from "@/components/ui/NavegacionOrganizacion";
import { SelectorDeEspacio } from "@/components/ui/SelectorDeEspacio";
import { PaletaComandos } from "@/components/ui/PaletaComandos";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { ItemNav } from "@/components/ui/ItemNav";
import { retraso } from "@/lib/animacion";
import { useSession } from "@/lib/session";
import { useViewMode } from "@/lib/view-mode";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { toast } from "sonner";

// `retraso` vivía aquí duplicado. Ahora es de `@/lib/animacion`, donde está
// también el porqué del tope del índice.

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useSession();
  const hayRiel = useHayRiel();

  // Lo que hace que `/app` te devuelva donde estabas. Va aquí y no en cada
  // pantalla porque este armazón envuelve a todas las del espacio: entrar por
  // un canal, por el tablero o por la auditoría cuenta igual como «estuve
  // aquí».
  useEffect(() => {
    guardarUltimoEspacio(workspaceId);
  }, [workspaceId]);

  const { mode, setMode, ready: modeReady } = useViewMode();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [rolOrganizacion, setRolOrganizacion] = useState<Organization["role"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Y se olvida en cuanto se descubre que no vale. `/app` entra al espacio
  // recordado sin comprobarlo —comprobar cuesta una ronda de peticiones en el
  // gesto más repetido que hay—, así que si no se borra aquí, cada vez que se
  // abra la aplicación se volvería a aterrizar en este mismo error. Sin esto,
  // «se paga la vez que falla» se convierte en «se paga siempre a partir de
  // esa vez».
  useEffect(() => {
    if (!loading && (error || !workspace)) olvidarUltimoEspacio();
  }, [error, loading, workspace]);

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

  // Para «Ajustes» de la sección de organización: no hay ruta para pedir una
  // sola (mismo motivo que en el armazón de organización), así que se pide la
  // lista y se busca la que corresponde a este workspace.
  useEffect(() => {
    if (!workspace) return;
    let vigente = true;
    api
      .get<{ organizations: Organization[] }>("/organizations")
      .then(({ organizations }) => {
        if (!vigente) return;
        const mia = organizations.find((o) => o.id === workspace.organizationId);
        setRolOrganizacion(mia?.role ?? null);
      })
      // Sin rol no se pintan las opciones de administrar. Es una pérdida de
      // capacidad silenciosa, así que al menos queda anotada.
      .catch(ignorar("no se pudo saber tu rol en la organización"));
    return () => {
      vigente = false;
    };
  }, [workspace]);

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
      <div className="grid min-h-[100svh] place-items-center">
        <Loader2 className="animate-spin text-faint" size={20} />
      </div>
    ) : (
      <EsqueletoArmazon filas={6} />
    );
  }

  if (error || !workspace) {
    return (
      <div className="grid min-h-[100svh] place-items-center px-6">
        <EstadoVacio
          icono={<TriangleAlert size={20} className="text-danger" />}
          titulo={error ?? "workspace no encontrado"}
          pista="Puede que ya no exista, o que esta cuenta no tenga acceso."
          accion={
            <Link
              href="/app/organizaciones"
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
      <div className="relative h-[100svh]">
        <WorkspaceProvider workspace={workspace}>{children}</WorkspaceProvider>
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
          {/* Con el riel puesto este enlace sobra: la vuelta a todas las
              organizaciones está en su pie, y dos caminos al mismo sitio en la
              misma pantalla es la duplicación que este armazón vino a quitar.
              Sin riel —una sola organización, o móvil— sigue siendo la única
              salida y se queda. */}
          {!hayRiel && (
            <Link
              href="/app/organizaciones"
              className="presionable -ml-1 mb-3 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5
                text-[11px] text-muted hover:text-accent-bright"
            >
              <ArrowLeft size={12} />
              Workspaces
            </Link>
          )}

          {/* LA CABECERA ES EL SELECTOR. El riel son chapas de cuarenta
              píxeles, y se reportó cuatro veces que no se podía cambiar de
              organización con él. Sea cual sea el motivo exacto, la conclusión
              es la misma: cambiar de contexto no puede depender de acertar en
              una chapa pequeña. Aquí está donde el ojo ya está —esta cabecera
              dice en qué espacio estás— con el nombre escrito y sitio para los
              demás. El riel se queda: para quien lo usa es un clic, y las dos
              cosas no se estorban. */}
          <SelectorDeEspacio espacioActual={workspaceId}>
            <span className="flex items-center gap-2.5">
              {/* La inicial en una chapa hace que dos workspaces con nombres
                  parecidos se distingan por la forma antes que por la lectura. */}
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-xl border border-line-strong
                  bg-accent-soft/70 font-display text-sm font-semibold text-accent-bright"
              >
                {inicial}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold" title={workspace.name}>
                  {workspace.name}
                </span>
                {workspace.visibility === "personal" && (
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-faint">
                    <UserRound size={9} className="shrink-0" />
                    Solo tú ves este workspace
                  </span>
                )}
              </span>
            </span>
          </SelectorDeEspacio>
        </header>

        {/* min-h-0 es lo que permite que el desplazamiento viva aquí dentro: sin
            él, un flex en columna crece con su contenido y el pie con la sesión
            se va por debajo del borde de la pantalla. */}
        <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
          {/* Buscar es de la organización entera, no de este workspace, así que
              va fuera del grupo y con forma de campo: la caja dice «aquí se
              busca» antes de leer la palabra. La URL sí es la del workspace
              -mismo motivo que el resto de NavegacionOrganizacion-: abrir el
              buscador no debe cambiar de armazón. */}
          <Link
            href={`/app/w/${workspaceId}/buscar`}
            style={retraso(0)}
            className="devup-entrada presionable flex h-9 items-center gap-2 rounded-xl border border-line
              bg-canvas/50 px-2.5 text-[13px] text-muted
              hover:border-line-strong hover:bg-canvas hover:text-ink"
          >
            <Search size={13} className="shrink-0 text-faint" />
            Buscar
          </Link>

          {/* INICIO VA AQUÍ, FUERA DEL GRUPO, y el motivo es el mismo que
              pide el §5 de CAMINOS.md: no es una pantalla de este espacio, es
              la que contesta «¿qué tengo, en todos?». Se pidió «encima de
              Panel», y encima está — pero encima del rótulo y no debajo de él,
              porque el grupo se llama «Espacio» y meterla dentro la convertiría
              en una pantalla más de este espacio, que es justo lo que el §5
              dice que no es.

              Y hay precedente a dos líneas de aquí: «Buscar» ya vive fuera del
              grupo por esta misma razón. */}
          <Link
            href="/app/inicio"
            style={retraso(0)}
            aria-current={pathname === "/app/inicio" ? "page" : undefined}
            className={`devup-entrada presionable flex h-9 items-center gap-2 rounded-xl border px-2.5
              text-[13px] hover:border-line-strong hover:bg-canvas hover:text-ink ${
                pathname === "/app/inicio"
                  ? "border-accent/40 bg-accent-soft/50 text-accent-bright"
                  : "border-line bg-canvas/50 text-muted"
              }`}
          >
            <Home size={13} className="shrink-0 text-faint" />
            Inicio
          </Link>

          <div>
            <GrupoRotulo titulo="Espacio" />
            {/* Los destinos fijos del espacio van en su propia capa, separados
                de los canales de abajo. No es adorno: los canales entran y
                salen —se crean, se borran, cambian de nombre— y estos cinco no
                se mueven nunca. Meterlos en una capa dice cuál de las dos
                listas es el mapa y cuál es el contenido. */}
            <ul className="capa space-y-0.5 rounded-2xl p-1.5">
              <li>
                {/* DevCall va el primero del grupo porque es lo único de esta
                    lista donde hay alguien esperando. El resto —el panel, la
                    mesa, el tablero— sigue ahí dentro de una hora; una sala con
                    gente dentro, no. */}
                <ItemNav
                  href={`/app/w/${workspaceId}/devcall`}
                  icono={<PhoneCall size={15} />}
                  activo={pathname === `/app/w/${workspaceId}/devcall`}
                  indice={0}
                >
                  DevCall
                </ItemNav>
              </li>
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
                {/* La mesa va justo debajo del panel porque son la misma
                    idea a dos escalas: el panel coloca tarjetas de un vistazo,
                    la mesa coloca herramientas para trabajar en ellas. */}
                <ItemNav
                  href={`/app/w/${workspaceId}/mesa`}
                  icono={<LayoutGrid size={15} />}
                  activo={pathname === `/app/w/${workspaceId}/mesa`}
                  indice={1}
                >
                  Mesa
                </ItemNav>
              </li>
              <li>
                {/* La biblioteca vivía en la raíz del workspace
                    (`/app/w/[workspaceId]`), que era también donde aterrizaba
                    cualquiera que acabara de crear o de entrar a un workspace.
                    Se movió a su propia ruta porque una biblioteca vacía no es
                    lo primero que alguien nuevo debería ver: ver
                    `w/[workspaceId]/page.tsx`, que ahora manda al canal
                    general en su lugar. */}
                <ItemNav
                  href={`/app/w/${workspaceId}/archivos`}
                  icono={<Files size={15} />}
                  activo={pathname === `/app/w/${workspaceId}/archivos`}
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
                {/* «Qué ha pasado aquí» va junto al tablero y no junto a la
                    auditoría, aunque las dos lean el mismo registro. La
                    auditoría contesta «¿quién ha hecho cuánto?» y se abre
                    cuando toca revisar; esto contesta «¿qué me he perdido?» y
                    se abre al llegar. Quien vuelve un lunes no está auditando a
                    nadie. */}
                <ItemNav
                  href={`/app/w/${workspaceId}/actividad`}
                  icono={<History size={15} />}
                  activo={pathname === `/app/w/${workspaceId}/actividad`}
                  indice={2}
                >
                  Qué ha pasado
                </ItemNav>
              </li>
              <li>
                {/* El asistente va con el trabajo y no en un apartado aparte:
                    se le pregunta POR el tablero, el panel y la biblioteca, asi
                    que su sitio es junto a ellos. Usa la clave de cada persona
                    -DevUP no compra inferencia-, y quien no la haya puesto se
                    encuentra ahi la explicacion y el enlace, en vez de un
                    error. */}
                <ItemNav
                  href={`/app/w/${workspaceId}/asistente`}
                  icono={<Bot size={15} />}
                  activo={pathname === `/app/w/${workspaceId}/asistente`}
                  indice={3}
                >
                  Asistente
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

          {/* La organización, dentro del mismo armazón. Antes había que salir
              del workspace —«← Workspaces», elegir la organización, y ahí sí
              aparecía Ventas o Infraestructura—: dos saltos para algo que se
              usa a diario. Ahora es una sección más de esta misma barra, y el
              rol para «Ajustes» se pide aparte porque no hay ruta para una
              organización sola (mismo motivo que el armazón de organización). */}
          {/* LOS CANALES ARRIBA, justo debajo del espacio. Estaban al final,
              debajo de dieciséis destinos, y hacía falta desplazarse para
              llegar a una conversación o a una llamada — que es lo que más se
              abre en todo el día y lo que otra persona está esperando ahora
              mismo. Las herramientas del proyecto y de la organización se
              miran de vez en cuando; un canal, cada rato.

              Y la voz antes que el texto: un canal de voz es gente esperando,
              y un canal de texto espera a que llegues. */}
          <ChannelGroup
            title="Voz"
            kind="voice"
            channels={voice}
            workspaceId={workspaceId}
            pathname={pathname}
            unread={unread}
            onCreated={load}
          />
          <ChannelGroup
            title="Texto"
            kind="text"
            channels={text}
            workspaceId={workspaceId}
            pathname={pathname}
            unread={unread}
            onCreated={load}
          />


          {/* DOS GRUPOS Y NO UNO, porque no son lo mismo.
              GitHub, Infraestructura, Base de datos, Integraciones y Auditoría
              son de ESTE proyecto desde la migración 0035 — el de al lado
              enseña otra cosa— y estaban bajo un rótulo que decía
              «Organización». Un rótulo que miente en la barra cuesta más que
              uno que falta, porque nadie lo comprueba: se lee una vez al
              aprender la aplicación y ya no se vuelve a mirar.
              Ventas y Noticias sí son de la empresa entera, y se quedan abajo
              con Ajustes y Mi cuenta. */}
          {rolOrganizacion && (
            <>
              <div>
                <GrupoRotulo titulo="Proyecto" />
                {/* `div` y no `ul`: `NavegacionOrganizacion` no envuelve sus
                    destinos en `<li>` —los mismos elementos van también sueltos
                    en el armazón de organización—, así que un `<ul>` aquí
                    dejaría hijos que no son `<li>` directamente dentro de una
                    lista. */}
                <div className="capa space-y-0.5 rounded-2xl p-1.5">
                  <NavegacionOrganizacion
                    orgId={workspace.organizationId}
                    workspaceId={workspaceId}
                    pathname={pathname}
                    puedeAjustar={false}
                    indiceInicial={4}
                    grupo="proyecto"
                  />
                </div>
              </div>

              <div>
                <GrupoRotulo titulo="Organización" />
                <div className="capa space-y-0.5 rounded-2xl p-1.5">
                  <NavegacionOrganizacion
                    orgId={workspace.organizationId}
                    workspaceId={workspaceId}
                    pathname={pathname}
                    puedeAjustar={rolOrganizacion === "owner" || rolOrganizacion === "admin"}
                    indiceInicial={9}
                    grupo="organizacion"
                  />
                </div>
              </div>
            </>
          )}

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
          {/* El estado, el tema y el cierre de sesión se mudan al menú de la
              cuenta. Ocupaban tres filas fijas de una barra que ya tiene
              diecisiete destinos, y el botón de salir suelto era peor que
              ocupar sitio: un icono de puerta al lado del nombre del espacio no
              dice «cerrar sesión», dice «salir de aquí». */}
          <div className="flex items-center gap-2">
            <MenuDeUsuario orgId={workspace.organizationId} />
            <NotificationBell />
          </div>
        </footer>
        </>
      }
    >
      <WorkspaceProvider workspace={workspace}>{children}</WorkspaceProvider>
      <PaletaComandos orgId={workspace.organizationId} workspaceId={workspaceId} />
    </Armazon>
  );
}

function GrupoRotulo({
  titulo,
  contador,
  accion,
}: {
  titulo: string;
  contador?: number;
  /** A la derecha del rotulo: crear algo de este grupo, sin salir de el. */
  accion?: ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-2 px-3">
      <Rotulo>{titulo}</Rotulo>
      <span aria-hidden className="h-px flex-1 bg-line" />
      {contador !== undefined && (
        <span className="font-mono text-[10px] tabular-nums text-faint">{contador}</span>
      )}
      {accion}
    </div>
  );
}

// `ItemNav` vivía aquí duplicado. Ahora es de `@/components/ui/ItemNav`.

/**
 * Un grupo de canales, con su boton de crear dentro.
 *
 * EL BOTON SUELTO DE «NUEVO CANAL» ERA EL PROBLEMA DEL FLUJO. Estaba debajo de
 * las dos listas, no decia de que tipo iba a ser el canal, y hacer una sala de
 * voz consistia en pulsarlo, escribir el nombre y acordarse de cambiar el tipo
 * —que salia en «Texto» por defecto—. Casi todas las salas de voz nacian asi,
 * por descarte.
 *
 * Ahora el «+» esta en la cabecera del grupo, y el grupo ya dice el tipo: el
 * de Voz crea una sala, el de Texto crea un canal. No hay nada que elegir
 * porque la eleccion ya la hiciste al decidir donde pulsar.
 *
 * Y los dos grupos se pintan aunque esten vacios: antes, un espacio sin
 * canales de voz no ensenaba la seccion, asi que tampoco ensenaba por donde se
 * crea el primero.
 */
function ChannelGroup({
  title,
  kind,
  channels,
  workspaceId,
  pathname,
  unread,
  onCreated,
}: {
  title: string;
  kind: "text" | "voice";
  channels: Channel[];
  workspaceId: string;
  pathname: string;
  unread: Record<string, number>;
  onCreated: () => Promise<void>;
}) {
  const [creando, setCreando] = useState(false);
  const esVoz = kind === "voice";

  return (
    <div>
      <GrupoRotulo
        titulo={title}
        contador={channels.length}
        accion={
          <BotonIcono
            etiqueta={esVoz ? "Nueva sala de voz" : "Nuevo canal de texto"}
            onClick={() => setCreando((a) => !a)}
            aria-expanded={creando}
          >
            <Plus size={13} />
          </BotonIcono>
        }
      />

      {creando && (
        <div className="mb-1.5">
          <NewChannel
            workspaceId={workspaceId}
            kind={kind}
            onCreated={onCreated}
            onCerrar={() => setCreando(false)}
          />
        </div>
      )}

      {channels.length === 0 ? (
        <p className="px-3 text-[11px] text-faint">
          {esVoz ? "Ninguna sala todavia." : "Ninguno todavia."}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {channels.map((channel, indice) => {
            const href = `/app/w/${workspaceId}/c/${channel.id}`;
            const active = pathname === href;
            const pending = unread[channel.id] ?? 0;

            return (
              // `group/canal` con nombre: la barra ya tiene otros grupos
              // anidados, y un `group` sin nombre se los pisa. `relative`
              // porque el botón de borrar va encima del canto derecho.
              <li key={channel.id} className="group/canal relative">
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
                <BorrarCanal
                  canal={channel}
                  enEl={active}
                  workspaceId={workspaceId}
                  onBorrado={onCreated}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Borrar un canal.
 *
 * LA RUTA YA EXISTÍA Y NADIE LA LLAMABA. `DELETE /channels/:channelId` está en
 * la API desde el principio; lo que faltaba era la puerta. Es el cuarto caso de
 * la misma clase, y el barrido de rutas muertas ya dejó escrita la lección: una
 * ruta sin llamantes casi nunca es código de más, suele ser una función
 * terminada a la que le falta el botón.
 *
 * VA COMO HERMANO DEL ENLACE, NO DENTRO. `sufijo` de `ItemNav` se pinta dentro
 * del `<Link>`, y un `<button>` dentro de un `<a>` es HTML inválido —además de
 * que pulsarlo navegaría—. Así que va aparte, colocado sobre el canto derecho.
 *
 * SOLO APARECE AL PASAR POR ENCIMA O AL LLEGAR CON EL TECLADO
 * (`focus-within`). Una papelera visible en cada fila de una barra con
 * diecisiete destinos es un accidente esperando; y sin `focus-within` sería una
 * papelera que solo existe para quien usa ratón, que es el error que acabamos
 * de arreglar en el tablero.
 *
 * EL DIÁLOGO DICE LO QUE SE PIERDE. La base borra en cascada los mensajes, las
 * llamadas, las grabaciones y LA SALA DE DEVVERSE del canal. Eso último no lo
 * adivina nadie: quien borra un canal de texto no espera que desaparezca una
 * habitación. Los archivos sobreviven —`channel_id` pasa a nulo—, y también se
 * dice, porque callarlo haría dudar antes de borrar.
 */
function BorrarCanal({
  canal,
  enEl,
  workspaceId,
  onBorrado,
}: {
  canal: Channel;
  /** Si es el canal que se está viendo ahora mismo. */
  enEl: boolean;
  workspaceId: string;
  onBorrado: () => Promise<void>;
}) {
  const confirmar = useConfirmar();
  const router = useRouter();

  return (
    <span
      className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity
        duration-[var(--dur-hover)] group-hover/canal:opacity-100 group-focus-within/canal:opacity-100
        motion-reduce:transition-none"
    >
      <BotonIcono
        etiqueta={`Borrar ${canal.kind === "voice" ? "la sala" : "el canal"} ${canal.name}`}
        onClick={async () => {
          const seguro = await confirmar({
            titulo: `¿Borrar ${canal.kind === "voice" ? "la sala" : "el canal"} «${canal.name}»?`,
            descripcion:
              "Se borran también sus mensajes, sus llamadas y grabaciones, y su sala de DevVerse. " +
              "Los archivos que se compartieron ahí se quedan en la biblioteca. No se puede deshacer.",
            accion: "Borrar",
            peligro: true,
          });
          if (!seguro) return;
          try {
            await api.delete(`/channels/${canal.id}`);
            // Salir ANTES de recargar la lista: quedarse en la pantalla de un
            // canal que ya no existe da un error que no es del usuario.
            if (enEl) router.push(`/app/w/${workspaceId}`);
            await onBorrado();
            toast.success(`«${canal.name}» borrado`);
          } catch (caught) {
            // El permiso lo decide la base, no esta pantalla. Si no se puede,
            // hay que contarlo: un botón que no hace nada es peor que no tenerlo.
            toast.error(caught instanceof ApiError ? caught.message : "no se pudo borrar");
          }
        }}
      >
        <Trash2 size={12} />
      </BotonIcono>
    </span>
  );
}

/**
 * El formulario, ya sin selector de tipo: lo trae puesto quien lo abre.
 *
 * Sigue quedando la casilla de privado, que si es una decision —y una que no
 * se deduce de donde hayas pulsado—. Si falla la creacion se dice: antes el
 * `finally` apagaba el indicador y el canal simplemente no aparecia.
 */
function NewChannel({
  workspaceId,
  kind,
  onCreated,
  onCerrar,
}: {
  workspaceId: string;
  kind: "text" | "voice";
  onCreated: () => Promise<void>;
  onCerrar: () => void;
}) {
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    // Crece desde el borde de arriba, que es donde esta la cabecera que lo
    // abrio: un panel que nace de su propio centro se despega de lo que lo
    // invoco.
    <Tarjeta className="devup-emerge origin-top p-2.5">
      <Rotulo className="mb-2 block">
        {kind === "voice" ? "Nueva sala de voz" : "Nuevo canal de texto"}
      </Rotulo>
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
            setIsPrivate(false);
            onCerrar();
            await onCreated();
          } catch (caught) {
            toast.error(caught instanceof ApiError ? caught.message : "no se pudo crear el canal");
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-2.5"
      >
        {/* Mono porque el nombre de canal es un identificador, no una frase: se
            escribe en minusculas y con guiones y asi se ve mientras se teclea. */}
        <Entrada
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={kind === "voice" ? "sala-de-equipo" : "nombre-del-canal"}
          className="font-mono"
        />

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
          {/* El ancho lo pone el envoltorio: Boton trae `shrink-0` de fabrica y
              un `flex-1` encima seria una carrera de utilidades. */}
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
          <Boton type="button" variante="fantasma" tamano="sm" onClick={onCerrar}>
            Cancelar
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
