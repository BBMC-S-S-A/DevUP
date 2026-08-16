/**
 * La capa de dibujo — y el único archivo que hay que cambiar el día que
 * lleguen sprites de verdad.
 *
 * Hoy todo son formas geométricas, por decisión: un pack de arte con licencia
 * es barato pero hay que leerse la licencia antes de integrarlo, y el
 * renderizador se puede construir entero sin él. Lo que NO se ha hecho es
 * dibujarlo plano: cada cosa tiene altura y se apoya en el suelo, porque la
 * perspectiva es la parte que sí cambia la arquitectura del renderizador.
 *
 * LA COMBINACIÓN QUE SE ELIGIÓ. Rejilla cenital como sustrato —el suelo son
 * casillas alineadas con los ejes— pero todo lo que se levanta del suelo se
 * dibuja con altura, en ¾. Da la densidad y la profundidad de un Habbo sin
 * pagar lo que cuesta el isométrico de verdad: aquí la profundidad se ordena
 * por Y y cada mueble se dibuja una vez, no en cuatro orientaciones.
 *
 * Sustituir esto por sprites es reemplazar el cuerpo de estas funciones por
 * `ctx.drawImage(atlas, sx, sy, ...)`. Ni el renderizador ni la red se enteran.
 */

/** Lado de una casilla en píxeles, antes del zoom. */
export const TILE = 32;
/** Cuánto se levanta un muro sobre su casilla. Es lo que da la perspectiva. */
export const WALL_HEIGHT = 22;

/**
 * Tonos de zona. Ocho, derivados de la paleta de globals.css: son tintes
 * oscuros del acento, del verde y del ámbar, no colores nuevos. Cada zona
 * recibe uno por su posición, así que la misma oficina se ve igual en dos
 * navegadores.
 */
export const ZONE_PALETTE = [
  { floor: "#18203a", wall: "#243154", label: "#8fb0ff" },
  { floor: "#122b25", wall: "#1b4034", label: "#5fd6ab" },
  { floor: "#2e2415", wall: "#463620", label: "#e0aa5c" },
  { floor: "#251a2e", wall: "#382745", label: "#c193e0" },
  { floor: "#122a33", wall: "#1b3f4c", label: "#66c2d9" },
  { floor: "#2e1a1d", wall: "#45272c", label: "#e08a92" },
  { floor: "#1f2a18", wall: "#2f4024", label: "#a8cc70" },
  { floor: "#1c1f2e", wall: "#2b3045", label: "#9aa4c9" },
] as const;

/** Tonos de piel, pelo y ropa. Índices, no colores, en la base de datos. */
export const SKIN_TONES = [
  "#f2d3b8", "#e8bd97", "#d19a70", "#b2764c", "#8d5a38", "#66412a",
  "#f7e0cc", "#c98d63", "#a06840", "#7a4e30", "#5a3a24", "#3f281a",
  "#e5c4a5", "#cfa27c", "#9c6a45", "#6f4830",
] as const;

export const HAIR_TONES = [
  "#2b2118", "#4a3524", "#7a5334", "#a87b45", "#d4a656", "#e8d18a",
  "#8c3b28", "#c25b3a", "#5b8cff", "#34d399", "#c193e0", "#f87171",
  "#8a94a6", "#e7ebf2", "#1a1a1a", "#5c6577",
] as const;

export const CLOTH_TONES = [
  "#5b8cff", "#34d399", "#f59e0b", "#f87171", "#c193e0", "#66c2d9",
  "#e7ebf2", "#5c6577", "#2f4024", "#45272c", "#243154", "#8d5a38",
  "#1b4034", "#463620", "#382745", "#0f1319",
] as const;

const pick = <T,>(list: readonly T[], index: number): T => list[index % list.length]!;

export const skinTone = (i: number): string => pick(SKIN_TONES, i);
export const hairTone = (i: number): string => pick(HAIR_TONES, i);
export const clothTone = (i: number): string => pick(CLOTH_TONES, i);
export const zoneTone = (i: number) => pick(ZONE_PALETTE, i);

/** Cuántas variantes hay de cada pieza. Lo usa el editor de avatar. */
export const CATALOG = { body: 3, hair: 6, top: 5, bottom: 4 } as const;

