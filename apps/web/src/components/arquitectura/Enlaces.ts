/**
 * Por dónde sale y por dónde entra cada flecha, y qué curva las une.
 *
 * DE DÓNDE SALE EL PROBLEMA. Una línea de centro a centro de dos cajas se
 * dibuja por debajo de las dos, y la punta de la flecha acaba escondida dentro
 * del destino. Se ve mal y, peor, no se sabe a qué lado de la caja llega — que
 * es justo lo que una flecha tiene que decir.
 *
 * CÓMO LO RESUELVEN LAS HERRAMIENTAS DE VERDAD. draw.io llama a esto
 * «conexión flotante»: el enlace se engancha al LADO de la caja que mira al
 * otro extremo, y se recalcula solo al mover cualquiera de las dos. Es lo que
 * hace que un diagrama siga leyéndose después de recolocarlo.
 *
 * Y LA CURVA, QUE NO ES ADORNO. Dos líneas rectas entre cuatro cajas se cruzan
 * y no se sabe cuál es cuál; dos curvas que salen perpendiculares a su lado se
 * separan solas. Además la tangente en los extremos es perpendicular al borde,
 * así que la punta de la flecha entra recta en la caja en vez de de lado.
 */

export type Punto = { x: number; y: number };
export type Caja = { x: number; y: number; ancho: number; alto: number };

type Lado = "derecha" | "izquierda" | "abajo" | "arriba";

/**
 * A qué lado de `caja` se engancha el enlace que va hacia `hacia`.
 *
 * Gana el eje con más distancia: si dos cajas están una al lado de la otra, el
 * enlace sale por el costado; si una está debajo, sale por abajo. Es la regla
 * que hace que un diagrama en columnas —que es como los coloca DevUP— salga
 * con todas las flechas horizontales.
 */
function ladoHacia(caja: Caja, hacia: Punto): Lado {
  const cx = caja.x + caja.ancho / 2;
  const cy = caja.y + caja.alto / 2;
  const dx = hacia.x - cx;
  const dy = hacia.y - cy;
  // El ancho de una caja es más del doble que su alto, así que comparar dx con
  // dy a secas mandaría casi todo por arriba y por abajo. Se comparan en
  // proporción a la caja, que es lo que hace que «está a la derecha» signifique
  // lo mismo para una caja ancha y para una alta.
  if (Math.abs(dx) / caja.ancho >= Math.abs(dy) / caja.alto) {
    return dx >= 0 ? "derecha" : "izquierda";
  }
  return dy >= 0 ? "abajo" : "arriba";
}

function puntoDelLado(caja: Caja, lado: Lado): Punto {
  const cx = caja.x + caja.ancho / 2;
  const cy = caja.y + caja.alto / 2;
  switch (lado) {
    case "derecha":
      return { x: caja.x + caja.ancho, y: cy };
    case "izquierda":
      return { x: caja.x, y: cy };
    case "abajo":
      return { x: cx, y: caja.y + caja.alto };
    case "arriba":
      return { x: cx, y: caja.y };
  }
}

/** Hacia dónde apunta el trazo al salir de un lado, para curvar hacia fuera. */
function normal(lado: Lado): Punto {
  switch (lado) {
    case "derecha":
      return { x: 1, y: 0 };
    case "izquierda":
      return { x: -1, y: 0 };
    case "abajo":
      return { x: 0, y: 1 };
    case "arriba":
      return { x: 0, y: -1 };
  }
}

export type Trazado = { d: string; medio: Punto };

/**
 * La curva entre dos cajas, y dónde cae su punto medio.
 *
 * El medio se devuelve porque ahí va la etiqueta, y calcularlo como la media de
 * los dos extremos la dejaría flotando lejos del trazo en cuanto la curva se
 * abre. Este sale de la fórmula de la propia bézier, así que está encima de la
 * línea siempre.
 */
export function trazarEnlace(origen: Caja, destino: Caja): Trazado {
  const centroDestino = { x: destino.x + destino.ancho / 2, y: destino.y + destino.alto / 2 };
  const centroOrigen = { x: origen.x + origen.ancho / 2, y: origen.y + origen.alto / 2 };

  const ladoA = ladoHacia(origen, centroDestino);
  const ladoB = ladoHacia(destino, centroOrigen);
  const a = puntoDelLado(origen, ladoA);
  const b = puntoDelLado(destino, ladoB);

  // Cuánto se aleja la curva del borde antes de girar. Proporcional a la
  // distancia para que dos cajas pegadas no saquen un lazo enorme, con un
  // mínimo para que dos cajas alineadas no salgan con una recta seca.
  const distancia = Math.hypot(b.x - a.x, b.y - a.y);
  const tiron = Math.max(28, Math.min(110, distancia * 0.42));

  const na = normal(ladoA);
  const nb = normal(ladoB);
  const c1 = { x: a.x + na.x * tiron, y: a.y + na.y * tiron };
  const c2 = { x: b.x + nb.x * tiron, y: b.y + nb.y * tiron };

  // Bézier cúbica en t = 0.5: (A + 3·C1 + 3·C2 + B) / 8.
  const medio = {
    x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8,
    y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8,
  };

  return {
    d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`,
    medio,
  };
}
