import type { TipoNodoArquitectura } from "@/lib/api";

/**
 * La silueta de cada caja del diagrama.
 *
 * POR QUÉ NO TODAS SON UN RECTÁNGULO. En un diagrama de arquitectura la forma
 * es información: el cilindro quiere decir «aquí se guardan datos» y se lee de
 * un vistazo, sin llegar a la etiqueta. Es la convención de draw.io, de Visio y
 * de los diagramas que dibuja cualquiera en una pizarra desde hace treinta
 * años, y pelearse con ella solo consigue que haya que leerlo todo dos veces.
 *
 * SON `path` Y NO ICONOS. Un icono dentro de una caja sigue siendo una caja: el
 * borde es lo que da la forma, así que la silueta tiene que ser el propio
 * contorno. Se dibujan en un `<svg>` que ocupa la tarjeta entera y va por
 * debajo del texto.
 *
 * CADA FORMA DEJA SU HUECO. Un cilindro tiene una tapa arriba y una nube se
 * estrecha por los lados: si el texto se pintara siempre en el mismo sitio,
 * unas cuantas formas lo sacarían fuera del contorno. `INSET` dice cuánto hay
 * que apartarse en cada una.
 */

export const ANCHO_NODO = 180;
export const ALTO_NODO = 84;

/** Cuánto se aparta el contenido del borde, por forma: arriba, los lados. */
export const INSET: Record<TipoNodoArquitectura, { top: number; x: number }> = {
  servicio: { top: 10, x: 12 },
  // La tapa del cilindro se come la primera franja.
  base_datos: { top: 16, x: 14 },
  cola: { top: 10, x: 16 },
  // El hexágono se estrecha arriba y abajo, no a media altura.
  cache: { top: 10, x: 22 },
  // El cubo se estrecha hacia abajo.
  almacenamiento: { top: 10, x: 18 },
  // La nube es lo que menos superficie recta tiene.
  api_externa: { top: 20, x: 22 },
  otro: { top: 10, x: 12 },
};

/** Alto de la tapa del cilindro. Se usa también para dibujar su costura. */
const TAPA = 9;

function trazo(kind: TipoNodoArquitectura, w: number, h: number): string {
  switch (kind) {
    case "base_datos": {
      // Cilindro: tapa elíptica arriba, costado recto, fondo curvo.
      return [
        `M 0 ${TAPA}`,
        `A ${w / 2} ${TAPA} 0 0 1 ${w} ${TAPA}`,
        `L ${w} ${h - TAPA}`,
        `A ${w / 2} ${TAPA} 0 0 1 0 ${h - TAPA}`,
        "Z",
      ].join(" ");
    }
    case "cache": {
      // Hexágono tumbado, la forma de siempre para «esto está de paso».
      const k = 16;
      return `M ${k} 0 L ${w - k} 0 L ${w} ${h / 2} L ${w - k} ${h} L ${k} ${h} L 0 ${h / 2} Z`;
    }
    case "almacenamiento": {
      // Cubo: se estrecha hacia abajo. Se distingue del cilindro de un vistazo
      // y no hay que leer la etiqueta para saber cuál es cuál.
      const k = 12;
      return `M 2 6 L ${w - 2} 6 L ${w - k} ${h} L ${k} ${h} Z`;
    }
    case "api_externa": {
      // Nube: lo que no es nuestro y vive fuera.
      return [
        `M ${w * 0.2} ${h * 0.86}`,
        `C ${w * 0.0} ${h * 0.86} ${w * 0.0} ${h * 0.42} ${w * 0.22} ${h * 0.44}`,
        `C ${w * 0.2} ${h * 0.06} ${w * 0.62} ${h * 0.02} ${w * 0.66} ${h * 0.34}`,
        `C ${w * 0.92} ${h * 0.24} ${w * 1.02} ${h * 0.6} ${w * 0.82} ${h * 0.86}`,
        "Z",
      ].join(" ");
    }
    default: {
      // Servicio, cola y «otro» comparten rectángulo: lo que los separa es el
      // redondeo y, en la cola, las divisiones de dentro.
      const r = kind === "servicio" ? 12 : kind === "cola" ? 4 : 6;
      return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`;
    }
  }
}

export function FormaNodo({
  kind,
  resaltada,
  ancho = ANCHO_NODO,
  alto = ALTO_NODO,
}: {
  kind: TipoNodoArquitectura;
  /** Mientras se elige con quién enlazar, la caja señalada se marca. */
  resaltada?: boolean;
  ancho?: number;
  alto?: number;
}) {
  const borde = resaltada ? "var(--c-accent)" : "var(--c-line-strong)";

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0"
      width={ancho}
      height={alto}
      viewBox={`0 0 ${ancho} ${alto}`}
    >
      <path
        d={trazo(kind, ancho, alto)}
        fill="var(--c-surface)"
        stroke={borde}
        strokeWidth={resaltada ? 2 : 1.25}
      />

      {/* La costura de la tapa del cilindro: sin ella no se lee como un
          cilindro, se lee como una pastilla con las esquinas raras. */}
      {kind === "base_datos" && (
        <path
          d={`M 0 ${TAPA} A ${ancho / 2} ${TAPA} 0 0 0 ${ancho} ${TAPA}`}
          fill="none"
          stroke={borde}
          strokeWidth={1.25}
        />
      )}

      {/* Las divisiones de la cola, que es lo único que la separa de un
          rectángulo cualquiera: dicen que ahí dentro hay cosas esperando. */}
      {kind === "cola" &&
        [0.74, 0.83, 0.92].map((p) => (
          <line
            key={p}
            x1={ancho * p}
            y1={4}
            x2={ancho * p}
            y2={alto - 4}
            stroke={borde}
            strokeWidth={1}
            opacity={0.55}
          />
        ))}
    </svg>
  );
}
