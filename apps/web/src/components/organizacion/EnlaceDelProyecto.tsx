"use client";

import { Check, Copy, Link2, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Boton } from "@/components/ui/Boton";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Rotulo } from "@/components/ui/Superficies";
import { api, useMutacion, useRecurso } from "@/lib/datos";
import type { Workspace } from "@/lib/api";

/**
 * El enlace para meter al equipo en ESTE proyecto.
 *
 * ES EL GESTO DE DISCORD, y hacía falta porque las otras dos formas de entrar
 * empiezan por el correo de alguien —una invitación por persona, o un código
 * que se dicta por teléfono— y ninguna sirve para meter a cinco de golpe.
 *
 * LO QUE HAY QUE DECIR, Y SE DICE AQUÍ: entrar a un proyecto es entrar también
 * a su organización. No es una decisión de esta pantalla —la base exige
 * pertenecer a la organización antes de dejar mirar nada del espacio— pero sí
 * es una sorpresa si nadie la cuenta. Lo que sí se acota es cuánto ven: quien
 * entra por aquí ve ESTE proyecto y ninguno más.
 *
 * LA DIRECCIÓN SE ENSEÑA UNA VEZ. En la base solo vive su hash, así que no se
 * puede «volver a ver» un enlace: se copia al crearlo o se hace otro. Por eso
 * se queda en pantalla hasta que la persona lo cierra, en vez de desaparecer
 * con un aviso que dura tres segundos.
 */
export function EnlaceDelProyecto({ workspaceId }: { workspaceId: string }) {
  const confirmar = useConfirmar();
  const [reciente, setReciente] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Quién puede abrir la puerta lo dice la API, con la misma función que usan
  // las políticas. Mientras no llega, se asume que no: enseñar el botón y
  // quitarlo un segundo después es peor que enseñarlo un segundo más tarde.
  const espacio = useRecurso<{ workspace: Workspace }>(`/workspaces/${workspaceId}`);
  const puedoGestionar = espacio.datos?.workspace.puedoGestionar === true;

  const clave = `/workspaces/${workspaceId}/invite-links`;
  const enlaces = useRecurso<{ enlaces: EnlaceVivo[] }>(puedoGestionar ? clave : null);

  const crear = useMutacion(
    () => api.post<{ enlace: EnlaceVivo & { url: string } }>(clave, { dias: 7, usos: 25 }),
    {
      invalida: [clave],
      fallo: "No se pudo crear el enlace.",
      alTerminar: (r) => {
        setReciente(r.enlace.url);
        setCopiado(false);
      },
    },
  );

  const revocar = useMutacion((id: string) => api.delete(`/invite-links/${id}`), {
    invalida: [clave],
    exito: "Enlace cerrado",
    fallo: "No se pudo cerrar.",
  });

  if (!puedoGestionar) return null;

  const vivos = enlaces.datos?.enlaces ?? [];

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      toast.success("Enlace copiado");
    } catch {
      // Sin permiso de portapapeles —pasa en algunos navegadores y con http—
      // el enlace sigue en pantalla para copiarlo a mano. Decirlo es mejor que
      // un botón que no hace nada.
      toast.error("No pude copiar: selecciónalo y cópialo a mano.");
    }
  }

  return (
    <section className="capa-flotante flex shrink-0 flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Link2 size={14} className="text-accent" />
        <Rotulo>Invitar al proyecto</Rotulo>
      </div>

      {reciente ? (
        <div className="flex flex-col gap-2 rounded-xl border border-accent/25 bg-accent-soft/25 p-3">
          <p className="text-[11px] leading-relaxed text-muted">
            Cópialo ahora: <strong className="text-ink">no se vuelve a enseñar</strong>. Si lo
            pierdes, haz otro.
          </p>
          <code className="block break-all rounded-lg bg-canvas/60 p-2 font-mono text-[11px] text-ink">
            {reciente}
          </code>
          <div className="flex gap-2">
            <Boton
              type="button"
              tamano="sm"
              variante="primario"
              icono={copiado ? <Check size={13} /> : <Copy size={13} />}
              onClick={() => void copiar(reciente)}
            >
              {copiado ? "Copiado" : "Copiar"}
            </Boton>
            <Boton type="button" tamano="sm" variante="fantasma" onClick={() => setReciente(null)}>
              Listo
            </Boton>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[11px] leading-relaxed text-muted">
            Un enlace para pasarle a tu equipo. Quien lo use entra a{" "}
            <strong className="text-ink">este proyecto y a ninguno más</strong>, como miembro —
            nunca como administrador.
          </p>
          <Boton
            type="button"
            tamano="sm"
            variante="primario"
            icono={<Link2 size={13} />}
            cargando={crear.enviando}
            onClick={() => void crear.ejecutar()}
          >
            Crear enlace
          </Boton>
        </>
      )}

      {enlaces.cargando && <Loader2 size={13} className="animate-spin text-faint" />}

      {vivos.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2">
          {/* La lista no enseña el enlace —no se puede— sino lo que hace falta
              para decidir si cerrarlo: cuánta gente ha entrado y hasta cuándo
              sirve. */}
          {vivos.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-[11px]">
              <span className="text-muted">
                {e.uses}/{e.maxUses} usos
              </span>
              <span className="text-faint">·</span>
              <span className="text-faint">{caduca(e.expiresAt)}</span>
              <button
                type="button"
                className="presionable ml-auto rounded-md p-1 text-faint hover:text-danger"
                title="Cerrar este enlace"
                onClick={async () => {
                  const ok = await confirmar({
                    titulo: "¿Cerrar este enlace?",
                    descripcion:
                      "Quien ya entró se queda dentro; el enlace deja de servir para los demás.",
                    accion: "Cerrar",
                    peligro: true,
                  });
                  if (ok) await revocar.ejecutar(e.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type EnlaceVivo = {
  id: string;
  uses: number;
  maxUses: number;
  expiresAt: string;
};

/** «caduca en 6 días», que es lo que alguien necesita saber de un vistazo. */
function caduca(iso: string): string {
  const dias = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (dias <= 0) return "caducado";
  if (dias === 1) return "caduca mañana";
  return `caduca en ${dias} días`;
}
