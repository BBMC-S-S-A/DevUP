/**
 * Un gráfico de barras horizontal, de verdad — SVG con sus propias etiquetas
 * dentro, no un `<div>` con `width` en porcentaje.
 *
 * SIN LIBRERÍA, por el mismo criterio que la red de trabajo de Categorías: la
 * disposición es una regla de tres —el valor más alto ocupa el ancho entero,
 * los demás en proporción— y no hace falta traer una dependencia y su
 * mantenimiento para dibujar unos rectángulos con su texto al lado.
 */
type Barra = { etiqueta: string; valor: number };

const ALTO_FILA = 28;
const ANCHO_ETIQUETA = 26;
const ANCHO_VALOR = 14;

export function GraficoBarras({
  barras,
  color = "var(--c-accent)",
  formatear = (n: number) => n.toLocaleString("es"),
}: {
  barras: Barra[];
  color?: string;
  formatear?: (valor: number) => string;
}) {
  const maximo = Math.max(1, ...barras.map((b) => b.valor));
  const alto = barras.length * ALTO_FILA;
  const anchoBarra = 100 - ANCHO_ETIQUETA - ANCHO_VALOR - 4;

  return (
    <svg viewBox={`0 0 100 ${alto}`} className="w-full" style={{ height: alto * 3 }} role="img">
      <title>{barras.map((b) => `${b.etiqueta}: ${formatear(b.valor)}`).join(", ")}</title>
      {barras.map((b, i) => {
        const y = i * ALTO_FILA;
        const ancho = Math.max((b.valor / maximo) * anchoBarra, b.valor > 0 ? 1 : 0);
        return (
          <g key={b.etiqueta}>
            <text
              x={0}
              y={y + ALTO_FILA / 2}
              dominantBaseline="middle"
              fontSize={3.4}
              fill="var(--c-muted)"
              className="font-sans"
            >
              {b.etiqueta.length > 12 ? `${b.etiqueta.slice(0, 11)}…` : b.etiqueta}
            </text>
            <rect
              x={ANCHO_ETIQUETA}
              y={y + ALTO_FILA / 2 - 5}
              width={anchoBarra}
              height={10}
              rx={2}
              fill="var(--c-raised)"
            />
            <rect
              x={ANCHO_ETIQUETA}
              y={y + ALTO_FILA / 2 - 5}
              width={ancho}
              height={10}
              rx={2}
              fill={color}
            />
            <text
              x={ANCHO_ETIQUETA + anchoBarra + 2}
              y={y + ALTO_FILA / 2}
              dominantBaseline="middle"
              fontSize={3.4}
              fill="var(--c-ink)"
              className="font-mono tabular-nums"
            >
              {formatear(b.valor)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
