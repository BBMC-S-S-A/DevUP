/**
 * Cómo se dibuja cada mueble.
 *
 * Un archivo aparte del atlas porque es lo que más va a crecer: cada mueble
 * nuevo es una función aquí y una entrada en `props.ts`, sin tocar el
 * renderizador ni la red. Y es el archivo que un pack de sprites vacía.
 *
 * TODO SE APOYA EN `prism`. Una caja con tapa, frente y sombra al pie. La
 * proporción es lo que distingue un escritorio de una nevera, no el primitivo.
 */
import { TILE } from "./atlas";
import type { Prop, PropKind } from "./props";

/** Maderas, telas y metales. Índices, para que un mueble cambie de color. */
export const WOOD = ["#6b4a2f", "#8a5f3c", "#4e3623", "#a3764a"] as const;
export const FABRIC = [
  "#c2586a", "#5b8cff", "#34d399", "#f59e0b",
  "#c193e0", "#66c2d9", "#8a94a6", "#4a5568",
] as const;
export const METAL = ["#cfd6e4", "#9aa4b8", "#6b7488"] as const;

const at = <T,>(list: readonly T[], i: number): T => list[Math.abs(i) % list.length]!;

/**
 * Una caja apoyada en el suelo.
 *
 * `(px, py)` es el centro del borde FRONTAL de la huella, en píxeles de mundo.
 * Esa elección no es casual: es también la coordenada por la que se ordena la
 * profundidad, así que anclar aquí hace que ordenar y dibujar usen el mismo
 * número y no se puedan desincronizar.
 */
function prism(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  w: number,
  d: number,
  h: number,
  front: string,
  top: string,
  options: { shadow?: boolean; outline?: boolean } = {},
): void {
  const x = px - w / 2;

  if (options.shadow !== false) {
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.beginPath();
    ctx.ellipse(px, py - 1, w / 2, Math.max(2.5, d / 3), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cara frontal: lo que se ve de canto.
  ctx.fillStyle = front;
  ctx.fillRect(x, py - h, w, h);

  // Tapa: desplazada hacia arriba por la profundidad. Es lo que da el volumen.
  ctx.fillStyle = top;
  ctx.fillRect(x, py - h - d, w, d);

  if (options.outline !== false) {
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(py - h - d) + 0.5, Math.round(w) - 1, Math.round(h + d) - 1);
  }
}

/** Una losa plana sobre el suelo: alfombras, felpudos. No tiene volumen. */
function slab(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  w: number,
  d: number,
  fill: string,
  border?: string,
): void {
  ctx.fillStyle = fill;
  ctx.fillRect(px - w / 2, py - d, w, d);
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.strokeRect(px - w / 2 + 1, py - d + 1, w - 2, d - 2);
  }
}

