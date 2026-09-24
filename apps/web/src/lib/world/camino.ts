/**
 * Tocar el suelo y que el personaje vaya solo.
 *
 * POR QUÉ HACÍA FALTA. El DevVerse se movía SOLO con el teclado —WASD o las
 * flechas—. En un teléfono no hay teclado, así que la oficina entera era un
 * dibujo que no se podía recorrer; y con ratón, quien no juega a videojuegos
 * no sabe que existe WASD. Tocar donde quieres ir es lo que cualquiera
 * intenta primero.
 *
 * NO TOCA LA RED NI EL SERVIDOR. Esto convierte un destino en las mismas
 * cuatro teclas que ya lee el bucle (`Input`), así que el movimiento sigue
 * pasando por `isWalkable`, por la interpolación y por el reparto a los demás
 * exactamente igual que antes. Para el resto del mundo, alguien que camina
 * tocando es indistinguible de alguien que camina con la W.
 *
 * BÚSQUEDA EN ANCHURA, NO A*. Una oficina tiene del orden de mil casillas; la
 * anchura las recorre en menos de un milisegundo y no necesita una heurística
 * que haya que mantener. Si algún día los mapas son diez veces más grandes, se
 * cambia aquí y nadie más se entera.
 */

/** Lo único de la escena que hace falta para buscar un camino. */
export type Rejilla = { width: number; height: number; blocked: boolean[] };

export type Punto = { x: number; y: number };

export type Direccion = { up: boolean; down: boolean; left: boolean; right: boolean };

const QUIETO: Direccion = { up: false, down: false, left: false, right: false };

function libre(r: Rejilla, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < r.width && y < r.height && !r.blocked[y * r.width + x];
}

/**
 * La casilla libre más cercana a una ocupada.
 *
 * Tocar una mesa quiere decir «ve a la mesa», no «no se puede». Así que si el
 * destino está bloqueado se busca la casilla libre más próxima —hasta tres de
 * distancia—, que es ponerse al lado de lo que se ha tocado.
 */
export function libreMasCercana(r: Rejilla, x: number, y: number, radio = 3): Punto | null {
  if (libre(r, x, y)) return { x, y };
  let mejor: Punto | null = null;
  let mejorD = Infinity;
  for (let dy = -radio; dy <= radio; dy++) {
    for (let dx = -radio; dx <= radio; dx++) {
      if (!libre(r, x + dx, y + dy)) continue;
      const d = dx * dx + dy * dy;
      if (d < mejorD) {
        mejor = { x: x + dx, y: y + dy };
        mejorD = d;
      }
    }
  }
  return mejor;
}

const VECINOS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/**
 * Las casillas por las que pasar, de la de al lado hasta la de destino.
 *
 * En diagonal solo si las dos casillas rectas que la rodean están libres. El
 * bucle mueve cada eje por separado para poder deslizarse por una pared, y
 * cortar una esquina lo dejaría clavado contra ella con el camino a medias.
 *
 * Devuelve `null` si no se llega —el destino está en otra habitación sin
 * puerta, o fuera del mapa—, y un camino vacío si ya se está ahí.
 */
export function buscarCamino(r: Rejilla, desde: Punto, hasta: Punto): Punto[] | null {
  const ox = Math.floor(desde.x);
  const oy = Math.floor(desde.y);
  const destino = libreMasCercana(r, Math.floor(hasta.x), Math.floor(hasta.y));
  if (!destino || !libre(r, ox, oy)) return null;
  if (destino.x === ox && destino.y === oy) return [];

  const total = r.width * r.height;
  const previo = new Int32Array(total).fill(-1);
  const origen = oy * r.width + ox;
  const meta = destino.y * r.width + destino.x;
  previo[origen] = origen;

  const cola = new Int32Array(total);
  let cabeza = 0;
  let fin = 0;
  cola[fin++] = origen;

  while (cabeza < fin) {
    const actual = cola[cabeza++]!;
    if (actual === meta) break;
    const cx = actual % r.width;
    const cy = (actual - cx) / r.width;
    for (const [dx, dy] of VECINOS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!libre(r, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!libre(r, cx + dx, cy) || !libre(r, cx, cy + dy))) continue;
      const indice = ny * r.width + nx;
      if (previo[indice] !== -1) continue;
      previo[indice] = actual;
      cola[fin++] = indice;
    }
  }
  if (previo[meta] === -1) return null;

  const casillas: Punto[] = [];
  for (let i = meta; i !== origen; i = previo[i]!) {
    casillas.push({ x: i % r.width, y: Math.floor(i / r.width) });
  }
  casillas.reverse();
  // La casilla de salida entra en la simplificación como ancla y sale después:
  // sin ella, el primer tramo de un pasillo recto se quedaba como una parada
  // aparte, porque no había con qué compararlo.
  const centros = casillas.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }));
  return simplificar([{ x: ox + 0.5, y: oy + 0.5 }, ...centros]).slice(1);
}

/**
 * Quita los puntos que están en línea recta con sus vecinos.
 *
 * Sin esto, un pasillo de diez casillas son diez paradas, y el personaje se
 * nota que va de casilla en casilla. Con esto, va de esquina en esquina.
 */
function simplificar(puntos: Punto[]): Punto[] {
  if (puntos.length <= 2) return puntos;
  const salida: Punto[] = [puntos[0]!];
  for (let i = 1; i < puntos.length - 1; i++) {
    const a = salida[salida.length - 1]!;
    const b = puntos[i]!;
    const c = puntos[i + 1]!;
    const recto = Math.sign(b.x - a.x) === Math.sign(c.x - b.x) && Math.sign(b.y - a.y) === Math.sign(c.y - b.y);
    if (!recto) salida.push(b);
  }
  salida.push(puntos[puntos.length - 1]!);
  return salida;
}

/** Cuánto hay que acercarse a un punto para darlo por alcanzado, en casillas. */
const LLEGADA = 0.18;

/**
 * Las teclas que hay que «pulsar» para seguir el camino, y el camino que queda.
 *
 * Por ejes y con un margen: si la diferencia en un eje es menor que el margen
 * no se pulsa esa tecla, que es lo que evita el zigzag de quien corrige un
 * píxel a cada lado de la línea.
 */
export function seguirCamino(yo: Punto, camino: Punto[]): { direccion: Direccion; camino: Punto[] } {
  let resto = camino;
  while (resto.length > 0 && Math.hypot(resto[0]!.x - yo.x, resto[0]!.y - yo.y) < LLEGADA) {
    resto = resto.slice(1);
  }
  const siguiente = resto[0];
  if (!siguiente) return { direccion: QUIETO, camino: [] };

  const dx = siguiente.x - yo.x;
  const dy = siguiente.y - yo.y;
  const margen = LLEGADA / 2;
  return {
    direccion: {
      right: dx > margen,
      left: dx < -margen,
      down: dy > margen,
      up: dy < -margen,
    },
    camino: resto,
  };
}