// ---------------------------------------------------------------------------
// Suelo
// ---------------------------------------------------------------------------

/**
 * El suelo del pasillo, con un damero muy suave. Sin él, una oficina grande es
 * una mancha lisa y se pierde por completo la sensación de estar moviéndose:
 * el avatar camina y nada pasa por debajo.
 */
export function drawFloor(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  tone?: string,
): void {
  const even = (tx + ty) % 2 === 0;
  ctx.fillStyle = tone ?? (even ? "#12161d" : "#141920");
  ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
}

/**
 * El suelo de una sala, según su material.
 *
 * El material es lo que más distingue una sala de otra de un vistazo — más que
 * el color de la pared, más que los muebles. Un parquet dice «aquí se trabaja»
 * y un damero dice «aquí se descansa» antes de que a nadie le dé tiempo a leer
 * el rótulo.
 */
export function drawZoneFloor(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  palette: number,
  material: "wood" | "tile" | "checker" | "carpet" | "concrete",
): void {
  const tone = zoneTone(palette);
  const x = tx * TILE;
  const y = ty * TILE;

  switch (material) {
    case "wood": {
      // Parquet: tablas horizontales con las juntas desplazadas fila a fila,
      // que es lo que impide que se lea como una rejilla.
      ctx.fillStyle = "#5c4029";
      ctx.fillRect(x, y, TILE, TILE);
      const offset = (ty % 2) * (TILE / 2);
      for (let i = 0; i < 4; i += 1) {
        ctx.fillStyle = i % 2 === 0 ? "#67482f" : "#5a3e28";
        ctx.fillRect(x, y + i * 8, TILE, 8);
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.fillRect(x, y + i * 8 + 7, TILE, 1);
        ctx.fillRect(x + ((offset + i * 11) % TILE), y + i * 8, 1, 8);
      }
      break;
    }

    case "checker": {
      // Damero fino: cuatro cuadros por casilla, no uno. Con uno por casilla
      // el patrón compite con la rejilla del mundo y marea.
      for (let i = 0; i < 2; i += 1) {
        for (let j = 0; j < 2; j += 1) {
          ctx.fillStyle = (i + j) % 2 === 0 ? "#e2e6ee" : "#1a1f27";
          ctx.fillRect(x + i * (TILE / 2), y + j * (TILE / 2), TILE / 2, TILE / 2);
        }
      }
      break;
    }

    case "carpet": {
      ctx.fillStyle = tone.floor;
      ctx.fillRect(x, y, TILE, TILE);
      // Moteado de fibra, determinista a partir de la casilla.
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      for (let i = 0; i < 8; i += 1) {
        const px = x + ((tx * 7 + i * 13) % TILE);
        const py = y + ((ty * 11 + i * 17) % TILE);
        ctx.fillRect(px, py, 2, 1);
      }
      break;
    }

    case "concrete": {
      ctx.fillStyle = "#20242c";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "rgba(255,255,255,0.028)";
      ctx.fillRect(x, y, TILE, TILE / 2);
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.fillRect(x, y + TILE - 1, TILE, 1);
      ctx.fillRect(x + TILE - 1, y, 1, TILE);
      break;
    }

    default: {
      // Baldosa lisa del color de la sala, con junta. La referencia de escala
      // sin ruido.
      ctx.fillStyle = tone.floor;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      ctx.fillStyle = "rgba(0,0,0,0.20)";
      ctx.fillRect(x, y + TILE - 1, TILE, 1);
      ctx.fillRect(x + TILE - 1, y, 1, TILE);
    }
  }
}

/** El umbral de una puerta: el suelo de la sala más una marca de paso. */
export function drawDoorway(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  palette: number,
  material: "wood" | "tile" | "checker" | "carpet" | "concrete",
): void {
  drawZoneFloor(ctx, tx, ty, palette, material);
  const tone = zoneTone(palette);
  // Dos jambas cortas a los lados. Marcan la entrada sin cerrarla, que es lo
  // que le dice a alguien «por aquí se pasa» sin ningún cartel.
  ctx.fillStyle = shade(tone.wall, 1.5);
  ctx.fillRect(tx * TILE, ty * TILE, 3, TILE);
  ctx.fillRect(tx * TILE + TILE - 3, ty * TILE, 3, TILE);
}

