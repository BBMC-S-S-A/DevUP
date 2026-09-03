"use client";

import { useEffect, useRef } from "react";

/**
 * Seis ventanas dispersas que colapsan en una.
 *
 * Es la tesis del producto dibujada en vez de explicada, y por eso abre la
 * página en lugar de una captura: una captura exige que el visitante ya sepa
 * qué está mirando; esto se entiende sin leer nada.
 *
 * UN SOLO MOMENTO ORQUESTADO. Se dispara al entrar en pantalla, ocurre una vez
 * y el observador se desuscribe. Nada late en bucle: la regla de movimiento del
 * sistema se relaja en las rutas públicas, no se deroga.
 *
 * El estado inicial —disperso— está en el CSS, no aquí, así que sin JavaScript
 * la sección se ve igual de bien; solo se pierde el colapso. Y con
 * `prefers-reduced-motion` el CSS deja las ventanas ya reunidas.
 */
export function Teatro() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nodo = ref.current;
    if (!nodo) return;
    if (!("IntersectionObserver" in window)) {
      nodo.classList.add("reunido");
      return;
    }
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          if (!entrada.isIntersecting) continue;
          entrada.target.classList.add("reunido");
          observador.unobserve(entrada.target);
        }
      },
      { threshold: 0.4 },
    );
    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);

  return (
    <div className="teatro" ref={ref} aria-hidden="true">
      <div className="pila">
        {["github", "slack", "jira", "vercel", "notion"].map((nombre) => (
          <div className="vent" key={nombre}>
            <span>{nombre}</span>
            <i />
            <i />
          </div>
        ))}
      </div>
      <div className="destino">
        <span>devup.app</span>
        <b>
          1.200 cambios al día,
          <br />o ninguno.
        </b>
        <span className="num">134 API · 44/45 aisladas · 231 ✓</span>
      </div>
    </div>
  );
}
