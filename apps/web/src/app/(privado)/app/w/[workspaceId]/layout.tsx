"use client";

import {
  ArrowLeft,
  Bot,
  Files,
  Gamepad2,
  Hash,
  KanbanSquare,
  History,
  Building2,
  Inbox,
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
import { Recorrido } from "@/components/recorrido/Recorrido";
import { PaletaComandos } from "@/components/ui/PaletaComandos";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { ItemNav } from "@/components/ui/ItemNav";
import { Avatar } from "@/components/perfil/Avatar";
import { useAvisosDelEspacio } from "@/lib/workspace-feed";

/** Alguien dentro de una sala de voz, tal y como lo cuenta `/voz`. */
type Ocupante = { userId: string; displayName: string; muted: boolean };
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
  /** Quién hay en cada sala de voz ahora mismo. Vacío = nadie. */
  const [ocupacion, setOcupacion] = useState<Record<string, Ocupante[]>>({});
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

  /**
   * La ocupación de las salas de voz.
   *
   * ESTA SÍ SE EMPUJA, al revés que los no leídos de aquí arriba — y la
   * diferencia no es capricho. Un no leído es tuyo y solo tú lo cambias; quién
   * está en una sala lo cambia OTRO, y de eso te tienes que enterar sin
   * refrescar: la gracia de ver una sala ocupada es unirte mientras siguen
   * dentro. Un sondeo de treinta segundos llega tarde a media conversación.
   *
   * El aviso no dice de qué sala —podría ser una privada— así que lo que llega
   * es «vuelve a preguntar». Ver `announceVoz` en la API.
   */
  const loadVoz = useCallback(async () => {
    const { salas } = await api
      .get<{ salas: Record<string, Ocupante[]> }>(`/workspaces/${workspaceId}/voz`)
      .catch(() => ({ salas: {} }));
    setOcupacion(salas);
  }, [workspaceId]);

  useEffect(() => {
    void loadVoz();
  }, [loadVoz]);

  useAvisosDelEspacio(workspaceId, "voz-change", loadVoz);

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
  /** Todo lo que está sin leer, ahora que los canales no salen uno a uno. */
  const sinLeerTotal = Object.values(unread).reduce((suma, n) => suma + n, 0);

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
              salida y se queda.

              LLEVA A LA ORGANIZACIÓN Y NO A LA LISTA DE TODAS. Decía
              «Workspaces» y saltaba a `/app/organizaciones`, que es subir dos
              niveles de una vez: quien quiere salir de un espacio casi nunca
              quiere salir también de la empresa. */}
          {!hayRiel && (
            <Link
              href={`/app/o/${workspace.organizationId}`}
              className="presionable -ml-1 mb-3 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5
                text-[11px] text-muted hover:text-accent-bright"
            >
              <ArrowLeft size={12} />
              Organización
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

          {/* LA PORTADA GLOBAL SIGUE AQUÍ, FUERA DEL GRUPO, por el motivo del
              §5 de CAMINOS.md: no es una pantalla de este espacio, es la que
              contesta «¿qué tengo, en todos?», y meterla dentro del grupo
              «Espacio» la convertiría en una pantalla más de este espacio. Eso
              no cambia: sigue fuera del grupo y sigue encima de Panel.

              LO QUE CAMBIA ES EL RÓTULO, y es lo que estaba mintiendo. Se
              llamaba «Inicio» dentro de un espacio, y ahí «Inicio» solo puede
              querer decir una cosa: el inicio de ESTE espacio. Quien lo pulsa
              estando en Gestek aterriza en una pantalla que suma Gestek y
              devup —«52 tareas en 2 espacios»— sin que nada le haya avisado de
              que salía. La pantalla está bien; el rótulo la presentaba como
              otra cosa.

              Y ENCIMA VA LA VUELTA A LA ORGANIZACIÓN, que es lo que de verdad
              faltaba: desde dentro de un espacio no había forma de subir un
              nivel. La única salida llevaba a `/app/organizaciones` —la lista
              de TODAS— que es subir dos y aterrizar en otro sitio. */}
          <Link
            href={`/app/o/${workspace.organizationId}`}
            style={retraso(1)}
            className="devup-entrada presionable flex h-9 items-center gap-2 rounded-xl border border-line
              bg-canvas/50 px-2.5 text-[13px] text-muted
              hover:border-line-strong hover:bg-canvas hover:text-ink"
          >
            <Building2 size={13} className="shrink-0 text-faint" />
            Organización
          </Link>

          <Link
            href="/app/inicio"
            style={retraso(2)}
            aria-current={pathname === "/app/inicio" ? "page" : undefined}
            className={`devup-entrada presionable flex h-9 items-center gap-2 rounded-xl border px-2.5
              text-[13px] hover:border-line-strong hover:bg-canvas hover:text-ink ${
                pathname === "/app/inicio"
                  ? "border-accent/40 bg-accent-soft/50 text-accent-bright"
                  : "border-line bg-canvas/50 text-muted"
              }`}
          >
            <Inbox size={13} className="shrink-0 text-faint" />
            Todo lo mío
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
                  resaltado={sinLeerTotal > 0}
                  sufijo={
                    // EL CONTADOR SE MUDA AQUÍ CON LA LISTA. Iba en cada canal
                    // de la barra; si la lista se va y el contador no la sigue,
                    // lo que se pierde es enterarte de que alguien te escribió
                    // — que no es un detalle de la mudanza, es lo que la barra
                    // hacía por ti.
                    sinLeerTotal > 0 ? (
                      <span
                        title={`${sinLeerTotal} sin leer en los canales`}
                        className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center
                          rounded-full border border-accent/30 bg-accent/15 px-1
                          font-mono text-[10px] font-medium tabular-nums text-accent-bright"
                      >
                        {sinLeerTotal > 99 ? "99+" : sinLeerTotal}
                      </span>
                    ) : null
                  }
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
              y un canal de texto espera a que llegues.

              LA BARRA YA NO REPITE LA LISTA, y esto es lo que queda de aquella.
              Los canales colgaban aquí enteros —voz y texto— y DevCall era otra
              entrada que enseñaba lo mismo: la misma cosa mirada dos veces.
              Ahora la lista vive en DevCall, que los tiene todos con quién hay
              dentro y con los sin leer.

              Y AQUÍ SE QUEDA LO ÚNICO QUE DEVCALL NO PUEDE DAR: que veas sin
              mirar que hay alguien esperando AHORA. Una sala vacía no es una
              noticia y se busca cuando se necesita; una con gente dentro caduca
              en diez minutos, y para enterarte de eso no puedes tener que abrir
              una pantalla. Por eso salen solo las ocupadas, y la sección entera
              desaparece cuando no hay nadie en ninguna. */}
          <SalasConGente
            salas={voice}
            ocupacion={ocupacion}
            workspaceId={workspaceId}
            pathname={pathname}
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
            <MenuDeUsuario orgId={workspace.organizationId} workspaceId={workspaceId} />
            <NotificationBell />
          </div>
        </footer>
        </>
      }
    >
      <WorkspaceProvider workspace={workspace}>{children}</WorkspaceProvider>
      <PaletaComandos orgId={workspace.organizationId} workspaceId={workspaceId} />
      {/* SOLO EN LA VISTA PROFESIONAL, y por eso va aquí y no en el otro
          `WorkspaceProvider` de arriba: sus pasos hablan de ramas, de tableros
          y de cerrar tareas, y encima de DevVerse serían una ventana tapando
          justo lo que hace que esa vista valga la pena. Quien entre directo a
          la oficina lo verá al volver. */}
      <Recorrido />
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

