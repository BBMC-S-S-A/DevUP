"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardColumn, Rama } from "@/lib/api";
import { Rotulo } from "@/components/ui/Superficies";
import { paso, type AristaFisica, type NodoFisico } from "./fisica";

/**
 * La red de trabajo: quién, qué y de qué área, dibujado como una sola cosa —
 * y ahora un grafo de verdad, con física, arrastre y zoom, como el de
 * Obsidian.
 *
 * QUÉ ES UN NODO Y QUÉ ES UNA ARISTA, QUE ES LA ÚNICA PREGUNTA QUE IMPORTA.
 * Un grafo vale lo que valgan sus aristas, y las que existen hoy en la base son
 * dos: una tarea tiene responsable (`tasks.assignee_id`) y una tarea tiene una
 * rama (`tasks.category_id`). Con eso se dibuja persona ↔ tarea ↔ categoría, y
 * eso ya contesta preguntas que hoy no se pueden contestar: qué áreas toca una
 * persona, qué áreas están sin nadie, qué tarea cuelga de qué rama.
 *
 * LO QUE NO SE DIBUJA, PORQUE NO EXISTE. No hay arista tarea↔commit,
 * tarea↔mensaje ni tarea↔despliegue. Eso es el grafo con procedencia del
 * estudio de arquitectura, y necesita el registro de actividad. Hasta que
 * exista, esta red enseña de verdad lo que hay y no finge saber más — que es
 * justo lo que separa un mapa útil de una decoración con curvas.
 *
 * FUERZAS Y NO COLUMNAS FIJAS. La versión anterior ponía a cada tipo en su
 * columna, determinista, porque parecía la única forma de que no fuera una
 * maraña. Se pidió que fuera de verdad como Obsidian —nodos libres,
 * arrastrables, con zoom— y la física de `fisica.ts` hace exactamente eso: se
 * ordena sola alrededor de sus enlaces, y quien lo mira puede reordenarlo a
 * mano cuando quiera algo distinto de lo que la física decidió.
 *
 * LAS POSICIONES VIVEN EN UNA REF, NO EN ESTADO. Se actualizan sesenta veces
 * por segundo mientras la física está caliente, y pasar eso por `setState` de
 * React sería sesenta re-render completos por segundo. Un contador de
 * cuadros en estado fuerza el redibujado sin que React compare las posiciones
 * una por una.
 */

type Tipo = "persona" | "tarea" | "categoria";

type Nodo = { id: string; tipo: Tipo; texto: string; categorias: string[] };
type Arista = { deId: string; aId: string; categorias: string[] };

const SIN_RAMA = "sin-rama";
const ANCHO = 940;
const ALTO = 560;
const LONGITUD_ENLACE: Record<Tipo, number> = { persona: 90, tarea: 90, categoria: 90 };

const COLOR: Record<Tipo, string> = {
  persona: "var(--c-cyan)",
  tarea: "var(--c-accent)",
  categoria: "var(--c-accent-bright)",
};
const RADIO: Record<Tipo, number> = { persona: 7, tarea: 4.5, categoria: 8 };

export function RedDeTrabajo({
  columnas,
  ramas,
  elegidas,
}: {
  columnas: BoardColumn[];
  ramas: Rama[];
  /** Ramas señaladas desde la lista de fuera. Vacío = se ven todas por igual. */
  elegidas: string[];
}) {
  // Solo lo que está sin terminar: una red que incluye lo cerrado hace meses
  // enseña el pasado y tapa el presente, que es lo que se viene a mirar.
  const tareas = useMemo(
    () => columnas.filter((c) => !c.isTerminal).flatMap((c) => c.tasks),
    [columnas],
  );

  const { nodos, aristas } = useMemo(() => {
    const personas = new Map<string, string>();
    for (const t of tareas) if (t.assigneeId && t.assigneeName) personas.set(t.assigneeId, t.assigneeName);

    const nodosPersona: Nodo[] = [...personas.entries()].map(([id, nombre]) => ({
      id: `p:${id}`,
      tipo: "persona",
      texto: nombre,
      categorias: tareas.filter((t) => t.assigneeId === id).map((t) => t.categoryId ?? SIN_RAMA),
    }));

    const nodosTarea: Nodo[] = tareas.map((t) => ({
      id: `t:${t.id}`,
      tipo: "tarea",
      texto: t.title,
      categorias: [t.categoryId ?? SIN_RAMA],
    }));

    // Solo las ramas con algo sin terminar, y al final «sin rama» — el nodo
    // que más dice, porque hasta ahora lo que nadie clasificó no se veía en
    // ningún sitio.
    const usadas = ramas.filter((r) => tareas.some((t) => t.categoryId === r.id));
    const huerfanas = tareas.some((t) => !t.categoryId);
    const columnaCategoria: { id: string; nombre: string }[] = [
      ...usadas.map((r) => ({ id: r.id, nombre: r.nombre })),
      ...(huerfanas ? [{ id: SIN_RAMA, nombre: "sin rama" }] : []),
    ];
    const nodosCategoria: Nodo[] = columnaCategoria.map((r) => ({
      id: `c:${r.id}`,
      tipo: "categoria",
      texto: r.nombre,
      categorias: [r.id],
    }));

    const aristas: Arista[] = [];
    for (const t of tareas) {
      const suya = t.categoryId ?? SIN_RAMA;
      if (t.assigneeId && personas.has(t.assigneeId)) {
        aristas.push({ deId: `p:${t.assigneeId}`, aId: `t:${t.id}`, categorias: [suya] });
      }
      if (columnaCategoria.some((c) => c.id === suya)) {
        aristas.push({ deId: `t:${t.id}`, aId: `c:${suya}`, categorias: [suya] });
      }
    }

    return { nodos: [...nodosPersona, ...nodosTarea, ...nodosCategoria], aristas };
  }, [tareas, ramas]);

  return (
    <GrafoFisico
      nodos={nodos}
      aristas={aristas}
      elegidas={elegidas}
      vacio={tareas.length === 0}
    />
  );
}

