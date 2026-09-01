"use client";

import { GripVertical, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Desplegable } from "@/components/ui/Field";
import { Rotulo } from "@/components/ui/Superficies";

/**
 * La mesa de trabajo: la pantalla partida en una, dos o tres zonas.
 *
 * POR QUÉ NO ES LA REJILLA DEL PANEL, aunque el plan decía que debía serlo.
 * Al escribirlo pensé que forzar una sola primitiva evitaría la deriva de tener
 * dos sistemas de disposición. Mirándolo de cerca son dos problemas distintos:
 * la rejilla coloca tarjetas que FLUYEN en una página que se desplaza, con
 * filas de alto fijo; la mesa reparte el ANCHO de una pantalla que no se
 * desplaza, y cada zona tiene que ocupar todo el alto y desplazarse por dentro.
 * Meter lo segundo en lo primero habría dado una rejilla con un caso especial
 * para «esta celda es en realidad una columna», que es peor que dos componentes
 * honestos.
 *
 * Lo que sí comparten, y es lo que de verdad evitaba la deriva: el vocabulario
 * —fracciones y no píxeles— y el modelo de guardado —por persona, al soltar y
 * no en cada fotograma—.
 *
 * FRACCIONES Y NO PÍXELES. Lo que se guarda es «esta zona ocupa el 40 %», no
 * «480 px». Es lo que permite que la misma mesa sirva en un portátil y en un
 * monitor grande sin recalcular nada, y lo que hace que colapsar en vertical en
 * una pantalla estrecha sea apilar en orden en vez de inventar equivalencias.
 *
 * EN MÓVIL NO HAY ZONAS. Tres columnas en 375 px son tres carriles donde no se
 * puede trabajar: se apilan, en el orden en que están puestas. Partir la
 * pantalla es una idea de pantalla ancha, y fingir que funciona en un teléfono
 * es lo que hace que la gente deje de usar la función en el ordenador también.
 */

export type Zona = { herramienta: string; objetivo: string | null };

/** Mínimo por zona, en fracción. Por debajo, la herramienta deja de caber. */
const MINIMO = 0.15;

