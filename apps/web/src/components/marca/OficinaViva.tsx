"use client";

import { useEffect, useRef } from "react";
import { TILE, drawAvatar, drawBubble, drawEmote, drawWall, drawZoneFloor } from "@/lib/world/atlas";
import { drawProp } from "@/lib/world/furniture";
import { prop } from "@/lib/world/props";
import type { Avatar } from "@/lib/world/types";

/**
 * Una oficina de DevVerse trabajando, en el hueco central del acceso.
 *
 * POR QUÉ ESTÁ AQUÍ. Entre la columna de texto y el cuadro del formulario queda
 * el mayor hueco de la pantalla, y no decía nada. Lo que sí dice algo es la
 * oficina: es lo único del producto que no se entiende leyéndolo, y en cuanto se
 * ve a alguien cruzar una sala y sentarse a trabajar, se entiende entero. Es la
 * misma decisión que `Teatro` en la landing —dibujar la tesis en vez de
 * explicarla— con la pieza que le toca a esta pantalla.
 *
 * SON LOS MUÑECOS Y LOS MUEBLES DE VERDAD. Se pinta con `drawAvatar`,
 * `drawProp`, `drawWall` y `drawZoneFloor` del propio mundo (`lib/world`), así
 * que lo que se ve en el acceso es exactamente lo que hay dentro. Una
 * ilustración imitando el estilo sería una segunda verdad que se separa de la
 * primera en cuanto alguien cambie un sprite, y nadie se acuerda de actualizar
 * el dibujo del login. Es el mismo criterio que ya sigue `Companero` en la
 * landing: es el avatar de verdad, no una mascota nueva.
 *
 * TODO ES DETERMINISTA, igual que el mundo (ver la cabecera de `rooms.ts`): la
 * coreografía sale del reloj, no de un azar. Dos personas que abren el acceso a
 * la vez ven lo mismo, y recargar no reparte a la gente de otra manera.
 *
 * LO QUE SE ENSEÑA son las cosas que se hacen dentro y nada más: trabajar en tu
 * mesa, reunirse en la mesa grande, cruzar la sala, hablar y saludar a quien
 * pasa. Una escena que además hiciera cosas raras se leería como un
 * salvapantallas.
 */

/**
 * El tamaño, en casillas, y es VERTICAL a propósito.
 *
 * El hueco que llena es una franja alta y estrecha —lo que queda entre la
 * columna de texto y el cuadro de acceso, de arriba abajo—, así que una sala
 * ancha desperdiciaba la mitad. Se probó con trece por nueve y ocupaba una
 * banda en medio dejando aire arriba y abajo; nueve por doce llena la franja.
 *
 * Y una sala honda tiene sentido dentro del mundo: los puestos contra el muro
 * del fondo, la mesa de reunión en medio, y la zona de estar delante.
 */
const ANCHO = 9;
const ALTO = 12;

/** La vuelta completa de la coreografía. Todo se calcula módulo esto. */
const CICLO_MS = 22_000;

/**
 * Paleta y suelo.
 *
 * La 3 es la violeta, y se elige por integración: es la paleta de la atmósfera
 * del acceso, así que la sala se apoya en el fondo en vez de pelearse con él. La
 * 2 —la de madera, la que le toca al tema `work`— se probó primero y gritaba: un
 * rectángulo naranja en una pantalla violeta se lee como un banner, no como una
 * ventana al producto.
 */
const PALETA = 3;
const SUELO = "carpet" as const;

const cuerpo = (
  body: number,
  hair: number,
  skinTone: number,
  hairTone: number,
  topTone: number,
  bottomTone: number,
): Avatar => ({
  body,
  hair,
  top: 0,
  bottom: 0,
  skinTone,
  hairTone,
  topTone,
  bottomTone,
  hat: 0,
  glasses: 0,
  beard: 0,
  shoes: 0,
  hatTone: 0,
  shoesTone: 7,
});

/**
 * Seis cuerpos que se distinguen de lejos.
 *
 * Distintos en complexión y en pelo, no solo en el color de la camiseta: a este
 * tamaño la silueta es lo que el ojo separa, y seis personas iguales de distinto
 * color se leen como la misma repetida seis veces.
 */
const QUIENES: Avatar[] = [
  cuerpo(0, 1, 3, 2, 3, 6),
  cuerpo(2, 5, 1, 0, 9, 1),
  cuerpo(1, 4, 5, 4, 12, 6),
  cuerpo(0, 3, 8, 5, 6, 7),
  cuerpo(2, 0, 2, 1, 1, 2),
  cuerpo(1, 2, 10, 3, 14, 1),
];

