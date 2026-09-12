"use client";

import { AlertTriangle, Building2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Boton } from "@/components/ui/Boton";
import { Entrada } from "@/components/ui/Field";
import { Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { ApiError, type Organization, api } from "@/lib/api";

/**
 * El nombre y el identificador de la organización, y el botón de borrarla.
 *
 * POR QUÉ FALTABA Y SE NOTABA. No se podía renombrar: una organización creada
 * con una errata —o con el nombre de antes de cambiarlo— se quedaba así para
 * siempre, porque la única salida era crear otra y mudar el equipo a mano. Y
 * tampoco se podía borrar: las de prueba se quedaban en el riel de todo el
 * mundo, para siempre.
 *
 * EL IDENTIFICADOR SE AVISA ANTES DE TOCARLO, no después. Es lo que va en las
 * direcciones, así que cambiarlo rompe cualquier enlace que alguien tuviera
 * guardado. Se puede hacer —a veces hay que hacerlo— pero quien lo haga tiene
 * que saberlo mientras lo escribe, no enterarse cuando un compañero diga que
 * su enlace ya no lleva a ninguna parte.
 *
 * BORRAR PIDE ESCRIBIR EL IDENTIFICADOR, y no es teatro. Un botón de borrar a
 * secas se pulsa desde una pestaña que alguien dejó abierta en la organización
 * equivocada, y eso pasa. Copiar el identificador obliga a mirar CUÁL se está
 * borrando, que es justo la comprobación que falla cuando se borra la que no
 * era.
 */
export function IdentidadOrganizacion({
  orgId,
  puedeEditar,
  esPropietario,
}: {
  orgId: string;
  /** Administrar basta para renombrar. */
  puedeEditar: boolean;
  /** Borrar, no: eso es solo de quien es propietario (lo exige la base). */
  esPropietario: boolean;
}) {
  const router = useRouter();
  const [org, setOrg] = useState<Organization | null>(null);
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    void api
      .get<{ organizations: Organization[] }>("/organizations")
      .then(({ organizations }) => {
        const mia = organizations.find((o) => o.id === orgId) ?? null;
        setOrg(mia);
        setNombre(mia?.name ?? "");
        setSlug(mia?.slug ?? "");
      })
      .catch(() => setOrg(null));
  }, [orgId]);

  if (!org) return null;

  const cambiado = nombre.trim() !== org.name || slug.trim() !== org.slug;
  const slugCambia = slug.trim() !== org.slug;

  const guardar = async () => {
    setGuardando(true);
    try {
      const { organization } = await api.patch<{ organization: Organization }>(
        `/organizations/${orgId}`,
        {
          ...(nombre.trim() !== org.name ? { name: nombre.trim() } : {}),
          ...(slugCambia ? { slug: slug.trim() } : {}),
        },
      );
      setOrg(organization);
      toast.success("Organización actualizada");
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "no se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Tarjeta className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Building2 size={14} className="text-muted" />
          <Rotulo>Nombre e identificador</Rotulo>
        </div>

        <div className="space-y-3">
          <div>
            <Rotulo className="mb-1.5 block">Nombre</Rotulo>
            <Entrada
              value={nombre}
              disabled={!puedeEditar}
              maxLength={80}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>

          <div>
            <Rotulo className="mb-1.5 block">Identificador</Rotulo>
            <Entrada
              value={slug}
              disabled={!puedeEditar}
              maxLength={40}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
              {slugCambia ? (
                <span className="text-warn">
                  Cambiarlo rompe los enlaces guardados con el anterior: quien tenga uno dejará de
                  encontrar nada.
                </span>
              ) : (
                <>Va en las direcciones de la organización.</>
              )}
            </p>
          </div>

          {puedeEditar && (
            <div className="flex justify-end">
              <Boton variante="primario" disabled={!cambiado || guardando} onClick={() => void guardar()}>
                Guardar
              </Boton>
            </div>
          )}
        </div>
      </Tarjeta>

      {esPropietario && <ZonaDePeligro org={org} onBorrada={() => router.push("/app/organizaciones")} />}
    </>
  );
}

function ZonaDePeligro({ org, onBorrada }: { org: Organization; onBorrada: () => void }) {
  const [escrito, setEscrito] = useState("");
  const [borrando, setBorrando] = useState(false);

  const coincide = escrito.trim().replace(/^\//, "") === org.slug;

  const borrar = async () => {
    setBorrando(true);
    try {
      await api.delete(`/organizations/${org.id}`, { confirmarSlug: escrito.trim() });
      toast.success(`«${org.name}» borrada`);
      onBorrada();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "no se pudo borrar");
      setBorrando(false);
    }
  };

  return (
    <Tarjeta className="border-danger/30 p-4">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle size={14} className="text-danger" />
        <Rotulo>Borrar la organización</Rotulo>
      </div>

      {/* Lo que se lleva por delante, enumerado. «Esta acción no se puede
          deshacer» no dice nada que ayude a decidir; la lista, sí. */}
      <p className="mb-3 text-xs leading-relaxed text-muted">
        Se borra <strong>«{org.name}»</strong> entera y con ella sus espacios de trabajo: canales,
        mensajes, archivos, tareas, el diagrama, los repositorios conectados y las credenciales
        guardadas. No hay papelera y no se puede deshacer.
      </p>

      <Rotulo className="mb-1.5 block">
        Escribe <code className="font-mono text-danger">{org.slug}</code> para confirmar
      </Rotulo>
      <Entrada
        value={escrito}
        placeholder={org.slug}
        onChange={(e) => setEscrito(e.target.value)}
      />

      <div className="mt-3 flex justify-end">
        <Boton
          variante="peligro"
          icono={<Trash2 size={14} />}
          disabled={!coincide || borrando}
          cargando={borrando}
          onClick={() => void borrar()}
        >
          Borrar para siempre
        </Boton>
      </div>
    </Tarjeta>
  );
}
