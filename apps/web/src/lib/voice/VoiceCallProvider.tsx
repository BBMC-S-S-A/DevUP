"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
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
  /**
   * Los elementos que están sonando, por participante.
   *
   * ESTÁ AQUÍ PARA QUE EL AUDIO POR CERCANÍA NO SE CREE LOS SUYOS. En el
   * DevVerse no todo el mundo suena igual: se oye más fuerte a quien tienes al
   * lado. Ese gradiente necesita tocar el volumen de un elemento concreto, y
   * la forma obvia —que el mundo pinte sus propios `<audio>`— es la que dio el
   * fallo: desde que la llamada vive aquí para sobrevivir a navegar, eran DOS
   * elementos por persona. Se oía a cada uno dos veces y, peor, la copia de
   * aquí sonaba a volumen fijo, así que alejarse ya no bajaba a nadie.
   *
   * Un ref y no estado: esto cambia al ritmo de los fotogramas, y meterlo en
   * el valor del contexto re-renderizaría media aplicación por nada.
   */
  elementosDeAudio: RefObject<Map<string, HTMLMediaElement>>;
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

  /**
   * LO ÚLTIMO QUE SE SABE, PARA QUE LAS TRES FUNCIONES DE ABAJO NO CAMBIEN
   * NUNCA DE IDENTIDAD. Y eso no es una optimización: es lo que impide un
   * bucle infinito.
   *
   * Estas funciones salen por el contexto, y hay quien las usa como
   * dependencia de un efecto. `useLlamada` —el pasillo del DevVerse— tiene un
   * `useEffect(() => colgar, [colgar])` para colgar al salir del mundo, y
   * `colgar` depende de `leaveChannel`. Mientras `leaveChannel` se recreaba en
   * CADA renderizado, la cadena era: renderizo → `leaveChannel` nuevo →
   * `colgar` nuevo → el efecto ejecuta su limpieza → cuelga y hace `setEstado`
   * → renderizo. DevVerse se colgaba a sí mismo en bucle y la pestaña se comía
   * la CPU con «Maximum update depth exceeded».
   *
   * Con las dependencias leídas de este ref, las funciones se crean una vez y
   * ya. Meterlas en `useCallback` con `[target, room]` no habría bastado:
   * `room` trae los participantes y cambia sola cada vez que alguien habla.
   */
  const ultimo = useRef({ target, room });
  ultimo.current = { target, room };

  /** Ver `elementosDeAudio` en el tipo del contexto. */
  const elementosDeAudio = useRef(new Map<string, HTMLMediaElement>());

  const joinCorrillo = useCallback((corrillo: string, workspaceId: string, nombre: string) => {
    const { target: actual, room: sala } = ultimo.current;
    if (actual?.corrillo === corrillo) return;
    desired.current = { channelId: "", workspaceId, channelName: nombre, corrillo };
    if (sala.status === "idle") {
      setTarget(desired.current);
    } else {
      sala.leave();
    }
  }, []);

  const joinChannel = useCallback((channelId: string, workspaceId: string, channelName: string) => {
    const { target: actual, room: sala } = ultimo.current;
    if (actual?.channelId === channelId && !actual?.corrillo) return;
    desired.current = { channelId, workspaceId, channelName };
    if (sala.status === "idle") {
      setTarget(desired.current);
    } else {
      // Cambiar de sala a mitad de llamada: primero se sale de la actual: el
      // efecto de abajo recoge `desired` en cuanto quede libre.
      sala.leave();
    }
  }, []);

  const leaveChannel = useCallback(() => {
    desired.current = null;
    joinedFor.current = null;
    ultimo.current.room.leave();
    setTarget(null);
  }, []);

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
    elementosDeAudio,
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
        <HiddenAudio
          key={participante.peerId}
          stream={participante.audioStream}
          // Se apunta quién es quién para que el audio por cercanía del
          // DevVerse pueda subirle y bajarle el volumen A ESTE elemento en vez
          // de crearse otro. Ver `elementosDeAudio` en el tipo del contexto.
          alRegistrar={(elemento) => {
            if (elemento) elementosDeAudio.current.set(participante.peerId, elemento);
            else elementosDeAudio.current.delete(participante.peerId);
          }}
        />
      ))}
    </VoiceCallContext.Provider>
  );
}

export function useVoiceCall(): VoiceCallContextValue {
  const ctx = useContext(VoiceCallContext);
  if (!ctx) throw new Error("useVoiceCall debe usarse dentro de VoiceCallProvider");
  return ctx;
}