/**
 * Lo del fondo y lo de delante, separados por el orden de dibujo.
 *
 * El renderizador del mundo ordena todo por su pie en Y; aquí son trece
 * casillas y no vale la pena traerse ese ordenador. Con dos grupos basta: lo del
 * fondo antes de la gente y lo de delante después, así quien cruza queda por
 * delante de los escritorios y por detrás de las plantas. Con un solo grupo, la
 * gente flotaba por encima de todo.
 */
const AL_FONDO = [
  prop("window", 2, 0, { facing: "s" }),
  prop("whiteboard", 4, 0, { facing: "s", tone: 1 }),
  prop("window", 6, 0, { facing: "s" }),

  // Los tres puestos, contra el muro del fondo, con su silla por delante.
  prop("desk", 1, 1, { facing: "s", tone: 1 }),
  prop("monitor", 1, 1, { facing: "s", tone: 1 }),
  prop("chair", 1, 2, { facing: "n", tone: 5 }),

  prop("desk", 4, 1, { facing: "s", tone: 1 }),
  prop("dualMonitor", 4, 1, { facing: "s", tone: 1 }),
  prop("chair", 4, 2, { facing: "n", tone: 5 }),

  prop("desk", 7, 1, { facing: "s", tone: 1 }),
  prop("monitor", 7, 1, { facing: "s", tone: 1 }),
  prop("chair", 7, 2, { facing: "n", tone: 5 }),

  prop("bookshelf", 7, 4, { facing: "s", tone: 2 }),

  // La mesa de reunión, en el medio de la sala.
  prop("meetingTable", 4, 5, { facing: "s", tone: 2 }),
  prop("chair", 3, 5, { facing: "e", tone: 3 }),
  prop("chair", 5, 5, { facing: "o", tone: 3 }),

  // La zona de estar, delante.
  // Tono 7 de `FABRIC`, el gris azulado. Dos intentos antes: el 4 es lila y
  // salía magenta contra el violeta del fondo —lo primero que veía el ojo era
  // un sofá—, y el 10 dio la vuelta al verde menta, porque `FABRIC` solo tiene
  // OCHO entradas y el índice se calcula con módulo. Los dos se vieron
  // pintándolos, no leyendo la lista.
  prop("sofa", 2, 8, { facing: "s", tone: 7 }),
  prop("coffeeTable", 5, 8, { tone: 2 }),
];

const DELANTE = [prop("plantTall", 7, 9, { tone: 4 }), prop("plant", 1, 10, { tone: 6 })];

/**
 * Quién está sentado dónde, y mirando a dónde.
 *
 * La plaza de una silla es su propia casilla, así que se colocan igual que en el
 * mundo: media casilla a la derecha y 0,9 hacia abajo.
 */
const SENTADOS: { x: number; y: number; facing: "n" | "s" | "e" | "o"; quien: number }[] = [
  // De espaldas, mirando su monitor. De espaldas es lo correcto y además es lo
  // que se lee: girados hacia la cámara parecerían posando, no trabajando.
  { x: 1, y: 2, facing: "n", quien: 0 },
  { x: 4, y: 2, facing: "n", quien: 2 },
  { x: 7, y: 2, facing: "n", quien: 4 },
  // En la mesa de reunión, mirándose entre ellos.
  { x: 3, y: 5, facing: "e", quien: 3 },
  { x: 5, y: 5, facing: "o", quien: 5 },
];

/** Lo que se dice, y quién lo dice. Frases de trabajo, no de relleno. */
const CONVERSACION: { sentado: number; frase: string }[] = [
  { sentado: 3, frase: "¿lo subo ya?" },
  { sentado: 0, frase: "queda uno" },
  { sentado: 4, frase: "míralo en el tablero" },
  { sentado: 1, frase: "listo, pasa a revisión" },
];