// ---------------------------------------------------------------------------
// Cosas que se levantan del suelo
// ---------------------------------------------------------------------------

/**
 * Un bloque en ¾: se apoya en su casilla y se extruye hacia arriba.
 *
 * La cara superior va más clara y la inferior más oscura. Son dos rectángulos
 * y un borde, pero es exactamente lo que hace que la oficina se lea como un
 * espacio y no como un plano — y es la geometría que un sprite tendrá que
 * respetar cuando sustituya a esto.
 */
function drawBlock(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  height: number,
  face: string,
  cap: string,
  width = TILE,
  inset = 0,
): void {
  const x = tx * TILE + inset;
  const y = ty * TILE;
  const w = width - inset * 2;

  // Cuerpo: desde la altura hasta el pie de la casilla.
  ctx.fillStyle = face;
  ctx.fillRect(x, y - height, w, TILE + height);

  // Cara superior, que es lo que da la altura.
  ctx.fillStyle = cap;
  ctx.fillRect(x, y - height, w, Math.min(height, TILE));

  // Una línea de sombra al pie separa el objeto del suelo. Sin ella los
  // bloques parecen flotar sobre el damero.
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(x, y + TILE - 2, w, 2);
}

/** Altura del zócalo del frente. Marca el límite sin tapar la sala. */
export const SILL_HEIGHT = 5;

export function drawWall(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  palette: number,
  face: "back" | "side" | "front",
  capped = true,
): void {
  const tone = zoneTone(palette);
  // El muro va bastante más claro que su suelo. Con poca diferencia la sala se
  // ve como una mancha de color y el espacio deja de leerse: es el fallo que
  // tenía la primera versión de esto.
  const body = shade(tone.wall, face === "back" ? 1.55 : 1.3);
  const cap = shade(tone.wall, face === "back" ? 2.1 : 1.85);

  if (face === "front") {
    drawBlock(ctx, tx, ty, SILL_HEIGHT, shade(tone.wall, 1.15), shade(tone.wall, 1.7));
    return;
  }
  drawBlock(ctx, tx, ty, WALL_HEIGHT, body, capped ? cap : body);
}

/** Muro exterior de la planta, en gris: no pertenece a ninguna zona. */
export function drawOuterWall(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  face: "back" | "side" | "front",
  capped = true,
): void {
  if (face === "front") {
    drawBlock(ctx, tx, ty, SILL_HEIGHT, "#232a35", "#333c4a");
    return;
  }
  drawBlock(ctx, tx, ty, WALL_HEIGHT, "#242c38", capped ? "#3a4453" : "#242c38");
}

/**
 * Mobiliario.
 *
 * Bajo, estrecho y más oscuro que la pared. La primera versión era alta y
 * clara y el resultado era inequívoco: los escritorios se leían como columnas
 * y la sala parecía un aparcamiento. Un mueble tiene que quedar por debajo de
 * la cintura de un avatar para que se entienda que se le puede rodear.
 */
export function drawFurniture(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  palette: number,
): void {
  const tone = zoneTone(palette);
  drawBlock(ctx, tx, ty, 7, shade(tone.floor, 1.75), shade(tone.floor, 2.4), TILE, 5);
}

// ---------------------------------------------------------------------------
// Avatares
// ---------------------------------------------------------------------------

export type AvatarLook = {
  body: number;
  hair: number;
  top: number;
  bottom: number;
  skinTone: number;
  hairTone: number;
  topTone: number;
  bottomTone: number;
};

