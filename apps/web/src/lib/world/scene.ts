/**
 * La planta: de la lista de zonas a algo dibujable y contra lo que chocar.
 *
 * El servidor manda rectángulos —una zona por canal, ya filtrada por acceso—.
 * Aquí se convierten en salas amuebladas. Que esto viva en el cliente y no en
 * la base es deliberado: cambiar el aspecto de una sala no debería ser una
 * migración, y el mobiliario es exactamente el tipo de cosa que el documento
 * 0002 permite que exista solo en el mundo.
 */
import { type FloorMaterial, FLOOR_OF, MATERIALS, furnitureOf, type Theme, themeOf } from "./rooms";
import type { Prop } from "./props";
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
  | { kind: "zone-floor"; zone: Zone; material: FloorMaterial }
  | { kind: "wall"; palette: number; face: WallFace }
  | { kind: "outer-wall"; face: WallFace }
  | { kind: "door"; zone: Zone; material: FloorMaterial };

export type ZoneInfo = { zone: Zone; theme: Theme; material: FloorMaterial };

export type Scene = {
  width: number;
  height: number;
  cells: Cell[];
  zones: Zone[];
  info: Map<string, ZoneInfo>;
  /** Muebles del suelo, para el orden por Y. */
  props: Prop[];
  /** Planos —alfombras—: se dibujan con el suelo, antes que nada con altura. */
  floorProps: Prop[];
  /** Los que cuelgan de la pared: se dibujan con su muro, no delante. */
  wallProps: Prop[];
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
  const info = new Map<string, ZoneInfo>();
  const props: Prop[] = [];
  const floorProps: Prop[] = [];
  const wallProps: Prop[] = [];

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
    const theme = themeOf(zone);
    // El material elegido a mano gana al del tema. Nulo = el del tema.
    const material = zone.material !== null ? MATERIALS[zone.material % MATERIALS.length]! : FLOOR_OF[theme];
    info.set(zone.id, { zone, theme, material });

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
        if (y === southY && x === doorX) {
          cells[index] = { kind: "door", zone, material };
          blocked[index] = false;
          continue;
        }

        if (perimeter) {
          const face: WallFace = y === southY ? "front" : y === zone.y ? "back" : "side";
          cells[index] = { kind: "wall", palette: zone.palette, face };
          blocked[index] = true;
          continue;
        }

        cells[index] = { kind: "zone-floor", zone, material };
        blocked[index] = false;
      }
    }

    // Amueblar. Lo que bloquea marca su casilla; lo que no —alfombras, sillas,
    // monitores sobre un escritorio— se pisa sin más.
    for (const piece of furnitureOf(zone)) {
      const tx = Math.round(piece.x);
      const ty = Math.round(piece.y);
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;

      if (piece.onWall) {
        wallProps.push(piece);
        continue;
      }
      if (piece.flat) {
        floorProps.push(piece);
        continue;
      }
      props.push(piece);
      if (piece.blocks) blocked[at(width, tx, ty)] = true;
    }
  }

  // Una sala que se amuebló hasta dejarse sin sitio para estar de pie es un
  // fallo de diseño, no un obstáculo: se libera la fila de la puerta hacia
  // dentro para garantizar que siempre se puede entrar y dar media vuelta.
  for (const zone of zones) {
    const doorX = zone.x + Math.floor(zone.width / 2);
    const southY = zone.y + zone.height - 1;
    for (const y of [southY - 1, southY - 2]) {
      if (y <= zone.y) continue;
      const index = at(width, doorX, y);
      if (index >= 0 && index < blocked.length) blocked[index] = false;
    }
  }

  return { width, height, cells, zones, info, props, floorProps, wallProps, blocked };
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
