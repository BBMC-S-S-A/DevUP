"use client";

import { GripVertical } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * La rejilla del panel: arrastrar para colocar, estirar para dimensionar.
 *
 * Sin librería nueva, por el mismo criterio que el tablero de tareas y la barra
 * de Spotify: Pointer Events y CSS Grid llegan de sobra, y una dependencia de
 * arrastre trae su propio modelo de estado que acaba peleándose con el nuestro.
 *
 * TODO EN CELDAS, NUNCA EN PÍXELES. Lo que se guarda es «columna 2, fila 0, dos
 * de ancho, tres de alto», no coordenadas. Es lo que permite que el mismo panel
 * se vea bien en un portátil y en un monitor grande sin recalcular nada, y lo
 * que hace que colapsar a una columna en el móvil sea ordenar por posición en
 * vez de inventar una equivalencia.
 *
 * NO SE APILAN. Si el sitio donde sueltas ya está ocupado, el movimiento no se
 * aplica y la sombra se pone en rojo. Lo alternativo —empujar a los vecinos—
 * suena mejor y en la práctica hace que mover una tarjeta reorganice media
 * pantalla, que es exactamente lo que la gente no espera cuando coloca algo a
 * mano.
 */

export const COLUMNAS = 4;
export const ALTO_FILA = 120;
const HUECO = 12;

export type Casilla = { x: number; y: number; w: number; h: number };
export type Disposicion<T extends string> = Partial<Record<T, Casilla>>;

const solapan = (a: Casilla, b: Casilla) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const acotar = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** ¿Cabe `candidata` sin pisar a nadie salvo a sí misma? */
function libre<T extends string>(
  disposicion: Disposicion<T>,
  id: T,
  candidata: Casilla,
): boolean {
  if (candidata.x < 0 || candidata.y < 0 || candidata.x + candidata.w > COLUMNAS) return false;
  return Object.entries(disposicion).every(
    ([otro, casilla]) => otro === id || !solapan(candidata, casilla as Casilla),
  );
}

/**
 * Una disposición para quien nunca ha colocado nada.
 *
 * Se deriva del orden que ya tenía —dos por fila, media rejilla cada una— en
 * vez de repartir al azar: quien viene de la versión en columna encuentra sus
 * widgets en el mismo orden de lectura, solo que ahora en dos columnas.
 */
export function disposicionPorDefecto<T extends string>(
  orden: readonly T[],
  altoDe: (id: T) => number,
): Disposicion<T> {
  const salida: Disposicion<T> = {};
  let x = 0;
  let y = 0;
  let altoDeLaFila = 0;

  for (const id of orden) {
    const h = altoDe(id);
    if (x + 2 > COLUMNAS) {
      x = 0;
      y += altoDeLaFila;
      altoDeLaFila = 0;
    }
    salida[id] = { x, y, w: 2, h };
    altoDeLaFila = Math.max(altoDeLaFila, h);
    x += 2;
  }
  return salida;
}

type Gesto =
  | { tipo: "mover"; id: string; agarreX: number; agarreY: number }
  | { tipo: "estirar"; id: string };