/**
 * Una persona, apoyada en `(x, y)` en píxeles de mundo.
 *
 * El paso al caminar es un desplazamiento vertical de un píxel alternando con
 * el tiempo. Es lo más barato que existe y basta: sin ningún movimiento, un
 * avatar desplazándose parece una ficha arrastrada, no alguien andando.
 */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  look: AvatarLook,
  facing: "n" | "s" | "e" | "o",
  moving: boolean,
  time: number,
  sitting = false,
): void {
  // Dos fases de paso, no una: pie adelantado y pie atrasado, más el rebote
  // del cuerpo. Con una sola fase el avatar da botes; con dos, camina.
  // Sentado no se camina: ni rebote ni balanceo, pase lo que pase con las
  // teclas. Sin este corte, un avatar sentado con la W pulsada mueve las
  // piernas en el sitio.
  const phase = moving && !sitting ? Math.floor(time / 130) % 4 : 0;
  const bob = moving && (phase === 1 || phase === 3) ? 1 : 0;
  const swing = moving ? [0, 2.5, 0, -2.5][phase]! : 0;

  const skin = skinTone(look.skinTone);
  const hair = hairTone(look.hairTone);
  const top = clothTone(look.topTone);
  const bottom = clothTone(look.bottomTone);

  // Complexión: cambia el ancho de hombros y la altura, no solo el ancho. Tres
  // siluetas que se distinguen de lejos, que es donde se ve a la gente.
  const build = look.body % CATALOG.body;
  const w = [13, 16, 19][build]!;
  const height = [37, 40, 39][build]!;
  const half = w / 2;

  // Sombra en el suelo. Es lo que ancla el avatar a la casilla; sin ella
  // flota, y con perspectiva eso se nota mucho más que en vista plana.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(x, y - 1, half, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  void sitting;

  // Sentarse baja el cuerpo entero y recoge las piernas: el asiento de una
  // silla queda a unos ocho píxeles del suelo, y las rodillas se doblan hacia
  // delante en vez de colgar. Con solo bajar el avatar parecía hundido en el
  // suelo, no sentado.
  const sit = sitting ? 7 : 0;
  const legLength = sitting ? 6 : 13;
  const base = y - bob - sit;
  const legTop = base - legLength;
  const torsoTop = base - (height - sit) + 12 + (sitting ? 4 : 0);
  const headY = base - (height - sit) + (sitting ? 4 : 0);

  // Piernas, una por lado, con el balanceo del paso.
  ctx.fillStyle = shade(bottom, 0.85);
  ctx.fillRect(x - half + 1 + swing * 0.4, legTop, half - 1.5, legLength);
  ctx.fillStyle = bottom;
  ctx.fillRect(x + 0.5 - swing * 0.4, legTop, half - 1.5, legLength);
  // Zapatos: dos píxeles que separan la pierna del suelo.
  ctx.fillStyle = "rgba(10,12,16,0.65)";
  ctx.fillRect(x - half + 1 + swing * 0.4, base - 2.5, half - 1.5, 2.5);
  ctx.fillRect(x + 0.5 - swing * 0.4, base - 2.5, half - 1.5, 2.5);
  // Sentado, los pies quedan por delante del asiento.
  if (sitting) {
    ctx.fillStyle = "rgba(10,12,16,0.5)";
    ctx.fillRect(x - half + 1, y - 3, w - 2, 3);
  }

  // Torso, más estrecho arriba: unos hombros rectos leen como una caja.
  ctx.fillStyle = top;
  ctx.fillRect(x - half, torsoTop + 1, w, legTop - torsoTop - 1);
  ctx.fillRect(x - half + 1, torsoTop, w - 2, 2);

  // Brazos, con el balanceo contrario al de las piernas — es lo que hace que
  // el paso parezca un paso y no una figura deslizándose.
  ctx.fillStyle = shade(top, 0.75);
  ctx.fillRect(x - half - 2.5, torsoTop + 2 - swing * 0.5, 2.8, 12);
  ctx.fillRect(x + half - 0.3, torsoTop + 2 + swing * 0.5, 2.8, 12);
  // Manos
  ctx.fillStyle = shade(skin, 0.95);
  ctx.fillRect(x - half - 2.5, torsoTop + 13 - swing * 0.5, 2.8, 2.5);
  ctx.fillRect(x + half - 0.3, torsoTop + 13 + swing * 0.5, 2.8, 2.5);

  // Cuello y cabeza. El cuello es un píxel y cambia por completo la silueta.
  ctx.fillStyle = shade(skin, 0.8);
  ctx.fillRect(x - 2.5, torsoTop - 2, 5, 3);
  ctx.fillStyle = skin;
  ctx.fillRect(x - 6, headY, 12, 14);
  // Esquinas superiores recortadas: redondea la cabeza sin antialias.
  ctx.clearRect(x - 6, headY, 1.5, 1.5);
  ctx.clearRect(x + 4.5, headY, 1.5, 1.5);

  // Pelo. Seis cortes que se distinguen de lejos.
  ctx.fillStyle = hair;
  const style = look.hair % CATALOG.hair;
  if (style !== 5) {
    ctx.fillRect(x - 6, headY - 1.5, 12, 5.5);
    ctx.fillRect(x - 6.5, headY + 1, 13, 2);
  }
  if (style === 1) {
    // Melena hasta los hombros.
    ctx.fillRect(x - 7.5, headY, 2, 15);
    ctx.fillRect(x + 5.5, headY, 2, 15);
  }
  if (style === 3) {
    // Media melena.
    ctx.fillRect(x - 7.5, headY, 2, 9);
    ctx.fillRect(x + 5.5, headY, 2, 9);
  }
  if (style === 2) ctx.fillRect(x - 6.5, headY + 3, 9, 2); // flequillo lateral
  if (style === 4) {
    // Moño
    ctx.fillRect(x - 3, headY - 5, 6, 4);
    ctx.fillRect(x - 4, headY - 4, 8, 2);
  }
  if (style === 5) {
    // Rapado: no calvo. Una sombra de pelo, que es lo que se ve de verdad.
    ctx.fillStyle = shade(hair, 0.75);
    ctx.fillRect(x - 5.5, headY, 11, 2.5);
  }

  // La cara solo se dibuja si mira hacia la cámara. De espaldas no hay ojos,
  // y esa ausencia es lo que hace legible hacia dónde va alguien.
  if (facing !== "n") {
    const shift = facing === "e" ? 1.8 : facing === "o" ? -1.8 : 0;
    ctx.fillStyle = "rgba(10,12,16,0.85)";
    ctx.fillRect(x - 3.5 + shift, headY + 6.5, 2, 2.5);
    ctx.fillRect(x + 1.5 + shift, headY + 6.5, 2, 2.5);
    // Boca: una línea de un píxel. Sin ella la cara queda inexpresiva de una
    // manera que se nota aunque no se sepa por qué.
    ctx.fillStyle = "rgba(10,12,16,0.35)";
    ctx.fillRect(x - 1.5 + shift, headY + 10.5, 3, 1);
  }
}

