"use client";

import { useEffect, useRef } from "react";
import {
  TILE,
  drawAvatar,
  drawBubble,
  drawEmote,
  drawWall,
  drawZoneFloor,
} from "@/lib/world/atlas";
import { drawProp } from "@/lib/world/furniture";
import { prop } from "@/lib/world/props";
import type { Avatar } from "@/lib/world/types";

/**
 * Un trozo de DevVerse vivo, en la pantalla de acceso.
 *
 * POR QUÉ ESTÁ AQUÍ. La columna izquierda del acceso tiene un hueco grande en
 * medio —el texto está arriba y las cuatro fichas abajo, con `justify-between`—
 * y ese hueco no dice nada. Lo que sí dice algo es la oficina: es lo único del
 * producto que no se entiende leyéndolo, y en cuanto se ve a alguien caminar
 * hasta una mesa y ponerse a trabajar, se entiende entero.
 *
 * SON LOS MUÑECOS DE VERDAD, NO UN DIBUJO PARECIDO. Se pinta con
 * `drawAvatar`, `drawProp` y `drawZoneFloor` del propio mundo (`lib/world`), así
 * que lo que se ve en el acceso es exactamente lo que hay dentro. Un dibujo
 * imitando el estilo sería una segunda verdad que se separa de la primera en
 * cuanto alguien cambie un sprite — y nadie se acuerda de actualizar la
 * ilustración del login.
 *
 * TODO ES DETERMINISTA, igual que el mundo (ver la cabecera de `rooms.ts`): la
 * coreografía sale del reloj, no de un azar. Dos personas que abren el acceso a
 * la vez ven lo mismo, y una recarga no reparte a la gente de otra manera.
 *
 * LO QUE SE ENSEÑA son las cuatro cosas que se hacen dentro: caminar, sentarse
 * a trabajar, hablar, y saludar a quien pasa. No hay más, y es a propósito: una
 * escena que hace de todo se lee como un salvapantallas.
 */

/** El tamaño de la escena, en casillas. */
const ANCHO = 11;
const ALTO = 6;

/** La vuelta completa de la coreografía. Todo se calcula módulo esto. */
const CICLO_MS = 18_000;

/**
 * Paleta y suelo de la sala.
 *
 * `wood` no es un gusto: `FLOOR_OF` en `rooms.ts` le da parquet al tema
 * `work`, y el propio atlas explica por qué el suelo importa más que los
 * muebles — «un parquet dice “aquí se trabaja” y un damero dice “aquí se
 * descansa” antes de que a nadie le dé tiempo a leer el rótulo». Aquí se quiere
 * decir lo primero.
 */
/**
 * La 3 es la violeta, y se elige por integración, no por gusto: es la paleta de
 * la atmósfera del acceso, así que la sala se apoya en el fondo en vez de
 * pelearse con él. La 2 —la de madera, la que le toca al tema `work`— se probó
 * primero y gritaba: un rectángulo naranja en medio de una pantalla violeta se
 * lee como un banner, no como una ventana al producto.
 */
const PALETA = 3;
const SUELO = "carpet" as const;

type Cuerpo = Avatar;

