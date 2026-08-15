"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useVoiceRoom } from "./useVoiceRoom";

type Target = { channelId: string; workspaceId: string; channelName: string } | null;

type VoiceCallContextValue = {
  room: ReturnType<typeof useVoiceRoom>;
  /** Canal de la llamada activa, o null si no hay ninguna. */
  activeChannelId: string | null;
  activeWorkspaceId: string | null;
  activeChannelName: string | null;
  /** Entra en la sala de este canal. Si ya hay otra activa, sale de esa primero. */
  joinChannel: (channelId: string, workspaceId: string, channelName: string) => void;
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

  const room = useVoiceRoom(target?.channelId ?? "", target?.workspaceId ?? "");

  const joinChannel = (channelId: string, workspaceId: string, channelName: string) => {
    if (target?.channelId === channelId) return;
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
    if (room.status === "idle" && desired.current && desired.current.channelId !== target?.channelId) {
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
    if (room.status === "idle" && joinedFor.current !== target.channelId) {
      joinedFor.current = target.channelId;
      void room.join();
    }
  }, [target, room.status, room.join]);

  const value: VoiceCallContextValue = {
    room,
    activeChannelId: target?.channelId ?? null,
    activeWorkspaceId: target?.workspaceId ?? null,
    activeChannelName: target?.channelName ?? null,
    joinChannel,
    leaveChannel,
  };

  return <VoiceCallContext.Provider value={value}>{children}</VoiceCallContext.Provider>;
}

export function useVoiceCall(): VoiceCallContextValue {
  const ctx = useContext(VoiceCallContext);
  if (!ctx) throw new Error("useVoiceCall debe usarse dentro de VoiceCallProvider");
  return ctx;
}
