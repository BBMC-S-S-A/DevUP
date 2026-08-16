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
  | "window";

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
