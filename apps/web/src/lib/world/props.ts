/**
 * El catálogo de muebles.
 *
 * Todo se dibuja con un solo primitivo: `prism`, una caja apoyada en el suelo
 * con su cara frontal y su tapa. Suena pobre y no lo es — un escritorio es una
 * tapa ancha sobre dos cajas finas, un sofá son tres cajas y dos brazos, una
 * máquina recreativa es una caja alta con una pantalla encendida encima. Lo
 * que da el aspecto no es la variedad de primitivos sino la proporción y la
 * luz: tapa clara, frente medio, sombra al pie. Siempre las tres.
 *
 * Por qué un primitivo y no sprites todavía: la geometría es lo que hay que
 * acertar antes de encargar arte. Si un escritorio ocupa dos casillas y tiene
 * 14 píxeles de alto, el sprite que lo sustituya tendrá que ocupar eso mismo;
 * dibujarlo primero y medirlo después es como se acaba con un pack de arte que
 * no encaja con el mapa.
 */

export type PropKind =
  | "desk"
  | "monitor"
  | "chair"
  | "sofa"
  | "armchair"
  | "coffeeTable"
  | "meetingTable"
  | "plant"
  | "plantTall"
  | "rug"
  | "bookshelf"
  | "arcade"
  | "piano"
  | "speaker"
  | "whiteboard"
  | "fridge"
  | "lamp"
  | "beanbag"
  | "frame"
  | "shelf"
  | "window"
  | "standingDesk"
  | "serverRack"
  | "printer"
  | "dualMonitor"
  | "corkBoard"
  | "cabinet"
  | "waterCooler"
  | "kitchenette"
  | "coffeeMachine"
  | "diningTable"
  | "barStool"
  | "tv"
  | "sideboard"
  | "floorCushion"
  | "curtains"
  | "poolTable"
  | "foosball"
  | "pinball"
  | "retroTv"
  | "trophyCase"
  | "neonSign"
  | "drums"
  | "guitar"
  | "mixer"
  | "micStand"
  | "vinylShelf"
  | "acousticPanel"
  | "projector"
  | "confPuck"
  | "flipchart"
  | "planterDivider"
  | "wallClock"
  | "aquarium"
  | "doorway";

/** Un mueble colocado. `x`/`y` en casillas; el ancla es el pie del mueble. */
export type Prop = {
  kind: PropKind;
  x: number;
  y: number;
  facing: "n" | "s" | "e" | "o";
  /** Índice de paleta para las piezas que admiten color (sofás, sillas…). */
  tone: number;
  /** Si estorba al caminar. Una alfombra no; un escritorio sí. */
  blocks: boolean;
  /**
   * Los que cuelgan de la pared se dibujan con la pared, no en el orden por Y:
   * están *sobre* ella, no delante.
   */
  onWall: boolean;
  /**
   * Los planos se dibujan con el suelo, antes que nada que tenga altura.
   *
   * Sin esto una alfombra entra en el orden por Y como cualquier otra cosa, y
   * como suele estar en la parte baja de la sala se dibuja la última: tapa el
   * sofá, la mesa y las butacas que debería tener encima. Es exactamente lo
   * que pasó la primera vez.
   */
  flat: boolean;
  /**
   * Lo que este mueble tiene que mostrar, si muestra algo.
   *
   * Ver el plan §6: un mueble no decora, proyecta algo que ya es cierto. Va
   * en el propio mueble y no en un mapa aparte porque el que dibuja es el que
   * necesita el dato, y pasarlo por otro sitio obligaría a que la función de
   * dibujo supiera de dónde viene.
   */
  data?: PropData;
};

export type PropData = {
  /** Renglones cortos, como los de una pizarra: «Por hacer 4». */
  lines?: { label: string; value: number }[];
  /** Una cantidad: los archivos de un canal, por ejemplo. */
  count?: number;
  /** Si la pantalla está encendida — actividad reciente en el canal. */
  active?: boolean;
};

export const PROP_SPECS: Record<PropKind, { blocks: boolean; onWall: boolean; flat?: boolean }> = {
  desk: { blocks: true, onWall: false },
  monitor: { blocks: false, onWall: false }, // va encima del escritorio
  chair: { blocks: false, onWall: false }, // se puede empujar; no bloquea
  sofa: { blocks: true, onWall: false },
  armchair: { blocks: true, onWall: false },
  coffeeTable: { blocks: true, onWall: false },
  meetingTable: { blocks: true, onWall: false },
  plant: { blocks: true, onWall: false },
  plantTall: { blocks: true, onWall: false },
  rug: { blocks: false, onWall: false, flat: true },
  bookshelf: { blocks: true, onWall: false },
  arcade: { blocks: true, onWall: false },
  piano: { blocks: true, onWall: false },
  speaker: { blocks: true, onWall: false },
  whiteboard: { blocks: false, onWall: true },
  fridge: { blocks: true, onWall: false },
  lamp: { blocks: false, onWall: false },
  beanbag: { blocks: true, onWall: false },
  frame: { blocks: false, onWall: true },
  shelf: { blocks: false, onWall: true },
  window: { blocks: false, onWall: true },
  standingDesk: { blocks: true, onWall: false },
  serverRack: { blocks: true, onWall: false },
  printer: { blocks: true, onWall: false },
  dualMonitor: { blocks: false, onWall: false },
  corkBoard: { blocks: false, onWall: true },
  cabinet: { blocks: true, onWall: false },
  waterCooler: { blocks: true, onWall: false },
  kitchenette: { blocks: true, onWall: false },
  coffeeMachine: { blocks: false, onWall: false },
  diningTable: { blocks: true, onWall: false },
  barStool: { blocks: false, onWall: false },
  tv: { blocks: true, onWall: false },
  sideboard: { blocks: true, onWall: false },
  floorCushion: { blocks: false, onWall: false },
  curtains: { blocks: false, onWall: true },
  poolTable: { blocks: true, onWall: false },
  foosball: { blocks: true, onWall: false },
  pinball: { blocks: true, onWall: false },
  retroTv: { blocks: true, onWall: false },
  trophyCase: { blocks: true, onWall: false },
  neonSign: { blocks: false, onWall: true },
  drums: { blocks: true, onWall: false },
  guitar: { blocks: true, onWall: false },
  mixer: { blocks: true, onWall: false },
  micStand: { blocks: false, onWall: false },
  vinylShelf: { blocks: true, onWall: false },
  acousticPanel: { blocks: false, onWall: true },
  projector: { blocks: true, onWall: false },
  confPuck: { blocks: false, onWall: false },
  flipchart: { blocks: true, onWall: false },
  planterDivider: { blocks: true, onWall: false },
  wallClock: { blocks: false, onWall: true },
  aquarium: { blocks: true, onWall: false },
  doorway: { blocks: false, onWall: false },
};

