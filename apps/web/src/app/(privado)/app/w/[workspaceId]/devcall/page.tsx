"use client";

import { Headphones, Loader2, Mic, PhoneCall, Plus, Radio, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, type Channel, api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { Field } from "@/components/ui/Field";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useRecurso } from "@/lib/datos";
import { useVoiceCall } from "@/lib/voice/VoiceCallProvider";
import { Avatar } from "@/components/perfil/Avatar";

/**
 * DevCall: las salas del espacio, y entrar a una sin buscarla.
 *
 * QUÉ RESUELVE. Los canales de voz estaban repartidos por la barra lateral
 * junto a los de texto, y para hablar con alguien había que acordarse de en cuál
 * suele estar. Aquí están todas juntas, con la que tienes abierta arriba.
 *
 * ENTRAR NO TE ENCIERRA, y conviene decirlo porque es lo que se pidió: la
 * llamada vive por encima de la aplicación —`VoiceCallProvider` y la barra
 * flotante están en el armazón, no en la pantalla del canal— así que se entra y
 * se sigue navegando: al tablero, a la biblioteca, a otro espacio. La llamada
 * no se corta y la barra viene contigo. Eso ya funcionaba y casi nadie lo
 * sabía, porque no había ningún sitio que lo dijera.
 *
 * LO QUE FALTA, Y NO SE FINGE:
 *
 *  - **Quién está dentro de una sala sin entrar.** Esa presencia vive en la
 *    memoria del servidor de tiempo real y ninguna ruta la expone. Es lo que
 *    hace que Discord se lea de un vistazo, y está delegado.
 *  - **Agenda y reuniones programadas.** No hay tabla donde guardarlas. Una
 *    reunión con hora es una fila, no una pantalla, y va delegada también.
 *
 * Mientras tanto esta pantalla no dibuja huecos con «próximamente»: enseña lo
 * que hay y dice en una línea lo que todavía no.
 */