const cuerpo = (
  body: number,
  hair: number,
  skinTone: number,
  hairTone: number,
  topTone: number,
  bottomTone: number,
): Cuerpo => ({
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
 * Tres cuerpos que se distinguen de lejos.
 *
 * Distintos en complexión y en pelo, no solo en el color de la camiseta: la
 * silueta es lo que el ojo separa a este tamaño, y tres personas iguales de
 * distinto color se leen como la misma repetida.
 */
const QUIENES: Cuerpo[] = [
  cuerpo(0, 1, 3, 2, 3, 6),
  cuerpo(2, 5, 1, 0, 9, 1),
  cuerpo(1, 4, 5, 4, 12, 6),
];

/**
 * Los muebles, en dos grupos, y la razón es la profundidad.
 *
 * El renderizador del mundo ordena todo por su pie en Y; aquí son once casillas
 * y no vale la pena traerse ese ordenador. Con dos grupos basta: lo de la pared
 * se pinta ANTES que la gente y lo de delante DESPUÉS, así quien camina por en
 * medio queda por delante de los escritorios y por detrás de la planta. Con un
 * solo grupo, la gente flotaba por encima de todo.
 */
const MUEBLES_AL_FONDO = [
  prop("whiteboard", 5, 0, { facing: "s", tone: 1 }),
  prop("desk", 2, 1, { facing: "s", tone: 1 }),
  prop("monitor", 2, 1, { facing: "s", tone: 1 }),
  prop("chair", 2, 2, { facing: "n", tone: 5 }),
  prop("desk", 8, 1, { facing: "s", tone: 1 }),
  prop("dualMonitor", 8, 1, { facing: "s", tone: 1 }),
  prop("chair", 8, 2, { facing: "n", tone: 5 }),
];

const MUEBLES_DELANTE = [
  // Solo la planta. Había también una mesita, y se quitó al verla: en una sala
  // de trabajo no cuenta nada, quedaba medio cortada por el muro de delante, y
  // estorbaba el paso de quien cruza — que es la acción que la escena existe
  // para enseñar.
  prop("plantTall", 9, 4, { tone: 4 }),
];

/** Lo que dice quien está sentado, y cuándo. Frases del trabajo, no de relleno. */
const FRASES = ["¿lo subo ya?", "queda uno", "mirando el tablero", "listo"];

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

    const pintar = (t: number): void => {
      const fase = (t % CICLO_MS) / CICLO_MS;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, ANCHO * TILE, ALTO * TILE);

      // La sala: muro al fondo, suelo, y muro delante. Sin los muros esto se
      // leía como una alfombra flotando, no como una habitación — se vio
      // pintándolo. Los laterales cierran la caja.
      for (let x = 0; x < ANCHO; x += 1) drawWall(ctx, x, 0, PALETA, "back");
      for (let y = 1; y < ALTO - 1; y += 1) {
        drawWall(ctx, 0, y, PALETA, "side");
        for (let x = 1; x < ANCHO - 1; x += 1) drawZoneFloor(ctx, x, y, PALETA, SUELO);
        drawWall(ctx, ANCHO - 1, y, PALETA, "side");
      }
      for (let x = 0; x < ANCHO; x += 1) drawWall(ctx, x, ALTO - 1, PALETA, "front");

      for (const pieza of MUEBLES_AL_FONDO) drawProp(ctx, pieza);

      // 1 y 2 · Dos personas trabajando, sentadas a sus mesas y DE ESPALDAS.
      // De espaldas es lo correcto y además es lo que se lee: mirando a su
      // monitor se entiende que trabajan; girados hacia la cámara parecerían
      // posando. La plaza de una silla es su propia casilla, así que se colocan
      // igual que en el mundo: media casilla a la derecha, 0,9 hacia abajo.
      drawAvatar(ctx, 2 * TILE + TILE / 2, 2 * TILE + TILE * 0.9, QUIENES[0]!, "n", false, t, true);
      drawAvatar(ctx, 8 * TILE + TILE / 2, 2 * TILE + TILE * 0.9, QUIENES[2]!, "n", false, t, true);

      // 3 · Alguien cruza la sala, ida y vuelta. El seno da el recorrido sin un
      // contador de estado, y `Math.cos` dice hacia dónde mira: es su derivada,
      // así que el giro cae exactamente en el extremo del paseo.
      const ang = fase * Math.PI * 2;
      const paseo = 5 + Math.sin(ang) * 3.2;
      const haciaLaDerecha = Math.cos(ang) > 0;
      const pieDelPaseo = 3 * TILE + TILE * 0.9;
      drawAvatar(
        ctx,
        paseo * TILE + TILE / 2,
        pieDelPaseo,
        QUIENES[1]!,
        haciaLaDerecha ? "e" : "o",
        true,
        t,
        false,
      );

      for (const pieza of MUEBLES_DELANTE) drawProp(ctx, pieza);

      // El saludo y la frase, al final del todo para que no los tape nadie —
      // igual que en el mundo, donde las burbujas van en la última pasada.
      //
      // Saluda quien está sentada a la derecha cuando el que pasea le llega
      // cerca. Que las dos cosas coincidan es lo que convierte tres figuras
      // sueltas en una oficina: se ven.
      if (paseo > 6.4 && haciaLaDerecha) {
        drawEmote(
          ctx,
          8 * TILE + TILE / 2,
          2 * TILE + TILE * 0.9,
          "wave",
          Math.min(1, (paseo - 6.4) / 1.8),
        );
      }

      // Habla durante un tercio de cada cuarto de vuelta: callada la mayor
      // parte del tiempo, que es como se habla trabajando.
      const cuarto = Math.floor(fase * 4);
      if (fase * 4 - cuarto < 0.34) {
        drawBubble(ctx, 2 * TILE + TILE / 2, 2 * TILE + TILE * 0.9, FRASES[cuarto % FRASES.length]!);
      }
    };

    // Quien pidió no ver movimiento ve la escena quieta, no nada: un fotograma
    // fijo sigue contando qué es DevVerse. `matchMedia` y no una clase de CSS
    // porque esto se dibuja en un lienzo, donde `motion-reduce:` no llega.
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (quieto.matches) {
      pintar(CICLO_MS * 0.18);
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
      aria-hidden
      className={className}
      style={{
        width: `${ANCHO * TILE}px`,
        height: `${ALTO * TILE}px`,
        imageRendering: "pixelated",
        maxWidth: "100%",
      }}
    />
  );
}
