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

/** El suelo de una zona: el tinte de su paleta, con el mismo damero encima. */
export function drawZoneFloor(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  palette: number,
): void {
  const tone = zoneTone(palette);
  ctx.fillStyle = tone.floor;
  ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);

  // Junta entre baldosas, no damero. Un damero dentro de la sala compite con
  // el mobiliario por la atención y deja la vista inquieta; una línea de junta
  // da la misma referencia de escala sin pelearse con nada.
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(tx * TILE, ty * TILE + TILE - 1, TILE, 1);
  ctx.fillRect(tx * TILE + TILE - 1, ty * TILE, 1, TILE);
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
): void {
  const step = moving && Math.floor(time / 140) % 2 === 0 ? 1 : 0;
  const skin = skinTone(look.skinTone);
  const hair = hairTone(look.hairTone);
  const top = clothTone(look.topTone);
  const bottom = clothTone(look.bottomTone);

  // Ancho según la complexión elegida.
  const w = 14 + (look.body % CATALOG.body) * 2;
  const half = w / 2;

  // Sombra en el suelo. Es lo que ancla el avatar a la casilla; sin ella
  // flota, y con perspectiva eso se nota mucho más que en vista plana.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(x, y - 1, half - 1, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const base = y - step;

  // Piernas
  ctx.fillStyle = bottom;
  ctx.fillRect(x - half + 2, base - 12, w - 4, 12);

  // Torso
  ctx.fillStyle = top;
  ctx.fillRect(x - half, base - 26, w, 15);

  // Brazos, un tono más oscuro para que se separen del torso.
  ctx.fillStyle = shade(top, 0.78);
  ctx.fillRect(x - half - 2, base - 25, 2.5, 11);
  ctx.fillRect(x + half - 0.5, base - 25, 2.5, 11);

  // Cabeza
  ctx.fillStyle = skin;
  ctx.fillRect(x - 6, base - 39, 12, 14);

  // Pelo. El índice cambia la forma: melena, corto, con flequillo, calvo…
  ctx.fillStyle = hair;
  const style = look.hair % CATALOG.hair;
  if (style !== 5) ctx.fillRect(x - 6.5, base - 40, 13, 5);
  if (style === 1 || style === 3) {
    // Melena: baja por los lados.
    ctx.fillRect(x - 7.5, base - 40, 2, 13);
    ctx.fillRect(x + 5.5, base - 40, 2, 13);
  }
  if (style === 2) ctx.fillRect(x - 6.5, base - 36, 13, 2); // flequillo
  if (style === 4) ctx.fillRect(x - 3, base - 43, 6, 4); // moño

  // La cara solo se dibuja si mira hacia la cámara. De espaldas no hay ojos,
  // y esa ausencia es lo que hace legible hacia dónde va alguien.
  if (facing !== "n") {
    ctx.fillStyle = "rgba(10,12,16,0.82)";
    const shift = facing === "e" ? 1.5 : facing === "o" ? -1.5 : 0;
    ctx.fillRect(x - 3.5 + shift, base - 33, 2, 2);
    ctx.fillRect(x + 1.5 + shift, base - 33, 2, 2);
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
