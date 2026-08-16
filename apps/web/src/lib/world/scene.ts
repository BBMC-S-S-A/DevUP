/**
 * La planta: de la lista de zonas a algo dibujable y contra lo que chocar.
 *
 * El servidor manda rectángulos —una zona por canal, ya filtrada por acceso—.
 * Aquí se convierten en muros, puertas y mobiliario. Que esto viva en el
 * cliente y no en la base es deliberado: cambiar el aspecto de una sala no
 * debería ser una migración.
 */
import { TILE } from "./atlas";
import type { Room, Zone } from "./types";

/**
 * Qué cara de la sala es un muro.
 *
 * Importa para dibujar, y mucho. En una vista de tres cuartos se mira hacia
 * dentro de las salas desde abajo: si la pared sur se levanta como las otras,
 * tapa justo lo que se quiere ver y las salas se convierten en cajas cerradas.
 * Por eso la del frente es un zócalo bajo — es lo mismo que hacen Habbo y
 * Gather, y sin ello el espacio no se lee.
 */
export type WallFace = "back" | "side" | "front";

export type Cell =
  | { kind: "floor" }
  | { kind: "zone-floor"; zone: Zone }
  | { kind: "wall"; palette: number; face: WallFace }
  | { kind: "outer-wall"; face: WallFace }
  | { kind: "furniture"; palette: number };

export type Scene = {
  width: number;
  height: number;
  cells: Cell[];
  zones: Zone[];
  /** Casillas que no se pueden pisar. Índice = y * width + x. */
  blocked: boolean[];
};

const at = (width: number, x: number, y: number): number => y * width + x;

/**
 * Construye la escena.
 *
 * La puerta va en el centro de la pared sur de cada sala, siempre. Podría
 * elegirse según por dónde venga la gente, pero una puerta que cambia de sitio
 * cuando se añade un canal es exactamente el tipo de detalle que hace que un
 * sitio deje de sentirse como un sitio.
 */
export function buildScene(room: Room, zones: Zone[]): Scene {
  const { width, height } = room;
  const cells: Cell[] = new Array(width * height).fill({ kind: "floor" as const });
  const blocked: boolean[] = new Array(width * height).fill(false);

  // Muro exterior: el borde de la planta. Sin él se camina hacia el vacío.
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        const face: WallFace = y === height - 1 ? "front" : y === 0 ? "back" : "side";
        cells[at(width, x, y)] = { kind: "outer-wall", face };
        blocked[at(width, x, y)] = true;
      }
    }
  }

  for (const zone of zones) {
    const doorX = zone.x + Math.floor(zone.width / 2);
    const southY = zone.y + zone.height - 1;

    for (let x = zone.x; x < zone.x + zone.width; x += 1) {
      for (let y = zone.y; y < zone.y + zone.height; y += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const index = at(width, x, y);

        const perimeter =
          x === zone.x || y === zone.y || x === zone.x + zone.width - 1 || y === southY;

        // La puerta: un hueco en la pared sur. Es suelo de la zona, no muro,
        // y por eso cruzarla ya cuenta como entrar.
        if (perimeter && !(y === southY && x === doorX)) {
          const face: WallFace = y === southY ? "front" : y === zone.y ? "back" : "side";
          cells[index] = { kind: "wall", palette: zone.palette, face };
          blocked[index] = true;
          continue;
        }

        cells[index] = { kind: "zone-floor", zone };
        blocked[index] = false;
      }
    }

    // Un par de muebles contra la pared del fondo, para que la sala no sea una
    // caja vacía. Se colocan de forma determinista a partir del tamaño: la
    // misma sala amueblada igual en todos los navegadores, sin guardar nada.
    const deskY = zone.y + 2;
    for (let i = 1; i < zone.width - 1; i += 2) {
      const x = zone.x + i;
      if (x <= zone.x || x >= zone.x + zone.width - 1) continue;
      if (deskY >= southY) continue;
      const index = at(width, x, deskY);
      cells[index] = { kind: "furniture", palette: zone.palette };
      blocked[index] = true;
    }
  }

  return { width, height, cells, zones, blocked };
}

/** ¿Se puede pisar esta posición? Se mira la casilla que hay debajo del pie. */
export function isWalkable(scene: Scene, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= scene.width || ty >= scene.height) return false;
  return !scene.blocked[at(scene.width, tx, ty)];
}

/** En qué zona cae una posición, si es que cae en alguna. */
export function zoneAt(scene: Scene, x: number, y: number): Zone | null {
  for (const zone of scene.zones) {
    if (x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height) {
      return zone;
    }
  }
  return null;
}

export const worldToPixels = (tiles: number): number => tiles * TILE;
