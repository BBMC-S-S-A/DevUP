"use client";

import { Building2, Check, ChevronsUpDown, Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { type Organization, type Workspace, api } from "@/lib/api";
import { Rotulo } from "@/components/ui/Superficies";
import { ignorar } from "@/lib/fallo";

/**
 * Cambiar de organización y de espacio desde la cabecera de la barra.
 *
 * POR QUÉ EXISTE, AUNQUE YA ESTÉ EL RIEL. El riel son chapas de cuarenta
 * píxeles con dos letras, y se reportó cuatro veces que no se podía cambiar de
 * organización con él. Sea cual sea el motivo exacto, la conclusión es la
 * misma: **el cambio de contexto no puede depender de acertar en una chapa
 * pequeña**. Aquí está donde el ojo ya está —la cabecera dice en qué espacio
 * estás—, con el nombre escrito y sitio para el de todos los demás.
 *
 * El riel se queda: para quien lo usa es un salto de un clic, y las dos cosas
 * no se estorban. Lo que no se sostiene es que fuera el único camino.
 *
 * LO ENSEÑA TODO DE UNA VEZ, agrupado por organización. La alternativa —elegir
 * primero empresa y luego espacio, en dos pasos— es exactamente el salto de dos
 * pasos que llevamos quitando toda la semana. Con tres organizaciones y siete
 * espacios cabe entero en una lista.
 *
 * SE PIDE AL ABRIR, no al pintar la barra. Es una lista que se mira de vez en
 * cuando, y cargarla en cada pantalla sería una petición por organización cada
 * vez que se navega para algo que casi nunca se abre.
 */
export function SelectorDeEspacio({
  espacioActual,
  children,
}: {
  /** El espacio en el que se está, si se está en uno. */
  espacioActual?: string;
  /** La cabecera que se pulsa: se pinta igual, abierta o cerrada. */
  children: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [espacios, setEspacios] = useState<Record<string, Workspace[]>>({});
  const [cargando, setCargando] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto || orgs.length > 0) return;
    let vigente = true;
    setCargando(true);

    void (async () => {
      const { organizations } = await api
        .get<{ organizations: Organization[] }>("/organizations")
        .catch(() => ({ organizations: [] as Organization[] }));
      if (!vigente) return;
      setOrgs(organizations);

      const porOrg: Record<string, Workspace[]> = {};
      await Promise.all(
        organizations.map(async (o) => {
          const { workspaces } = await api
            .get<{ workspaces: Workspace[] }>(`/organizations/${o.id}/workspaces`)
            .catch(() => ({ workspaces: [] as Workspace[] }));
          porOrg[o.id] = workspaces;
        }),
      );
      if (vigente) {
        setEspacios(porOrg);
        setCargando(false);
      }
    })().catch(ignorar("no se pudo cargar la lista de espacios"));

    return () => {
      vigente = false;
    };
  }, [abierto, orgs.length]);

  // Cerrar al pulsar fuera y con Escape. Sin lo segundo, un menú abierto en una
  // barra que ya se desplaza se queda encima de todo sin forma evidente de
  // quitarlo con el teclado.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        aria-haspopup="menu"
        className="presionable -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-xl px-1 py-1 text-left hover:bg-raised/60"
      >
        <span className="min-w-0 flex-1">{children}</span>
        <ChevronsUpDown size={13} className="shrink-0 text-faint" />
      </button>

      {abierto && (
        <div
          role="menu"
          className="devup-emerge panel-emergente absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[60svh] overflow-y-auto rounded-xl p-1.5"
        >
          {cargando && orgs.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-faint">cargando…</p>
          ) : orgs.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-faint">No se pudo cargar la lista.</p>
          ) : (
            orgs.map((o) => (
              <div key={o.id} className="mb-1 last:mb-0">
                <Link
                  href={`/app/o/${o.id}`}
                  onClick={() => setAbierto(false)}
                  className="presionable flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-raised/70"
                >
                  <Building2 size={11} className="shrink-0 text-faint" />
                  <Rotulo className="min-w-0 flex-1 truncate !text-muted">{o.name}</Rotulo>
                </Link>

                {(espacios[o.id] ?? []).length === 0 ? (
                  <p className="px-2 py-1 pl-7 text-[11px] text-faint">
                    {cargando ? "…" : "sin espacios todavía"}
                  </p>
                ) : (
                  <ul>
                    {(espacios[o.id] ?? []).map((w) => {
                      const aqui = w.id === espacioActual;
                      return (
                        <li key={w.id}>
                          <Link
                            href={`/app/w/${w.id}`}
                            onClick={() => setAbierto(false)}
                            aria-current={aqui ? "page" : undefined}
                            className={`presionable flex items-center gap-2 rounded-lg py-1.5 pl-7 pr-2 text-[13px] hover:bg-raised/70 ${
                              aqui ? "text-accent-bright" : "text-ink"
                            }`}
                          >
                            {w.visibility === "personal" ? (
                              <UserRound size={12} className="shrink-0 text-faint" />
                            ) : (
                              <span aria-hidden className="shrink-0 text-faint">
                                #
                              </span>
                            )}
                            <span className="min-w-0 flex-1 truncate">{w.name}</span>
                            {aqui && <Check size={12} className="shrink-0" />}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))
          )}

          <span aria-hidden className="my-1 block h-px bg-line" />

          <Link
            href="/app/organizaciones"
            onClick={() => setAbierto(false)}
            className="presionable flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-muted hover:bg-raised/70"
          >
            <Plus size={13} className="shrink-0 text-faint" />
            Nueva organización
          </Link>
        </div>
      )}
    </div>
  );
}