export default function DevCallPage() {
  const workspaceId = useWorkspaceId();
  const router = useRouter();
  const { room, activeChannelId, activeChannelName, joinChannel, leaveChannel } = useVoiceCall();

  const canales = useRecurso<{ channels: Channel[] }>(`/workspaces/${workspaceId}/channels`);
  const salas = (canales.datos?.channels ?? []).filter((c) => c.kind === "voice");
  const enLlamada = Boolean(activeChannelId) && room.status !== "idle";

  return (
    <Pagina
      titulo="DevCall"
      rotulo="las salas de este espacio"
      icono={<PhoneCall size={18} />}
      ancho="lg"
    >
      {canales.error ? (
        <Fallo onReintentar={() => void canales.recargar()}>{canales.error}</Fallo>
      ) : canales.cargando ? (
        <Cargando etiqueta="Cargando salas" />
      ) : (
        <div className="space-y-4">
          {enLlamada && (
            <Tarjeta viva className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-accent/40 bg-accent-soft/60 text-accent-bright">
                  <Radio size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <Rotulo>Estás dentro</Rotulo>
                  <p className="truncate text-sm font-medium text-ink">{activeChannelName}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Chip tono={room.muted ? "warn" : "live"}>
                    <Mic size={10} />
                    {room.muted ? "en silencio" : "hablando"}
                  </Chip>
                  <Boton
                    tamano="sm"
                    variante="fantasma"
                    onClick={() => router.push(`/app/w/${workspaceId}/c/${activeChannelId}`)}
                  >
                    Abrir la sala
                  </Boton>
                  <Boton tamano="sm" variante="peligro" onClick={leaveChannel}>
                    Colgar
                  </Boton>
                </div>
              </div>

              {/* Quién está, con su latencia. Es el dato que contesta «¿soy yo o
                  es él?» cuando alguien se entrecorta, sin tener que preguntar
                  «¿me escucháis bien?» tres veces. */}
              {room.participants.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                  {room.participants.map((p) => (
                    <li
                      key={p.peerId}
                      className="flex items-center gap-1.5 rounded-lg border border-line bg-canvas/60 py-0.5 pl-1 pr-2"
                    >
                      <Avatar userId={p.userId} nombre={p.displayName} tamano={20} />
                      <span className="text-[11px] text-muted">{p.displayName}</span>
                      {p.rtt !== null && (
                        <span className="font-mono text-[10px] tabular-nums text-faint">
                          {p.rtt} ms
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Tarjeta>
          )}

          {/* La frase que hacía falta: entrar a una sala no te encierra en
              ella. Funcionaba desde siempre y no lo decía nadie. */}
          <p className="px-1 text-[11px] leading-relaxed text-faint">
            Al entrar a una sala puedes seguir moviéndote por DevUP —al tablero, a la biblioteca, a
            otro espacio— sin colgar: la llamada va contigo en la barra de abajo.
          </p>

          {salas.length === 0 ? (
            <EstadoVacio
              icono={<Headphones size={20} />}
              titulo="Todavía no hay ninguna sala"
              pista="Una sala es un sitio donde estar, no una llamada que se lanza: se entra y se sale, y quien pase puede unirse."
            />
          ) : (
            <ul className="space-y-2">
              {salas.map((sala) => {
                const aqui = sala.id === activeChannelId;
                return (
                  <li key={sala.id}>
                    <Tarjeta className="flex flex-wrap items-center gap-3 p-3.5">
                      <span
                        aria-hidden
                        className={`grid size-9 shrink-0 place-items-center rounded-xl border ${
                          aqui
                            ? "border-accent/40 bg-accent-soft/60 text-accent-bright"
                            : "border-line-strong bg-raised text-faint"
                        }`}
                      >
                        <Headphones size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {sala.name}
                        </span>
                        <span className="block text-[11px] text-faint">
                          {sala.isPrivate ? "Privada" : "Abierta a todo el espacio"}
                        </span>
                      </span>
                      {aqui ? (
                        <Chip tono="live">estás aquí</Chip>
                      ) : (
                        <Boton
                          tamano="sm"
                          onClick={() => joinChannel(sala.id, workspaceId, sala.name)}
                        >
                          <Video size={13} />
                          Entrar
                        </Boton>
                      )}
                    </Tarjeta>
                  </li>
                );
              })}
            </ul>
          )}

          <NuevaSala workspaceId={workspaceId} onCreada={() => void canales.recargar()} />

          <p className="px-1 text-[11px] leading-relaxed text-faint">
            Todavía no se ve quién hay dentro de una sala sin entrar, ni se pueden agendar reuniones
            con hora. Lo primero vive en el servidor de tiempo real y lo segundo necesita dónde
            guardarlas; las dos están repartidas en el tablero.
          </p>
        </div>
      )}
    </Pagina>
  );
}

/**
 * Crear una sala desde aquí.
 *
 * EL BOTÓN DE «NUEVO CANAL» SUELTO EN LA BARRA ERA EL PROBLEMA: no decía de qué
 * tipo, salía debajo de una lista de canales de texto, y para hacer una sala de
 * voz había que crear un canal y acordarse de marcar la casilla. Aquí lo que se
 * crea es una sala, y no hace falta elegir tipo porque la pantalla ya lo dice.
 */
function NuevaSala({ workspaceId, onCreada }: { workspaceId: string; onCreada: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [creando, setCreando] = useState(false);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="presionable flex w-full items-center gap-2.5 rounded-2xl border border-dashed
          border-line px-4 py-3 text-sm text-faint hover:border-accent/40 hover:bg-accent-soft/20 hover:text-muted"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-dashed border-line">
          <Plus size={15} />
        </span>
        Nueva sala
      </button>
    );
  }

  return (
    <Tarjeta className="p-4">
      <Rotulo>Nueva sala</Rotulo>
      <p className="mb-3 mt-1 text-xs leading-relaxed text-muted">
        Un sitio donde estar, no una llamada que se lanza: se entra y se sale, y quien pase puede
        unirse.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const limpio = nombre.trim();
          if (!limpio) return;
          setCreando(true);
          try {
            await api.post(`/workspaces/${workspaceId}/channels`, {
              name: limpio,
              kind: "voice",
              isPrivate: false,
            });
            setNombre("");
            setAbierto(false);
            onCreada();
          } catch (caught) {
            toast.error(caught instanceof ApiError ? caught.message : "no se pudo crear la sala");
          } finally {
            setCreando(false);
          }
        }}
      >
        <div className="min-w-[12rem] flex-1">
          <Field label="Nombre" value={nombre} onChange={setNombre} autoFocus maxLength={60} />
        </div>
        <div className="flex items-end gap-2">
          <Boton type="submit" disabled={!nombre.trim() || creando}>
            {creando ? <Loader2 size={14} className="animate-spin" /> : null}
            Crear
          </Boton>
          <Boton type="button" variante="fantasma" onClick={() => setAbierto(false)}>
            Cancelar
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
