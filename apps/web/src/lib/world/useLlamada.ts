"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * La llamada que nace de acercarse a alguien.
 *
 * YA NO TIENE CONEXIÓN PROPIA, y ese es el cambio. Antes esto mantenía UNA
 * `RTCPeerConnection` y un solo interlocutor, así que la llamada por cercanía
 * era de dos personas por construcción: el tercero que llegaba se encontraba a
 * los otros dos ocupados. Ahora esto solo hace de INVITACIÓN —llamar, sonar,
 * aceptar— y quien acepta entra en un CORRILLO: una sala de voz efímera, sin
 * canal detrás, con la misma malla que ya aguanta tres en una sala de verdad.
 *
 * POR QUÉ NO SE ESCRIBIÓ AQUÍ UNA MALLA PARA VARIOS. Sería la segunda del
 * proyecto, y la segunda hereda todos los fallos que la primera ya arregló: la
 * renegociación al añadir una pista, los candidatos que llegan antes que la
 * descripción remota, el par que se queda zombi cuando se cae la red. La malla
 * de las salas ya los tiene resueltos y probados.
 *
 * LO QUE SE CONSERVA DEL DISEÑO ANTERIOR, porque era bueno: que llamar PIDA
 * PERMISO. Acercarse a alguien no te mete en su conversación; se llama, suena,
 * y la otra persona acepta. Eso es lo que distingue el pasillo de una sala,
 * donde se entra caminando.
 *
 * EL CIFRADO NO CAMBIA: la malla es entre pares, sin nada en medio. El servidor
 * sigue siendo el cartero de la negociación y no oye nada.
 */

export type EstadoLlamada =
  | { fase: "libre" }
  /** He llamado y espero respuesta. */
  | { fase: "llamando"; peerId: string; nombre: string; corrillo: string }
  /** Me llaman. */
  | { fase: "entrante"; peerId: string; nombre: string; title?: string | null; corrillo: string }
  | { fase: "hablando"; nombre: string };

type Enviar = (mensaje: Record<string, unknown>) => boolean;

type Corrillos = {
  /** Entra en el corrillo (sala efímera) indicado. */
  joinCorrillo: (corrillo: string, workspaceId: string, nombre: string) => void;
  /** Sale de donde se esté. */
  leaveChannel: () => void;
  /** En qué corrillo estoy, si estoy en uno. */
  activeCorrillo: string | null;
};

export function useLlamada(enviar: Enviar, workspaceId: string, salas: Corrillos) {
  const [estado, setEstado] = useState<EstadoLlamada>({ fase: "libre" });

  const { joinCorrillo, leaveChannel, activeCorrillo } = salas;

  const colgar = useCallback(() => {
    leaveChannel();
    setEstado({ fase: "libre" });
  }, [leaveChannel]);

  // Irse del mundo cuelga. Estar en el pasillo es lo que sostiene un corrillo:
  // fuera de la oficina no hay pasillo en el que estar.
  useEffect(() => colgar, [colgar]);

  /**
   * Llamar a alguien.
   *
   * SI YA ESTOY EN UN CORRILLO, PROPONGO EL MÍO. Es lo que hace que el grupo
   * crezca en vez de partirse: quien ya está hablando con dos invita al
   * tercero al mismo sitio, no a uno nuevo. Si no estoy en ninguno, se propone
   * uno recién inventado.
   */
  const llamar = useCallback(
    (peerId: string, nombre: string) => {
      if (estado.fase !== "libre" && estado.fase !== "hablando") return;
      const corrillo = activeCorrillo ?? crypto.randomUUID();
      setEstado({ fase: "llamando", peerId, nombre, corrillo });
      enviar({ type: "knock", toPeerId: peerId, corrillo });
    },
    [enviar, estado.fase, activeCorrillo],
  );

  const saludar = useCallback(
    (peerId: string) => {
      // Saludar no abre nada: es un gesto que ve toda la oficina. Está aquí y
      // no en el menú para que las dos acciones del menú salgan del mismo
      // sitio y no se separen con el tiempo.
      enviar({ type: "emote", emote: "wave" });
      void peerId;
    },
    [enviar],
  );

  const responder = useCallback(
    (aceptar: boolean) => {
      if (estado.fase !== "entrante") return;
      const { peerId, nombre, corrillo } = estado;
      enviar({ type: "knock-reply", toPeerId: peerId, accept: aceptar });
      if (!aceptar) {
        setEstado({ fase: "libre" });
        return;
      }
      // Entrar en el corrillo QUE PROPUSO QUIEN LLAMA, no en uno propio: si
      // cada uno abriera el suyo, dos personas que se aceptan acabarían en dos
      // salas distintas hablando solas.
      joinCorrillo(corrillo, workspaceId, `Con ${nombre}`);
      setEstado({ fase: "hablando", nombre });
    },
    [estado, enviar, joinCorrillo, workspaceId],
  );

  /** Todo lo que llega dirigido a mí por el socket del mundo. */
  const recibir = useCallback(
    (mensaje: { type: string; fromPeerId: string; [k: string]: unknown }) => {
      if (mensaje.type === "knocked") {
        // Ocupado se rechaza solo, salvo que ya esté hablando: entonces la
        // llamada es una invitación a unirse a lo que ya hay, y eso sí se
        // pregunta. Un tono de «no puede atenderte» es información; el
        // silencio, no.
        if (estado.fase === "llamando" || estado.fase === "entrante") {
          enviar({ type: "knock-reply", toPeerId: mensaje.fromPeerId, accept: false });
          return;
        }
        setEstado({
          fase: "entrante",
          peerId: mensaje.fromPeerId,
          nombre: String(mensaje.displayName ?? "alguien"),
          title: (mensaje.title as string | null) ?? null,
          corrillo: String(mensaje.corrillo),
        });
        return;
      }

      if (mensaje.type === "knock-answered") {
        if (estado.fase !== "llamando" || mensaje.fromPeerId !== estado.peerId) return;
        if (!mensaje.accept) {
          colgar();
          return;
        }
        // Quien llamó entra al corrillo QUE PROPUSO. Si ya estaba dentro —acaba
        // de sumar un tercero al grupo— `joinCorrillo` ve que es el mismo y no
        // hace nada, que es justo lo que tiene que pasar: nadie se sale de la
        // conversación por invitar a alguien.
        joinCorrillo(estado.corrillo, workspaceId, `Con ${estado.nombre}`);
        setEstado({ fase: "hablando", nombre: estado.nombre });
      }
    },
    [estado, enviar, colgar, joinCorrillo, workspaceId],
  );

  return { estado, llamar, saludar, responder, colgar, recibir };
}
