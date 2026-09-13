"use client";

import { useState } from "react";
import type { BoardColumn, Rama } from "@/lib/api";
import { Rotulo } from "@/components/ui/Superficies";

/**
 * La red de trabajo: quién, qué y de qué área, dibujado como una sola cosa.
 *
 * QUÉ ES UN NODO Y QUÉ ES UNA ARISTA, QUE ES LA ÚNICA PREGUNTA QUE IMPORTA.
 * Un grafo vale lo que valgan sus aristas, y las que existen hoy en la base son
 * tres: una tarea tiene responsable (`tasks.assignee_id`), una tarea tiene
 * categorías (`task_tags`) y una tarea está en una columna. Con eso se dibuja
 * persona ↔ tarea ↔ categoría, y eso ya contesta preguntas que hoy no se pueden
 * contestar: qué áreas toca una persona, qué áreas están sin nadie, qué tarea
 * cuelga de dos ramas a la vez.
 *
 * LO QUE NO SE DIBUJA, PORQUE NO EXISTE. No hay arista tarea↔commit,
 * tarea↔mensaje ni tarea↔despliegue. Eso es el grafo con procedencia del
 * estudio de arquitectura, y necesita el registro de actividad. Hasta que
 * exista, esta red enseña de verdad lo que hay y no finge saber más — que es
 * justo lo que separa un mapa útil de una decoración con curvas.
 *
 * TRES COLUMNAS Y NO UNA NUBE. Con treinta tareas, un grafo de fuerzas se
 * convierte en una maraña donde no se distingue nada y hay que arrastrar para
 * leerlo. En capas se lee de un vistazo: a la izquierda quién, en medio qué, a
 * la derecha de qué área. Las curvas hacen el resto.
 *
 * SIN LIBRERÍA DE GRAFOS, por el mismo criterio que el tablero no trajo una de
 * arrastre: la disposición es determinista —no hay física que simular— y son
 * cien líneas de SVG contra una dependencia y su mantenimiento.
 */

type Nodo = {
  id: string;
  tipo: "persona" | "tarea" | "categoria";
  texto: string;
  x: number;
  y: number;
  /** De qué categorías depende, para saber si se resalta. */
  categorias: string[];
};

type Arista = { de: Nodo; a: Nodo; categorias: string[] };

/**
 * El nodo de «sin rama».
 *
 * Es una cadena y no `null` porque el resto del dibujo trabaja con listas de
 * identificadores, y meter un nulo ahí obligaría a comprobarlo en cada sitio —
 * que es como se cuela el caso que nadie miró.
 */
const SIN_RAMA = "sin-rama";

const ALTO_FILA = 34;
const MARGEN = 28;
const COLUMNAS = { persona: 130, tarea: 470, categoria: 810 };

/**
 * DIBUJA RAMAS, NO ETIQUETAS, y ese cambio no es cosmético.
 *
 * Antes leía `task.tags`, que son las etiquetas de la 0002 —las de cruzar, de
 * muchas a muchas—. Así que una tarea con tres etiquetas salía con tres líneas
 * y la red enseñaba un reparto que no existe en ningún tablero. Ahora lee
 * `task.categoryId`: una tarea cuelga de UNA rama, y el dibujo tiene tantas
 * líneas como decisiones se tomaron de verdad.
 *
 * De paso se gana lo que faltaba: las tareas SIN rama. Con etiquetas eran
 * invisibles —no tener ninguna no dibuja nada— y son justo las que hay que ver.
 */