export function Rejilla<T extends string>({
  orden,
  disposicion,
  onCambiar,
  editable = true,
  children,
}: {
  orden: readonly T[];
  disposicion: Disposicion<T>;
  /** Se llama al soltar, no durante el gesto: guardar en cada píxel sería una
   *  escritura por fotograma. */
  onCambiar: (siguiente: Disposicion<T>) => void;
  editable?: boolean;
  children: (id: T) => ReactNode;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [gesto, setGesto] = useState<Gesto | null>(null);
  const [previa, setPrevia] = useState<Disposicion<T> | null>(null);
  const [valida, setValida] = useState(true);
  const [estrecha, setEstrecha] = useState(false);

  // Una sola columna en pantalla estrecha: las posiciones no caben y forzarlas
  // daría tarjetas de un dedo de ancho. Se ordenan por fila y luego por columna,
  // que es el orden en que se leen.
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const aplicar = () => setEstrecha(media.matches);
    aplicar();
    media.addEventListener("change", aplicar);
    return () => media.removeEventListener("change", aplicar);
  }, []);

  const vista = previa ?? disposicion;

  /** De coordenadas de pantalla a celda de la rejilla. */
  const celdaEn = useCallback((clientX: number, clientY: number) => {
    const caja = contenedor.current?.getBoundingClientRect();
    if (!caja) return { x: 0, y: 0 };
    const anchoColumna = (caja.width + HUECO) / COLUMNAS;
    return {
      x: Math.floor((clientX - caja.left) / anchoColumna),
      y: Math.floor((clientY - caja.top) / (ALTO_FILA + HUECO)),
    };
  }, []);

  const alMover = useCallback(
    (evento: PointerEvent) => {
      if (!gesto) return;
      const actual = disposicion[gesto.id as T];
      if (!actual) return;

      let candidata: Casilla;
      if (gesto.tipo === "mover") {
        const celda = celdaEn(evento.clientX, evento.clientY);
        candidata = {
          ...actual,
          x: acotar(celda.x - gesto.agarreX, 0, COLUMNAS - actual.w),
          y: Math.max(0, celda.y - gesto.agarreY),
        };
      } else {
        const celda = celdaEn(evento.clientX, evento.clientY);
        candidata = {
          ...actual,
          w: acotar(celda.x - actual.x + 1, 1, COLUMNAS - actual.x),
          h: acotar(celda.y - actual.y + 1, 1, 6),
        };
      }

      setValida(libre(disposicion, gesto.id as T, candidata));
      setPrevia({ ...disposicion, [gesto.id]: candidata } as Disposicion<T>);
    },
    [gesto, disposicion, celdaEn],
  );

  /**
   * Qué tarjeta acaba de aterrizar, para que el gesto no termine en seco.
   *
   * Se limpia sola: la clase solo tiene que estar el tiempo que dura la
   * animación. Dejarla puesta haría que la tarjeta volviera a asentarse en cada
   * renderizado siguiente, que es peor que no animar nada.
   */
  const [aterrizando, setAterrizando] = useState<string | null>(null);

  useEffect(() => {
    if (!aterrizando) return;
    const id = setTimeout(() => setAterrizando(null), 260);
    return () => clearTimeout(id);
  }, [aterrizando]);

  const alSoltar = useCallback(() => {
    if (gesto && previa && valida) {
      onCambiar(previa);
      setAterrizando(gesto.id);
    }
    setGesto(null);
    setPrevia(null);
    setValida(true);
  }, [gesto, previa, valida, onCambiar]);

  useEffect(() => {
    if (!gesto) return;
    window.addEventListener("pointermove", alMover);
    window.addEventListener("pointerup", alSoltar);
    return () => {
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSoltar);
    };
  }, [gesto, alMover, alSoltar]);

  /** Teclado: mover y dimensionar sin ratón. Un panel que solo se coloca
   *  arrastrando deja fuera a quien no puede arrastrar. */
  const porTeclado = (id: T, evento: React.KeyboardEvent) => {
    const actual = disposicion[id];
    if (!actual) return;
    const paso = evento.shiftKey ? "tamaño" : "posición";
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = delta[evento.key];
    if (!d) return;
    evento.preventDefault();

    const candidata: Casilla =
      paso === "posición"
        ? { ...actual, x: acotar(actual.x + d[0], 0, COLUMNAS - actual.w), y: Math.max(0, actual.y + d[1]) }
        : {
            ...actual,
            w: acotar(actual.w + d[0], 1, COLUMNAS - actual.x),
            h: acotar(actual.h + d[1], 1, 6),
          };

    if (libre(disposicion, id, candidata)) onCambiar({ ...disposicion, [id]: candidata });
  };

  if (estrecha) {
    const porPosicion = [...orden].sort((a, b) => {
      const ca = vista[a];
      const cb = vista[b];
      if (!ca || !cb) return 0;
      return ca.y - cb.y || ca.x - cb.x;
    });
    return (
      <div className="space-y-3">
        {porPosicion.map((id) => (
          <div key={id}>{children(id)}</div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={contenedor}
      className="relative grid touch-none"
      style={{
        gridTemplateColumns: `repeat(${COLUMNAS}, minmax(0, 1fr))`,
        gridAutoRows: `${ALTO_FILA}px`,
        gap: `${HUECO}px`,
      }}
    >
      {orden.map((id) => {
        const casilla = vista[id];
        if (!casilla) return null;
        const moviendose = gesto?.id === id;

        return (
          <div
            key={id}
            style={{
              gridColumn: `${casilla.x + 1} / span ${casilla.w}`,
              gridRow: `${casilla.y + 1} / span ${casilla.h}`,
            }}
            className={`group/celda relative min-h-0 rounded-2xl transition-shadow duration-150
              ${moviendose ? "z-20" : "z-0"}
              ${moviendose && !valida ? "outline outline-2 outline-danger" : ""}
              ${moviendose && valida ? "outline outline-2 outline-accent" : ""}
              ${/* Levantada mientras está en la mano, y aterriza al soltarla:
                    sin lo primero el arrastre parece que empuja un hueco, y sin
                    lo segundo el gesto termina en un corte seco. */ ""}
              ${moviendose ? "devup-levantada" : ""}
              ${aterrizando === id ? "devup-asienta" : ""}`}
          >
            <div className="h-full min-h-0 overflow-hidden rounded-2xl">{children(id)}</div>

            {editable && (
              <>
                {/* El asa, no la tarjeta entera: dentro hay botones y listas que
                    se desplazan, y arrastrar desde cualquier punto haría
                    imposible usarlos. */}
                <button
                  type="button"
                  aria-label={`Mover ${id}. Flechas para colocar, Mayús y flechas para redimensionar`}
                  onKeyDown={(evento) => porTeclado(id, evento)}
                  onPointerDown={(evento) => {
                    if (evento.button !== 0) return;
                    const celda = celdaEn(evento.clientX, evento.clientY);
                    setGesto({
                      tipo: "mover",
                      id,
                      agarreX: celda.x - casilla.x,
                      agarreY: celda.y - casilla.y,
                    });
                  }}
                  className="absolute -left-1 -top-1 z-10 grid size-6 cursor-grab place-items-center
                    rounded-lg border border-line bg-surface text-faint opacity-0 shadow-sm
                    transition-opacity duration-150 hover:text-ink focus-visible:opacity-100
                    active:cursor-grabbing group-hover/celda:opacity-100"
                >
                  <GripVertical size={13} />
                </button>

                <span
                  role="button"
                  tabIndex={-1}
                  aria-hidden
                  onPointerDown={(evento) => {
                    if (evento.button !== 0) return;
                    setGesto({ tipo: "estirar", id });
                  }}
                  className="absolute -bottom-0.5 -right-0.5 z-10 size-4 cursor-se-resize rounded-br-2xl
                    opacity-0 transition-opacity duration-150 group-hover/celda:opacity-100
                    after:absolute after:bottom-1 after:right-1 after:size-2 after:rounded-sm
                    after:border-b-2 after:border-r-2 after:border-faint"
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
