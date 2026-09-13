/**
 * Lo que el modelo contesta, partido en trozos que se pueden pintar.
 *
 * POR QUÉ EXISTE. La respuesta del asistente se pintaba en crudo, con
 * `whitespace-pre-wrap`, así que llegaba tal cual la escribe el modelo: «hay 2
 * tareas en la columna **Por hacer**» se leía con los asteriscos puestos, y las
 * listas con su guion delante. No es un detalle de estilo — el modelo usa
 * markdown para marcar lo que importa, y enseñarlo en crudo convierte ese
 * énfasis en ruido justo encima de la palabra que había que destacar.
 *
 * POR QUÉ NO UNA LIBRERÍA. Es la misma cuenta que ya hizo el tablero con el
 * arrastre: lo que hace falta es un subconjunto pequeño y conocido —párrafos,
 * listas, negrita y código— y una dependencia de markdown completo trae
 * tablas, enlaces, HTML incrustado y su superficie de saneado. Aquí no se
 * pinta HTML: se devuelven datos y los pinta React, así que no hay nada que
 * sanear. Eso es lo que hace que el subconjunto se pague solo.
 *
 * Y ASÍ SE PUEDE PROBAR. Es una función pura de texto a estructura, con la
 * respuesta de verdad del modelo como caso — que es lo que no se podía hacer
 * cuando esto era una plantilla dentro de un componente.
 */

/** Un trozo de línea. */
export type Trozo =
  | { tipo: "texto"; texto: string }
  | { tipo: "fuerte"; texto: string }
  | { tipo: "codigo"; texto: string };

/** Un bloque de la respuesta. */
export type Bloque =
  | { tipo: "parrafo"; trozos: Trozo[] }
  | { tipo: "titulo"; trozos: Trozo[] }
  | { tipo: "lista"; puntos: Trozo[][] };

/**
 * Parte una línea en texto, negrita y código.
 *
 * Se recorre una vez con una expresión regular que captura las tres formas a la
 * vez, en vez de hacer tres pasadas: con pasadas separadas, un `**` dentro de
 * un trozo de código se convertiría en negrita — y el modelo escribe nombres de
 * columna entre acentos graves a menudo.
 */
export function trozosDe(linea: string): Trozo[] {
  const trozos: Trozo[] = [];
  // Código primero en la alternancia: lo que va entre acentos graves es
  // literal y gana a cualquier otra marca de dentro.
  const patron = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__/g;
  let desde = 0;
  for (let m = patron.exec(linea); m !== null; m = patron.exec(linea)) {
    if (m.index > desde) trozos.push({ tipo: "texto", texto: linea.slice(desde, m.index) });
    if (m[1] !== undefined) trozos.push({ tipo: "codigo", texto: m[1] });
    else trozos.push({ tipo: "fuerte", texto: (m[2] ?? m[3])! });
    desde = m.index + m[0].length;
  }
  if (desde < linea.length) trozos.push({ tipo: "texto", texto: linea.slice(desde) });
  // Una línea vacía no da ningún trozo, y quien pinte esto tiene que poder
  // contar con que siempre hay al menos uno.
  return trozos.length > 0 ? trozos : [{ tipo: "texto", texto: "" }];
}

/** Si la línea abre un punto de lista. */
const ES_PUNTO = /^\s*[-*]\s+(.*)$/;
/** Si la línea es un titular. */
const ES_TITULO = /^\s*#{1,6}\s+(.*)$/;

/**
 * La respuesta entera, en bloques.
 *
 * Las líneas en blanco separan párrafos, los guiones y asteriscos abren listas,
 * y las almohadillas titulares. Todo lo demás es texto: si el modelo escribe
 * algo que esto no entiende, sale tal cual en vez de desaparecer — que es la
 * diferencia entre un lector incompleto y uno que se come contenido.
 */
export function bloquesDe(texto: string): Bloque[] {
  const bloques: Bloque[] = [];
  let parrafo: string[] = [];
  let puntos: Trozo[][] | null = null;

  const cerrarParrafo = () => {
    if (parrafo.length === 0) return;
    // Las líneas seguidas de un párrafo se unen con un espacio, no con un
    // salto: el modelo corta a lo ancho por su cuenta, y respetar sus cortes
    // dejaría renglones partidos a media frase en una caja de otro ancho.
    bloques.push({ tipo: "parrafo", trozos: trozosDe(parrafo.join(" ")) });
    parrafo = [];
  };
  const cerrarLista = () => {
    if (puntos === null) return;
    bloques.push({ tipo: "lista", puntos });
    puntos = null;
  };

  for (const linea of texto.replace(/\r\n/g, "\n").split("\n")) {
    const titulo = ES_TITULO.exec(linea);
    if (titulo) {
      cerrarParrafo();
      cerrarLista();
      bloques.push({ tipo: "titulo", trozos: trozosDe(titulo[1]!) });
      continue;
    }

    const punto = ES_PUNTO.exec(linea);
    if (punto) {
      cerrarParrafo();
      puntos = [...(puntos ?? []), trozosDe(punto[1]!)];
      continue;
    }

    if (linea.trim() === "") {
      cerrarParrafo();
      cerrarLista();
      continue;
    }

    // Una línea normal cierra la lista: el modelo no sangra continuaciones, así
    // que suponer que pertenece al último punto se equivocaría más de lo que
    // acertaría.
    cerrarLista();
    parrafo.push(linea.trim());
  }

  cerrarParrafo();
  cerrarLista();
  return bloques;
}
