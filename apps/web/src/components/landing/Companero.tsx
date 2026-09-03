"use client";

import { useEffect, useRef, useState } from "react";

/**
 * El guía: un habitante de DevVerse que acompaña la visita.
 *
 * POR QUÉ ESTÁ AQUÍ Y NO EN LA PORTADA. Estaba decidido —§3.1 de
 * `docs/vision-y-mvp.md`— que DevVerse no podía abrir la página: la categoría
 * de oficinas virtuales no sostuvo un negocio para nadie y todas fracasaron
 * prometiendo «vente aquí a estar». Como acompañante, el mundo aparece desde el
 * primer segundo sin ser la promesa.
 *
 * ES EL AVATAR DE VERDAD, no una mascota nueva: mismas proporciones que
 * `drawAvatar` en `lib/world/atlas.ts` —cuerpo de 16 px, cabeza de 12 × 14, dos
 * fases de paso, brazos que balancean al contrario que las piernas— y con
 * `imageSmoothingEnabled = false`, que es la línea que `docs/direccion-de-arte.md`
 * marca como imprescindible. El día que lleguen los sprites renderizados en 3D,
 * esto los hereda cambiando el cuerpo de `dibujar`.
 *
 * LAS SEIS REGLAS QUE LO SEPARAN DE CLIPPY:
 *   1. No pisa una letra. La columna de texto es un muro con colisión
 *      comprobada en cada fotograma, y el lienzo es `pointer-events: none`.
 *   2. Está quieto si nadie lo mueve. No persigue el scroll ni se pasea solo:
 *      movimiento periférico mientras alguien lee es distracción.
 *   3. Habla poco. Una frase por tramo, con 2,5 s de silencio entre frases.
 *   4. Se le puede despedir, y se recuerda.
 *   5. No existe con `prefers-reduced-motion`, ni bajo 1180 px, ni sin puntero.
 *   6. Va en `aria-hidden`: todo lo que dice ya está escrito en la página.
 */

const PIEL = "#e8bd97";
const PELO = "#2b2118";
const CHAQUETA = "#1b2540";
const CAMISA = "#eef1f8";
const PANTALON = "#161f36";
const ZAPATO = "#0f1319";

type Emote = "saludo" | "sorpresa" | "contento" | "pensando" | "susto" | null;

const FRASES_BOTON: Record<string, string[]> = {
  "Empezar gratis": [
    "Ese es gratis de verdad. Sin tarjeta.",
    "Cero euros, cero tarjeta, cero excusas.",
    "Ahí no te piden nada. Literalmente nada.",
  ],
  "Crear cuenta": ["Una persona, para siempre, sin pagar."],
  "Ver la demo": ["Dos minutos. Sin registro.", "Míralo primero, yo te espero aquí."],
  "Probar 14 días": [
    "Catorce días. Luego decides tú.",
    "Dos semanas enteras, sin tarjeta.",
    "Si a los catorce días no te convence, se acabó.",
  ],
  "Hablar con ventas": ["Ahí ya te atiende una persona.", "Si sois muchos, mejor hablarlo."],
  Entrar: ["¿Ya tienes cuenta? Adelante.", "Por ahí se entra. Yo me quedo fuera."],
  Mensual: ["Mes a mes, sin atarte."],
  "Anual −2 meses": ["Doce meses por el precio de diez."],
};

const FRASES_TRAMO: Record<string, string[]> = {
  problema: [
    "Mil doscientas veces al día. Yo las conté.",
    "Cuatro horas a la semana solo en reubicarte.",
  ],
  tesis: [
    "Aquí está la idea entera, en dos líneas.",
    "El estado se deduce. Nadie mueve tarjetas a mano.",
  ],
  perfiles: ["Mira cuál de los tres eres tú.", "Yo era el primero: trabajaba solo."],
  producto: [
    "Todo esto ya funciona. No son promesas.",
    "231 comprobaciones en verde en cada cambio.",
  ],
  aliados: [
    "No competimos con tu stack. Corremos encima.",
    "Cada plataforma integrada es una victoria.",
  ],
  devverse: ["Ese es mi barrio.", "Aquí es donde vivo cuando no te acompaño."],
  planes: ["El primero es gratis. Sin trampa.", "Los precios aún son bandas, te aviso."],
};

