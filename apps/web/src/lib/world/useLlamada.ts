"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/**
 * La llamada individual que nace de acercarse a alguien.
 *
 * POR QUÉ ESTO NO ROMPE EL CIFRADO, que era la objeción a la idea original.
 * Encender la cámara automáticamente al acercarse obliga, en un espacio con
 * mucha gente, a un servidor de medios en el centro — y eso es exactamente lo
 * que rompería el cifrado de extremo a extremo. Aquí no hay espacio con mucha
 * gente: hay dos personas que han aceptado, dos navegadores y UNA conexión
 * directa. Cifrada por definición, sin nada en medio.
 *
 * EL SERVIDOR SOLO ES EL CARTERO. La negociación viaja por el socket del mundo,
 * que ya conoce a los dos — abrir un segundo socket para esto sería una pieza
 * más que mantener sin ganar nada. Lo que reparte es opaco para él.
 *
 * EL CANAL DE DATOS ES DE LA MISMA CONEXIÓN, y por eso la pizarra tampoco pasa
 * por ningún servidor: lo que se dibuja va por el mismo túnel cifrado que la
 * voz. Guardarla funciona como ya funciona grabar — uno de los dos exporta y
 * sube el resultado.
 */

export type EstadoLlamada =
  | { fase: "libre" }
  /** He llamado y espero respuesta. */
  | { fase: "llamando"; peerId: string; nombre: string }
  /** Me llaman. */
  | { fase: "entrante"; peerId: string; nombre: string; title?: string | null }
  | { fase: "conectando"; peerId: string; nombre: string }
  | { fase: "hablando"; peerId: string; nombre: string };

type Enviar = (mensaje: Record<string, unknown>) => boolean;

