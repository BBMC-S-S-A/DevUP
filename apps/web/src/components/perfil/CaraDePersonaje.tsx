"use client";

import { useEffect, useRef } from "react";
import type { AspectoDePersonaje } from "@/lib/api";
import { drawAvatar } from "@/lib/world/atlas";

/**
 * El personaje de DevVerse, dibujado del cuello para arriba.
 *
 * SE DIBUJA, NO SE GUARDA COMO IMAGEN. El personaje son dieciséis números y el
 * navegador ya sabe pintarlos: es el mismo `drawAvatar` con el que se pinta el
 * mundo. Guardar un PNG obligaría a regenerarlo cada vez que alguien se cambia
 * el gorro, y el día que se olvide regenerarlo la cara se queda vieja sin que
 * nada falle. Dibujarlo siempre no puede quedarse viejo.
 *
 * DE FRENTE Y QUIETO, a propósito. Es un retrato, no la sala: de perfil no se le
 * ve la cara, y animar el paso en una chapa de veinticuatro píxeles sería un
 * temblor, no un andar.
 *
 * SE PINTA A ESCALA 1 Y LUEGO SE AMPLÍA CON CSS. El atlas está hecho de
 * rectángulos de un píxel; ampliarlo dentro del lienzo los dejaría borrosos
 * porque el navegador suaviza al escalar. Con `image-rendering: pixelated`
 * sobre el elemento, el píxel se ve como píxel — que es como está dibujado.
 *
 * ESTE FICHERO NO ESTÁ EN `components/world/`, y no es un descuido: lee el
 * atlas del mundo pero no forma parte de él. Vive donde vive el resto de la
 * identidad de una persona, que es de donde lo va a usar todo lo demás.
 */

/** El lienzo interno. Alto de sobra: el cuerpo más alto del catálogo mide 40. */
const ANCHO = 32;
const ALTO = 44;

/**
 * Qué trozo se enseña.
 *
 * `drawAvatar` apoya los pies en `(x, y)` y el cuerpo mide entre 37 y 40 hacia
 * arriba, así que la cabeza queda arriba del todo. Se recorta ahí: el busto
 * llena la chapa y se reconoce a quién es, que es para lo que sirve. Un cuerpo
 * entero dentro de un círculo de veinticuatro píxeles es una mancha.
 */
const RECORTE = { x: 3, y: 0, ancho: 26, alto: 26 };

export function CaraDePersonaje({
  look,
  tamano = 24,
  className = "",
}: {
  look: AspectoDePersonaje;
  tamano?: number;
  className?: string;
}) {
  const lienzo = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = lienzo.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Un lienzo aparte para dibujar el cuerpo entero y quedarnos con el busto.
    // Dibujar directamente en el visible con desplazamiento negativo también
    // valdría, pero deja el recorte repartido entre dos coordenadas y cuesta
    // más leerlo que este trozo de más.
    const completo = document.createElement("canvas");
    completo.width = ANCHO;
    completo.height = ALTO;
    const fondo = completo.getContext("2d");
    if (!fondo) return;

    drawAvatar(fondo, ANCHO / 2, ALTO - 2, look, "s", false, 0, false);

    ctx.clearRect(0, 0, RECORTE.ancho, RECORTE.alto);
    ctx.drawImage(
      completo,
      RECORTE.x,
      RECORTE.y,
      RECORTE.ancho,
      RECORTE.alto,
      0,
      0,
      RECORTE.ancho,
      RECORTE.alto,
    );
    // `look` entero en las dependencias y no por campos: son catorce, y
    // enumerarlos invita a olvidar el que se añada mañana.
  }, [look]);

  return (
    <canvas
      ref={lienzo}
      width={RECORTE.ancho}
      height={RECORTE.alto}
      aria-hidden
      className={`size-full ${className}`}
      style={{ imageRendering: "pixelated", width: tamano, height: tamano }}
    />
  );
}