function GrafoFisico({
  nodos,
  aristas,
  elegidas,
  vacio,
}: {
  nodos: Nodo[];
  aristas: Arista[];
  elegidas: string[];
  vacio: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  // Posiciones y velocidades: persisten por id entre renderizados, para que
  // una tarea que ya se movió no salte al centro solo porque llegó un dato
  // nuevo del tablero. Lo que desaparece se olvida; lo que llega, entra cerca
  // del centro con un empujón al azar para no nacer todos en el mismo punto.
  const fisicaRef = useRef(new Map<string, NodoFisico>());
  const [cuadro, setCuadro] = useState(0);
  const alphaRef = useRef(1);
  const [vista, setVista] = useState({ x: 0, y: 0, k: 1 });
  const vistaRef = useRef(vista);
  vistaRef.current = vista;

  const aristasFisicas: AristaFisica[] = useMemo(
    () =>
      aristas.map((a) => {
        const tipoDe = a.deId.startsWith("p:") ? "persona" : a.deId.startsWith("t:") ? "tarea" : "categoria";
        return { deId: a.deId, aId: a.aId, longitud: LONGITUD_ENLACE[tipoDe] };
      }),
    [aristas],
  );

  // Sincroniza el mapa de físicas con los nodos actuales, sin perder lo que
  // ya había en marcha.
  useEffect(() => {
    const mapa = fisicaRef.current;
    const vivos = new Set(nodos.map((n) => n.id));
    for (const id of [...mapa.keys()]) if (!vivos.has(id)) mapa.delete(id);
    for (const n of nodos) {
      if (!mapa.has(n.id)) {
        const angulo = Math.random() * Math.PI * 2;
        const radio = 60 + Math.random() * 120;
        mapa.set(n.id, {
          id: n.id,
          x: ANCHO / 2 + Math.cos(angulo) * radio,
          y: ALTO / 2 + Math.sin(angulo) * radio,
          vx: 0,
          vy: 0,
        });
      }
    }
    alphaRef.current = Math.max(alphaRef.current, 0.6);
  }, [nodos]);

  // El bucle de física: corre mientras `alpha` no se haya enfriado. Se
  // detiene solo — no hay ninguna razón para gastar CPU dibujando un grafo
  // que ya se quedó quieto.
  useEffect(() => {
    let vivo = true;
    let cuadroId: number;
    const tocar = () => {
      if (!vivo) return;
      if (alphaRef.current > 0.006) {
        paso(
          [...fisicaRef.current.values()],
          aristasFisicas,
          alphaRef.current,
          ANCHO / 2,
          ALTO / 2,
        );
        alphaRef.current *= 0.994;
        setCuadro((c) => c + 1);
      }
      cuadroId = requestAnimationFrame(tocar);
    };
    cuadroId = requestAnimationFrame(tocar);
    return () => {
      vivo = false;
      cancelAnimationFrame(cuadroId);
    };
  }, [aristasFisicas]);

  // --- Interacción: arrastrar un nodo, o el lienzo, y hacer zoom -----------

  const [foco, setFoco] = useState<string | null>(null);
  const arrastre = useRef<{
    id: string | null; // null = arrastrando el lienzo
    inicioX: number;
    inicioY: number;
    moviό: boolean;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  /** De coordenadas de pantalla a coordenadas del mundo, deshaciendo pan y zoom. */
  function aMundo(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * ANCHO;
    const svgY = ((clientY - rect.top) / rect.height) * ALTO;
    const v = vistaRef.current;
    return { x: (svgX - v.x) / v.k, y: (svgY - v.y) / v.k };
  }

  function bajarPuntero(evento: React.PointerEvent, nodoId: string | null) {
    // `setPointerCapture` puede tirar `NotFoundError` si el puntero ya no
    // está activo cuando llega —un clic rapidísimo, un evento sintético de
    // pruebas—. Capturar es una mejora para que el arrastre no se corte al
    // salir del elemento, no una condición para que el arrastre funcione:
    // sin captura, sigue funcionando, solo un pelín menos robusto en el borde.
    try {
      (evento.target as Element).setPointerCapture(evento.pointerId);
    } catch {
      // no pasa nada: se sigue sin la captura.
    }
    const mundo = aMundo(evento.clientX, evento.clientY);
    const nodo = nodoId ? fisicaRef.current.get(nodoId) : null;
    arrastre.current = {
      id: nodoId,
      inicioX: evento.clientX,
      inicioY: evento.clientY,
      moviό: false,
      offsetX: nodo ? mundo.x - nodo.x : 0,
      offsetY: nodo ? mundo.y - nodo.y : 0,
    };
  }

  function moverPuntero(evento: React.PointerEvent) {
    const est = arrastre.current;
    if (!est) return;
    const dx = evento.clientX - est.inicioX;
    const dy = evento.clientY - est.inicioY;
    if (Math.hypot(dx, dy) > 3) est.moviό = true;

    if (est.id) {
      const nodo = fisicaRef.current.get(est.id);
      if (!nodo) return;
      const mundo = aMundo(evento.clientX, evento.clientY);
      nodo.fx = mundo.x - est.offsetX;
      nodo.fy = mundo.y - est.offsetY;
      alphaRef.current = Math.max(alphaRef.current, 0.3);
      setCuadro((c) => c + 1);
    } else {
      // Arrastrar el lienzo: el desplazamiento en píxeles de pantalla se
      // pasa a unidades del viewBox, y eso es directamente el paneo — el
      // paneo vive en el mismo espacio que esas unidades, antes del zoom.
      const rect = svgRef.current!.getBoundingClientRect();
      setVista((v) => ({
        ...v,
        x: v.x + (dx / rect.width) * ANCHO,
        y: v.y + (dy / rect.height) * ALTO,
      }));
      arrastre.current = { ...est, inicioX: evento.clientX, inicioY: evento.clientY };
    }
  }

  function subirPuntero() {
    const est = arrastre.current;
    if (est?.id) {
      const nodo = fisicaRef.current.get(est.id);
      if (nodo) {
        nodo.fx = undefined;
        nodo.fy = undefined;
      }
      alphaRef.current = Math.max(alphaRef.current, 0.3);
      // Un clic sin apenas movimiento es un clic: enfoca el nodo. Uno que sí
      // se movió fue un arrastre, y no cambia el foco.
      if (!est.moviό) setFoco((f) => (f === est.id ? null : est.id));
    } else if (!est?.moviό) {
      setFoco(null);
    }
    arrastre.current = null;
  }

  /**
   * NO ES `onWheel` DE REACT A PROPÓSITO. React registra su listener de
   * rueda como pasivo, y un pasivo no puede cancelar el scroll —
   * `preventDefault` no hace nada y el navegador desplaza la página entera
   * por debajo del grafo en vez de solo hacer zoom en él. Un listener nativo
   * con `{ passive: false }` es la única forma de que la rueda sea de verdad
   * del grafo y no de la página.
   */
  useEffect(() => {
    const nodo = svgRef.current;
    if (!nodo) return;
    const conRueda = (evento: WheelEvent) => {
      evento.preventDefault();
      const rect = nodo.getBoundingClientRect();
      const svgX = ((evento.clientX - rect.left) / rect.width) * ANCHO;
      const svgY = ((evento.clientY - rect.top) / rect.height) * ALTO;
      const v = vistaRef.current;
      const factor = evento.deltaY < 0 ? 1.12 : 1 / 1.12;
      // Hasta 12x: con nombres largos y varias tareas, 3x se quedaba corto
      // para leer un nodo concreto de cerca sin que el resto lo tape.
      const k = Math.min(12, Math.max(0.2, v.k * factor));
      // El punto del mundo bajo el cursor se queda bajo el cursor: sin esto,
      // la rueda hace que el dibujo se escape en vez de acercarse a lo que
      // se mira.
      const wx = (svgX - v.x) / v.k;
      const wy = (svgY - v.y) / v.k;
      setVista({ k, x: svgX - wx * k, y: svgY - wy * k });
    };
    nodo.addEventListener("wheel", conRueda, { passive: false });
    return () => nodo.removeEventListener("wheel", conRueda);
  }, []);

  const conectados = useMemo(() => {
    if (!foco) return null;
    const set = new Set<string>([foco]);
    for (const a of aristas) {
      if (a.deId === foco) set.add(a.aId);
      if (a.aId === foco) set.add(a.deId);
    }
    return set;
  }, [foco, aristas]);

  const vivoCategoria = (cats: string[]) => elegidas.length === 0 || cats.some((c) => elegidas.includes(c));
  const vivoNodo = (n: Nodo) => vivoCategoria(n.categorias) && (!conectados || conectados.has(n.id));
  const vivoArista = (a: Arista) =>
    vivoCategoria(a.categorias) && (!conectados || (a.deId === foco || a.aId === foco));

  if (vacio) {
    return (
      <p className="px-1 py-8 text-center text-xs text-faint">
        No hay tareas sin terminar que dibujar. La red enseña lo que está en curso, no lo cerrado.
      </p>
    );
  }

  void cuadro; // se lee solo para forzar el redibujado; el valor no importa.
  const posiciones = fisicaRef.current;

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        className="w-full touch-none select-none rounded-xl border border-line bg-canvas/30"
        style={{ height: ALTO * 0.72, cursor: arrastre.current?.id ? "grabbing" : "grab" }}
        role="img"
        aria-label="Red de personas, tareas y ramas de trabajo"
        onPointerDown={(e) => bajarPuntero(e, null)}
        onPointerMove={moverPuntero}
        onPointerUp={subirPuntero}
        onPointerLeave={subirPuntero}
      >
        <g transform={`translate(${vista.x} ${vista.y}) scale(${vista.k})`}>
          <g>
            {aristas.map((a, i) => {
              const de = posiciones.get(a.deId);
              const al = posiciones.get(a.aId);
              if (!de || !al) return null;
              const vivo = vivoArista(a);
              const tocada = foco === a.deId || foco === a.aId;
              return (
                <line
                  key={i}
                  x1={de.x}
                  y1={de.y}
                  x2={al.x}
                  y2={al.y}
                  stroke={tocada ? "var(--c-accent-bright)" : "var(--c-accent)"}
                  strokeWidth={(tocada ? 1.4 : 0.8) / vista.k}
                  opacity={vivo ? (tocada ? 0.85 : 0.3) : 0.05}
                />
              );
            })}
          </g>

          <g>
            {nodos.map((n) => {
              const p = posiciones.get(n.id);
              if (!p) return null;
              const vivo = vivoNodo(n);
              const enFoco = foco === n.id;
              return (
                <g
                  key={n.id}
                  opacity={vivo ? 1 : 0.15}
                  className="cursor-pointer"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    bajarPuntero(e, n.id);
                  }}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={RADIO[n.tipo] / vista.k}
                    fill={COLOR[n.tipo]}
                    stroke={enFoco ? "var(--c-accent-bright)" : "transparent"}
                    strokeWidth={2 / vista.k}
                  />
                  <text
                    x={p.x}
                    y={p.y + RADIO[n.tipo] / vista.k + 8 / vista.k}
                    textAnchor="middle"
                    fontSize={9 / vista.k}
                    className="fill-muted font-sans"
                  >
                    {/* Se recorta el título: uno larguísimo taparía media
                        pantalla, y para leerlo entero está el tablero. Aquí
                        lo que importa es la forma. */}
                    {n.texto.length > 26 ? `${n.texto.slice(0, 25)}…` : n.texto}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex flex-wrap items-center gap-3">
          <Rotulo>Leyenda</Rotulo>
          {(
            [
              ["persona", "Persona"],
              ["tarea", "Tarea sin terminar"],
              ["categoria", "Categoría"],
            ] as const
          ).map(([tipo, texto]) => (
            <span key={tipo} className="flex items-center gap-1.5 text-[11px] text-faint">
              <span aria-hidden className="size-2 rounded-full" style={{ background: COLOR[tipo] }} />
              {texto}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-faint">
          Arrastra para mover, rueda para zoom, clic en un nodo para aislarlo.
        </p>
      </div>
    </div>
  );
}