function lighten(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c(((n >> 16) & 255) * f)},${c(((n >> 8) & 255) * f)},${c((n & 255) * f)})`;
}

// ---------------------------------------------------------------------------
// Los muebles
// ---------------------------------------------------------------------------

type Draw = (ctx: CanvasRenderingContext2D, px: number, py: number, p: Prop) => void;

const DRAW: Record<PropKind, Draw> = {
  /** Escritorio: tapa ancha sobre dos patas. Dos casillas de ancho. */
  desk(ctx, px, py, p) {
    const wood = at(WOOD, p.tone);
    // Patas primero: quedan detrás de la tapa y solo asoman por los lados.
    prism(ctx, px - TILE * 0.72, py, 7, 5, 11, lighten(wood, 0.6), lighten(wood, 0.75), { shadow: false, outline: false });
    prism(ctx, px + TILE * 0.72, py, 7, 5, 11, lighten(wood, 0.6), lighten(wood, 0.75), { shadow: false, outline: false });
    prism(ctx, px, py, TILE * 1.8, 13, 13, lighten(wood, 0.82), lighten(wood, 1.18));
  },

  /** Monitor y teclado. Se coloca sobre un escritorio, así que va elevado. */
  monitor(ctx, px, py, p) {
    const shell = at(METAL, p.tone);
    const lift = 13; // altura de la tapa del escritorio
    // Teclado
    prism(ctx, px, py - lift + 4, 17, 4, 2, lighten(shell, 0.85), lighten(shell, 1.05), { shadow: false, outline: false });
    // Pie
    prism(ctx, px, py - lift - 2, 5, 3, 5, lighten(shell, 0.7), lighten(shell, 0.9), { shadow: false, outline: false });
    // Pantalla
    prism(ctx, px, py - lift - 6, 22, 3, 15, lighten(shell, 0.95), lighten(shell, 1.1), { shadow: false });
    // Lo que se ve en la pantalla. Es lo único encendido de la sala y por eso
    // es lo que hace que una zona de desarrollo parezca en uso.
    ctx.fillStyle = "#1b2540";
    ctx.fillRect(px - 9, py - lift - 19, 18, 11);
    ctx.fillStyle = "rgba(91,140,255,0.85)";
    ctx.fillRect(px - 7, py - lift - 17, 9, 1.5);
    ctx.fillRect(px - 7, py - lift - 14, 13, 1.5);
    ctx.fillRect(px - 7, py - lift - 11, 6, 1.5);
  },

  /** Silla de oficina: asiento, respaldo y una pata. El respaldo va detrás. */
  chair(ctx, px, py, p) {
    const fabric = at(FABRIC, p.tone);
    const back = p.facing === "n";
    // Mirando al norte el respaldo queda delante del asiento y hay que
    // dibujarlo después; mirando al sur, al revés. Sin esto la silla se ve
    // del revés cuando alguien la usa de espaldas.
    const drawBack = () =>
      prism(ctx, px, py - (back ? 9 : 13), 16, 4, 16, lighten(fabric, 0.72), lighten(fabric, 0.9), { shadow: false });
    const drawSeat = () =>
      prism(ctx, px, py - 4, 18, 8, 8, lighten(fabric, 0.9), lighten(fabric, 1.15), { shadow: false });

    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(px, py - 1, 9, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    prism(ctx, px, py, 5, 3, 5, "#3a4453", "#4a5566", { shadow: false, outline: false });

    if (back) {
      drawSeat();
      drawBack();
    } else {
      drawBack();
      drawSeat();
    }
  },

  /** Sofá de dos plazas: respaldo, asiento y dos brazos. Dos casillas. */
  sofa(ctx, px, py, p) {
    const fabric = at(FABRIC, p.tone);
    const w = TILE * 1.85;
    prism(ctx, px, py - 12, w, 8, 20, lighten(fabric, 0.7), lighten(fabric, 0.88));
    prism(ctx, px, py - 2, w, 12, 11, lighten(fabric, 0.95), lighten(fabric, 1.2), { shadow: false });
    prism(ctx, px - w / 2 + 5, py - 2, 10, 12, 16, lighten(fabric, 0.8), lighten(fabric, 1.02), { shadow: false });
    prism(ctx, px + w / 2 - 5, py - 2, 10, 12, 16, lighten(fabric, 0.8), lighten(fabric, 1.02), { shadow: false });
    // Junta entre los dos cojines: sin ella parece un banco, no un sofá.
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(px - 0.5, py - 13, 1, 11);
  },

  /** Butaca: el sofá de una plaza. */
  armchair(ctx, px, py, p) {
    const fabric = at(FABRIC, p.tone);
    prism(ctx, px, py - 11, 26, 7, 18, lighten(fabric, 0.7), lighten(fabric, 0.88));
    prism(ctx, px, py - 2, 26, 11, 10, lighten(fabric, 0.95), lighten(fabric, 1.2), { shadow: false });
    prism(ctx, px - 10, py - 2, 8, 11, 14, lighten(fabric, 0.8), lighten(fabric, 1.02), { shadow: false });
    prism(ctx, px + 10, py - 2, 8, 11, 14, lighten(fabric, 0.8), lighten(fabric, 1.02), { shadow: false });
  },

  /** Mesa baja de centro, con algo encima. */
  coffeeTable(ctx, px, py, p) {
    const wood = at(WOOD, p.tone);
    prism(ctx, px, py, 30, 16, 9, lighten(wood, 0.8), lighten(wood, 1.15));
    // Una taza. Es un detalle de dos píxeles y es de las cosas que más hacen
    // que un sitio parezca habitado.
    ctx.fillStyle = "#e7ebf2";
    ctx.fillRect(px + 4, py - 24, 5, 5);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(px + 5, py - 23, 3, 1.5);
  },

  /** Mesa de reunión: larga, para la sala de juntas. */
  meetingTable(ctx, px, py, p) {
    const wood = at(WOOD, p.tone);
    prism(ctx, px, py, TILE * 2.6, 26, 12, lighten(wood, 0.78), lighten(wood, 1.12));
  },

  /** Planta pequeña en maceta. */
  plant(ctx, px, py) {
    prism(ctx, px, py, 14, 7, 10, "#8a5f3c", "#a3764a");
    ctx.fillStyle = "#2f7a4f";
    for (const [dx, dy, r] of [
      [0, -22, 8], [-6, -17, 6], [6, -18, 6], [-2, -27, 5],
    ] as const) {
      ctx.beginPath();
      ctx.arc(px + dx, py + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#3d9a63";
    ctx.beginPath();
    ctx.arc(px - 3, py - 24, 4, 0, Math.PI * 2);
    ctx.fill();
  },

  /** Planta alta de interior, tipo ficus. Llena una esquina. */
  plantTall(ctx, px, py) {
    prism(ctx, px, py, 16, 8, 13, "#7a4f31", "#96633e");
    ctx.strokeStyle = "#3a6b45";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px, py - 13);
    ctx.lineTo(px, py - 34);
    ctx.stroke();
    ctx.fillStyle = "#2f7a4f";
    for (const [dx, dy, r] of [
      [0, -42, 11], [-9, -34, 8], [9, -35, 8], [-4, -50, 7], [5, -49, 6],
    ] as const) {
      ctx.beginPath();
      ctx.arc(px + dx, py + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#40a06a";
    ctx.beginPath();
    ctx.arc(px + 3, py - 44, 6, 0, Math.PI * 2);
    ctx.fill();
  },

  /**
   * Alfombra. Plana: se pisa, no se rodea.
   *
   * Va más CLARA que el suelo, no más oscura. Oscura se lee como un agujero en
   * el suelo —fue el primer intento y el efecto era inconfundible—: una
   * alfombra devuelve luz, no la traga.
   */
  rug(ctx, px, py, p) {
    const fabric = at(FABRIC, p.tone);
    const w = TILE * 2.6;
    const d = TILE * 1.8;
    slab(ctx, px, py, w, d, lighten(fabric, 0.62));
    // Cenefa doble: es lo que la distingue de una mancha de color.
    ctx.strokeStyle = lighten(fabric, 1.05);
    ctx.lineWidth = 3;
    ctx.strokeRect(px - w / 2 + 4, py - d + 4, w - 8, d - 8);
    ctx.strokeStyle = lighten(fabric, 0.45);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px - w / 2 + 9, py - d + 9, w - 18, d - 18);
    // Flecos en los lados cortos.
    ctx.fillStyle = lighten(fabric, 0.9);
    for (let i = 0; i < 10; i += 1) {
      const y = py - d + 5 + i * ((d - 10) / 9);
      ctx.fillRect(px - w / 2 - 2, y, 2, 2);
      ctx.fillRect(px + w / 2, y, 2, 2);
    }
  },

  /** Estantería con libros de colores. */
  bookshelf(ctx, px, py, p) {
    const wood = at(WOOD, p.tone + 2);
    prism(ctx, px, py, 30, 9, 42, lighten(wood, 0.7), lighten(wood, 1.0));
    // Baldas y libros
    for (let shelf = 0; shelf < 3; shelf += 1) {
      const y = py - 10 - shelf * 12;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(px - 14, y, 28, 2);
      for (let i = 0; i < 6; i += 1) {
        ctx.fillStyle = at(FABRIC, shelf * 3 + i);
        ctx.fillRect(px - 13 + i * 4.5, y - 8, 3.2, 8);
      }
    }
  },

  /** Máquina recreativa: mueble alto con la pantalla encendida. */
  arcade(ctx, px, py, p) {
    const shell = at(FABRIC, p.tone + 4);
    prism(ctx, px, py, 26, 12, 46, lighten(shell, 0.55), lighten(shell, 0.75));
    // Pantalla, inclinada hacia el jugador.
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(px - 10, py - 44, 20, 15);
    ctx.fillStyle = "#34d399";
    ctx.fillRect(px - 7, py - 41, 4, 4);
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(px + 1, py - 37, 5, 3);
    ctx.fillStyle = "#5b8cff";
    ctx.fillRect(px - 6, py - 33, 11, 2);
    // Marquesina y botones
    ctx.fillStyle = lighten(shell, 1.3);
    ctx.fillRect(px - 12, py - 52, 24, 6);
    ctx.fillStyle = "#f87171";
    ctx.beginPath();
    ctx.arc(px - 5, py - 25, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5b8cff";
    ctx.beginPath();
    ctx.arc(px + 2, py - 25, 2.2, 0, Math.PI * 2);
    ctx.fill();
  },

  /** Piano vertical, para la zona de música. */
  piano(ctx, px, py) {
    prism(ctx, px, py, TILE * 1.7, 14, 34, "#241c26", "#3a2f3d");
    // Teclas: blancas con negras encima. Es lo que lo hace reconocible al
    // instante a este tamaño.
    const w = TILE * 1.5;
    ctx.fillStyle = "#e7ebf2";
    ctx.fillRect(px - w / 2, py - 20, w, 7);
    ctx.fillStyle = "#12161d";
    for (let i = 1; i < 12; i += 1) {
      if (i % 7 === 3 || i % 7 === 0) continue;
      ctx.fillRect(px - w / 2 + i * (w / 12) - 1, py - 20, 2, 4);
    }
  },

  /** Altavoz de columna. */
  speaker(ctx, px, py) {
    prism(ctx, px, py, 16, 9, 34, "#1a1f27", "#2b3341");
    ctx.fillStyle = "#0a0c10";
    ctx.beginPath();
    ctx.arc(px, py - 26, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py - 13, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#34d399";
    ctx.fillRect(px - 1, py - 32, 2, 2);
  },

  /** Nevera pequeña, para la zona de descanso. */
  fridge(ctx, px, py) {
    prism(ctx, px, py, 24, 12, 40, "#c6ccd8", "#e2e7ef");
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(px - 12, py - 26, 24, 1.5);
    ctx.fillStyle = "#8a94a6";
    ctx.fillRect(px + 6, py - 22, 2, 8);
    ctx.fillRect(px + 6, py - 38, 2, 8);
  },

  /** Lámpara de pie. Da un charco de luz en el suelo. */
  lamp(ctx, px, py) {
    ctx.fillStyle = "rgba(245,158,11,0.10)";
    ctx.beginPath();
    ctx.ellipse(px, py - 2, 22, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    prism(ctx, px, py, 10, 5, 4, "#3a4453", "#4a5566", { outline: false });
    ctx.fillStyle = "#5c6577";
    ctx.fillRect(px - 1, py - 40, 2, 36);
    ctx.fillStyle = "#f2c879";
    ctx.beginPath();
    ctx.moveTo(px - 10, py - 40);
    ctx.lineTo(px + 10, py - 40);
    ctx.lineTo(px + 6, py - 52);
    ctx.lineTo(px - 6, py - 52);
    ctx.closePath();
    ctx.fill();
  },

  /** Puf. Bajo y redondo: la zona de juegos necesita algo que no sea una silla. */
  beanbag(ctx, px, py, p) {
    const fabric = at(FABRIC, p.tone);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(px, py - 2, 15, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lighten(fabric, 0.85);
    ctx.beginPath();
    ctx.ellipse(px, py - 8, 15, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lighten(fabric, 1.15);
    ctx.beginPath();
    ctx.ellipse(px - 2, py - 12, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  },

  // --- Cosas que cuelgan de la pared ---------------------------------------
  // Se dibujan sobre el muro, no delante: su `py` es la base del muro y suben
  // hacia su cara superior.

  frame(ctx, px, py, p) {
    const art = at(FABRIC, p.tone);
    prism(ctx, px, py - 8, 20, 2, 15, "#3a2f26", "#4d3f33", { shadow: false });
    ctx.fillStyle = lighten(art, 0.75);
    ctx.fillRect(px - 7, py - 21, 14, 10);
    ctx.fillStyle = lighten(art, 1.25);
    ctx.beginPath();
    ctx.moveTo(px - 7, py - 11);
    ctx.lineTo(px - 1, py - 18);
    ctx.lineTo(px + 7, py - 11);
    ctx.closePath();
    ctx.fill();
  },

  shelf(ctx, px, py, p) {
    prism(ctx, px, py - 10, 26, 3, 3, "#5a4433", "#7a5c44", { shadow: false });
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = at(FABRIC, p.tone + i);
      ctx.fillRect(px - 11 + i * 6, py - 21, 4, 8);
    }
  },

  window(ctx, px, py) {
    prism(ctx, px, py - 6, 30, 2, 22, "#2b3341", "#3a4453", { shadow: false });
    ctx.fillStyle = "#16304a";
    ctx.fillRect(px - 12, py - 26, 24, 17);
    // Cielo y una franja de luz. Una ventana apagada parece un cuadro.
    ctx.fillStyle = "#2d5a7a";
    ctx.fillRect(px - 12, py - 26, 24, 7);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(px - 0.75, py - 26, 1.5, 17);
    ctx.fillRect(px - 12, py - 18, 24, 1.5);
  },

  whiteboard(ctx, px, py) {
    prism(ctx, px, py - 6, 36, 2, 26, "#8a94a6", "#a5aec0", { shadow: false });
    ctx.fillStyle = "#e7ebf2";
    ctx.fillRect(px - 16, py - 30, 32, 22);
    ctx.strokeStyle = "#5b8cff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px - 11, py - 24);
    ctx.lineTo(px - 2, py - 24);
    ctx.moveTo(px - 11, py - 19);
    ctx.lineTo(px + 7, py - 19);
    ctx.stroke();
    ctx.strokeStyle = "#f87171";
    ctx.beginPath();
    ctx.moveTo(px - 11, py - 14);
    ctx.lineTo(px + 2, py - 14);
    ctx.stroke();
  },
};

export function drawProp(ctx: CanvasRenderingContext2D, p: Prop): void {
  DRAW[p.kind](ctx, p.x * TILE + TILE / 2, p.y * TILE + TILE, p);
}

/** Todos los muebles del catálogo, para la lámina de referencia y las pruebas. */
export const ALL_PROPS: PropKind[] = Object.keys(DRAW) as PropKind[];
