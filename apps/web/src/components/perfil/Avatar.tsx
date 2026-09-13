"use client";

import { CaraDePersonaje } from "./CaraDePersonaje";
import { useCara } from "@/lib/caras";
import { iniciales } from "@/lib/fechas";

/**
 * La chapa de una persona: su foto, su personaje, o su inicial.
 *
 * POR QUÉ UNA SOLA PIEZA. Antes cada pantalla dibujaba su propia chapa —diez
 * sitios llamando a `iniciales()` con su propio `span` y sus propias clases—,
 * así que la foto que alguien subiera se vería en el sitio que se acordara de
 * pintarla y en ninguno más. Y el orden de preferencia (personaje si lo eligió,
 * si no la foto, si no la inicial) estaría repetido diez veces, esperando a que
 * una copia se quede atrás.
 *
 * AQUÍ NO SE DECIDE ESE ORDEN, y eso es lo importante: lo decide el servidor y
 * esto pinta lo que RECIBE. Si llega una foto, foto; si llega un personaje,
 * personaje; si no llega nada, la inicial. Una pieza que tuviera que recordar
 * la regla sería una copia más de la regla.
 *
 * LA INICIAL NO ES UN ESTADO DE CARGA, es una cara. Mientras la petición viaja
 * se ve la inicial y luego aparece la foto — sin hueco gris, sin parpadeo de
 * esqueleto. Una chapa de veinticuatro píxeles no merece un estado de carga:
 * el «antes» ya es una respuesta correcta.
 */
export function Avatar({
  userId,
  nombre,
  tamano = 24,
  className = "",
}: {
  userId: string | null | undefined;
  /** Para la inicial y para el texto alternativo. */
  nombre: string | null | undefined;
  tamano?: number;
  className?: string;
}) {
  const cara = useCara(userId);
  const texto = nombre?.trim() || "?";

  return (
    <span
      aria-hidden
      title={texto}
      style={{ width: tamano, height: tamano }}
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full border
        border-line-strong bg-raised font-display font-semibold text-muted ${className}`}
    >
      {cara?.tipo === "foto" ? (
        // eslint-disable-next-line @next/next/no-img-element -- la URL viene
        // firmada y caduca; el optimizador de Next no puede con eso.
        <img src={cara.url} alt="" className="size-full object-cover" />
      ) : cara?.tipo === "personaje" ? (
        <CaraDePersonaje look={cara.look} tamano={tamano} />
      ) : (
        // El tamaño de la letra sale del de la chapa: una inicial fija se sale
        // en las pequeñas y se pierde en las grandes.
        <span style={{ fontSize: Math.max(9, Math.round(tamano * 0.38)) }}>{iniciales(texto)}</span>
      )}
    </span>
  );
}
