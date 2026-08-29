"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "./api";

/**
 * La capa de datos.
 *
 * EL PROBLEMA QUE RESUELVE, CON NÚMEROS: hay 88 llamadas a la API y 74 efectos
 * escritos directamente dentro de las pantallas, sin nada en medio. Cada
 * pantalla trae su propio `load`, su propio `useEffect`, sus propios
 * `cargando`/`error`, y ninguna guarda lo que trajo. Volver a una pantalla que
 * se acaba de visitar la recarga entera: no porque haya cambiado algo, sino
 * porque nadie se acordaba de lo de hace tres segundos.
 *
 * PROPIA Y NO UNA LIBRERÍA, por el mismo criterio que el arrastre de la rejilla
 * y el reproductor: lo que hace falta aquí son cuatro cosas —caché por clave,
 * no pedir dos veces lo mismo a la vez, invalidar por prefijo, y volver a
 * comprobar al volver a la pestaña—, y son unas cien líneas. Una librería de
 * datos trae además su propio modelo de estado, sus reintentos y su
 * vocabulario, y acaba discutiendo con el resto de la aplicación sobre quién
 * manda.
 *
 * ENSEÑA LO VIEJO MIENTRAS PIDE LO NUEVO. Si hay algo en la caché se pinta ya y
 * la petición sigue por detrás. Es la diferencia entre volver a una pantalla y
 * encontrarla puesta, o encontrarla en blanco medio segundo cada vez.
 */

type Entrada<T> = { datos: T; cuando: number };

const cache = new Map<string, Entrada<unknown>>();
/** Peticiones en vuelo, para que dos componentes con la misma clave pidan una. */
const enVuelo = new Map<string, Promise<unknown>>();
/** Quién está mirando cada clave, para avisarles cuando cambie. */
const oyentes = new Map<string, Set<() => void>>();

function avisar(clave: string) {
  for (const oyente of oyentes.get(clave) ?? []) oyente();
}

/**
 * Tira lo guardado y hace que quien lo esté mirando lo vuelva a pedir.
 *
 * POR PREFIJO Y NO POR CLAVE EXACTA a propósito: al borrar un cliente hay que
 * invalidar su lista, sus cotizaciones y el resumen del embudo, y quien borra
 * no debería tener que acordarse de las tres. `invalidar("/clients")` alcanza a
 * `/clients?page=2` y a `/clients/abc/quotes` de una vez.
 */
export function invalidar(prefijo: string) {
  for (const clave of [...cache.keys()]) {
    if (clave.startsWith(prefijo)) {
      cache.delete(clave);
      avisar(clave);
    }
  }
}

/** Mete un valor a mano. Para cuando la respuesta de un POST ya trae la fila. */
export function sembrar<T>(clave: string, datos: T) {
  cache.set(clave, { datos, cuando: Date.now() });
  avisar(clave);
}

export type Recurso<T> = {
  datos: T | undefined;
  /** Solo la primera vez. Al revalidar hay datos y esto es falso. */
  cargando: boolean;
  /** Hay datos viejos en pantalla y una petición en curso por detrás. */
  revalidando: boolean;
  error: string | null;
  recargar: () => Promise<void>;
};

