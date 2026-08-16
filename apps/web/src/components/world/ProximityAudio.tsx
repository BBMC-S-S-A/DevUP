"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Participant } from "@/lib/voice/useVoiceRoom";
import type { WorldState } from "@/lib/world/useWorld";

/**
 * El audio de la oficina: se oye más fuerte a quien tienes más cerca.
 *
 * DÓNDE ESTÁ EL REPARTO DE LA MALLA, QUE NO ES AQUÍ. La malla WebRTC se rompe
 * por encima de unos seis participantes porque cada cliente sube su audio N−1
 * veces. Lo que impide llegar ahí no es este archivo: es que entrar en una
 * zona sea entrar en su canal. Solo se abre conexión con quien está en la
 * misma llamada, así que una oficina de veinte personas repartidas en cuatro
 * salas son cuatro llamadas de cinco, no una de veinte. Las zonas reparten la
 * malla por construcción — ese es el argumento del documento 0002 y está en
 * `onZoneChange`, no en el volumen.
 *
 * Lo que hace este archivo es el gradiente dentro de una sala: dos
 * conversaciones en la misma zona de desarrollo se oyen distinto según dónde
 * estés parado, que es lo que hace que una sala grande siga siendo habitable.
 *
 * EL VOLUMEN SE MUEVE FUERA DE REACT. Cambiarlo por estado dispararía un
 * renderizado por fotograma y por participante. Aquí los elementos se crean
 * una vez —eso sí es React— y el volumen lo ajusta un bucle de animación
 * escribiendo directamente sobre el elemento.
 */

/** Dentro de este radio se oye al máximo. Fuera, baja hasta callarse. */
const FULL_VOLUME_RADIUS = 2.2;
/**
 * Suavizado del volumen, en milisegundos.
 *
 * Sin él, cruzarse con alguien produce un chasquido: el volumen salta de 0,2 a
 * 0,9 entre dos fotogramas. Es la misma histéresis que ya se usó para el
 * indicador de quién habla, por el mismo motivo — un umbral desnudo se nota.
 */
const FADE_TAU = 120;

export function ProximityAudio({
  participants,
  stateRef,
  radius,
}: {
  participants: Participant[];
  stateRef: RefObject<WorldState>;
  radius: number;
}) {
  const elements = useRef(new Map<string, HTMLAudioElement>());
  const volumes = useRef(new Map<string, number>());

  useEffect(() => {
    let frame = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;

      const state = stateRef.current;
      if (state) {
        const self = state.self;

        for (const [peerId, element] of elements.current) {
          const participant = participants.find((p) => p.peerId === peerId);
          if (!participant) continue;

          // Una misma persona puede tener dos pestañas abiertas y por tanto
          // dos avatares. Manda el más cercano: es el que corresponde a donde
          // está mirando de verdad.
          let distance = Number.POSITIVE_INFINITY;
          for (const peer of state.peers.values()) {
            if (peer.userId !== participant.userId) continue;
            distance = Math.min(distance, Math.hypot(peer.x - self.x, peer.y - self.y));
          }

          // A quien no se ve en el mundo —está en la llamada pero todavía no
          // ha aparecido su avatar— se le oye normal. Silenciarlo sería peor:
          // parecería que la llamada no funciona.
          const target = !Number.isFinite(distance)
            ? 1
            : distance <= FULL_VOLUME_RADIUS
              ? 1
              : Math.max(0, 1 - (distance - FULL_VOLUME_RADIUS) / (radius - FULL_VOLUME_RADIUS));

          const current = volumes.current.get(peerId) ?? target;
          const k = 1 - Math.exp(-dt / FADE_TAU);
          const next = current + (target - current) * k;
          volumes.current.set(peerId, next);
          element.volume = Math.max(0, Math.min(1, next));
        }
      }

      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [participants, stateRef, radius]);

  return (
    <>
      {participants
        .filter((p) => p.audioStream !== null)
        .map((participant) => (
          <PeerAudio
            key={participant.peerId}
            participant={participant}
            register={(element) => {
              if (element) elements.current.set(participant.peerId, element);
              else {
                elements.current.delete(participant.peerId);
                volumes.current.delete(participant.peerId);
              }
            }}
          />
        ))}
    </>
  );
}

function PeerAudio({
  participant,
  register,
}: {
  participant: Participant;
  register: (element: HTMLAudioElement | null) => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !participant.audioStream) return;
    element.srcObject = participant.audioStream;
    // Arranca en silencio: el bucle lo sube según la distancia real. Al revés,
    // el primer fotograma sonaría a todo volumen aunque estés al otro lado.
    element.volume = 0;
    void element.play().catch(() => {});
    register(element);
    return () => {
      register(null);
      element.srcObject = null;
    };
  }, [participant.audioStream, register]);

  return <audio ref={ref} autoPlay className="hidden" />;
}