/** Nombre flotante. Con fondo, porque sobre un suelo claro se pierde. */
export function drawNameplate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  name: string,
  accent: string,
): void {
  ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const width = ctx.measureText(name).width + 10;
  const top = y - 56;

  ctx.fillStyle = "rgba(10,12,16,0.78)";
  roundRect(ctx, x - width / 2, top, width, 14, 4);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.fillText(name, x, top + 7.5);
}

/** Rótulo de una zona, sobre su pared superior. */
export function drawZoneLabel(
  ctx: CanvasRenderingContext2D,
  zone: { x: number; y: number; width: number; palette: number },
  name: string,
  kind: "text" | "voice",
  isPrivate: boolean,
): void {
  const tone = zoneTone(zone.palette);
  const cx = (zone.x + zone.width / 2) * TILE;
  const cy = zone.y * TILE - WALL_HEIGHT - 9;
  const label = `${kind === "voice" ? "🔊" : "#"} ${name}${isPrivate ? " ·" : ""}`;

  ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const width = ctx.measureText(label).width + 14;
  ctx.fillStyle = "rgba(10,12,16,0.82)";
  roundRect(ctx, cx - width / 2, cy - 9, width, 18, 5);
  ctx.fill();

  ctx.fillStyle = tone.label;
  ctx.fillText(label, cx, cy);
}

// ---------------------------------------------------------------------------

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Aclara (>1) u oscurece (<1) un color `#rrggbb`. */
function shade(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * factor);
  const g = clamp(((n >> 8) & 255) * factor);
  const b = clamp((n & 255) * factor);
  return `rgb(${r},${g},${b})`;
}