export function useRecurso<T>(
  /** La ruta de la API, que ya es una clave única. `null` para no pedir nada
   *  todavía —falta el identificador, o no toca aún—. */
  clave: string | null,
  opciones: {
    /** Cuánto vale lo guardado antes de volver a preguntar. Por defecto 30 s. */
    frescura?: number;
    /** Volver a comprobar al regresar a la pestaña. Por defecto sí. */
    alVolver?: boolean;
  } = {},
): Recurso<T> {
  const { frescura = 30_000, alVolver = true } = opciones;

  const [, redibujar] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [revalidando, setRevalidando] = useState(false);

  // La petición se guarda en una ref para que el efecto no dependa de una
  // función nueva en cada renderizado, que es la forma clásica de acabar
  // pidiendo lo mismo en bucle.
  const pedir = useCallback(
    async (forzar: boolean) => {
      if (!clave) return;

      const guardado = cache.get(clave) as Entrada<T> | undefined;
      const fresco = guardado && Date.now() - guardado.cuando < frescura;
      if (fresco && !forzar) return;

      // Si ya hay una petición viva para esta clave, se espera a esa. Dos
      // componentes que montan a la vez pidiendo lo mismo hacían dos viajes.
      let promesa = enVuelo.get(clave) as Promise<T> | undefined;
      if (!promesa) {
        promesa = api.get<T>(clave);
        enVuelo.set(clave, promesa);
      }

      if (guardado) setRevalidando(true);
      try {
        const datos = await promesa;
        cache.set(clave, { datos, cuando: Date.now() });
        setError(null);
        avisar(clave);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "No se pudo cargar.");
      } finally {
        if (enVuelo.get(clave) === promesa) enVuelo.delete(clave);
        setRevalidando(false);
      }
    },
    [clave, frescura],
  );

  useEffect(() => {
    if (!clave) return;
    const oyente = () => redibujar((n) => n + 1);
    const grupo = oyentes.get(clave) ?? new Set();
    grupo.add(oyente);
    oyentes.set(clave, grupo);
    void pedir(false);
    return () => {
      grupo.delete(oyente);
      if (grupo.size === 0) oyentes.delete(clave);
    };
  }, [clave, pedir]);

  // Al volver a la pestaña se comprueba, porque lo que hay en pantalla puede
  // llevar horas ahí. Se usa `visibilitychange` y no `focus`: hacer clic en la
  // ventana desde otra aplicación dispara `focus` sin que nada haya cambiado.
  useEffect(() => {
    if (!clave || !alVolver) return;
    const alCambiar = () => {
      if (document.visibilityState === "visible") void pedir(false);
    };
    document.addEventListener("visibilitychange", alCambiar);
    return () => document.removeEventListener("visibilitychange", alCambiar);
  }, [clave, alVolver, pedir]);

  const guardado = clave ? (cache.get(clave) as Entrada<T> | undefined) : undefined;

  return {
    datos: guardado?.datos,
    cargando: Boolean(clave) && !guardado && !error,
    revalidando,
    error,
    recargar: useCallback(() => pedir(true), [pedir]),
  };
}

/**
 * Una mutación: crear, cambiar o borrar.
 *
 * AQUÍ VIVE LA REGLA DE ERRORES, que hasta ahora cada pantalla decidía sola.
 * El error de una acción va en un aviso flotante, porque la acción ya terminó y
 * no hay ningún sitio en la pantalla al que pertenezca. El error de un campo va
 * junto al campo, y por eso `useMutacion` no lo toca: lo devuelve para que
 * quien tiene el formulario lo ponga donde toca.
 *
 * `enviando` deshabilita el botón desde fuera. Es lo que evita la venta creada
 * dos veces por un doble clic — lo mismo que ya hace `cargando` en <Boton>,
 * pero para quien no tiene un botón sino un formulario entero.
 */
export function useMutacion<A extends unknown[], R>(
  accion: (...args: A) => Promise<R>,
  opciones: {
    /** Qué invalidar al salir bien. Prefijos. */
    invalida?: string[];
    /** Aviso flotante al salir bien. Sin esto no se dice nada, que a veces es
     *  lo correcto: si el cambio se ve en pantalla, el aviso sobra. */
    exito?: string;
    /** Qué decir si falla y el servidor no dio un mensaje propio. */
    fallo?: string;
    alTerminar?: (resultado: R) => void;
  } = {},
) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Si el componente se desmonta a mitad —cerrar el diálogo mientras guarda—,
  // tocar su estado después avisa por consola y no sirve de nada.
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  // Las opciones se leen en el momento de ejecutar. En una ref y no en las
  // dependencias: un objeto literal es nuevo en cada renderizado y rehacer
  // `ejecutar` cada vez rompe a quien la pase a un hijo memoizado. Pero
  // capturarlas sin más dejaría un `alTerminar` mirando el estado de hace
  // tres renderizados, que es el fallo más difícil de ver de los dos.
  const ultimasOpciones = useRef(opciones);
  ultimasOpciones.current = opciones;

  const ejecutar = useCallback(
    async (...args: A): Promise<R | undefined> => {
      const opts = ultimasOpciones.current;
      setEnviando(true);
      setError(null);
      try {
        const resultado = await accion(...args);
        for (const prefijo of opts.invalida ?? []) invalidar(prefijo);
        if (opts.exito) toast.success(opts.exito);
        opts.alTerminar?.(resultado);
        return resultado;
      } catch (caught) {
        const mensaje =
          caught instanceof ApiError ? caught.message : (opts.fallo ?? "No se pudo completar.");
        if (vivo.current) setError(mensaje);
        toast.error(mensaje);
        return undefined;
      } finally {
        if (vivo.current) setEnviando(false);
      }
    },
    [accion],
  );

  return { ejecutar, enviando, error, limpiarError: useCallback(() => setError(null), []) };
}

export { api, ApiError };
