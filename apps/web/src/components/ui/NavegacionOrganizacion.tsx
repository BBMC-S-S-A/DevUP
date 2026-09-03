import { Code2, Database, Github, Lightbulb, Megaphone, Server, Settings, Target } from "lucide-react";
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
}: {
  orgId: string;
  workspaceId?: string;
  pathname: string;
  puedeAjustar: boolean;
  indiceInicial?: number;
}) {
  const base = workspaceId ? `/app/w/${workspaceId}` : `/app/o/${orgId}`;
  const baseDev = `/app/o/${orgId}`;
  const pantallas = [
    { href: `${base}/ventas`, icono: <Target size={14} />, texto: "Ventas" },
    { href: `${base}/github`, icono: <Github size={14} />, texto: "GitHub" },
    { href: `${base}/noticias`, icono: <Megaphone size={14} />, texto: "Noticias" },
    { href: `${base}/infraestructura`, icono: <Server size={14} />, texto: "Infraestructura" },
    { href: `${base}/base-de-datos`, icono: <Database size={14} />, texto: "Base de datos" },
    { href: `${base}/integraciones`, icono: <Lightbulb size={14} />, texto: "Integraciones" },
  ];

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
          así que va anotado aquí y en docs/LO-QUE-HAY-Y-LO-QUE-FALTA.md. */}
      <a
        href={`${baseDev}/dev`}
        style={retraso(indiceInicial + pantallas.length)}
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
          indice={indiceInicial + pantallas.length + 1}
          activo={pathname === `${base}/ajustes`}
        >
          Ajustes
        </ItemNav>
      )}
    </>
  );
}
