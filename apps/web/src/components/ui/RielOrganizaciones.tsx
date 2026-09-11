"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { type Organization, type Workspace, api } from "@/lib/api";

/**
 * Si hay riel puesto, para que el armazón se aparte lo justo.
 *
 * Es un contexto y no una propiedad porque quien lo necesita —`Armazon`— está
 * dos armazones por debajo de quien lo sabe, y porque el riel puede no
 * pintarse: con una sola organización no aparece, y entonces apartarse dejaría
 * un hueco de 56 px sin nada dentro. Preguntarlo dos veces a la API para
 * averiguarlo sería pedir lo mismo dos veces por no compartir un booleano.
 */
const RielContext = createContext(false);

/** Lo usa `Armazon` para decidir su margen izquierdo. */
export function useHayRiel(): boolean {
  return useContext(RielContext);
}

/**
 * El riel de organizaciones: la única cosa que no cambia nunca.
 *
 * POR QUÉ EXISTE. Había tres armazones —el de organizaciones, el de una
 * organización y el del espacio de trabajo— y cada uno repintaba la pantalla
 * entera. Cambiar de espacio era volver al principio y volver a entrar: una
 * ventana dentro de otra dentro de otra, que es literalmente como se describió
 * al usarlo.
 *
 * VIVE EN `/app/layout.tsx` Y ESO ES TODO EL TRUCO. Ese armazón ya es el padre
 * común de `/app/o/…` y `/app/w/…`, así que navegar entre ellos no lo desmonta.
 * El riel se pinta una vez y sobrevive a todo lo que pase debajo — igual que la
 * llamada y la música, que viven ahí por el mismo motivo.
 *
 * SOLO EN ESCRITORIO. En móvil la barra ya es un cajón que se va del todo (ver
 * `Armazon`), y meter además un carril fijo de 56 px se comería un séptimo de
 * una pantalla de 375. Ahí el camino de vuelta sigue siendo el enlace de la
 * cabecera, que por eso se conserva con `md:hidden` en vez de borrarse.
 */
export function ProveedorRiel({ children }: { children: ReactNode }) {
  const [hayRiel, setHayRiel] = useState(false);
  return (
    <RielContext.Provider value={hayRiel}>
      <RielOrganizaciones onVisible={setHayRiel} />
      {children}
    </RielContext.Provider>
  );
}

function RielOrganizaciones({ onVisible }: { onVisible: (visible: boolean) => void }) {
  const pathname = usePathname();
  const [organizaciones, setOrganizaciones] = useState<Organization[]>([]);
  /** Por organización, a dónde lleva su chapa. Se resuelve una vez. */
  const [destinos, setDestinos] = useState<Record<string, string>>({});
  const [logos, setLogos] = useState<Record<string, string>>({});

  useEffect(() => {
    let vigente = true;

    void (async () => {
      const { organizations } = await api
        .get<{ organizations: Organization[] }>("/organizations")
        .catch(() => ({ organizations: [] as Organization[] }));
      if (!vigente) return;
      setOrganizaciones(organizations);

      // El destino de cada chapa es su primer espacio de trabajo, no la
      // organización: entrar a una organización para elegir espacio es
      // exactamente el salto de dos pasos que este riel viene a quitar. Si no
      // tiene ninguno, cae a la organización, que es donde se crea el primero.
      const resueltos: Record<string, string> = {};
      await Promise.all(
        organizations.map(async (o) => {
          const { workspaces } = await api
            .get<{ workspaces: Workspace[] }>(`/organizations/${o.id}/workspaces`)
            .catch(() => ({ workspaces: [] as Workspace[] }));
          resueltos[o.id] = workspaces[0]
            ? `/app/w/${workspaces[0].id}`
            : `/app/o/${o.id}/ventas`;
        }),
      );
      if (vigente) setDestinos(resueltos);

      // Los logos van después y por separado: son una petición por
      // organización que puede fallar sin impedir nada. Sin ellos queda la
      // chapa con la inicial, que ya distingue.
      await Promise.all(
        organizations
          .filter((o) => o.logoKey)
          .map(async (o) => {
            const { url } = await api
              .get<{ url: string | null }>(`/organizations/${o.id}/logo-url`)
              .catch(() => ({ url: null }));
            if (vigente && url) setLogos((previos) => ({ ...previos, [o.id]: url }));
          }),
      );
    })();

    return () => {
      vigente = false;
    };
  }, []);

  // Con una sola organización el riel no informa de nada: sería una columna
  // fija con un único botón que lleva a donde ya estás. Aparece cuando hay algo
  // entre lo que elegir.
  //
  // Y no se pinta en dos sitios. En `/app` la lista de organizaciones ES el
  // contenido, así que el riel sería la misma lista dos veces; y el entorno de
  // desarrollo se sirve a pantalla completa con las cabeceras de aislamiento
  // que exige WebContainer, donde no hay barra de la que colgarse.
  const visible =
    organizaciones.length >= 2 && pathname !== "/app" && !pathname.endsWith("/dev");

  useEffect(() => {
    onVisible(visible);
  }, [visible, onVisible]);

  if (!visible) return null;

  return (
    <nav
      aria-label="Organizaciones"
      className="fixed inset-y-3 left-3 z-30 hidden w-14 flex-col items-center gap-1.5
        rounded-2xl border border-line bg-raised/60 py-3 backdrop-blur md:flex"
    >
      {organizaciones.map((o) => (
        <Chapa
          key={o.id}
          organizacion={o}
          logo={logos[o.id]}
          href={destinos[o.id] ?? `/app/o/${o.id}/ventas`}
          // Activa por la organización que hay en la URL. Bajo `/app/w/…` no
          // está, así que ahí no se marca ninguna: marcar la equivocada sería
          // peor que no marcar, y la cabecera de la barra ya dice dónde estás.
          activa={pathname.startsWith(`/app/o/${o.id}`)}
        />
      ))}

      <span aria-hidden className="my-1 h-px w-6 bg-line-strong" />

      <Link
        href="/app"
        title="Todas las organizaciones"
        aria-label="Todas las organizaciones"
        className="presionable grid size-10 place-items-center rounded-xl border border-dashed
          border-line-strong text-faint transition-colors hover:border-accent hover:text-accent-bright"
      >
        <Plus size={16} />
      </Link>
    </nav>
  );
}

function Chapa({
  organizacion,
  logo,
  href,
  activa,
}: {
  organizacion: Organization;
  logo: string | undefined;
  href: string;
  activa: boolean;
}) {
  const inicial = organizacion.name.trim().charAt(0).toUpperCase();

  return (
    <Link
      href={href}
      title={organizacion.name}
      aria-current={activa ? "page" : undefined}
      className="presionable group relative grid size-10 place-items-center rounded-xl
        border border-line-strong bg-canvas/60 transition-colors hover:border-accent"
    >
      {/* El canto encendido a la izquierda, y no un borde entero: el borde
          entero compite con la chapa siguiente y el riel se lee como una lista
          de botones iguales. Esto es la misma señal que usan las
          notificaciones sin leer en su fila. */}
      {activa && (
        <span
          aria-hidden
          className="absolute -left-3 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent"
        />
      )}

      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="size-10 rounded-xl object-cover" />
      ) : (
        <span
          aria-hidden
          className={`font-display text-sm font-semibold ${activa ? "text-accent-bright" : "text-muted"}`}
        >
          {inicial}
        </span>
      )}
    </Link>
  );
}
