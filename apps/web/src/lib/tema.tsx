"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * El tema: claro, oscuro, o lo que diga el sistema.
 *
 * TRES OPCIONES Y NO DOS. «Seguir al sistema» no es un lujo: quien tiene el
 * portátil en automático espera que la aplicación se oscurezca al atardecer con
 * todo lo demás, y forzarle a elegir uno fijo le rompe esa expectativa. Es la
 * opción por defecto.
 *
 * EL VALOR SE APLICA ANTES DE PINTAR, no aquí. Este proveedor solo gobierna el
 * cambio en caliente; la primera pintada la resuelve un script diminuto en el
 * `layout` (ver `GUION_TEMA`), porque para cuando React monta ya es tarde: el
 * navegador habría pintado un fotograma con el tema equivocado y eso es un
 * fogonazo blanco en la cara de quien trabaja de noche.
 */

export type Tema = "claro" | "oscuro" | "sistema";

const CLAVE = "devup-tema";

/**
 * Lo que corre antes del primer pintado. Va como texto porque se inyecta con
 * `dangerouslySetInnerHTML` en el `<head>`: es la única forma de ejecutar algo
 * antes de que el navegador pinte.
 *
 * En `try` porque `localStorage` lanza en modo privado de algunos navegadores y
 * con las cookies de terceros bloqueadas. Si falla, no se pone atributo y manda
 * `prefers-color-scheme`, que es exactamente el comportamiento correcto.
 */
export const GUION_TEMA = `
try {
  var t = localStorage.getItem("${CLAVE}");
  if (t === "claro" || t === "oscuro") document.documentElement.dataset.tema = t;
} catch (e) {}
`.trim();

type Valor = {
  tema: Tema;
  /** El tema que se está viendo de verdad, ya resuelto el «sistema». */
  efectivo: "claro" | "oscuro";
  poner: (t: Tema) => void;
};

const Contexto = createContext<Valor | null>(null);

export function TemaProvider({ children }: { children: ReactNode }) {
  // Arranca en "sistema" y se corrige en el primer efecto. No se lee
  // `localStorage` en el estado inicial a propósito: el servidor no lo tiene, y
  // devolver algo distinto en cliente y servidor es un error de hidratación.
  const [tema, setTema] = useState<Tema>("sistema");
  const [sistemaOscuro, setSistemaOscuro] = useState(false);

  useEffect(() => {
    try {
      const guardado = localStorage.getItem(CLAVE);
      if (guardado === "claro" || guardado === "oscuro") setTema(guardado);
    } catch {
      // Sin almacenamiento se sigue al sistema, que ya es el valor inicial.
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sincronizar = () => setSistemaOscuro(media.matches);
    sincronizar();
    media.addEventListener("change", sincronizar);
    return () => media.removeEventListener("change", sincronizar);
  }, []);

  const poner = useCallback((siguiente: Tema) => {
    setTema(siguiente);
    const raiz = document.documentElement;

    if (siguiente === "sistema") {
      delete raiz.dataset.tema;
      try {
        localStorage.removeItem(CLAVE);
      } catch {
        /* sin almacenamiento, la elección dura lo que la pestaña */
      }
      return;
    }

    raiz.dataset.tema = siguiente;
    try {
      localStorage.setItem(CLAVE, siguiente);
    } catch {
      /* igual: se aplica ahora, no se recuerda */
    }
  }, []);

  const efectivo = tema === "sistema" ? (sistemaOscuro ? "oscuro" : "claro") : tema;

  return <Contexto.Provider value={{ tema, efectivo, poner }}>{children}</Contexto.Provider>;
}

export function useTema(): Valor {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useTema debe usarse dentro de TemaProvider");
  return ctx;
}
