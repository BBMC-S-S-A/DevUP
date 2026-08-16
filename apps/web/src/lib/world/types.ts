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
  zoneId: string | null;
};
