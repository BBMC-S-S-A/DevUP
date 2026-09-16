"use client";

import { Hand, Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Chip, Rotulo } from "@/components/ui/Superficies";
import type { EstadoLlamada } from "@/lib/world/useLlamada";
import { BotonPizarra, Pizarra } from "./Pizarra";
import type { useVoiceCall } from "@/lib/voice/VoiceCallProvider";

/**
 * Acercarse a alguien: el menú, la llamada entrante y el panel de llamada.
 *
 * ACERCARSE NO ENCIENDE NADA. La idea original —la cámara se abre sola al
 * aproximarse— chocaba con el cifrado de extremo a extremo: en un espacio con
 * mucha gente, el vídeo automático obliga a un servidor de medios en medio.
 * La versión acordada ofrece «saludar» o «llamar», y las cámaras se encienden
 * solo si los dos aceptan. Es mejor diseño además de compatible: acercarse a
 * alguien para leer el rótulo de la sala de detrás no debería abrirle la cámara
 * a nadie.
 */

export function MenuCercania({
  nombre,
  title,
  presence,
  onSaludar,
  onLlamar,
  ocupado,
}: {
  nombre: string;
  title?: string | null;
  presence?: string;
  onSaludar: () => void;
  onLlamar: () => void;
  /** Ya hay una llamada en curso: llamar otra vez no lleva a nada. */
  ocupado: boolean;
}) {
  const noMolestar = presence === "do_not_disturb";

  return (
    <div className="devup-materializa cristal-denso pointer-events-auto rounded-2xl px-3 py-2.5 shadow-lg">
      <div className="mb-2 min-w-0">
        <p className="truncate text-xs font-semibold">{nombre}</p>
        {title && <p className="truncate text-[10px] text-faint">{title}</p>}
      </div>

      <div className="flex items-center gap-1.5">
        <Boton tamano="sm" variante="secundario" icono={<Hand size={12} />} onClick={onSaludar}>
          Saludar
        </Boton>
        <Boton
          tamano="sm"
          variante={noMolestar ? "fantasma" : "primario"}
          icono={<Phone size={12} />}
          onClick={onLlamar}
          disabled={ocupado}
          // «No molestar» no bloquea la llamada, la desaconseja. Bloquearla
          // convertiría el estado en un muro y la gente dejaría de usarlo por
          // miedo a quedarse incomunicada; avisar deja la decisión en quien
          // llama, que es quien sabe si es importante.
          title={noMolestar ? "Ha pedido que no le molesten. Llama solo si hace falta." : undefined}
        >
          Llamar
        </Boton>
      </div>

      {noMolestar && (
        <p className="mt-1.5 max-w-[13rem] text-[10px] leading-relaxed text-faint">
          Ha pedido que no le molesten.
        </p>
      )}
    </div>
  );
}