const FRASES_QUIETO = [
  "¿Te has quedado leyendo? Buena señal.",
  "Sigo aquí. Tú a lo tuyo.",
  "Aprovecho y me estiro un poco.",
];

const MAPA_TECLAS: Record<string, "izq" | "der" | "arr" | "aba"> = {
  ArrowLeft: "izq",
  ArrowRight: "der",
  ArrowUp: "arr",
  ArrowDown: "aba",
  a: "izq",
  d: "der",
  w: "arr",
  s: "aba",
  A: "izq",
  D: "der",
  W: "arr",
  S: "aba",
};

function sombrear(hex: string, factor: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((n & 255) * factor));
  return `rgb(${r},${g},${b})`;
}

export function Companero() {
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const bocadilloRef = useRef<HTMLDivElement>(null);
  const [fuera, setFuera] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem("devup-companero") === "no") setFuera(true);
    } catch {
      // Modo privado o almacenamiento bloqueado: entonces aparece, sin más.
    }
  }, []);

  useEffect(() => {
    if (fuera) return;
    const lienzo = lienzoRef.current;
    const bocadillo = bocadilloRef.current;
    if (!lienzo || !bocadillo) return;
    const ctx = lienzo.getContext("2d");
    if (!ctx) return;

    let ancho = 0;
    let alto = 0;
    let x = 90;
    let y = 200;
    const raton = { x: 600, y: 300 };
    let mirando: "s" | "e" | "o" = "s";
    let andando = false;
    let emote: Emote = null;
    let emoteHasta = 0;
    let ultimoDibujo = "";
    let visibleHasta = 0;
    let mudoHasta = 0;
    let quietoDesde = performance.now();
    let anim = 0;
    const teclas = { izq: false, der: false, arr: false, aba: false };
    const dichos = new Set<string>();

    const acento = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--acento").trim() || "#0400aa";

    function medir() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ancho = window.innerWidth;
      alto = window.innerHeight;
      lienzo!.width = ancho * dpr;
      lienzo!.height = alto * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Sin esto, todo el trabajo de píxel se pierde al escalar.
      ctx!.imageSmoothingEnabled = false;
      ultimoDibujo = "";
    }

    function azar(lista: string[]) {
      return lista[Math.floor(Math.random() * lista.length)]!;
    }

    function decir(texto: string, ms = 5000, prioritario = false) {
      const t = performance.now();
      if (!prioritario && t < mudoHasta) return false;
      bocadillo!.textContent = texto;
      bocadillo!.classList.add("visible");
      visibleHasta = t + ms;
      // Lo que separa un guía de Clippy no es el dibujo: es la frecuencia.
      mudoHasta = visibleHasta + 2500;
      return true;
    }

    function emocion(cual: Emote, ms = 2200) {
      emote = cual;
      emoteHasta = performance.now() + ms;
    }

    function dibujar(t: number) {
      const fase = andando ? Math.floor(t / 130) % 4 : 0;
      const bob = andando && (fase === 1 || fase === 3) ? 1 : 0;
      const swing = andando ? [0, 2.5, 0, -2.5][fase]! : 0;
      const perfil = mirando === "e" || mirando === "o";
      const signo = mirando === "e" ? 1 : -1;
      const corbata = acento();
      const w = 16;
      const altura = 40;
      const mitad = w / 2;

      // La sombra ancla la figura al suelo. Sin ella, flota.
      ctx!.fillStyle = "rgba(0,0,0,0.2)";
      ctx!.beginPath();
      ctx!.ellipse(x, y - 1, mitad, 3.5, 0, 0, Math.PI * 2);
      ctx!.fill();

      const base = y - bob;
      const piernaTop = base - 13;
      const torsoTop = base - altura + 12;
      const cabezaY = base - altura;

      ctx!.fillStyle = sombrear(PANTALON, 0.85);
      ctx!.fillRect(x - mitad + 1 + swing * 0.4, piernaTop, mitad - 1.5, 13);
      ctx!.fillStyle = PANTALON;
      ctx!.fillRect(x + 0.5 - swing * 0.4, piernaTop, mitad - 1.5, 13);
      ctx!.fillStyle = ZAPATO;
      ctx!.fillRect(x - mitad + 1 + swing * 0.4, base - 2.5, mitad - 1.5, 2.5);
      ctx!.fillRect(x + 0.5 - swing * 0.4, base - 2.5, mitad - 1.5, 2.5);

      // El traje. La corbata toma el acento, así que va de azul de día y de
      // morado de noche, igual que el resto de la página.
      const wt = perfil ? w - 4 : w;
      const mt = wt / 2;
      ctx!.fillStyle = CHAQUETA;
      ctx!.fillRect(x - mt, torsoTop + 1, wt, piernaTop - torsoTop - 1);
      ctx!.fillRect(x - mt + 1, torsoTop, wt - 2, 2);

      if (!perfil) {
        ctx!.fillStyle = CAMISA;
        ctx!.fillRect(x - 2, torsoTop + 1, 4, 9);
        ctx!.fillStyle = sombrear(CHAQUETA, 1.35);
        ctx!.fillRect(x - 3.2, torsoTop + 1, 1.6, 7);
        ctx!.fillRect(x + 1.6, torsoTop + 1, 1.6, 7);
        ctx!.fillStyle = CHAQUETA;
        ctx!.fillRect(x - 2, torsoTop + 6, 1.2, 4);
        ctx!.fillRect(x + 0.8, torsoTop + 6, 1.2, 4);
        ctx!.fillStyle = corbata;
        ctx!.fillRect(x - 0.9, torsoTop + 2, 1.8, 2);
        ctx!.fillRect(x - 0.7, torsoTop + 4, 1.4, 6);
        ctx!.fillStyle = sombrear(CHAQUETA, 1.6);
        ctx!.fillRect(x - 0.5, torsoTop + 12, 1, 1);
      } else {
        ctx!.fillStyle = CAMISA;
        ctx!.fillRect(x + signo * (mt - 2.2), torsoTop + 1, 2, 3.5);
      }

      const saluda = emote === "saludo";
      const susto = emote === "susto";
      ctx!.fillStyle = sombrear(CHAQUETA, 0.78);
      if (perfil) {
        ctx!.fillRect(x - 1.4 + signo * (mt - 0.5), torsoTop + 2, 2.8, 12);
      } else {
        const izq = susto ? torsoTop - 9 : torsoTop + 2 - swing * 0.5;
        const der = susto || saluda ? torsoTop - 9 : torsoTop + 2 + swing * 0.5;
        ctx!.fillRect(x - mt - 2.5, izq, 2.8, susto ? 11 : 12);
        ctx!.fillRect(x + mt - 0.3, der, 2.8, susto || saluda ? 11 : 12);
        ctx!.fillStyle = sombrear(PIEL, 0.95);
        ctx!.fillRect(x - mt - 2.5, susto ? izq - 2.5 : izq + 11, 2.8, 2.5);
        ctx!.fillRect(x + mt - 0.3, susto || saluda ? der - 2.5 : der + 11, 2.8, 2.5);
      }

      ctx!.fillStyle = sombrear(PIEL, 0.8);
      ctx!.fillRect(x - 2.5, torsoTop - 2, 5, 3);

      // Cabeza de 12 × 14 con las esquinas de arriba recortadas: se redondea
      // sin antialias, que es como se hace en el atlas.
      const cx = x + (perfil ? signo * 1.5 : 0);
      ctx!.fillStyle = PIEL;
      ctx!.fillRect(cx - 6, cabezaY, 12, 14);
      ctx!.clearRect(cx - 6, cabezaY, 1.5, 1.5);
      ctx!.clearRect(cx + 4.5, cabezaY, 1.5, 1.5);

      ctx!.fillStyle = PELO;
      ctx!.fillRect(cx - 6, cabezaY, 12, 4.5);
      ctx!.fillRect(cx - 6, cabezaY, 1.8, 8);
      ctx!.fillRect(cx + 4.2, cabezaY, 1.8, 8);
      ctx!.clearRect(cx - 6, cabezaY, 1.5, 1.5);
      ctx!.clearRect(cx + 4.5, cabezaY, 1.5, 1.5);

      ctx!.fillStyle = "#12131a";
      const oy = cabezaY + 7;
      const par = (dx: number, dy: number, w2: number, h2: number) => {
        if (perfil) ctx!.fillRect(cx + signo * 2 - dx, oy + dy, w2, h2);
        else {
          ctx!.fillRect(cx - 3.2 - dx + 0.8, oy + dy, w2, h2);
          ctx!.fillRect(cx + 1.4 - dx + 0.8, oy + dy, w2, h2);
        }
      };
      if (emote === "sorpresa") par(0.8, -1, 2.5, 3);
      else if (emote === "contento") par(0.8, 0.5, 2.5, 1.2);
      else if (emote === "pensando") par(0.8, -2, 2, 2);
      else if (emote === "susto") par(1, -1.5, 3, 3.5);
      else par(0.8, 0, 2, 2);

      if (emote === "contento" || emote === "saludo") {
        ctx!.fillRect(cx - 1.5, cabezaY + 10.5, 3, 1.2);
      } else if (emote === "sorpresa" || emote === "susto") {
        ctx!.fillRect(cx - 1, cabezaY + 10, 2, 2);
      }
    }

    function marco(t: number) {
      // Paso corto y tranquilo: 0,9 px por fotograma, unos 54 px por segundo.
      const paso = 0.9;
      let dx = 0;
      let dy = 0;
      if (teclas.izq) dx -= paso;
      if (teclas.der) dx += paso;
      if (teclas.arr) dy -= paso;
      if (teclas.aba) dy += paso;
      x += dx;
      y += dy;

      // COLISIÓN: la columna de texto es un muro. Se comprueba cada fotograma,
      // así que no hay forma de que acabe encima de una letra.
      const columna = Math.min(ancho, 68 * 16);
      const muro = (ancho - columna) / 2;
      const medioCuerpo = 13;
      x = Math.min(x, muro - medioCuerpo);
      x = Math.max(medioCuerpo + 2, x);
      y = Math.max(70, Math.min(alto - 46, y));

      andando = Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1;
      if (Math.abs(dx) > 0.1) mirando = dx > 0 ? "e" : "o";
      else mirando = Math.abs(raton.x - x) < 55 ? "s" : raton.x > x ? "e" : "o";

      if (emote && t > emoteHasta) emote = null;
      if (bocadillo!.classList.contains("visible") && t > visibleHasta) {
        bocadillo!.classList.remove("visible");
      }

      if (andando) quietoDesde = t;
      if (t - quietoDesde > 25000 && !bocadillo!.classList.contains("visible")) {
        quietoDesde = t;
        emocion("pensando", 2600);
        decir(azar(FRASES_QUIETO), 4400);
      }

      const firma = `${Math.round(x)},${Math.round(y)}${mirando}${andando ? 1 : 0}${
        andando ? Math.floor(t / 130) % 4 : 0
      }${emote ?? ""}${acento()}`;
      if (firma !== ultimoDibujo) {
        ctx!.clearRect(0, 0, ancho, alto);
        dibujar(t);
        ultimoDibujo = firma;
      }

      // El bocadillo va encima de la cabeza y pegado al borde de la pantalla:
      // así se come el margen en vez de la columna de texto.
      const anchoGlobo = bocadillo!.offsetWidth || 160;
      const altoGlobo = bocadillo!.offsetHeight || 44;
      const gx = Math.max(6, Math.min(x - 40, muro - anchoGlobo / 2));
      bocadillo!.style.left = `${gx}px`;
      bocadillo!.style.top = `${y - 46 - altoGlobo}px`;
      bocadillo!.style.setProperty("--pico", `${x - gx - 5}px`);

      anim = requestAnimationFrame(marco);
    }

    function alMover(e: MouseEvent) {
      raton.x = e.clientX;
      raton.y = e.clientY;
    }

    function alPulsar(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const destino = e.target as HTMLElement | null;
      if (
        destino &&
        (destino.tagName === "INPUT" || destino.tagName === "TEXTAREA" || destino.isContentEditable)
      ) {
        return;
      }
      const k = MAPA_TECLAS[e.key];
      if (!k) return;
      // No se secuestra el scroll: las flechas siguen desplazando la página.
      teclas[k] = true;
    }

    function alSoltar(e: KeyboardEvent) {
      const k = MAPA_TECLAS[e.key];
      if (k) teclas[k] = false;
    }

    function alSalirFoco() {
      teclas.izq = teclas.der = teclas.arr = teclas.aba = false;
    }

    function alPasarPorEncima(e: MouseEvent) {
      const objetivo = e.target as HTMLElement | null;
      const boton = objetivo?.closest(".btn, .ciclo button");
      if (!boton) return;
      const lista = FRASES_BOTON[(boton.textContent ?? "").trim()];
      if (!lista) return;
      emocion("sorpresa", 1400);
      decir(azar(lista), 3000);
    }

    // Irse de la página: el cursor sale por arriba, hacia la X o las pestañas.
    // Levanta las dos manos. Es lo único que se salta el silencio entre frases,
    // porque esperar turno aquí es llegar tarde.
    let yaSeAsusto = false;
    function alIrse(e: MouseEvent) {
      if (e.relatedTarget || e.clientY > 12 || yaSeAsusto) return;
      yaSeAsusto = true;
      emocion("susto", 3200);
      decir(
        azar([
          "¡Eh! ¿Ya te vas? No has visto los planes.",
          "¡Espera! Que el primero es gratis.",
          "¿Me dejas aquí solo? Vuelve cuando quieras.",
        ]),
        4800,
        true,
      );
      window.setTimeout(() => {
        yaSeAsusto = false;
      }, 25000);
    }

    medir();
    window.addEventListener("resize", medir);
    window.addEventListener("mousemove", alMover, { passive: true });
    window.addEventListener("keydown", alPulsar);
    window.addEventListener("keyup", alSoltar);
    window.addEventListener("blur", alSalirFoco);
    document.addEventListener("mouseover", alPasarPorEncima);
    document.addEventListener("mouseout", alIrse);

    // Un comentario por tramo, la primera vez que entra en pantalla.
    const secciones = document.querySelectorAll<HTMLElement>("[data-tramo]");
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          if (!entrada.isIntersecting) continue;
          const clave = entrada.target.getAttribute("data-tramo");
          if (!clave || dichos.has(clave)) continue;
          const lista = FRASES_TRAMO[clave];
          if (!lista) continue;
          if (decir(azar(lista), 4800)) {
            dichos.add(clave);
            emocion("contento", 2400);
          }
        }
      },
      { threshold: 0.35 },
    );
    secciones.forEach((s) => observador.observe(s));

    anim = requestAnimationFrame(marco);

    const saludo = window.setTimeout(() => {
      emocion("saludo", 3000);
      decir("Soy tu guía de DevUP. Te iré contando cosas sobre la marcha.", 5200, true);
    }, 1200);
    const segunda = window.setTimeout(() => {
      emocion("contento", 2400);
      decir("Muéveme con las flechas si quieres. Del texto no me dejan pasar.", 5200, true);
    }, 8600);

    return () => {
      cancelAnimationFrame(anim);
      window.clearTimeout(saludo);
      window.clearTimeout(segunda);
      observador.disconnect();
      window.removeEventListener("resize", medir);
      window.removeEventListener("mousemove", alMover);
      window.removeEventListener("keydown", alPulsar);
      window.removeEventListener("keyup", alSoltar);
      window.removeEventListener("blur", alSalirFoco);
      document.removeEventListener("mouseover", alPasarPorEncima);
      document.removeEventListener("mouseout", alIrse);
    };
  }, [fuera]);

  if (fuera) return null;

  return (
    <>
      <div id="companero" aria-hidden="true">
        <canvas ref={lienzoRef} />
      </div>
      <div id="bocadillo" ref={bocadilloRef} aria-hidden="true" />
      <button
        id="despedir"
        type="button"
        onClick={() => {
          setFuera(true);
          try {
            localStorage.setItem("devup-companero", "no");
          } catch {
            // Si no se puede recordar, al menos se va en esta visita.
          }
        }}
      >
        Despedir
      </button>
    </>
  );
}
