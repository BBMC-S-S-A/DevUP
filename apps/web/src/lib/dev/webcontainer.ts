import { WebContainer } from "@webcontainer/api";

/**
 * Arranque del WebContainer: un Node.js completo corriendo dentro del propio
 * navegador vía WebAssembly. Es la pieza que resuelve el terminal con shell
 * real sin que DevUP tenga que alojar cómputo de ningún cliente — sigue
 * viviendo en la máquina de quien lo usa, igual que ya vive ahí el WebRTC de
 * las llamadas (ver docs/decisiones/0003-arquitectura-de-despliegue.md).
 *
 * Candado a nivel de módulo, no solo en el hook que lo llama: React 19 en
 * modo estricto invoca los efectos dos veces en desarrollo, y `WebContainer`
 * solo admite una instancia por pestaña — una segunda llamada a `boot()`
 * mientras la primera sigue en curso lanza un error de la propia librería.
 */
let bootPromise: Promise<WebContainer> | null = null;

export function bootWebContainer(): Promise<WebContainer> {
  if (typeof window !== "undefined" && !window.crossOriginIsolated) {
    // Sin COOP/COEP, `SharedArrayBuffer` no existe y `WebContainer.boot()`
    // falla con un mensaje interno que no dice por qué. Este es el fallo más
    // probable en esta pieza nueva, así que vale la pena diagnosticarlo aquí
    // en vez de dejar que reviente dentro de la librería.
    return Promise.reject(
      new Error(
        "el navegador no reporta aislamiento cross-origin — faltan las cabeceras " +
          "Cross-Origin-Opener-Policy/Cross-Origin-Embedder-Policy de esta ruta",
      ),
    );
  }

  bootPromise ??= WebContainer.boot();
  return bootPromise;
}
