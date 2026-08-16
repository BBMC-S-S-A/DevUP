/**
 * Tipos de la vista inmersiva.
 *
 * Ver docs/decisiones/0002-vistas-profesional-e-inmersiva.md.
 */

/** Una zona es la proyección de un canal. Nunca existe sin él. */
export type Zone = {
  id: string;
  channelId: string;
  channelName: string;
  channelKind: "text" | "voice";
  channelPrivate: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Índice de paleta; el tono concreto lo decide el cliente. */
  palette: number;
  /**
   * Si alguien ha editado esta sala. En falso, `props` se ignora y el
   * mobiliario se deduce del nombre del canal — que es lo que hace que una
   * sala nueva no nazca vacía.
   */
  customized: boolean;
  /** Material de suelo elegido a mano, o nulo para el que le toque por tema. */
  material: number | null;
  /** Muebles guardados, en coordenadas relativas al origen de la sala. */
  props: StoredProp[];
};

/** Un mueble tal como viene de la base: relativo a la sala. */
export type StoredProp = {
  id: string;
  kind: string;
  x: number;
  y: number;
  facing: "n" | "s" | "e" | "o";
  tone: number;
};

export type Room = { id: string; width: number; height: number };

export type WorldMap = { room: Room | null; zones: Zone[] };

export type Facing = "n" | "s" | "e" | "o";

/** Cómo se ve alguien. Todo son índices de catálogo, no colores literales. */
export type Avatar = {
  body: number;
  hair: number;
  top: number;
  bottom: number;
  skinTone: number;
  hairTone: number;
  topTone: number;
  bottomTone: number;
  hat: number;
  glasses: number;
  beard: number;
  shoes: number;
  hatTone: number;
  shoesTone: number;
};

export const DEFAULT_AVATAR: Avatar = {
  body: 0,
  hair: 0,
  top: 0,
  bottom: 0,
  skinTone: 2,
  hairTone: 1,
  topTone: 3,
  bottomTone: 6,
  hat: 0,
  glasses: 0,
  beard: 0,
  shoes: 0,
  hatTone: 0,
  shoesTone: 7,
};

/**
 * Alguien dentro de la oficina.
 *
 * `x`/`y` es dónde se dibuja ahora mismo; `tx`/`ty` es lo último que dijo el
 * servidor. La interpolación mueve el primero hacia el segundo — sin ella, con
 * el servidor repartiendo a 10 Hz, los demás avanzarían a saltos de diez por
 * segundo por muy fluido que vaya el dibujo.
 */
export type Peer = {
  peerId: string;
  userId: string;
  displayName: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  facing: Facing;
  moving: boolean;
  /** Sentado en un mueble. Cambia la postura y bloquea el movimiento. */
  sitting: boolean;
  /** Lo último que dijo, mientras dure la burbuja. */
  bubble?: string;
  bubbleUntil?: number;
  /** Gesto en curso. */
  emote?: "wave" | "yes" | "clap" | "hand";
  emoteUntil?: number;
  zoneId: string | null;
};

/**
 * Lo que cambia cada poco: el tablero y la actividad de cada canal.
 *
 * Viaja aparte del mapa porque el mapa casi nunca cambia y esto cambia con
 * cada tarea que alguien mueve. Ver la ruta /world/live.
 */
export type LiveData = {
  board: { name: string; count: number }[];
  channels: { channelId: string; files: number; lastMessageAt: string | null }[];
};
