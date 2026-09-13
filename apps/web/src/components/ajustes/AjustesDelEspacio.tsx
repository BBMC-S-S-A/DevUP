"use client";

import { Building2, Trash2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, type Workspace, api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Field } from "@/components/ui/Field";
import { Chip, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { olvidarUltimoEspacio } from "@/lib/ultimo-espacio";

/**
 * Ajustes del espacio de trabajo: su nombre y quién llega a él.
 *
 * NO EXISTÍA, Y ERA EL HUECO MÁS RARO DE LA CONFIGURACIÓN. Una organización se
 * puede renombrar y borrar desde el primer día; un espacio se creaba y ya. Una
 * errata en el nombre era para siempre, y un proyecto que empezó siendo
 * personal no tenía cómo abrirse al equipo salvo creando otro y mudando todo a
 * mano.
 *
 * QUÉ SIGNIFICA CADA VISIBILIDAD, escrito aquí porque es lo que de verdad se
 * decide en esta pantalla y no se puede adivinar por el nombre:
 *
 *  · **Compartido** — lo ve quien tenga acceso a los espacios de la
 *    organización, y lo administra quien administra la organización.
 *  · **Personal** — solo quien lo creó. Sirve para lo que todavía no es del
 *    equipo, no para esconder cosas del equipo.
 *
 * Y CAMBIAR DE UNO A OTRO PIDE LAS DOS COSAS A LA VEZ: administrar la
 * organización Y haberlo creado. No es un capricho de la pantalla: es lo que
 * impide que quien administra convierta en suyo un espacio del equipo —un
 * movimiento que no rompe nada y deja a todo el mundo fuera de su propio
 * proyecto— y, en el otro sentido, que alguien publique el suyo al equipo sin
 * ser administrador. Si el servidor lo rechaza, el aviso lo explica.
 */
export function AjustesDelEspacio({
  workspace,
  puedoAdministrar,
  soyQuienLoCreo,
  onCambiado,
}: {
  workspace: Workspace;
  /** Si administra la organización. Lo decide el servidor igual; esto solo pinta. */
  puedoAdministrar: boolean;
  soyQuienLoCreo: boolean;
  onCambiado: () => void;
}) {
  const router = useRouter();
  const confirmar = useConfirmar();
  const [nombre, setNombre] = useState(workspace.name);
  const [guardando, setGuardando] = useState(false);
  /** Lo tecleado para confirmar el borrado. `null` = ni siquiera se ha pedido. */
  const [confirmacion, setConfirmacion] = useState<string | null>(null);

  // Se siembra cuando llega y no se vuelve a pisar: reasignarlo en cada
  // renderizado haría imposible escribir en el campo.
  useEffect(() => {
    setNombre(workspace.name);
  }, [workspace.id, workspace.name]);

  const compartido = workspace.visibility === "shared";
  // El servidor exige las dos mitades para cambiar de visibilidad (ver arriba).
  // Enseñar el mando a quien no las tiene es prometer algo que se va a rechazar.
  const puedoCambiarVisibilidad = puedoAdministrar && soyQuienLoCreo;
  const puedoEditar = compartido ? puedoAdministrar : soyQuienLoCreo;
  const cambiado = nombre.trim() !== workspace.name && nombre.trim().length > 0;

  const pedirConfirmacion = async () => {
    const seguro = await confirmar({
      titulo: `¿Borrar «${workspace.name}»?`,
      descripcion:
        "Se lleva por delante sus canales con sus mensajes, los archivos, el tablero entero " +
        "con sus tareas y su historia, el diagrama, los repositorios conectados y las " +
        "credenciales guardadas. No hay papelera.",
      accion: "Entendido, quiero borrarlo",
      peligro: true,
    });
    if (seguro) setConfirmacion("");
  };

  const guardar = async (cambio: { name?: string; visibility?: "personal" | "shared" }) => {
    setGuardando(true);
    try {
      await api.patch(`/workspaces/${workspace.id}`, cambio);
      onCambiado();
      toast.success("guardado");
    } catch (fallo) {
      toast.error(fallo instanceof ApiError ? fallo.message : "no se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  /**
   * Borrar, en dos pasos y los dos dentro de la tarjeta.
   *
   * PRIMERO SE DICE QUÉ SE PIERDE, y solo después se pide teclear el nombre. El
   * orden importa: un campo de confirmación antes de explicar el daño se rellena
   * por inercia. Y el nombre y no un botón a secas porque un botón se dispara
   * desde una pestaña que alguien dejó abierta en el espacio equivocado — eso
   * pasa, y teclear «Producto» obliga a mirar CUÁL se está borrando.
   *
   * Sin `window.prompt`: es un diálogo del navegador que se pinta fuera de la
   * aplicación, no se puede leer con calma y en algunos navegadores se bloquea.
   */
  const borrar = async () => {
    const escrito = confirmacion ?? "";
    setGuardando(true);
    try {
      await api.delete(`/workspaces/${workspace.id}`, { confirmarNombre: escrito });
      // Se olvida antes de navegar: `/app` entra al último espacio recordado
      // sin comprobarlo, así que sin esto la aplicación intentaría abrir el que
      // acabamos de borrar en cada arranque.
      olvidarUltimoEspacio();
      toast.success(`«${workspace.name}» borrado`);
      router.replace(`/app/o/${workspace.organizationId}`);
    } catch (fallo) {
      toast.error(fallo instanceof ApiError ? fallo.message : "no se pudo borrar");
      setGuardando(false);
    }
  };

  return (
    <Tarjeta className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Rotulo>Este espacio de trabajo</Rotulo>
        <Chip tono={compartido ? "accent" : "neutro"}>
          {compartido ? "Compartido" : "Personal"}
        </Chip>
      </div>

      {!puedoEditar && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          {compartido
            ? "Los espacios compartidos los administra quien administra la organización."
            : "Un espacio personal solo lo cambia quien lo creó."}
        </p>
      )}

      <div className="mt-4 space-y-4">
        <div>
          <Field
            label="Nombre"
            value={nombre}
            onChange={setNombre}
            maxLength={80}
            disabled={!puedoEditar || guardando}
            placeholder="Producto, Infraestructura, Cliente X…"
          />
          {cambiado && puedoEditar && (
            <Boton
              variante="primario"
              tamano="sm"
              className="mt-2"
              cargando={guardando}
              onClick={() => void guardar({ name: nombre.trim() })}
            >
              Guardar
            </Boton>
          )}
        </div>

        <div className="border-t border-line pt-3">
          <Rotulo className="mb-1.5 block">Quién llega aquí</Rotulo>
          <div className="space-y-1.5">
            <OpcionVisibilidad
              elegida={compartido}
              icono={<Building2 size={13} />}
              titulo="Compartido con la organización"
              pista="Lo ve el equipo, y lo administra quien administra la organización."
              disabled={!puedoCambiarVisibilidad || guardando || compartido}
              onElegir={() => void guardar({ visibility: "shared" })}
            />
            <OpcionVisibilidad
              elegida={!compartido}
              icono={<UserRound size={13} />}
              titulo="Personal"
              pista="Solo tú. Para lo que todavía no es del equipo."
              disabled={!puedoCambiarVisibilidad || guardando || !compartido}
              onElegir={() => void guardar({ visibility: "personal" })}
            />
          </div>

          {!puedoCambiarVisibilidad && (
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              Cambiar esto pide administrar la organización <strong>y</strong> haber creado el
              espacio. Es lo que impide que quien administra se quede un espacio del equipo, y
              que alguien publique el suyo sin ser administrador.
            </p>
          )}
        </div>

        {puedoEditar && (
          <div className="border-t border-line pt-3">
            {confirmacion === null ? (
              <Boton
                variante="fantasma"
                tamano="sm"
                icono={<Trash2 size={14} />}
                disabled={guardando}
                onClick={() => void pedirConfirmacion()}
                className="!text-danger hover:!bg-danger/10"
              >
                Borrar este espacio
              </Boton>
            ) : (
              <div className="devup-entrada rounded-xl border border-danger/30 bg-danger/5 p-3">
                <p className="text-xs leading-relaxed text-danger">
                  Escribe <strong>{workspace.name}</strong> para confirmar.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    value={confirmacion}
                    onChange={(e) => setConfirmacion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setConfirmacion(null);
                    }}
                    aria-label={`Escribe ${workspace.name} para confirmar el borrado`}
                    className="min-w-0 flex-1 rounded-lg border border-danger/40 bg-canvas px-2.5 py-1.5 text-sm text-ink outline-none"
                  />
                  <Boton
                    variante="fantasma"
                    tamano="sm"
                    cargando={guardando}
                    // El botón solo se enciende con el nombre correcto: así el
                    // error se ve ANTES de pulsar, no como un rechazo después.
                    disabled={
                      confirmacion.trim().toLowerCase() !== workspace.name.trim().toLowerCase()
                    }
                    onClick={() => void borrar()}
                    className="!text-danger hover:!bg-danger/15"
                  >
                    Borrar
                  </Boton>
                  <Boton variante="fantasma" tamano="sm" onClick={() => setConfirmacion(null)}>
                    Cancelar
                  </Boton>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Tarjeta>
  );
}

function OpcionVisibilidad({
  elegida,
  icono,
  titulo,
  pista,
  disabled,
  onElegir,
}: {
  elegida: boolean;
  icono: React.ReactNode;
  titulo: string;
  pista: string;
  disabled: boolean;
  onElegir: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onElegir}
      aria-pressed={elegida}
      className={`presionable flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left
        transition-colors disabled:cursor-default ${
          elegida
            ? "border-accent/50 bg-accent-soft/40"
            : "border-line hover:border-line-strong disabled:hover:border-line"
        }`}
    >
      <span className={`mt-0.5 shrink-0 ${elegida ? "text-accent-bright" : "text-faint"}`}>
        {icono}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-ink">{titulo}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">{pista}</span>
      </span>
    </button>
  );
}
