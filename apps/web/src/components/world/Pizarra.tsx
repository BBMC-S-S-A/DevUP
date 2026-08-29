"use client";

import { Download, Eraser, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Rotulo } from "@/components/ui/Superficies";

/**
 * La pizarra compartida de una llamada individual.
 *
 * EL SERVIDOR NUNCA VE LO QUE SE DIBUJA. Va por el canal de datos de la misma
 * conexión que lleva la voz, así que está cifrada por el mismo túnel y no pasa
 * por ninguna máquina nuestra. No es un detalle de implementación: es lo que
 * permite que exista sin reabrir la decisión del cifrado de extremo a extremo.
 *
 * SE MANDAN TRAZOS, NO IMÁGENES. Cada movimiento manda dos puntos y un color:
 * unas decenas de bytes. Mandar el lienzo entero —que es lo primero que uno
 * piensa— son cientos de kilobytes por fotograma y el canal de datos se atasca
 * en segundos. La contrapartida es que quien llega tarde no ve lo dibujado
 * antes, y por eso al abrirla se manda una vez el estado completo.
 *
 * GUARDARLA FUNCIONA COMO GRABAR: uno de los dos exporta y sube el resultado.
 * No hay una versión en el servidor que sincronizar, y no la hay a propósito.
 */

type Trazo = { x1: number; y1: number; x2: number; y2: number; color: string; grosor: number };

const COLORES = ["#a78bfa", "#34d399", "#f5b53f", "#fb7185", "#e7ebf2"];

