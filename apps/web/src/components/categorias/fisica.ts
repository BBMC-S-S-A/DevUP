/**
 * La física del grafo libre: qué le pasa a cada nodo en un instante.
 *
 * TRES FUERZAS Y NADA MÁS. Repulsión entre todos los nodos —para que no se
 * amontonen—, un muelle en cada arista —para que lo conectado se busque—, y
 * una gravedad débil hacia el centro —para que el conjunto no se vaya
 * flotando fuera de pantalla—. Es el mismo modelo que d3-force por dentro,
 * escrito a mano porque son ochenta líneas y no hace falta la dependencia
 * entera para tres fuerzas.
 *
 * `alpha` BAJA SOLA, COMO EN d3-force. Empieza en 1 y decae cada paso: al
 * principio el dibujo se mueve mucho para deshacer el amontonamiento inicial,
 * y al cabo de un segundo se queda quieto. Sin este decaimiento el grafo
 * temblaría para siempre en vez de asentarse.
 */

export type NodoFisico = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Puesto mientras se arrastra: la física deja de mover este nodo. */
  fx?: number;
  fy?: number;
};

export type AristaFisica = { deId: string; aId: string; longitud: number };

const REPULSION = 900;
const RIGIDEZ_MUELLE = 0.06;
const GRAVEDAD = 0.02;
const FRICCION = 0.86;
const DISTANCIA_MINIMA = 8;

export function paso(
  nodos: NodoFisico[],
  aristas: AristaFisica[],
  alpha: number,
  centroX: number,
  centroY: number,
): void {
  const porId = new Map(nodos.map((n) => [n.id, n]));

  // Repulsión: cada par de nodos se empuja, más fuerte cuanto más cerca.
  // O(n²) a propósito — con los tamaños de un tablero (decenas de tareas) es
  // más barato que llevar un árbol espacial para calcularlo aproximado.
  for (let i = 0; i < nodos.length; i++) {
    for (let j = i + 1; j < nodos.length; j++) {
      const a = nodos[i]!;
      const b = nodos[j]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      if (dist < 0.01) {
        // Dos nodos exactamente encima: un empujón en una dirección
        // arbitraria mejor que dividir por cero.
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        dist = 0.1;
      }
      dist = Math.max(dist, DISTANCIA_MINIMA);
      const fuerza = (REPULSION / (dist * dist)) * alpha;
      const fx = (dx / dist) * fuerza;
      const fy = (dy / dist) * fuerza;
      if (a.fx === undefined) {
        a.vx -= fx;
        a.vy -= fy;
      }
      if (b.fx === undefined) {
        b.vx += fx;
        b.vy += fy;
      }
    }
  }

  // Muelle: cada arista tira de sus dos extremos hacia su longitud deseada.
  for (const ar of aristas) {
    const a = porId.get(ar.deId);
    const b = porId.get(ar.aId);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(Math.hypot(dx, dy), 0.01);
    const diferencia = ((dist - ar.longitud) / dist) * RIGIDEZ_MUELLE * alpha;
    const fx = dx * diferencia;
    const fy = dy * diferencia;
    if (a.fx === undefined) {
      a.vx += fx;
      a.vy += fy;
    }
    if (b.fx === undefined) {
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // Gravedad: un tirón débil hacia el centro, para que el conjunto no derive.
  for (const n of nodos) {
    if (n.fx !== undefined) continue;
    n.vx += (centroX - n.x) * GRAVEDAD * alpha;
    n.vy += (centroY - n.y) * GRAVEDAD * alpha;
  }

  for (const n of nodos) {
    if (n.fx !== undefined) {
      n.x = n.fx;
      n.y = n.fy!;
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx *= FRICCION;
    n.vy *= FRICCION;
    n.x += n.vx;
    n.y += n.vy;
  }
}
