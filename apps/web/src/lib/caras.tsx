"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { type Cara, api } from "./api";
import { ignorar } from "./fallo";

/**
 * Las caras de la gente, pedidas en lote y cacheadas.
 *
 * EL PROBLEMA QUE RESUELVE NO ES PINTAR: ES CUÁNTAS PETICIONES. Un tablero
 * enseña veinte tarjetas con su responsable, la red de trabajo otras tantas, y
 * el marcador una por persona. Si cada chapa pidiera su cara, abrir el tablero
 * serían veinte peticiones — y las mismas veinte otra vez al cambiar de
 * pantalla, porque nadie las estaría guardando.
 *
 * CÓMO. Cada chapa dice qué persona necesita; esto las junta y pregunta UNA
 * vez por todas las que aún no conoce. El truco es esperar un tic del
 * navegador antes de pedir: en ese tic se monta la pantalla entera, así que las
 * veinte llegan juntas sin que ninguna sepa de las demás.
 *
 * LO QUE SE GUARDA INCLUYE LOS HUECOS. Alguien sin foto ni personaje no tiene
 * cara, y eso es una respuesta — si no se anotara, cada pintada volvería a
 * preguntar por la misma persona que ya se sabe que no tiene. Por eso el mapa
 * guarda `null` y no se limita a no tener la clave.
 *
 * LAS URL CADUCAN, y aquí no se renuevan. Duran lo que dure la sesión de la
 * pestaña, que es más que de sobra: al recargar se piden otra vez. Montar un
 * temporizador para refrescarlas sería complicar esto por un caso que no
 * existe — nadie tiene una pestaña abierta más que el tiempo de vida de una
 * firma sin recargar.
 */

type Estado = {
  caras: Record<string, Cara | null>;
  pedir: (userId: string) => void;
};

const Contexto = createContext<Estado | null>(null);

/** De golpe, no de una en una. Es el tope de la ruta. */
const MAXIMO_POR_TANDA = 60;

export function ProveedorDeCaras({ children }: { children: ReactNode }) {
  const [caras, setCaras] = useState<Record<string, Cara | null>>({});
  /** Lo pedido y todavía sin mandar. Vive en una ref y no en estado: cambiarlo
   *  no debe repintar nada — solo dispara la tanda. */
  const pendientes = useRef(new Set<string>());
  /** Lo que ya se preguntó, para no volver a preguntarlo aunque no tenga cara. */
  const preguntados = useRef(new Set<string>());
  const [tanda, setTanda] = useState(0);

  const pedir = useCallback((userId: string) => {
    if (!userId || preguntados.current.has(userId) || pendientes.current.has(userId)) return;
    pendientes.current.add(userId);
    // Un contador y no un booleano: dos chapas que se montan en el mismo tic
    // tienen que disparar UNA tanda, y el efecto de abajo se encarga.
    setTanda((n) => n + 1);
  }, []);

  useEffect(() => {
    if (pendientes.current.size === 0) return;

    // El tiempo de espera es cero a propósito: no es una pausa, es «cuando
    // termine de montarse esta pantalla». Con un número mayor, las primeras
    // chapas parpadearían sin cara durante ese rato.
    const id = setTimeout(() => {
      const ids = [...pendientes.current].slice(0, MAXIMO_POR_TANDA);
      if (ids.length === 0) return;
      for (const uno of ids) {
        pendientes.current.delete(uno);
        preguntados.current.add(uno);
      }

      void api
        .post<{ caras: Record<string, Cara> }>("/avatars/urls", { ids })
        .then(({ caras: llegadas }) => {
          setCaras((previas) => {
            const siguiente = { ...previas };
            // Se anotan TODAS las pedidas, no solo las que vinieron: un hueco
            // es la respuesta «no tiene cara», y no anotarlo haría preguntar
            // por esa persona una y otra vez.
            for (const uno of ids) siguiente[uno] = llegadas[uno] ?? null;
            return siguiente;
          });
        })
        .catch(ignorar("no se pudieron cargar las fotos de la gente"));
    }, 0);

    return () => clearTimeout(id);
  }, [tanda]);

  return <Contexto.Provider value={{ caras, pedir }}>{children}</Contexto.Provider>;
}

/**
 * La cara de una persona, o `null` mientras no se sabe o no tiene.
 *
 * FUNCIONA SIN PROVEEDOR, devolviendo siempre `null`. Es deliberado: una chapa
 * es de lo más reutilizado que hay y acabará montada en una pantalla suelta, en
 * una prueba o en el catálogo de piezas. Reventar ahí obligaría a envolver
 * cada sitio «por si acaso», y lo que pasa sin proveedor —la inicial de
 * siempre— es exactamente lo correcto.
 */
export function useCara(userId: string | null | undefined): Cara | null {
  const contexto = useContext(Contexto);
  const pedir = contexto?.pedir;

  useEffect(() => {
    if (userId && pedir) pedir(userId);
  }, [userId, pedir]);

  if (!userId || !contexto) return null;
  return contexto.caras[userId] ?? null;
}
