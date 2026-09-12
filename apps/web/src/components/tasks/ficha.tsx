import type { ReactNode } from "react";
import {
  Bug,
  FileText,
  FlaskConical,
  Palette,
  Server,
  Sparkles,
  TrendingUp,
  Wrench,
} from "lucide-react";
import type { TipoDeTarea } from "@/lib/api";

/**
 * El vocabulario de la ficha de desarrollo, en un solo sitio.
 *
 * POR QUÉ ESTO ES UN ARCHIVO Y NO DOS CONSTANTES SUELTAS. El tipo y la
 * prioridad se dibujan en dos sitios que no se ven a la vez: la tarjeta del
 * tablero y el diálogo que la abre. Si cada uno trajera su propia lista, el día
 * que se añada un tipo aparecería en el desplegable y saldría en blanco en la
 * tarjeta — y nadie lo notaría hasta que alguien lo usara de verdad.
 *
 * LOS COLORES SIGUEN UNA REGLA Y NO UN GUSTO: el tipo NO tiene color propio.
 * Solo la prioridad colorea, y solo cuando no es normal. Si el tipo también
 * pintara, un tablero de treinta tarjetas sería un mosaico donde el rojo de
 * «urgente» deja de verse — que es lo único que tenía que verse desde lejos.
 * El tipo se distingue por su icono, que se lee sin robar atención.
 */

export const TIPO_EN_PALABRAS: Record<TipoDeTarea, string> = {
  funcionalidad: "Funcionalidad",
  arreglo: "Arreglo",
  mejora: "Mejora",
  deuda: "Deuda técnica",
  investigacion: "Investigación",
  documentacion: "Documentación",
  diseno: "Diseño",
  infraestructura: "Infraestructura",
};

/** Qué es cada tipo, para el desplegable: una lista de ocho palabras sueltas se
 *  rellena al azar; una que explica la diferencia, no. */
export const TIPO_EXPLICADO: Record<TipoDeTarea, string> = {
  funcionalidad: "algo que antes no se podía hacer",
  arreglo: "algo que no funciona como dice",
  mejora: "funciona, pero no lo bastante bien",
  deuda: "funciona y hay que rehacerlo igualmente",
  investigacion: "todavía no se sabe qué hay que hacer",
  documentacion: "explicarlo para quien venga después",
  diseno: "cómo se ve y cómo se usa",
  infraestructura: "despliegue, entornos, tuberías, credenciales",
};

const ICONOS: Record<TipoDeTarea, typeof Bug> = {
  funcionalidad: Sparkles,
  arreglo: Bug,
  mejora: TrendingUp,
  deuda: Wrench,
  investigacion: FlaskConical,
  documentacion: FileText,
  diseno: Palette,
  infraestructura: Server,
};

export function IconoDeTipo({ tipo, size = 11 }: { tipo: TipoDeTarea; size?: number }): ReactNode {
  const Icono = ICONOS[tipo];
  return <Icono size={size} className="shrink-0" />;
}

/** 0 baja · 1 normal · 2 alta · 3 urgente. El índice ES el valor guardado. */
export const PRIORIDADES = [
  { valor: 0, texto: "Baja", pista: "puede esperar sin que pase nada" },
  { valor: 1, texto: "Normal", pista: "lo de siempre" },
  { valor: 2, texto: "Alta", pista: "esto corre" },
  { valor: 3, texto: "Urgente", pista: "esto es ahora" },
] as const;

/**
 * Cómo se pinta una prioridad en la tarjeta.
 *
 * `normal` devuelve null a propósito: es el valor por defecto, así que
 * enseñarlo pintaría el 80 % del tablero con una etiqueta que no dice nada. Que
 * una tarjeta NO lleve marca es la información de que es normal.
 */
export function tonoDePrioridad(prioridad: number): { texto: string; clase: string } | null {
  if (prioridad === 3) {
    return { texto: "Urgente", clase: "border-danger/40 bg-danger/10 text-danger" };
  }
  if (prioridad === 2) return { texto: "Alta", clase: "border-warn/40 bg-warn/10 text-warn" };
  if (prioridad === 0) return { texto: "Baja", clase: "border-line text-faint" };
  return null;
}

export const ESTADO_DE_RAMA: Record<string, { texto: string; clase: string }> = {
  abierta: { texto: "abierta", clase: "border-accent/40 bg-accent-soft/60 text-accent" },
  fusionada: { texto: "fusionada", clase: "border-live/40 bg-live/10 text-live" },
  // Descartada no es un fallo: es un camino que se probó y se abandonó, y esa
  // información vale. Por eso se apaga, no se pinta en rojo.
  descartada: { texto: "descartada", clase: "border-line text-faint line-through" },
};

export const EVIDENCIA_EN_PALABRAS: Record<string, string> = {
  pr: "PR",
  commit: "Commit",
  enlace: "Enlace",
  nota: "Nota",
};
