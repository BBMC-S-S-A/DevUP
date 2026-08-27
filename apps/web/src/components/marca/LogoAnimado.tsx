import { CAJA_D, CONTORNO_D } from "./contorno-d";

/**
 * La marca encendiéndose: una luz morada recorre el contorno de la D.
 *
 * Viene del proyecto de diseño «Loading animation with purple light» y se
 * reimplementa aquí sobre el sistema propio, no se incrusta. Tres razones, y la
 * última es la que decide:
 *
 *  · El original monta un lienzo de composición con su propio reloj y un
 *    `requestAnimationFrame` permanente. Esto vive en el acceso, la primera
 *    pantalla que ve alguien: un temporizador a 60 fps por una decoración no
 *    debe competir con el formulario.
 *  · El original pinta la luz ENCIMA de un PNG del logo. Aquí el contorno se
 *    basta solo, así que es vectorial: nítido a cualquier tamaño y coloreable
 *    con el acento del tema en vez de con un color quemado en un archivo.
 *  · Y así respeta `prefers-reduced-motion`, que en el lienzo no existía.
 *
 * Lo que NO cambia es el movimiento, que es lo que se pidió: los mismos tres
 * tiempos, la misma estela con cabeza de cometa, la misma respiración. Los
 * fotogramas viven en globals.css, como el resto de animaciones del sistema.
 */

export function LogoAnimado({
  tamano = 200,
  className = "",
}: {
  /** Lado en píxeles. El contorno es vectorial: cualquier tamaño vale. */
  tamano?: number;
  className?: string;
}) {
  // Las capas son cinco y el orden importa: halo difuso, pista apagada, estela
  // encendida, cabeza y punta. Pintadas al revés, la cabeza queda enterrada bajo
  // su propio resplandor y el cometa deja de leerse como una luz que avanza.
  const comun = {
    d: CONTORNO_D,
    fill: "none",
    pathLength: 1000,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;

  return (
    <span
      className={`devup-marca-anima relative inline-block ${className}`}
      style={{ width: tamano, height: tamano }}
      aria-hidden
    >
      <svg viewBox={`0 0 ${CAJA_D} ${CAJA_D}`} width={tamano} height={tamano} className="overflow-visible">
        {/* El resplandor: el mismo trazo, muy grueso y desenfocado. Es lo que
            tiñe el aire alrededor de la marca y lo que hace que se lea como luz
            y no como una línea de color. */}
        <g style={{ filter: "blur(14px)" }}>
          <path
            {...comun}
            data-marca="halo"
            stroke="var(--color-violet)"
            strokeWidth={30}
            strokeDasharray="1000 1000"
            opacity={0}
          />
        </g>

        {/* La pista apagada: sin ella, la parte que la luz todavía no ha
            recorrido no existe, y la D aparece a trozos en vez de revelarse. */}
        <path {...comun} stroke="var(--color-violet)" strokeWidth={3} opacity={0.14} />

        {/* La estela encendida. */}
        <path
          {...comun}
          data-marca="estela"
          stroke="var(--color-accent-bright)"
          strokeWidth={9}
          strokeDasharray="0 1000"
          opacity={0}
        />

        {/* La cabeza del cometa y su punta blanca, que es lo que da la sensación
            de que algo viaja por el trazo. */}
        <path
          {...comun}
          data-marca="cometa"
          stroke="var(--color-violet)"
          strokeWidth={13}
          strokeDasharray="46 1000"
          opacity={0}
        />
        <path
          {...comun}
          data-marca="punta"
          stroke="#ffffff"
          strokeWidth={5}
          strokeDasharray="15 1000"
          opacity={0}
        />
      </svg>

      {/* Los tres puntos de carga. En el original son el latido de la espera, y
          se encienden al ritmo del recorrido en vez de por su cuenta: así lo que
          se mira es una sola cosa avanzando, no dos relojes distintos. */}
      <span className="absolute inset-x-0 -bottom-1 flex justify-center gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            data-marca="punto"
            className="size-1.5 rounded-full bg-violet"
            style={{ opacity: 0.18, animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </span>
    </span>
  );
}
