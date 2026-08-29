"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * El armazón: barra lateral y contenido.
 *
 * EXISTE PORQUE LO HICE MAL. El plan de interfaz decía que el armazón de
 * organización tenía que nacer «con cajón para móvil en vez de con una barra
 * fija que luego haya que desmontar», y lo escribí con la barra fija de 256 px
 * copiando la del espacio de trabajo. El resultado fue dos barras que desmontar
 * en vez de una, que es exactamente lo que ese párrafo existía para evitar.
 * Esto es el desmontaje, hecho una sola vez para los dos.
 *
 * DEBAJO DE 768 px LA BARRA ES UN CAJÓN. No se encoge ni se convierte en una
 * fila de iconos: se va del todo y vuelve cuando se la llama. Una barra de
 * 256 px en una pantalla de 375 px se come dos tercios del sitio, y la versión
 * «estrecha» de una barra de navegación acaba siendo iconos sin etiqueta que
 * nadie reconoce.
 *
 * SE CIERRA AL NAVEGAR. Es la mitad que se olvida siempre: sin eso, tocas un
 * enlace, la página de detrás cambia, y el cajón se queda encima tapándola.
 */
export function Armazon({
  barra,
  titulo,
  children,
}: {
  /** El contenido de la barra: cabecera, navegación y pie. */
  barra: ReactNode;
  /** Lo que dice la cinta superior en móvil, donde no hay barra que lo diga. */
  titulo: string;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const pathname = usePathname();
  const boton = useRef<HTMLButtonElement>(null);

  useEffect(() => setAbierto(false), [pathname]);

  // Escape cierra, y el foco vuelve al botón que lo abrió. Sin lo segundo,
  // cerrar con el teclado deja el foco en un cajón que ya no está y el
  // siguiente Tab empieza desde el principio de la página.
  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape") return;
      setAbierto(false);
      boton.current?.focus();
    };
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [abierto]);

  // Con el cajón abierto la página de detrás no se desplaza. En un móvil, el
  // desplazamiento se «cuela» al fondo en cuanto el cajón llega a su tope, y la
  // página aparece movida al cerrarlo.
  useEffect(() => {
    if (!abierto) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = antes;
    };
  }, [abierto]);

  return (
    <div className="min-h-screen">
      {/* Cinta superior, solo en móvil: sin ella no hay forma de llamar al
          cajón, y sin el título no se sabe dónde se está. */}
      <div className="cristal fixed inset-x-0 top-0 z-40 flex h-12 items-center gap-2 px-3 md:hidden">
        <button
          ref={boton}
          type="button"
          onClick={() => setAbierto(true)}
          aria-label="Abrir la navegación"
          aria-expanded={abierto}
          className="presionable toque-comodo grid size-9 place-items-center rounded-xl text-muted hover:text-ink"
        >
          <Menu size={17} />
        </button>
        <span className="truncate text-sm font-semibold">{titulo}</span>
      </div>

      {abierto && (
        <div
          aria-hidden
          onClick={() => setAbierto(false)}
          className="devup-velo fixed inset-0 z-40 bg-canvas/70 backdrop-blur-sm md:hidden"
        />
      )}

      <aside
        // `translate` y no `display`: un cajón que aparece de golpe no dice de
        // dónde viene, y el gesto de volver a cerrarlo deja de ser evidente.
        className={`cristal fixed inset-y-0 left-0 z-50 flex w-64 flex-col rounded-none
          transition-transform duration-300 md:z-30 md:translate-x-0
          ${abierto ? "translate-x-0" : "-translate-x-full"}`}
        style={{ transitionTimingFunction: "var(--muelle-firme)" }}
        {...(abierto ? { role: "dialog", "aria-modal": true, "aria-label": "Navegación" } : {})}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-px
            bg-gradient-to-b from-transparent via-accent/25 to-transparent"
        />

        {/* Cerrar desde dentro. El velo también cierra, pero un botón visible
            es lo que busca quien no sabe que el velo se puede tocar. */}
        <button
          type="button"
          onClick={() => {
            setAbierto(false);
            boton.current?.focus();
          }}
          aria-label="Cerrar la navegación"
          className="presionable toque-comodo absolute right-2 top-2 z-10 grid size-8 place-items-center
            rounded-lg text-faint hover:text-ink md:hidden"
        >
          <X size={15} />
        </button>

        {barra}
      </aside>

      <main className="alto-util pt-12 md:pt-0 md:pl-64">{children}</main>
    </div>
  );
}

/**
 * El esqueleto del armazón, mientras llega lo que va dentro.
 *
 * En móvil no se pinta la barra: ahí no hay barra que esperar —hay un cajón
 * cerrado— y un rectángulo de 256 px cargando sobre una pantalla de 375 sería
 * el anuncio de algo que no va a aparecer.
 */
export function EsqueletoArmazon({ filas = 5 }: { filas?: number }) {
  return (
    <div className="min-h-screen">
      <aside className="cristal fixed inset-y-0 left-0 z-30 hidden w-64 flex-col rounded-none md:flex">
        <div className="filo-luz shrink-0 px-4 pb-3.5 pt-4">
          <div className="devup-esqueleto h-2.5 w-24 rounded" />
          <div className="mt-3 flex items-center gap-2.5">
            <div className="devup-esqueleto size-9 rounded-xl" />
            <div className="devup-esqueleto h-3 flex-1 rounded" />
          </div>
        </div>
        <div className="flex-1 space-y-2 px-2.5 py-4">
          <div className="devup-esqueleto h-9 rounded-xl" />
          {Array.from({ length: filas }).map((_, i) => (
            <div
              key={i}
              style={{ animationDelay: `${i * 60}ms` }}
              className="devup-esqueleto h-7 rounded-lg"
            />
          ))}
        </div>
      </aside>
      <main className="min-h-screen md:pl-64" />
    </div>
  );
}
