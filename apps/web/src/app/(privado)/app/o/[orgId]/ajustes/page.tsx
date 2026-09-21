"use client";

import {
  ArrowLeft,
  Building2,
  Check,
  Copy,
  ImagePlus,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  Plus,
  Server,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Desplegable, Entrada } from "@/components/ui/Field";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import {
  type OrganizationLink,
  type OrganizationMember,
  type Workspace,
  ApiError,
  api,
} from "@/lib/api";
import { AjustesDelEspacio } from "@/components/ajustes/AjustesDelEspacio";
import { Miembros } from "@/components/organizacion/Miembros";
import { useOrgId } from "@/lib/workspace-context";
import { useRecurso } from "@/lib/datos";
import { uploadOrgLogo } from "@/lib/files/upload";
import { useSession } from "@/lib/session";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Fallo, Pagina } from "@/components/ui/Pagina";
import { IdentidadOrganizacion } from "@/components/organizacion/IdentidadOrganizacion";
import { useWorkspaceIdOpcional } from "@/lib/workspace-context";

/**
 * Ajustes de la organización: la personalización de la entidad en sí, no de
 * quien la usa (eso es el panel, que es por persona). Tres piezas, cada una
 * su propia superficie: foto, miembros, enlaces.
 *
 * No hay comprobación de rol antes de pintar los mandos de escritura porque
 * ya la hace RLS del lado del servidor (0019 y 0001) — enseñar un botón que
 * el servidor va a rechazar es peor que simplemente dejar que el 403 llegue,
 * porque aquí sí sabemos de antemano quién administra: se lee una sola vez
 * de `/organizations/:orgId/members` y se usa para decidir qué enseñar.
 */
export default function OrganizationSettingsPage() {
  const orgId = useOrgId();
  const { user } = useSession();

  /**
   * Si se llegó desde dentro de un espacio, sus ajustes van PRIMERO.
   *
   * Esta pantalla se monta en dos direcciones: `/app/o/<org>/ajustes` y
   * `/app/w/<espacio>/ajustes`. Quien pulsa «Ajustes» estando dentro de un
   * proyecto viene casi siempre a por ese proyecto —a renombrarlo, a abrirlo al
   * equipo, a borrarlo—, y hasta ahora se encontraba con la foto y los miembros
   * de la organización, que es lo que menos buscaba. Desde la barra de la
   * organización no hay espacio en contexto y no se pinta: no hay «el espacio»
   * del que hablar.
   */
  const workspaceId = useWorkspaceIdOpcional();
  const espacio = useRecurso<{ workspace: Workspace }>(
    workspaceId ? `/workspaces/${workspaceId}` : null,
  );

  // Cuatro lecturas de esta pantalla estaban escritas a mano, cada una con su
  // `useState`, su `useCallback` y su efecto — unas quince líneas por sitio
  // para hacer lo mismo. Por la capa de datos son una línea, y además comparten
  // caché con quien pida lo mismo desde otra pantalla.
  const equipo = useRecurso<{ members: OrganizationMember[] }>(
    `/organizations/${orgId}/members`,
  );
  const members = equipo.datos?.members ?? null;
  const load = equipo.recargar;

  const yo = members?.find((m) => m.userId === user?.id);
  const administro = yo ? yo.role === "owner" || yo.role === "admin" : false;

  return (
    <Pagina
      titulo="Ajustes"
      rotulo="foto, miembros y enlaces de la organización"
      icono={<Settings size={20} />}
    >
      <div className="space-y-5">
        {equipo.error && (
          <Fallo onReintentar={() => void load()}>{equipo.error}</Fallo>
        )}

        {espacio.datos && (
          <AjustesDelEspacio
            workspace={espacio.datos.workspace}
            puedoAdministrar={administro}
            soyQuienLoCreo={espacio.datos.workspace.createdBy === user?.id}
            onCambiado={() => void espacio.recargar()}
          />
        )}

        <IdentidadOrganizacion
          orgId={orgId}
          puedeEditar={administro}
          esPropietario={yo?.role === "owner"}
        />
        <FotoOrganizacion orgId={orgId} puedeEditar={administro} />
        <Miembros orgId={orgId} members={members} yo={user?.id ?? null} administro={administro} onChange={load} />
        <Enlaces orgId={orgId} puedeEditar={administro} />

        {/* EL ESTADO DE LA INSTALACIÓN YA NO ESTÁ AQUÍ. Estaba al final, y el
            sitio no era un descuido: nadie entra en «Ajustes» buscando si el
            almacén responde. Pero seguía siendo la misma pantalla que la foto
            de la organización y la lista de miembros, y es información de otro
            oficio — bóveda, almacén, TURN, y «0 migraciones aplicadas» con un
            párrafo explicando por qué ese número no significa lo que parece.

            Se mudó a `/instalacion`, con la misma puerta de rol. Queda la
            salida, y solo para quien puede pasar por ella. */}
        {administro && (
          <Link
            href={`/app/o/${orgId}/instalacion`}
            className="presionable flex items-center gap-2.5 rounded-xl border border-line
              bg-surface/60 px-4 py-3 text-sm text-muted
              hover:border-line-strong hover:bg-raised/60 hover:text-ink"
          >
            <Server size={15} className="shrink-0 text-faint" />
            Cómo está montada esta instalación
          </Link>
        )}
      </div>
    </Pagina>
  );
}

