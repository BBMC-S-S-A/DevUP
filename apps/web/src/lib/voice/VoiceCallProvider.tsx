"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { HiddenAudio } from "@/components/voice/ParticipantTile";
import { useVoiceRoom } from "./useVoiceRoom";

/**
 * A dónde se quiere estar conectado.
 *
 * `corrillo` presente = sala efímera sin canal (el pasillo del DevVerse). Con
 * canal, `channelId` manda; sin él, el canal va vacío y lo que identifica el
 * destino es el corrillo. Ver `claveDe`.
 */
type Target = {
  channelId: string;
  workspaceId: string;
  channelName: string;
  corrillo?: string;
} | null;

type VoiceCallContextValue = {
  room: ReturnType<typeof useVoiceRoom>;
  /** Canal de la llamada activa, o null si no hay ninguna. */
  activeChannelId: string | null;
  activeWorkspaceId: string | null;
  activeChannelName: string | null;
  /** Entra en la sala de este canal. Si ya hay otra activa, sale de esa primero. */
  joinChannel: (channelId: string, workspaceId: string, channelName: string) => void;
  /**
   * Entra en un CORRILLO: una sala efímera sin canal, la de juntarse a hablar
   * en el pasillo del DevVerse. Misma malla y mismo sitio que una sala de
   * verdad —así la llamada también te sigue al tablero— pero sin historial.
   */
  joinCorrillo: (corrillo: string, workspaceId: string, nombre: string) => void;
  /** El corrillo en el que estoy, si estoy en uno. */
  activeCorrillo: string | null;
  leaveChannel: () => void;
};

const VoiceCallContext = createContext<VoiceCallContextValue | null>(null);

/**
 * La llamada vive aquí, no en la página del canal.
 *
 * Antes, `useVoiceRoom` se llamaba dentro de `VoiceRoom`, montado solo dentro
 * de la página de ese canal — navegar a otra parte de la app (el tablero, la
 * biblioteca, otro canal) desmontaba el componente y con él la llamada:
 * `useEffect(() => leave, [leave])` colgaba, cerraba el micrófono y avisaba al
 * resto de que te habías ido, aunque solo quisieras ver otra cosa un momento.
 *
 * Montado una sola vez aquí, en el layout de toda la app, el hook sobrevive a
 * cualquier navegación dentro de `/app`. Lo que cambia con la navegación es
 * solo si `VoiceRoom` (la vista con los recuadros y los controles) está
 * montada o no — la conexión WebRTC, ajena a eso, sigue en pie.
 */
export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target>(null);
  // Qué canal se quiere tener activo. Distinto de `target` (lo que de verdad
  // se le pasa al hook) porque cambiar de sala exige primero salir de la
  // actual, y eso tarda un ciclo de renderizado en reflejarse.
  const desired = useRef<Target>(null);
  const joinedFor = useRef<string | null>(null);

  const room = useVoiceRoom(target?.channelId ?? "", target?.workspaceId ?? "", target?.corrillo);

  /** Qué identifica a un destino: el canal, o el corrillo si no hay canal. */
  const claveDe = (t: Target): string | null => (t ? (t.corrillo ?? t.channelId) : null);

  const joinCorrillo = (corrillo: string, workspaceId: string, nombre: string) => {
    if (target?.corrillo === corrillo) return;
    desired.current = { channelId: "", workspaceId, channelName: nombre, corrillo };
    if (room.status === "idle") {
      setTarget(desired.current);
    } else {
      room.leave();
    }
  };

  const joinChannel = (channelId: string, workspaceId: string, channelName: string) => {
    if (target?.channelId === channelId && !target?.corrillo) return;
    desired.current = { channelId, workspaceId, channelName };
    if (room.status === "idle") {
      setTarget(desired.current);
    } else {
      // Cambiar de sala a mitad de llamada: primero se sale de la actual: el
      // efecto de abajo recoge `desired` en cuanto quede libre.
      room.leave();
    }
  };

  const leaveChannel = () => {
    desired.current = null;
    joinedFor.current = null;
    room.leave();
    setTarget(null);
  };

  // Al quedar libre (recién llegado, o tras salir para cambiar de sala),
  // aplica el destino pendiente si todavía hay uno.
  useEffect(() => {
    if (room.status === "idle" && desired.current && claveDe(desired.current) !== claveDe(target)) {
      setTarget(desired.current);
    }
  }, [room.status, target]);

  // Entra en cuanto el destino ya coincide con lo pedido y todavía no se ha
  // entrado para ese destino exacto — sin este guardia, cada renderizado con
  // status "idle" volvería a llamar a join().
  useEffect(() => {
    if (!target) {
      joinedFor.current = null;
      return;
    }
    const clave = claveDe(target);
    if (room.status === "idle" && clave && joinedFor.current !== clave) {
      joinedFor.current = clave;
      void room.join();
    }
  }, [target, room.status, room.join]);

  const value: VoiceCallContextValue = {
    room,
    activeChannelId: target?.corrillo ? null : (target?.channelId ?? null),
    activeCorrillo: target?.corrillo ?? null,
    activeWorkspaceId: target?.workspaceId ?? null,
    activeChannelName: target?.channelName ?? null,
    joinChannel,
    joinCorrillo,
    leaveChannel,
  };

  return (
    <VoiceCallContext.Provider value={value}>
      {children}
      {/* EL AUDIO VIVE DONDE VIVE LA LLAMADA, Y ESTE ERA EL FALLO.

          Los elementos que reproducen a los demás los pintaba la PANTALLA del
          canal. Así que al irte a cualquier otra —el tablero, la biblioteca,
          otro espacio— se desmontaban, su `srcObject` se soltaba, y dejabas de
          oír a todo el mundo. La conexión seguía viva y la barra seguía
          diciendo «en llamada», así que a ti te seguían oyendo: el síntoma era
          justo ese, «me cambio de pantalla y se deja de oír».

          Aquí no pasa: este proveedor cuelga de `app/layout.tsx`, que es el
          armazón que sobrevive a navegar. Es el mismo sitio donde ya vive la
          conexión, y esa es la razón de fondo: el sonido tiene que durar lo
          que dure la llamada, no lo que dure la vista.

          Y por eso las pantallas ya NO lo pintan: dos elementos con el mismo
          stream es oír a cada uno dos veces. */}
      {room.participants.map((participante) => (
        <HiddenAudio key={participante.peerId} stream={participante.audioStream} />
      ))}
    </VoiceCallContext.Provider>
  );
}

export function useVoiceCall(): VoiceCallContextValue {
  const ctx = useContext(VoiceCallContext);
  if (!ctx) throw new Error("useVoiceCall debe usarse dentro de VoiceCallProvider");
  return ctx;
}