/** La llamada entrante. Ocupa el centro porque no se puede ignorar sin decidir. */
export function LlamadaEntrante({
  nombre,
  title,
  onAceptar,
  onRechazar,
}: {
  nombre: string;
  title?: string | null;
  onAceptar: () => void;
  onRechazar: () => void;
}) {
  return (
    <div className="pointer-events-auto fixed left-1/2 top-6 z-50 -translate-x-1/2">
      <div className="devup-materializa cristal-denso flex items-center gap-3 rounded-2xl px-4 py-3 shadow-xl">
        <span className="devup-llega grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <Phone size={16} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{nombre} te llama</p>
          {title && <p className="truncate text-[11px] text-faint">{title}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Boton tamano="sm" variante="fantasma" onClick={onRechazar}>
            Ahora no
          </Boton>
          <Boton tamano="sm" variante="primario" onClick={onAceptar}>
            Responder
          </Boton>
        </div>
      </div>
    </div>
  );
}

/**
 * El panel de la llamada en curso.
 *
 * Se queda en una esquina y no ocupa la pantalla: la gracia de llamar desde la
 * oficina es seguir viendo la oficina. La pizarra sí crece, porque para dibujar
 * hace falta sitio.
 *
 * LO QUE ENSEÑA SALE DE LA SALA, NO DE LA LLAMADA. Desde que la llamada por
 * cercanía es un corrillo —una sala de voz efímera— aquí puede haber tres
 * personas, así que se listan las que hay en vez de nombrar a «la otra». El
 * audio de todas lo reproduce `VoiceCallProvider`, como en cualquier sala.
 */
export function PanelLlamada({
  estado,
  room,
  onColgar,
}: {
  estado: EstadoLlamada;
  /** La sala efímera: quién hay, el micrófono, la cámara y el canal de datos. */
  room: ReturnType<typeof useVoiceCall>["room"];
  onColgar: () => void;
}) {
  const mio = useRef<HTMLVideoElement>(null);
  const [pizarra, setPizarra] = useState(false);

  // Verse a uno mismo al encender la cámara. Sin esto, le das al botón, se
  // enciende la luz de la cámara y en pantalla no pasa nada: es lo que hacía
  // creer que la cámara del DevVerse no servía.
  useEffect(() => {
    if (mio.current) mio.current.srcObject = room.localCameraStream;
  }, [room.localCameraStream]);

  if (estado.fase === "libre" || estado.fase === "entrante") return null;

  const hablando = estado.fase === "hablando";
  const gente = room.participants;

  return (
    <>
      {pizarra && (
        <div className="pointer-events-auto fixed inset-6 z-50 md:inset-12">
          <Pizarra
            onCerrar={() => setPizarra(false)}
            enviar={room.enviarPorCanal}
            escuchar={room.escucharCanal}
          />
        </div>
      )}

      <div className="pointer-events-auto fixed bottom-4 right-4 z-40 w-64">
        <div className="cristal-denso overflow-hidden rounded-2xl shadow-xl">
          {room.localCameraStream && (
            <video
              ref={mio}
              autoPlay
              playsInline
              // MUDO SIEMPRE: el navegador no reproduce vídeo con sonido sin un
              // gesto previo, y si lo hiciera te oirías a ti mismo con retardo.
              muted
              className="aspect-video w-full -scale-x-100 bg-canvas"
            />
          )}

          <div className="p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <Rotulo>{hablando ? "En corrillo" : "Llamando"}</Rotulo>
                {/* QUIÉN HAY, no «con quién hablas»: en un corrillo pueden ser
                    tres, y nombrar solo a la primera persona haría creer que
                    las demás no están oyendo. */}
                <p className="truncate text-xs font-semibold">
                  {hablando
                    ? gente.length === 0
                      ? "Esperando a que entren"
                      : gente.map((p) => p.displayName).join(", ")
                    : estado.nombre}
                </p>
              </div>
              {!hablando && <Chip tono="accent">Llamando</Chip>}
            </div>

            {/* Cualquiera del corrillo puede invitar a un cuarto acercándose y
                llamándole: el grupo crece, no se parte. Se dice aquí porque en
                una llamada de dos eso no se podía, y nadie lo va a suponer. */}
            {hablando && gente.length > 0 && (
              <p className="mb-2 text-[10px] leading-relaxed text-faint">
                Acércate a alguien más y llámale: se suma a este mismo corrillo.
              </p>
            )}

            <div className="flex items-center gap-1.5">
              <BotonIcono
                etiqueta={room.muted ? "Activar el micrófono" : "Silenciar el micrófono"}
                onClick={() => room.toggleMute()}
                disabled={!hablando}
                className={room.muted ? "text-danger" : ""}
              >
                {room.muted ? <MicOff size={14} /> : <Mic size={14} />}
              </BotonIcono>
              <BotonIcono
                etiqueta={room.cameraOn ? "Apagar la cámara" : "Encender la cámara"}
                onClick={() => void room.toggleCamera()}
                disabled={!hablando}
                className={room.cameraOn ? "text-accent" : ""}
              >
                {room.cameraOn ? <VideoOff size={14} /> : <Video size={14} />}
              </BotonIcono>
              {hablando && <BotonPizarra onAbrir={() => setPizarra(true)} />}
              <div className="flex-1" />
              <BotonIcono etiqueta="Colgar" onClick={onColgar} className="hover:text-danger">
                <PhoneOff size={14} />
              </BotonIcono>
            </div>

            {/* Lo que dijo el navegador cuando dijo que no. Cada motivo se
                arregla de una forma distinta, así que se dice cuál fue. */}
            {room.error && (
              <p className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] leading-relaxed text-danger">
                {room.error}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