export function useLlamada(enviar: Enviar) {
  const [estado, setEstado] = useState<EstadoLlamada>({ fase: "libre" });
  const [remoto, setRemoto] = useState<MediaStream | null>(null);
  const [conVideo, setConVideo] = useState(false);

  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const canal = useRef<RTCDataChannel | null>(null);
  const otro = useRef<string | null>(null);
  /** Lo que llega por el canal de datos. Lo consume la pizarra. */
  const alDato = useRef<((d: unknown) => void) | null>(null);

  const colgar = useCallback(() => {
    canal.current?.close();
    canal.current = null;
    pc.current?.close();
    pc.current = null;
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    otro.current = null;
    setRemoto(null);
    setConVideo(false);
    setEstado({ fase: "libre" });
  }, []);

  useEffect(() => colgar, [colgar]);

  /**
   * Los servidores ICE los da la API, nunca una variable pública.
   *
   * Una credencial de TURN en el paquete de JavaScript es un relé abierto a
   * internet con tu factura de ancho de banda. Ver routes/ice.ts.
   */
  const crearConexion = useCallback(
    async (peerId: string) => {
      const { iceServers } = await api.get<{ iceServers: RTCIceServer[] }>(
        "/calls/ice-servers",
      );
      const conexion = new RTCPeerConnection({ iceServers });

      conexion.onicecandidate = (evento) => {
        if (evento.candidate) {
          enviar({ type: "rtc", toPeerId: peerId, data: { candidate: evento.candidate } });
        }
      };
      conexion.ontrack = (evento) => {
        setRemoto(evento.streams[0] ?? null);
        if (evento.track.kind === "video") setConVideo(true);
      };
      conexion.onconnectionstatechange = () => {
        // «failed» y «closed» son finales; «disconnected» a menudo se recupera
        // solo en unos segundos, así que colgar ahí cortaría llamadas que iban
        // a seguir.
        if (conexion.connectionState === "failed" || conexion.connectionState === "closed") {
          colgar();
        }
      };

      pc.current = conexion;
      otro.current = peerId;
      return conexion;
    },
    [enviar, colgar],
  );

  const engancharCanal = useCallback((c: RTCDataChannel) => {
    canal.current = c;
    c.onmessage = (evento) => {
      try {
        alDato.current?.(JSON.parse(evento.data));
      } catch {
        // Un mensaje ilegible del otro lado no tiene que tirar la llamada.
      }
    };
  }, []);

  /** Micrófono siempre; cámara solo si se pide. Ver el porqué en la cabecera. */
  const tomarMedios = useCallback(async (video: boolean) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    local.current = stream;
    return stream;
  }, []);

  const llamar = useCallback(
    (peerId: string, nombre: string) => {
      if (estado.fase !== "libre") return;
      setEstado({ fase: "llamando", peerId, nombre });
      enviar({ type: "knock", toPeerId: peerId });
    },
    [enviar, estado.fase],
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
    async (aceptar: boolean) => {
      if (estado.fase !== "entrante") return;
      const peerId = estado.peerId;
      enviar({ type: "knock-reply", toPeerId: peerId, accept: aceptar });
      if (!aceptar) {
        setEstado({ fase: "libre" });
        return;
      }

      setEstado({ fase: "conectando", peerId, nombre: estado.nombre });
      const conexion = await crearConexion(peerId);
      // Quien acepta espera la oferta: el que llamó es quien la crea. Que los
      // dos ofrezcan a la vez es la colisión clásica de WebRTC, y el papel fijo
      // la evita sin negociar nada.
      conexion.ondatachannel = (evento) => engancharCanal(evento.channel);
      const stream = await tomarMedios(false);
      for (const pista of stream.getTracks()) conexion.addTrack(pista, stream);
    },
    [estado, enviar, crearConexion, engancharCanal, tomarMedios],
  );

  /** Enciende la cámara a mitad de llamada, para los dos por separado. */
  const encenderCamara = useCallback(async () => {
    const conexion = pc.current;
    if (!conexion || !local.current) return;
    const [pista] = (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks();
    if (!pista) return;
    local.current.addTrack(pista);
    conexion.addTrack(pista, local.current);
    // Añadir una pista después de conectar obliga a renegociar; sin esto la
    // otra parte nunca ve el vídeo aunque se esté enviando.
    const oferta = await conexion.createOffer();
    await conexion.setLocalDescription(oferta);
    if (otro.current) enviar({ type: "rtc", toPeerId: otro.current, data: { sdp: oferta } });
  }, [enviar]);

  const enviarPorCanal = useCallback((dato: unknown) => {
    if (canal.current?.readyState !== "open") return false;
    canal.current.send(JSON.stringify(dato));
    return true;
  }, []);

  /** Lo que la pizarra usa para escuchar lo que dibuja la otra persona. */
  const escucharCanal = useCallback((fn: ((d: unknown) => void) | null) => {
    alDato.current = fn;
  }, []);

  /** Todo lo que llega dirigido a mí por el socket del mundo. */
  const recibir = useCallback(
    async (mensaje: { type: string; fromPeerId: string; [k: string]: unknown }) => {
      if (mensaje.type === "knocked") {
        // Ocupado: se rechaza solo en vez de dejar al otro esperando. Un tono
        // de «no puede atenderte» es información; el silencio no.
        if (estado.fase !== "libre") {
          enviar({ type: "knock-reply", toPeerId: mensaje.fromPeerId, accept: false });
          return;
        }
        setEstado({
          fase: "entrante",
          peerId: mensaje.fromPeerId,
          nombre: String(mensaje.displayName ?? "alguien"),
          title: (mensaje.title as string | null) ?? null,
        });
        return;
      }

      if (mensaje.type === "knock-answered") {
        if (estado.fase !== "llamando" || mensaje.fromPeerId !== estado.peerId) return;
        if (!mensaje.accept) {
          colgar();
          return;
        }
        setEstado({ fase: "conectando", peerId: estado.peerId, nombre: estado.nombre });
        const conexion = await crearConexion(estado.peerId);
        // El que llama abre el canal de datos: la pizarra necesita que exista
        // antes de que a nadie se le ocurra dibujar.
        engancharCanal(conexion.createDataChannel("pizarra"));
        const stream = await tomarMedios(false);
        for (const pista of stream.getTracks()) conexion.addTrack(pista, stream);
        const oferta = await conexion.createOffer();
        await conexion.setLocalDescription(oferta);
        enviar({ type: "rtc", toPeerId: estado.peerId, data: { sdp: oferta } });
        return;
      }

      if (mensaje.type === "rtc") {
        const conexion = pc.current;
        if (!conexion) return;
        const data = mensaje.data as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

        if (data.sdp) {
          await conexion.setRemoteDescription(data.sdp);
          if (data.sdp.type === "offer") {
            const respuesta = await conexion.createAnswer();
            await conexion.setLocalDescription(respuesta);
            enviar({ type: "rtc", toPeerId: mensaje.fromPeerId, data: { sdp: respuesta } });
          }
          setEstado((previo) =>
            previo.fase === "conectando"
              ? { fase: "hablando", peerId: previo.peerId, nombre: previo.nombre }
              : previo,
          );
        } else if (data.candidate) {
          // Un candidato que llega antes que la descripción remota no es un
          // error: se descarta y el siguiente llega bien.
          await conexion.addIceCandidate(data.candidate).catch(() => {});
        }
      }
    },
    [estado, enviar, colgar, crearConexion, engancharCanal, tomarMedios],
  );

  return {
    estado,
    remoto,
    conVideo,
    llamar,
    saludar,
    responder,
    colgar,
    encenderCamara,
    recibir,
    enviarPorCanal,
    escucharCanal,
  };
}