export function Mesa({
  zonas,
  fracciones,
  onCambiar,
  catalogo,
  children,
}: {
  zonas: Zona[];
  fracciones: number[];
  /** Se llama al soltar el divisor o al cambiar una zona, no durante el gesto. */
  onCambiar: (zonas: Zona[], fracciones: number[]) => void;
  /** Qué herramientas se pueden poner, y cómo se llaman. */
  catalogo: Record<string, { titulo: string; icono: ReactNode }>;
  /** Qué pintar dentro de cada zona. */
  children: (zona: Zona, indice: number) => ReactNode;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  const [previa, setPrevia] = useState<number[] | null>(null);
  const [estrecha, setEstrecha] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const aplicar = () => setEstrecha(media.matches);
    aplicar();
    media.addEventListener("change", aplicar);
    return () => media.removeEventListener("change", aplicar);
  }, []);

  const vista = previa ?? fracciones;

  /**
   * Mover un divisor reparte entre sus DOS vecinas y no entre todas.
   *
   * Repartir entre todas haría que tocar el divisor de la derecha moviera
   * también la zona de la izquierda, que nadie espera: el gesto es «hacer esta
   * más grande a costa de la de al lado».
   */
  const alMover = useCallback(
    (evento: PointerEvent) => {
      if (arrastrando === null) return;
      const caja = contenedor.current?.getBoundingClientRect();
      if (!caja) return;

      const i = arrastrando;
      const juntas = fracciones[i]! + fracciones[i + 1]!;
      const inicio = fracciones.slice(0, i).reduce((a, b) => a + b, 0);
      const relativa = (evento.clientX - caja.left) / caja.width - inicio;

      const izquierda = Math.max(MINIMO, Math.min(juntas - MINIMO, relativa));
      const siguiente = [...fracciones];
      siguiente[i] = izquierda;
      siguiente[i + 1] = juntas - izquierda;
      setPrevia(siguiente);
    },
    [arrastrando, fracciones],
  );

  const alSoltar = useCallback(() => {
    if (arrastrando !== null && previa) onCambiar(zonas, previa);
    setArrastrando(null);
    setPrevia(null);
  }, [arrastrando, previa, zonas, onCambiar]);

  useEffect(() => {
    if (arrastrando === null) return;
    window.addEventListener("pointermove", alMover);
    window.addEventListener("pointerup", alSoltar);
    // Mientras se arrastra, el cursor manda en toda la ventana: sin esto, al
    // pasar por encima de un texto cambia a cursor de selección y el gesto
    // parece haberse soltado.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSoltar);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [arrastrando, alMover, alSoltar]);

  /** Teclado: mover el divisor sin ratón, de cinco en cinco por ciento. */
  const porTeclado = (i: number, evento: React.KeyboardEvent) => {
    const paso = evento.key === "ArrowLeft" ? -0.05 : evento.key === "ArrowRight" ? 0.05 : 0;
    if (paso === 0) return;
    evento.preventDefault();
    const juntas = fracciones[i]! + fracciones[i + 1]!;
    const izquierda = Math.max(MINIMO, Math.min(juntas - MINIMO, fracciones[i]! + paso));
    const siguiente = [...fracciones];
    siguiente[i] = izquierda;
    siguiente[i + 1] = juntas - izquierda;
    onCambiar(zonas, siguiente);
  };

  function cerrar(i: number) {
    const quedan = zonas.filter((_, k) => k !== i);
    // Lo que ocupaba la zona cerrada se reparte a partes iguales, que es lo que
    // menos sorprende: darlo todo a una vecina mueve el resto de la mesa.
    const sobra = fracciones[i]! / (quedan.length || 1);
    onCambiar(
      quedan,
      fracciones.filter((_, k) => k !== i).map((f) => f + sobra),
    );
  }

  function cambiarHerramienta(i: number, herramienta: string) {
    onCambiar(
      zonas.map((z, k) => (k === i ? { herramienta, objetivo: null } : z)),
      fracciones,
    );
  }

  if (zonas.length === 0) return null;

  const marco = (zona: Zona, i: number) => (
    <section
      className="panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl"
      aria-label={catalogo[zona.herramienta]?.titulo ?? zona.herramienta}
    >
      <header className="filo-luz flex shrink-0 items-center gap-2 px-2.5 py-1.5">
        <span className="shrink-0 text-faint">{catalogo[zona.herramienta]?.icono}</span>
        <Desplegable
          tamano="sm"
          value={zona.herramienta}
          onChange={(e) => cambiarHerramienta(i, e.target.value)}
          aria-label={`Herramienta de la zona ${i + 1}`}
          className="border-none bg-transparent"
        >
          {Object.entries(catalogo).map(([id, { titulo }]) => (
            <option className="bg-surface" key={id} value={id}>
              {titulo}
            </option>
          ))}
        </Desplegable>
        <span className="flex-1" />
        <BotonIcono etiqueta={`Cerrar la zona ${i + 1}`} onClick={() => cerrar(i)}>
          <X size={13} />
        </BotonIcono>
      </header>

      {/* El desplazamiento vive DENTRO de la zona: si viviera fuera, abrir dos
          herramientas largas haría que la página entera se desplazara y las dos
          se perderían de vista a la vez. */}
      <div className="min-h-0 flex-1 overflow-auto">{children(zona, i)}</div>
    </section>
  );

  if (estrecha) {
    return (
      <div className="flex flex-col gap-3">
        {zonas.map((zona, i) => (
          <div key={i} className="h-[70svh]">
            {marco(zona, i)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={contenedor} className="flex min-h-0 flex-1 gap-2">
      {zonas.map((zona, i) => (
        <div
          key={i}
          className="flex min-h-0 min-w-0 flex-col"
          style={{ flexBasis: `${vista[i]! * 100}%`, flexGrow: 0, flexShrink: 0 }}
        >
          {marco(zona, i)}
        </div>
      ))}

      {/* Los divisores van después y en posición absoluta sobre la fila: como
          hermanos entre zonas robarían ancho a las fracciones, y entonces la
          suma dejaría de ser 1 y las cuentas del arrastre se irían. */}
      {zonas.slice(0, -1).map((_, i) => {
        const izquierda = vista.slice(0, i + 1).reduce((a, b) => a + b, 0);
        return (
          <button
            key={`divisor-${i}`}
            type="button"
            role="separator"
            aria-orientation="vertical"
            aria-label={`Ancho entre la zona ${i + 1} y la ${i + 2}`}
            aria-valuenow={Math.round(vista[i]! * 100)}
            onKeyDown={(evento) => porTeclado(i, evento)}
            onPointerDown={(evento) => {
              if (evento.button !== 0) return;
              setArrastrando(i);
            }}
            className="group absolute inset-y-0 z-10 grid w-3 -translate-x-1/2 cursor-col-resize
              place-items-center rounded"
            style={{ left: `calc(${izquierda * 100}% - ${(i + 1) * 0}px)` }}
          >
            <span
              className={`h-8 w-1 rounded-full transition-colors duration-150
                ${arrastrando === i ? "bg-accent" : "bg-line-strong group-hover:bg-accent/60"}`}
            />
            <GripVertical
              size={10}
              className="pointer-events-none absolute text-canvas opacity-0 group-hover:opacity-0"
            />
          </button>
        );
      })}
    </div>
  );
}

/** El botón de añadir zona, con el tope dicho en vez de desaparecer sin más. */
export function AnadirZona({
  cuantas,
  maximo,
  onAnadir,
}: {
  cuantas: number;
  maximo: number;
  onAnadir: () => void;
}) {
  if (cuantas >= maximo) {
    return (
      <Rotulo className="text-faint">
        {maximo} zonas es el tope · en menos ancho no se trabaja
      </Rotulo>
    );
  }
  return (
    <Boton tamano="sm" variante="secundario" icono={<Plus size={12} />} onClick={onAnadir}>
      {cuantas === 0 ? "Abrir una herramienta" : "Partir otra vez"}
    </Boton>
  );
}