/* ============================================================================
 * Foto
 * ========================================================================= */

function FotoOrganizacion({ orgId, puedeEditar }: { orgId: string; puedeEditar: boolean }) {
  const [subiendo, setSubiendo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const logo = useRecurso<{ url: string | null }>(`/organizations/${orgId}/logo-url`);
  // `undefined` mientras carga y `null` cuando no hay foto: son dos estados
  // distintos y la pantalla los pinta distinto —esqueleto o hueco—, así que no
  // se pueden colapsar en uno.
  const url = logo.cargando ? undefined : (logo.datos?.url ?? null);
  const cargar = logo.recargar;

  const subir = async (file: File) => {
    setSubiendo(true);
    try {
      await uploadOrgLogo(orgId, file);
      toast.success("Foto actualizada");
      await cargar();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "no se pudo subir la foto");
    } finally {
      setSubiendo(false);
    }
  };

  const quitar = async () => {
    try {
      await api.delete(`/organizations/${orgId}/logo`);
      await cargar();
      toast.success("Foto quitada");
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "no se pudo quitar");
    }
  };

  return (
    <Tarjeta className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Rotulo>Foto de la organización</Rotulo>
        <span className="h-px flex-1 bg-line/70" aria-hidden />
      </div>

      <div className="flex items-center gap-4">
        <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line-strong bg-canvas/60 text-faint">
          {url === undefined ? (
            <Loader2 size={16} className="animate-spin" />
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="size-full object-cover" />
          ) : (
            <Building2 size={22} />
          )}
        </span>

        {puedeEditar && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void subir(file);
              }}
            />
            <Boton
              variante="secundario"
              tamano="sm"
              icono={<ImagePlus size={13} />}
              cargando={subiendo}
              onClick={() => inputRef.current?.click()}
            >
              {url ? "Cambiar foto" : "Subir foto"}
            </Boton>
            {url && (
              <Boton variante="fantasma" tamano="sm" onClick={() => void quitar()}>
                Quitar
              </Boton>
            )}
          </div>
        )}
      </div>
    </Tarjeta>
  );
}

/* ============================================================================
 * Enlaces
 * ========================================================================= */

function Enlaces({ orgId, puedeEditar }: { orgId: string; puedeEditar: boolean }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const recurso = useRecurso<{ links: OrganizationLink[] }>(`/organizations/${orgId}/links`);
  const links = recurso.cargando ? null : (recurso.datos?.links ?? []);
  const load = recurso.recargar;

  return (
    <Tarjeta className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Rotulo>Enlaces</Rotulo>
        <span className="h-px flex-1 bg-line/70" aria-hidden />
      </div>

      {links === null ? (
        <div className="devup-esqueleto h-11 rounded-xl" />
      ) : links.length === 0 ? (
        <EstadoVacio
          icono={<Link2 size={18} />}
          titulo="Sin enlaces todavía"
          pista="El repositorio, la documentación, lo que el equipo quiera tener a mano."
        />
      ) : (
        <ul className="space-y-1.5">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center gap-2.5 rounded-xl border border-line/70 bg-surface/60 px-3 py-2"
            >
              <Link2 size={13} className="shrink-0 text-faint" />
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-sm text-ink hover:text-accent-bright"
              >
                {link.label}
              </a>
              {puedeEditar && (
                <BotonIcono
                  etiqueta={`Quitar ${link.label}`}
                  onClick={async () => {
                    try {
                      await api.delete(`/organizations/${orgId}/links/${link.id}`);
                      await load();
                    } catch (caught) {
                      toast.error(caught instanceof ApiError ? caught.message : "no se pudo quitar");
                    }
                  }}
                  className="hover:!text-danger"
                >
                  <X size={13} />
                </BotonIcono>
              )}
            </li>
          ))}
        </ul>
      )}

      {puedeEditar && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await api.post<{ link: OrganizationLink }>(`/organizations/${orgId}/links`, {
                label,
                url,
              });
              await load();
              setLabel("");
              setUrl("");
            } catch (caught) {
              toast.error(caught instanceof ApiError ? caught.message : "no se pudo añadir");
            } finally {
              setBusy(false);
            }
          }}
          className="mt-3 flex flex-wrap gap-2"
        >
          <Entrada
            required
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Nombre"
            className="w-32"
          />
          <Entrada
            required
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…"
            className="min-w-48 flex-1"
          />
          <Boton type="submit" variante="secundario" tamano="sm" icono={<Plus size={13} />} cargando={busy}>
            Añadir
          </Boton>
        </form>
      )}
    </Tarjeta>
  );
}
