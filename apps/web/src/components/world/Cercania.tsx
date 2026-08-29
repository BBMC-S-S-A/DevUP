"use client";

import { Hand, Phone, PhoneOff, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Chip, Rotulo } from "@/components/ui/Superficies";
import type { EstadoLlamada } from "@/lib/world/useLlamada";
import { BotonPizarra, Pizarra } from "./Pizarra";

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
 */
export function PanelLlamada({
  estado,
  remoto,
  conVideo,
  onColgar,
  onCamara,
  enviarPorCanal,
  escucharCanal,
}: {
  estado: EstadoLlamada;
  remoto: MediaStream | null;
  conVideo: boolean;
  onColgar: () => void;
  onCamara: () => void;
  enviarPorCanal: (dato: unknown) => boolean;
  escucharCanal: (fn: ((d: unknown) => void) | null) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [pizarra, setPizarra] = useState(false);

  // El audio va en su propio elemento y no dentro del vídeo: si la otra parte
  // no ha encendido la cámara no hay elemento de vídeo que reproducir, y la voz
  // se perdería con él.
  useEffect(() => {
    if (audio.current) audio.current.srcObject = remoto;
    if (video.current) video.current.srcObject = remoto;
  }, [remoto]);

  if (estado.fase === "libre" || estado.fase === "entrante") return null;

  const hablando = estado.fase === "hablando";

  return (
    <>
      <audio ref={audio} autoPlay />

      {pizarra && (
        <div className="pointer-events-auto fixed inset-6 z-50 md:inset-12">
          <Pizarra
            onCerrar={() => setPizarra(false)}
            enviar={enviarPorCanal}
            escuchar={escucharCanal}
          />
        </div>
      )}

      <div className="pointer-events-auto fixed bottom-4 right-4 z-40 w-64">
        <div className="cristal-denso overflow-hidden rounded-2xl shadow-xl">
          {conVideo && (
            <video ref={video} autoPlay playsInline className="aspect-video w-full bg-canvas" />
          )}

          <div className="p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <Rotulo>{hablando ? "En llamada" : "Conectando"}</Rotulo>
                <p className="truncate text-xs font-semibold">{estado.nombre}</p>
              </div>
              {!hablando && (
                <Chip tono="accent">
                  {estado.fase === "llamando" ? "Llamando" : "Conectando"}
                </Chip>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <BotonIcono etiqueta="Encender la cámara" onClick={onCamara} disabled={!hablando}>
                <Video size={14} />
              </BotonIcono>
              {hablando && <BotonPizarra onAbrir={() => setPizarra(true)} />}
              <div className="flex-1" />
              <BotonIcono etiqueta="Colgar" onClick={onColgar} className="hover:text-danger">
                <PhoneOff size={14} />
              </BotonIcono>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
