/**
 * Qué clase de sala es cada zona, y cómo se amuebla.
 *
 * EL TEMA SE DEDUCE DEL NOMBRE DEL CANAL, no se guarda en ninguna parte. Es
 * coherente con la regla del documento 0002 —el mundo proyecta lo que ya
 * existe— y tiene una ventaja práctica: renombrar un canal a «música»
 * redecora la sala sola, sin migración ni panel de ajustes. Cuando llegue el
 * editor de la fase 2, lo que se guardará es la excepción, no el caso normal.
 *
 * TODO ES DETERMINISTA. Ni un `Math.random` en todo el archivo: el mobiliario
 * sale de la posición de la zona y de su nombre. Dos personas mirando la misma
 * sala tienen que ver la misma taza sobre la misma mesa, y guardar la posición
 * de cada planta en la base de datos para conseguirlo sería absurdo.
 */
import { type Prop, type PropKind, PROP_SPECS, prop } from "./props";
import type { Zone } from "./types";

export type Theme = "work" | "lounge" | "games" | "music" | "meeting";

export type FloorMaterial = "wood" | "tile" | "checker" | "carpet" | "concrete";

const THEME_RULES: { theme: Theme; words: string[] }[] = [
  { theme: "games", words: ["juego", "gaming", "arcade", "entreten", "ocio", "game", "play"] },
  { theme: "music", words: ["music", "músic", "audio", "sonido", "radio", "podcast"] },
  { theme: "meeting", words: ["reuni", "junta", "daily", "meeting", "standup", "comit", "direcc"] },
  { theme: "lounge", words: ["general", "salón", "salon", "café", "cafe", "descanso", "random", "off", "social", "cocina"] },
  { theme: "work", words: ["desarrollo", "dev", "código", "codigo", "code", "backend", "front", "trabajo", "ingenier", "producto", "diseño"] },
];

/**
 * El tema de una zona.
 *
 * Sin coincidencia, un canal de voz es una sala de reuniones y uno de texto un
 * salón. Es la suposición menos mala: nadie abre un canal de voz para estar
 * solo, y un canal de texto suele ser donde se está sin hacer ruido.
 */
export function themeOf(zone: Zone): Theme {
  const name = zone.channelName.toLowerCase();
  for (const rule of THEME_RULES) {
    if (rule.words.some((word) => name.includes(word))) return rule.theme;
  }
  return zone.channelKind === "voice" ? "meeting" : "lounge";
}

export const FLOOR_OF: Record<Theme, FloorMaterial> = {
  work: "wood",
  lounge: "tile",
  games: "concrete",
  music: "carpet",
  meeting: "wood",
};

/**
 * Amuebla una sala.
 *
 * `zone` incluye los muros; el interior útil va de `x+1` a `x+width-2`. La
 * pared sur lleva la puerta en el centro, así que ahí no se pone nada: dejar
 * la entrada despejada es lo que evita que alguien se quede encajado nada más
 * entrar, y es el fallo más fácil de cometer amueblando por rejilla.
 */
/**
 * El mobiliario de una sala: el guardado si lo hay, el deducido si no.
 *
 * Es el único sitio que decide entre los dos, y por eso la marca `customized`
 * y no «¿tiene filas?». Con lo segundo, vaciar una sala a propósito la haría
 * volver al amueblado por defecto en el siguiente refresco — borrar el sofá
 * lo devolvería, que es de las cosas más desconcertantes que puede hacer un
 * editor.
 *
 * Las coordenadas guardadas son relativas a la sala; aquí se pasan a la
 * planta. Mover una sala se lleva sus muebles dentro sin tocar ni una fila.
 */
export function furnitureOf(zone: Zone): Prop[] {
  if (!zone.customized) return furnish(zone);

  return zone.props.flatMap((stored) => {
    const spec = PROP_SPECS[stored.kind as PropKind];
    // Un `kind` que este cliente no conoce se ignora en vez de romper el
    // dibujo entero. Es lo que permite añadir muebles sin migración: un
    // cliente viejo simplemente no ve los nuevos.
    if (!spec) return [];
    return [
      prop(stored.kind as PropKind, zone.x + stored.x, zone.y + stored.y, {
        facing: stored.facing,
        tone: stored.tone,
      }),
    ];
  });
}