export function OficinaViva({ className }: { className?: string }) {
  const lienzo = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = lienzo.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // El lienzo se dimensiona en píxeles reales del dispositivo. Sin esto, en
    // una pantalla de densidad doble el arte de píxel sale borroso — y el
    // desenfoque es lo primero que se nota en este estilo.
    const ratio = window.devicePixelRatio || 1;
    canvas.width = ANCHO * TILE * ratio;
    canvas.height = ALTO * TILE * ratio;

    const pie = (y: number) => y * TILE + TILE * 0.9;
    const centro = (x: number) => x * TILE + TILE / 2;

    const pintar = (t: number): void => {
      const fase = (t % CICLO_MS) / CICLO_MS;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, ANCHO * TILE, ALTO * TILE);

      // La sala: muro al fondo, suelo entre laterales, y antepecho delante. Sin
      // los muros esto se leía como una alfombra flotando, no como una
      // habitación — se vio pintándolo, no leyéndolo.
      for (let x = 0; x < ANCHO; x += 1) drawWall(ctx, x, 0, PALETA, "back");
      for (let y = 1; y < ALTO - 1; y += 1) {
        drawWall(ctx, 0, y, PALETA, "side");
        for (let x = 1; x < ANCHO - 1; x += 1) drawZoneFloor(ctx, x, y, PALETA, SUELO);
        drawWall(ctx, ANCHO - 1, y, PALETA, "side");
      }
      for (let x = 0; x < ANCHO; x += 1) drawWall(ctx, x, ALTO - 1, PALETA, "front");

      for (const pieza of AL_FONDO) drawProp(ctx, pieza);

      for (const s of SENTADOS) {
        drawAvatar(ctx, centro(s.x), pie(s.y), QUIENES[s.quien]!, s.facing, false, t, true);
      }

      // Alguien cruza la sala de lado a lado, ida y vuelta. El seno da el
      // recorrido sin un contador de estado, y el coseno dice hacia dónde mira:
      // es su derivada, así que el giro cae exactamente en el extremo del paseo,
      // no antes ni después.
      const ang = fase * Math.PI * 2;
      const paseo = 4 + Math.sin(ang) * 2.6;
      const haciaLaDerecha = Math.cos(ang) > 0;
      drawAvatar(
        ctx,
        centro(paseo),
        pie(7),
        QUIENES[1]!,
        haciaLaDerecha ? "e" : "o",
        true,
        t,
        false,
      );

      for (const pieza of DELANTE) drawProp(ctx, pieza);

      // El saludo y las frases, al final del todo para que no los tape nadie —
      // igual que en el mundo, donde las burbujas van en la última pasada.

      // Saluda quien está en el sofá cuando el que pasea le llega cerca. Que las
      // dos cosas coincidan es lo que convierte seis figuras sueltas en una
      // oficina: se ven entre ellas.
      if (paseo < 2.6 && !haciaLaDerecha) {
        drawEmote(ctx, centro(2), pie(8), "wave", Math.min(1, (2.6 - paseo) / 1.4));
      }

      // Se habla un tercio de cada turno, y habla uno distinto cada vez:
      // callados la mayor parte del tiempo, que es como se habla trabajando, y
      // por turnos, que es lo que hace que parezca una conversación y no un
      // cartel.
      const turno = Math.floor(fase * CONVERSACION.length);
      if (fase * CONVERSACION.length - turno < 0.34) {
        const dice = CONVERSACION[turno % CONVERSACION.length]!;
        const quien = SENTADOS[dice.sentado]!;
        drawBubble(ctx, centro(quien.x), pie(quien.y), dice.frase);
      }
    };

    // Quien pidió no ver movimiento ve la escena quieta, no nada: un fotograma
    // fijo sigue contando qué es DevVerse. `matchMedia` y no una clase de CSS
    // porque esto se dibuja en un lienzo, donde `motion-reduce:` no llega.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      pintar(CICLO_MS * 0.16);
      return;
    }

    let cuadro = 0;
    const bucle = (ahora: number): void => {
      // Parado en una pestaña de fondo. Es la pantalla de acceso: puede quedarse
      // abierta media hora en una pestaña que nadie mira, y no va a gastar
      // batería dibujando para nadie.
      if (!document.hidden) pintar(ahora);
      cuadro = requestAnimationFrame(bucle);
    };
    cuadro = requestAnimationFrame(bucle);
    return () => cancelAnimationFrame(cuadro);
  }, []);

  return (
    <canvas
      ref={lienzo}
      // Decorativo de verdad: lo que cuenta ya está escrito al lado en texto,
      // así que anunciarlo a un lector de pantalla sería repetirlo como ruido.
      // Es la misma regla que ya sigue `Companero` en la landing.
      aria-hidden
      className={className}
      style={{
        // EL ANCHO, MEDIDO EN EL NAVEGADOR Y NO ESTIMADO. El hueco que llena
        // no crece como la ventana: crece MÁS DEPRISA, porque el texto de la
        // izquierda está topado a `max-w-md` y el cuadro de acceso a `max-w-sm`,
        // así que todo lo que gana la ventana se lo queda el aire de en medio.
        //
        // Medido: a 1280 el hueco es de 272 px (el texto acaba en 496, el
        // formulario empieza en 768) y a 1500 ya es de 437. Un `22vw` recto
        // daba 282 px a 1280 — se metía veintidós píxeles en la columna del
        // texto— y se quedaba corto a 1500. De ahí la resta: arranca pequeña
        // donde el hueco es estrecho y crece al doble de velocidad.
        width: "min(360px, max(224px, 40vw - 310px))",
        // El tope por altura existe porque la franja es alta pero la ventana
        // puede no serlo: en un portátil de 1500 × 700 una sala de 480 px de
        // alto se saldría por arriba y por abajo.
        maxHeight: "72vh",
        aspectRatio: `${ANCHO} / ${ALTO}`,
        imageRendering: "pixelated",
      }}
    />
  );
}