export function RedDeTrabajo({
  columnas,
  ramas,
  elegidas,
}: {
  columnas: BoardColumn[];
  ramas: Rama[];
  /** Ramas señaladas. Vacío = se ven todas por igual. */
  elegidas: string[];
}) {
  const [encima, setEncima] = useState<string | null>(null);

  // Solo lo que está sin terminar: una red que incluye lo cerrado hace meses
  // enseña el pasado y tapa el presente, que es lo que se viene a mirar.
  const tareas = columnas.filter((c) => !c.isTerminal).flatMap((c) => c.tasks);

  const personas = new Map<string, string>();
  for (const t of tareas) if (t.assigneeId && t.assigneeName) personas.set(t.assigneeId, t.assigneeName);

  const nodosPersona: Nodo[] = [...personas.entries()].map(([id, nombre], i) => ({
    id: `p:${id}`,
    tipo: "persona",
    texto: nombre,
    x: COLUMNAS.persona,
    y: MARGEN + i * ALTO_FILA,
    categorias: tareas
      .filter((t) => t.assigneeId === id)
      .map((t) => t.categoryId ?? SIN_RAMA),
  }));

  const nodosTarea: Nodo[] = tareas.map((t, i) => ({
    id: `t:${t.id}`,
    tipo: "tarea",
    texto: t.title,
    x: COLUMNAS.tarea,
    y: MARGEN + i * ALTO_FILA,
    categorias: [t.categoryId ?? SIN_RAMA],
  }));

  // Solo las ramas que tienen algo sin terminar: una rama vacía en el dibujo es
  // una línea que no lleva a ninguna parte.
  //
  // Y AL FINAL, «sin rama», que es el nodo que más dice. Archivar en una rama no
  // asigna a nadie y clasificar es voluntario, así que lo que nadie clasificó se
  // acumula ahí — y hasta ahora no se veía en ningún sitio.
  const usadas = ramas.filter((r) => tareas.some((t) => t.categoryId === r.id));
  const huerfanas = tareas.some((t) => !t.categoryId);
  const columnaDerecha: { id: string; nombre: string }[] = [
    ...usadas.map((r) => ({ id: r.id, nombre: r.nombre })),
    ...(huerfanas ? [{ id: SIN_RAMA, nombre: "sin rama" }] : []),
  ];
  const nodosCategoria: Nodo[] = columnaDerecha.map((r, i) => ({
    id: `c:${r.id}`,
    tipo: "categoria",
    texto: r.nombre,
    x: COLUMNAS.categoria,
    y: MARGEN + i * ALTO_FILA,
    categorias: [r.id],
  }));

  const aristas: Arista[] = [];
  for (const t of tareas) {
    const nodoT = nodosTarea.find((n) => n.id === `t:${t.id}`)!;
    const suya = t.categoryId ?? SIN_RAMA;
    if (t.assigneeId) {
      const nodoP = nodosPersona.find((n) => n.id === `p:${t.assigneeId}`);
      if (nodoP) aristas.push({ de: nodoP, a: nodoT, categorias: [suya] });
    }
    const nodoC = nodosCategoria.find((n) => n.id === `c:${suya}`);
    if (nodoC) aristas.push({ de: nodoT, a: nodoC, categorias: [suya] });
  }

  const alto =
    MARGEN * 2 +
    Math.max(nodosPersona.length, nodosTarea.length, nodosCategoria.length, 1) * ALTO_FILA;
  const todos = [...nodosPersona, ...nodosTarea, ...nodosCategoria];

  /** Sin selección, todo vale igual. Con selección, lo demás se apaga. */
  const destacado = (cats: string[]) =>
    elegidas.length === 0 || cats.some((c) => elegidas.includes(c));

  if (tareas.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-xs text-faint">
        No hay tareas sin terminar que dibujar. La red enseña lo que está en curso, no lo cerrado.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 940 ${alto}`}
        style={{ minWidth: 700, height: alto }}
        className="w-full"
        role="img"
        aria-label="Red de personas, tareas y ramas de trabajo"
      >
        <g>
          {aristas.map((a, i) => {
            const vivo = destacado(a.categorias);
            const tocada = encima === a.de.id || encima === a.a.id;
            // Curva y no recta: con treinta líneas rectas entre dos columnas no
            // se distingue una de otra. La curva separa los caminos y es lo que
            // hace que esto se lea como una red y no como una tabla con rayas.
            const medio = (a.de.x + a.a.x) / 2;
            return (
              <path
                key={i}
                d={`M ${a.de.x} ${a.de.y} C ${medio} ${a.de.y}, ${medio} ${a.a.y}, ${a.a.x} ${a.a.y}`}
                fill="none"
                stroke={tocada ? "var(--c-accent-bright)" : "var(--c-accent)"}
                strokeWidth={tocada ? 1.6 : 0.9}
                opacity={vivo ? (tocada ? 0.9 : 0.32) : 0.06}
              />
            );
          })}
        </g>

        <g>
          {todos.map((n) => {
            const vivo = destacado(n.categorias);
            const tocado = encima === n.id;
            return (
              <g
                key={n.id}
                opacity={vivo ? 1 : 0.18}
                onMouseEnter={() => setEncima(n.id)}
                onMouseLeave={() => setEncima(null)}
              >
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.tipo === "tarea" ? 4 : 6}
                  fill={COLOR[n.tipo]}
                  stroke={tocado ? "var(--c-accent-bright)" : "transparent"}
                  strokeWidth={2}
                />
                <text
                  x={n.tipo === "categoria" ? n.x + 11 : n.x - 11}
                  y={n.y + 3.5}
                  textAnchor={n.tipo === "categoria" ? "start" : "end"}
                  className="fill-muted font-sans text-[10px]"
                >
                  {/* Se recorta el título: una tarea de cien caracteres taparía
                      la columna de al lado, y para leerla entera está el
                      tablero. Aquí lo que importa es la forma. */}
                  {n.texto.length > 34 ? `${n.texto.slice(0, 33)}…` : n.texto}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-3 px-1">
        <Rotulo>Leyenda</Rotulo>
        {(
          [
            ["persona", "Persona"],
            ["tarea", "Tarea sin terminar"],
            ["categoria", "Categoría"],
          ] as const
        ).map(([tipo, texto]) => (
          <span key={tipo} className="flex items-center gap-1.5 text-[11px] text-faint">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: COLOR[tipo] }}
            />
            {texto}
          </span>
        ))}
      </div>
    </div>
  );
}

const COLOR: Record<Nodo["tipo"], string> = {
  persona: "var(--c-cyan)",
  tarea: "var(--c-accent)",
  categoria: "var(--c-accent-bright)",
};