export function furnish(zone: Zone): Prop[] {
  const theme = themeOf(zone);
  const left = zone.x + 1;
  const right = zone.x + zone.width - 2;
  const top = zone.y + 1;
  const bottom = zone.y + zone.height - 2;
  const midX = Math.floor((left + right) / 2);
  const doorX = zone.x + Math.floor(zone.width / 2);
  const tone = zone.palette;
  const props: Prop[] = [];

  // Decoración de pared, en la pared del fondo. Va en todas las salas: una
  // pared desnuda es lo que hace que un sitio parezca sin terminar.
  //
  // Dos piezas y en los extremos, nunca tres. Cada una mide casi una casilla
  // de ancho, así que dos contiguas se solapan — y con la pizarra encima de la
  // ventana la pared parecía un collage. Los extremos garantizan la
  // separación sea cual sea el ancho de la sala.
  const wallY = zone.y;
  const wallLeft = left;
  const wallRight = right;
  const wallDecor = (kind: "whiteboard" | "frame" | "shelf") => {
    props.push(prop("window", wallLeft, wallY, { tone }));
    if (wallRight - wallLeft >= 3) props.push(prop(kind, wallRight, wallY, { tone: tone + 3 }));
  };

  switch (theme) {
    case "work": {
      // Escritorios contra la pared del fondo, con su monitor y su silla
      // delante. Es la sala de la izquierda de la foto de referencia.
      for (let i = 0; i + 1 <= right - left; i += 3) {
        const x = left + i + 0.5;
        if (x > right - 0.5) break;
        props.push(prop("desk", x, top + 1, { tone }));
        props.push(prop("monitor", x, top + 1, { tone: i }));
        props.push(prop("chair", x, top + 2, { tone: tone + i, facing: "n" }));
      }
      props.push(prop("plantTall", right, bottom, { tone }));
      if (right - left >= 4) props.push(prop("bookshelf", left, bottom - 1, { tone }));
      wallDecor("whiteboard");
      break;
    }

    case "lounge": {
      // Sofás enfrentados con la mesa en medio, sobre una alfombra. Es la sala
      // de la derecha de la foto: pocas piezas, bien colocadas.
      props.push(prop("rug", midX, top + 4, { tone: tone + 1 }));
      props.push(prop("sofa", midX, top + 1, { tone: tone + 1, facing: "s" }));
      props.push(prop("coffeeTable", midX, top + 3, { tone }));
      props.push(prop("armchair", left, top + 3, { tone: tone + 2, facing: "e" }));
      props.push(prop("armchair", right, top + 3, { tone: tone + 2, facing: "o" }));
      props.push(prop("plantTall", left, bottom, { tone }));
      props.push(prop("lamp", right, bottom, { tone }));
      wallDecor("frame");
      break;
    }

    case "games": {
      // Recreativas contra la pared, pufs delante y un altavoz en la esquina.
      for (let x = left; x <= right; x += 2) {
        if (x === doorX) continue;
        props.push(prop("arcade", x, top + 1, { tone: x }));
      }
      props.push(prop("beanbag", left + 1, bottom, { tone: tone + 2 }));
      props.push(prop("beanbag", right - 1, bottom, { tone: tone + 5 }));
      props.push(prop("speaker", right, top + 2, { tone }));
      wallDecor("frame");
      break;
    }

    case "music": {
      props.push(prop("rug", midX, top + 4, { tone: tone + 4 }));
      props.push(prop("piano", midX, top + 1, { tone }));
      props.push(prop("speaker", left, top + 1, { tone }));
      props.push(prop("speaker", right, top + 1, { tone }));
      props.push(prop("chair", midX, top + 2, { tone: tone + 1, facing: "n" }));
      props.push(prop("plant", left, bottom, { tone }));
      wallDecor("shelf");
      break;
    }

    case "meeting": {
      // Mesa larga con sillas a los dos lados. Las de abajo miran al norte,
      // las de arriba al sur: sentados unos frente a otros.
      const tableY = top + 2;
      props.push(prop("meetingTable", midX, tableY, { tone }));
      for (const dx of [-1, 1]) {
        props.push(prop("chair", midX + dx, tableY - 1, { tone: tone + 1, facing: "s" }));
        props.push(prop("chair", midX + dx, tableY + 1, { tone: tone + 1, facing: "n" }));
      }
      wallDecor("whiteboard");
      props.push(prop("plant", right, bottom, { tone }));
      break;
    }
  }

  // Nada delante de la puerta, pase lo que pase. Es la última palabra y no una
  // comprobación dentro de cada caso: así una sala nueva no puede volver a
  // introducir el fallo.
  return props.filter((p) => !(p.blocks && Math.round(p.x) === doorX && p.y >= bottom));
}

/**
 * Los materiales por índice, para el selector del editor.
 *
 * El orden importa y no se puede reordenar: `world_zones.material` guarda la
 * posición en esta lista. Añadir al final es seguro; insertar en medio
 * repinta el suelo de todas las salas que ya eligieron uno.
 */
export const MATERIALS: FloorMaterial[] = ["wood", "tile", "checker", "carpet", "concrete"];