export function prop(
  kind: PropKind,
  x: number,
  y: number,
  options: { facing?: Prop["facing"]; tone?: number } = {},
): Prop {
  const spec = PROP_SPECS[kind];
  return {
    kind,
    x,
    y,
    facing: options.facing ?? "s",
    tone: options.tone ?? 0,
    blocks: spec.blocks,
    onWall: spec.onWall,
    flat: spec.flat ?? false,
  };
}

/**
 * La paleta del editor, agrupada.
 *
 * El orden es el de uso, no el alfabético: dentro de cada grupo van primero
 * las piezas que definen la sala —el escritorio antes que la papelera— porque
 * es lo que se coloca primero al amueblar de cero.
 */
export const CATEGORIES: { label: string; kinds: PropKind[] }[] = [
  {
    label: "Trabajo",
    kinds: ["desk", "standingDesk", "monitor", "dualMonitor", "chair", "serverRack",
            "printer", "cabinet", "bookshelf", "whiteboard", "corkBoard", "waterCooler"],
  },
  {
    label: "Salón",
    kinds: ["sofa", "armchair", "coffeeTable", "rug", "diningTable", "barStool",
            "kitchenette", "coffeeMachine", "tv", "sideboard", "floorCushion", "lamp", "fridge"],
  },
  {
    label: "Juegos",
    kinds: ["arcade", "poolTable", "foosball", "pinball", "retroTv", "beanbag",
            "trophyCase", "neonSign"],
  },
  {
    label: "Música",
    kinds: ["piano", "drums", "guitar", "mixer", "micStand", "speaker",
            "vinylShelf", "acousticPanel"],
  },
  {
    label: "Reunión",
    kinds: ["meetingTable", "projector", "confPuck", "flipchart", "planterDivider"],
  },
  {
    label: "Decoración",
    kinds: ["plant", "plantTall", "frame", "shelf", "window", "curtains",
            "wallClock", "aquarium", "doorway"],
  },
];

/**
 * Dónde se sienta uno en cada mueble.
 *
 * Desplazamientos en casillas respecto al ancla del mueble, y hacia dónde
 * queda mirando quien se sienta. Un sofá tiene dos plazas porque dibuja casi
 * dos casillas de ancho; una butaca, una.
 *
 * Va aquí y no en el archivo de dibujo a propósito: la posición de una plaza
 * es geometría del mundo —afecta a colisiones, a la cámara y a la red—, no
 * una decisión de cómo se pinta. Cuando un pack de sprites sustituya al
 * dibujo, esto tiene que seguir igual.
 */
export type Seat = { dx: number; dy: number; facing: Prop["facing"] };

export const SEATS: Partial<Record<PropKind, Seat[]>> = {
  // La silla mira a donde la giraron, y quien se sienta mira igual.
  chair: [{ dx: 0, dy: 0, facing: "s" }],
  barStool: [{ dx: 0, dy: 0, facing: "s" }],
  beanbag: [{ dx: 0, dy: 0, facing: "s" }],
  floorCushion: [{ dx: 0, dy: 0, facing: "s" }],
  armchair: [{ dx: 0, dy: 0, facing: "s" }],
  // Dos plazas, una a cada lado del centro del sofá.
  sofa: [
    { dx: -0.5, dy: 0, facing: "s" },
    { dx: 0.5, dy: 0, facing: "s" },
  ],
};

/** Las plazas de un mueble ya colocado, en coordenadas de planta. */
export function seatsOf(piece: Prop): { x: number; y: number; facing: Prop["facing"] }[] {
  const seats = SEATS[piece.kind];
  if (!seats) return [];
  return seats.map((seat) => ({
    x: piece.x + seat.dx,
    y: piece.y + seat.dy,
    // Quien se sienta mira hacia donde mira el mueble. Sentarse en una silla
    // girada al norte y quedar mirando al sur es de las cosas que más delatan
    // que un sitio está hecho a medias.
    facing: piece.facing,
  }));
}
