import {
  Code2,
  Database,
  Github,
  KeyRound,
  Lightbulb,
  Megaphone,
  ScanSearch,
  Server,
  Settings,
  Target,
} from "lucide-react";
import { ItemNav } from "./ItemNav";
import { retraso } from "@/lib/animacion";

/**
 * Las pantallas de la organización, en la barra lateral.
 *
 * ESTABA DUPLICADA A MEDIAS: vivía completa en el armazón de organización, y
 * para llegar a ella desde un workspace había que salir primero — «← Workspaces»,
 * elegir la organización, y ahí sí aparecía. Juan lo pidió al revés: que esta
 * sección viva TAMBIÉN dentro del armazón del espacio de trabajo, como una
 * sección más de la misma barra, sin salir de dónde se está.
 *
 * Por eso es un componente aparte y no una copia pegada dos veces: es
 * exactamente la lista que ya perdió sincronía una vez en esta barra
 * (`ItemNav`, ver su propio comentario) y sería el mismo error otra vez.
 *
 * `indiceInicial` deja que quien llama decida dónde continúa el escalonado:
 * en el armazón de organización esta sección abre la barra: empieza en 0. En
 * el del workspace va después de «Espacio», así que sigue contando desde ahí.
 *
 * `workspaceId`, cuando se pasa, cambia a DÓNDE llevan estos enlaces —a
 * `/app/w/[workspaceId]/ventas` en vez de `/app/o/[orgId]/ventas`— para que
 * abrir Ventas desde un workspace no cambie de armazón: sigue siendo
 * `WorkspaceLayout` el que pinta la barra, con `useOrgId` resolviendo la
 * organización desde el `WorkspaceProvider` en vez de la URL. `/dev` es la
 * excepción a propósito: ya es una salida deliberada a pantalla completa
 * -el entorno embebido lo exige, ver el comentario de más abajo- así que no
 * hay barra de la que "salirse" y da igual desde dónde se entre.
 */
export function NavegacionOrganizacion({
  orgId,
  workspaceId,
  pathname,
  puedeAjustar,
  indiceInicial = 0,
  grupo,
}: {
  orgId: string;
  workspaceId?: string;
  pathname: string;
  puedeAjustar: boolean;
  indiceInicial?: number;
  /**
   * Qué mitad pintar. Sin decir nada salen las dos seguidas, que es lo que
   * hace falta fuera de un espacio de trabajo.
   */
  grupo?: "organizacion" | "proyecto";
}) {
  const base = workspaceId ? `/app/w/${workspaceId}` : `/app/o/${orgId}`;

  /**
   * GitHub, Infraestructura, Base de datos e Integraciones solo salen dentro
   * de un workspace (migración 0035).
   *
   * No es una cuestión de orden en la barra: es que fuera de un workspace no
   * tienen respuesta. Cada proyecto tiene su git, su base y su
   * infraestructura, así que «los repositorios de la organización» ya no es
   * una pregunta con sentido — y la pantalla que la contestaba enseñaba a los
   * tres proyectos de una empresa exactamente lo mismo.
   */
  /**
   * DE LA ORGANIZACIÓN DE VERDAD: lo que es igual mires desde el espacio que
   * mires. El embudo de ventas y las noticias son de la empresa, no del
   * proyecto.
   */
  const deLaOrganizacion = [
    { href: `${base}/ventas`, icono: <Target size={14} />, texto: "Ventas" },
    { href: `${base}/noticias`, icono: <Megaphone size={14} />, texto: "Noticias" },
  ];

  /**
   * DEL PROYECTO, y por eso solo salen dentro de uno.
   *
   * La migración 0035 les dio a cada espacio su git, su base y su
   * infraestructura. Desde entonces estaban aquí, pero debajo de un rótulo que
   * decía «Organización» — y eso es sencillamente falso: lo que enseñan es de
   * ESTE proyecto y del de al lado enseñan otra cosa. Un rótulo que miente en
   * la barra lateral cuesta más que uno que falta, porque nadie lo comprueba.
   */
  const delProyecto = workspaceId
    ? [
        { href: `${base}/github`, icono: <Github size={14} />, texto: "GitHub" },
        { href: `${base}/infraestructura`, icono: <Server size={14} />, texto: "Infraestructura" },
        { href: `${base}/base-de-datos`, icono: <Database size={14} />, texto: "Base de datos" },
        { href: `${base}/integraciones`, icono: <Lightbulb size={14} />, texto: "Integraciones" },
        // Va la última porque es la portada de las dos de arriba, no una
        // quinta pantalla: reúne lo que Base de datos e Integraciones ya
        // analizan por su cuenta. Quien busca «auditar mi proyecto» no abre
        // ninguna de las dos, y ese era todo el problema.
        { href: `${base}/auditoria`, icono: <ScanSearch size={14} />, texto: "Auditoría" },
      ]
    : [];

  // `grupo` deja que la barra pinte cada mitad bajo su propio rótulo. Sin él se
  // devuelven las dos seguidas, que es lo que sigue necesitando el armazón de
  // organización, donde no hay proyecto del que hablar.
  const pantallas =
    grupo === "proyecto"
      ? delProyecto
      : grupo === "organizacion"
        ? deLaOrganizacion
        : [...deLaOrganizacion, ...delProyecto];

  return (
    <>
      {pantallas.map((p, i) => (
        <ItemNav
          key={p.href}
          href={p.href}
          icono={p.icono}
          indice={indiceInicial + i}
          activo={pathname === p.href}
        >
          {p.texto}
        </ItemNav>
      ))}

      {/* NAVEGACIÓN DURA, Y NO <Link>. El entorno embebido necesita que la
          página se sirva con sus cabeceras de aislamiento, y una navegación de
          cliente no vuelve a pedirla al servidor: se quedaría sin ellas y
          WebContainer no arranca. Es el fallo menos evidente de este archivo,
          así que va anotado aquí y en docs/LO-QUE-HAY-Y-LO-QUE-FALTA.md.

          Solo dentro de un workspace, como el resto de instrumentos: lo que
          abre son los repositorios del proyecto, y desde 0035 esos son suyos
          y no de la organización. */}
      {workspaceId && grupo !== "organizacion" && (
        <a
          href={`${base}/dev`}
          style={retraso(indiceInicial + pantallas.length)}
          className="devup-entrada presionable relative flex items-center gap-2.5 rounded-lg py-1.5
            pl-3 pr-2 text-[13px] text-muted hover:bg-raised/70 hover:text-ink"
        >
          <span className="shrink-0 text-faint">
            <Code2 size={14} />
          </span>
          <span className="min-w-0 flex-1 truncate">Entorno de desarrollo</span>
        </a>
      )}

      {/* Mi cuenta va SIN puerta de rol, al revés que Ajustes: ahí es correcto
          esconderlo porque es la organización, pero una conexión de agente la
          necesita cualquiera que quiera enchufar su Claude, y un miembro raso
          es justamente quien no tiene otra manera de llegar. */}
      {grupo !== "proyecto" && (
        <ItemNav
          href={`${base}/cuenta`}
          icono={<KeyRound size={14} />}
          indice={indiceInicial + pantallas.length + 1}
          activo={pathname === `${base}/cuenta`}
        >
          Mi cuenta
        </ItemNav>
      )}

      {puedeAjustar && grupo !== "proyecto" && (
        <ItemNav
          href={`${base}/ajustes`}
          icono={<Settings size={14} />}
          indice={indiceInicial + pantallas.length + 2}
          activo={pathname === `${base}/ajustes`}
        >
          Ajustes
        </ItemNav>
      )}
    </>
  );
}