/**
 * Los avatares apilados de quien está en una sala.
 *
 * ES LO QUE HACE QUE LA BARRA SE LEA SIN MIRARLA: una fila con caras es alguien
 * esperando, y eso caduca — por eso sigue aquí y no solo en DevCall.
 *
 * SOLAPADOS Y CON TOPE EN TRES. Tres caras y un «+2» caben sin empujar el
 * nombre de la sala; cinco lo parten. El número va en mono porque su ancho no
 * debe bailar al pasar de 9 a 10.
 */
function Ocupantes({ gente }: { gente: Ocupante[] }) {
  if (gente.length === 0) return null;
  const visibles = gente.slice(0, 3);
  const resto = gente.length - visibles.length;

  return (
    <span
      className="flex shrink-0 items-center"
      title={`${gente.map((p) => p.displayName).join(", ")} ${gente.length === 1 ? "está" : "están"} dentro`}
    >
      {visibles.map((persona, indice) => (
        <span
          key={persona.userId}
          // El borde del color del fondo es lo que separa una cara de la
          // siguiente cuando se solapan; sin él se leen como una mancha.
          className={`rounded-full border border-surface ${indice > 0 ? "-ml-1.5" : ""}`}
        >
          <Avatar userId={persona.userId} nombre={persona.displayName} tamano={16} />
        </span>
      ))}
      {resto > 0 && (
        <span className="ml-1 font-mono text-[10px] tabular-nums text-faint">+{resto}</span>
      )}
    </span>
  );
}

/**
 * Las salas donde hay alguien ahora mismo.
 *
 * NO ES LA LISTA DE SALAS: es la lista de las que están ocupadas, y la
 * diferencia es todo el sentido de que esto siga en la barra. La lista entera
 * —con las vacías y con los canales de texto— vive en DevCall desde que dejó de
 * estar repetida en los dos sitios.
 *
 * SIN NADIE DENTRO NO SE PINTA NADA, ni siquiera el rótulo: una sección vacía
 * ocupa el mismo sitio que una llena y no dice nada, y lo que esto viene a
 * decir es justamente que hay alguien.
 */
function SalasConGente({
  salas,
  ocupacion,
  workspaceId,
  pathname,
}: {
  salas: Channel[];
  ocupacion: Record<string, Ocupante[]>;
  workspaceId: string;
  pathname: string;
}) {
  const conGente = salas.filter((sala) => (ocupacion[sala.id]?.length ?? 0) > 0);
  if (conGente.length === 0) return null;

  return (
    <div>
      <GrupoRotulo titulo="Hay alguien" />
      <ul className="space-y-0.5">
        {conGente.map((sala, indice) => {
          const href = `/app/w/${workspaceId}/c/${sala.id}`;
          return (
            <li key={sala.id}>
              <ItemNav
                href={href}
                icono={<Volume2 size={15} />}
                activo={pathname === href}
                indice={indice}
                sufijo={<Ocupantes gente={ocupacion[sala.id] ?? []} />}
              >
                {sala.name}
              </ItemNav>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
