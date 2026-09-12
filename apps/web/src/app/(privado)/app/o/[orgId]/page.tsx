"use client";

import { ArrowRight, Loader2, Plus, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, type Workspace, api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { Field } from "@/components/ui/Field";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useOrgId } from "@/lib/workspace-context";
import { useRecurso } from "@/lib/datos";

/**
 * La organización: qué espacios de trabajo tiene y cómo entrar en uno.
 *
 * FALTABA, Y SE NOTABA. `/app/o/[orgId]` no existía como pantalla: había
 * Ventas, Noticias, Ajustes y Buscar colgando de esa ruta, pero la ruta en sí
 * daba 404. Por eso el riel no podía llevar a una organización y saltaba al
 * primer espacio que tuviera — eligiendo por ti cuál abrir, que está mal en
 * cuanto hay más de uno.
 *
 * EL PASO INTERMEDIO ES EL PUNTO. Pulsar una organización enseña lo que tiene;
 * desde ahí se entra al espacio que toque, y entonces sí aparece su Panel, su
 * tablero y lo demás. Cada nivel enseña lo suyo en vez de adivinar el
 * siguiente.
 *
 * LA BARRA YA HACÍA SU MITAD. El armazón de organización lista los espacios
 * desde hace tiempo; lo que no había era contenido al lado, así que el paso
 * intermedio existía a medias y no se podía usar.
 */
export default function OrganizacionPage() {
  const orgId = useOrgId();
  const espacios = useRecurso<{ workspaces: Workspace[] }>(`/organizations/${orgId}/workspaces`);
  const lista = espacios.datos?.workspaces ?? [];

  return (
    <Pagina
      titulo="Espacios de trabajo"
      rotulo="dónde se trabaja dentro de esta organización"
      icono={<Users size={18} />}
      ancho="lg"
    >
      {espacios.error ? (
        <Fallo onReintentar={() => void espacios.recargar()}>{espacios.error}</Fallo>
      ) : espacios.cargando ? (
        <Cargando etiqueta="Cargando espacios" />
      ) : (
        <div className="space-y-4">
          {lista.length === 0 ? (
            <EstadoVacio
              icono={<Users size={20} />}
              titulo="Todavía no hay ningún espacio"
              pista="Un espacio de trabajo es un proyecto: sus canales, sus archivos, su tablero y su repositorio. Crea el primero aquí abajo."
            />
          ) : (
            <ul className="space-y-2">
              {lista.map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/app/w/${w.id}`}
                    className="presionable flex items-center gap-3 rounded-2xl border border-line
                      bg-surface/60 px-4 py-3 hover:border-line-strong hover:bg-raised/60"
                  >
                    <span
                      aria-hidden
                      className="grid size-9 shrink-0 place-items-center rounded-xl border border-line-strong
                        bg-accent-soft/70 font-display text-sm font-semibold text-accent-bright"
                    >
                      {w.visibility === "personal" ? <UserRound size={15} /> : "#"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{w.name}</span>
                      {/* Un espacio personal no es «privado a medias»: no lo ve
                          nadie más, ni quien administra. Decirlo aquí evita la
                          pregunta de por qué los demás no lo encuentran. */}
                      <span className="block text-[11px] text-faint">
                        {w.visibility === "personal" ? "Solo tuyo" : "Compartido con la organización"}
                      </span>
                    </span>
                    <ArrowRight size={14} className="shrink-0 text-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <NuevoEspacio orgId={orgId} onCreado={() => void espacios.recargar()} />
        </div>
      )}
    </Pagina>
  );
}

/**
 * Crear un espacio, y entrar directo a su canal general.
 *
 * No devuelve a esta lista: quien acaba de crear un espacio quiere escribir en
 * él, no volver a elegirlo de una lista donde ahora hay uno más. El canal
 * general se siembra al crearlo, así que hay dónde aterrizar desde el primer
 * segundo.
 */
function NuevoEspacio({ orgId, onCreado }: { orgId: string; onCreado: () => void }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [visibility, setVisibility] = useState<"shared" | "personal">("shared");
  const [creando, setCreando] = useState(false);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="presionable flex w-full items-center gap-2.5 rounded-2xl border border-dashed
          border-line px-4 py-3.5 text-sm text-faint hover:border-accent/40 hover:bg-accent-soft/20 hover:text-muted"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-dashed border-line">
          <Plus size={15} />
        </span>
        Nuevo espacio de trabajo
      </button>
    );
  }

  return (
    <Tarjeta className="p-4">
      <Rotulo>Nuevo espacio</Rotulo>
      <p className="mb-3 mt-1 text-xs leading-relaxed text-muted">
        Un proyecto con lo suyo dentro: canales, archivos, tablero y repositorio.
      </p>

      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const limpio = nombre.trim();
          if (!limpio) return;
          setCreando(true);
          try {
            const { workspace, generalChannelId } = await api.post<{
              workspace: { id: string };
              generalChannelId: string;
            }>(`/organizations/${orgId}/workspaces`, { name: limpio, visibility });
            toast.success(`Espacio «${limpio}» creado`);
            onCreado();
            router.push(`/app/w/${workspace.id}/c/${generalChannelId}`);
          } catch (caught) {
            toast.error(caught instanceof ApiError ? caught.message : "no se pudo crear el espacio");
            setCreando(false);
          }
        }}
      >
        <Field label="Nombre" value={nombre} onChange={setNombre} autoFocus maxLength={60} />

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["shared", "Compartido", "Lo ve toda la organización"],
              ["personal", "Solo mío", "No lo ve nadie más"],
            ] as const
          ).map(([valor, texto, pista]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setVisibility(valor)}
              aria-pressed={visibility === valor}
              title={pista}
              className={`presionable rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
                visibility === valor
                  ? "border-accent/50 bg-accent-soft/60 text-accent-bright"
                  : "border-line text-muted hover:border-line-strong"
              }`}
            >
              {texto}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <Boton type="submit" disabled={!nombre.trim() || creando}>
            {creando ? <Loader2 size={14} className="animate-spin" /> : null}
            Crear y entrar
          </Boton>
          <Boton type="button" variante="fantasma" onClick={() => setAbierto(false)}>
            Cancelar
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