export function Pizarra({
  onCerrar,
  enviar,
  escuchar,
}: {
  onCerrar: () => void;
  /** Manda algo por el canal de datos de la llamada. */
  enviar: (dato: unknown) => boolean;
  /** Se suscribe a lo que llega por ese canal. */
  escuchar: (fn: ((d: unknown) => void) | null) => void;
}) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  /** Todo lo dibujado, para poder repintar al cambiar de tamaño y para exportar. */
  const historia = useRef<Trazo[]>([]);
  const [color, setColor] = useState(COLORES[0]!);
  const [borrando, setBorrando] = useState(false);

  const pintar = useCallback((trazo: Trazo) => {
    const ctx = lienzo.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = trazo.color;
    ctx.lineWidth = trazo.grosor;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(trazo.x1, trazo.y1);
    ctx.lineTo(trazo.x2, trazo.y2);
    ctx.stroke();
  }, []);

  const repintar = useCallback(() => {
    const ctx = lienzo.current?.getContext("2d");
    if (!ctx || !lienzo.current) return;
    ctx.clearRect(0, 0, lienzo.current.width, lienzo.current.height);
    for (const trazo of historia.current) pintar(trazo);
  }, [pintar]);

  // Lo que dibuja la otra persona.
  useEffect(() => {
    escuchar((dato) => {
      const mensaje = dato as { tipo?: string; trazo?: Trazo; trazos?: Trazo[] };
      if (mensaje.tipo === "trazo" && mensaje.trazo) {
        historia.current.push(mensaje.trazo);
        pintar(mensaje.trazo);
      } else if (mensaje.tipo === "todo" && mensaje.trazos) {
        // Quien acaba de abrir la pizarra recibe lo que ya había.
        historia.current = mensaje.trazos;
        repintar();
      } else if (mensaje.tipo === "limpiar") {
        historia.current = [];
        repintar();
      }
    });
    return () => escuchar(null);
  }, [escuchar, pintar, repintar]);

  // Al abrir, se manda lo que uno tenga. Si los dos abren a la vez se mandan lo
  // mismo dos veces y gana el último, que con un lienzo en blanco da igual.
  useEffect(() => {
    if (historia.current.length > 0) {
      enviar({ tipo: "todo", trazos: historia.current });
    }
  }, [enviar]);

  // El lienzo se dimensiona en píxeles reales, no en CSS: sin esto el trazo
  // sale borroso en cualquier pantalla con más de un píxel por punto.
  useEffect(() => {
    const canvas = lienzo.current;
    if (!canvas) return;
    const ajustar = () => {
      const caja = canvas.getBoundingClientRect();
      canvas.width = caja.width;
      canvas.height = caja.height;
      repintar();
    };
    ajustar();
    const observador = new ResizeObserver(ajustar);
    observador.observe(canvas);
    return () => observador.disconnect();
  }, [repintar]);

  function punto(evento: React.PointerEvent) {
    const caja = lienzo.current!.getBoundingClientRect();
    return { x: evento.clientX - caja.left, y: evento.clientY - caja.top };
  }

  return (
    <div className="cristal-denso flex h-full w-full flex-col overflow-hidden rounded-2xl">
      <header className="filo-luz flex shrink-0 items-center justify-between gap-3 px-3 py-2">
        <Rotulo>Pizarra · solo la veis los dos</Rotulo>
        <div className="flex items-center gap-1.5">
          {COLORES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              aria-pressed={color === c && !borrando}
              onClick={() => {
                setColor(c);
                setBorrando(false);
              }}
              className={`size-4 rounded-full transition-transform duration-150
                ${color === c && !borrando ? "scale-125 ring-2 ring-ink/30" : ""}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <BotonIcono
            etiqueta={borrando ? "Dibujar" : "Borrar"}
            onClick={() => setBorrando((b) => !b)}
            className={borrando ? "text-accent" : ""}
          >
            <Eraser size={14} />
          </BotonIcono>
          <BotonIcono
            etiqueta="Limpiar la pizarra"
            onClick={() => {
              historia.current = [];
              repintar();
              enviar({ tipo: "limpiar" });
            }}
          >
            <Trash2 size={14} />
          </BotonIcono>
          <BotonIcono
            etiqueta="Guardar como imagen"
            onClick={() => {
              const url = lienzo.current?.toDataURL("image/png");
              if (!url) return;
              const enlace = document.createElement("a");
              enlace.href = url;
              enlace.download = `pizarra-${new Date().toISOString().slice(0, 10)}.png`;
              enlace.click();
            }}
          >
            <Download size={14} />
          </BotonIcono>
          <BotonIcono etiqueta="Cerrar la pizarra" onClick={onCerrar}>
            <X size={14} />
          </BotonIcono>
        </div>
      </header>

      <canvas
        ref={lienzo}
        className="min-h-0 flex-1 cursor-crosshair touch-none bg-canvas/40"
        onPointerDown={(evento) => {
          evento.currentTarget.setPointerCapture(evento.pointerId);
          dibujando.current = true;
          ultimo.current = punto(evento);
        }}
        onPointerMove={(evento) => {
          if (!dibujando.current || !ultimo.current) return;
          const ahora = punto(evento);
          const trazo: Trazo = {
            x1: ultimo.current.x,
            y1: ultimo.current.y,
            x2: ahora.x,
            y2: ahora.y,
            // Borrar es pintar del color del fondo y no un modo aparte: la
            // pizarra no tiene capas, así que «quitar» no significa nada.
            color: borrando ? "#08070c" : color,
            grosor: borrando ? 18 : 2.5,
          };
          historia.current.push(trazo);
          pintar(trazo);
          enviar({ tipo: "trazo", trazo });
          ultimo.current = ahora;
        }}
        onPointerUp={() => {
          dibujando.current = false;
          ultimo.current = null;
        }}
        onPointerLeave={() => {
          dibujando.current = false;
          ultimo.current = null;
        }}
      />

      <footer className="shrink-0 px-3 pb-2">
        <p className="text-[10px] leading-relaxed text-faint">
          Va por el canal de datos de vuestra llamada: no pasa por ningún servidor. Para conservarla,
          guárdala como imagen y súbela a la biblioteca.
        </p>
      </footer>
    </div>
  );
}

/** El botón que la abre, para que quien llame no tenga que buscarlo. */
export function BotonPizarra({ onAbrir }: { onAbrir: () => void }) {
  return (
    <Boton tamano="sm" variante="secundario" onClick={onAbrir}>
      Pizarra
    </Boton>
  );
}
