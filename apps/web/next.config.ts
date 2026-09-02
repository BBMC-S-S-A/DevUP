import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// Un solo .env en la raíz del monorepo, compartido por la API y la web. Next
// solo mira su propio directorio, así que lo cargamos a mano antes de que se
// evalúe la configuración.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../.env") });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Salida autocontenida para la imagen de Docker: node_modules entero en una
  // imagen de producción son cientos de megas que no hacen falta.
  //
  // CONDICIONADA A PROPÓSITO. El adaptador de Cloudflare (OpenNext) tropieza
  // con `standalone` — hay un error de empaquetado de OpenTelemetry documentado
  // en su propio repositorio con exactamente esta combinación—, porque espera
  // la salida normal de `.next` y no la ya recortada para Docker. `BUILD_DOCKER`
  // solo se pone en el `Dockerfile`; el build de Cloudflare no la lleva, así
  // que cae en el valor por defecto de Next y ninguno de los dos se pisa.
  output: process.env.BUILD_DOCKER === "true" ? "standalone" : undefined,
  eslint: { ignoreDuringBuilds: true },
  // Declaradas explícitamente para que Next las inserte en el bundle del
  // cliente; con solo process.env no está garantizado al venir de fuera de
  // su propio cargador.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000",
  },
  // El entorno de desarrollo embebido (editor + terminal, apps/web/src/app/app/o/[orgId]/dev)
  // arranca un WebContainer, que exige SharedArrayBuffer y por tanto que el
  // documento esté cross-origin-aislado.
  //
  // SOLO en /dev, y por un motivo caro de aprender: aisladas en todo el sitio
  // rompen la reproducción de Spotify. Comprobado en el navegador del usuario —
  // con estas cabeceras el Web Playback SDK se construye, acepta el token y no
  // llega a estar listo NUNCA, sin emitir un solo error; quitándolas, reproduce
  // a la primera. El módulo de contenido protegido (Widevine) no se puede
  // instanciar en un contexto cross-origin aislado.
  //
  // El motivo original de ponerlas globales era real y sigue en pie: COOP/COEP
  // solo se fijan en una carga completa del documento, y Next navega entre
  // páginas sin recargar, así que quien llega a /dev por un clic se traería las
  // cabeceras de la página por la que entró. La salida no es aislar el sitio
  // entero: es entrar a /dev con navegación dura. Eso se hace en
  // `app/app/page.tsx`, donde ese acceso es un <a> y no un <Link> — si alguien
  // lo vuelve a convertir en <Link>, el entorno de desarrollo dejará de tener
  // SharedArrayBuffer y WebContainer no arrancará.
  //
  // `credentialless` (no `require-corp`) porque el iframe de previsualización de
  // PDF carga recursos cross-origin (el PDF firmado de S3/MinIO) que no llevan
  // cabecera CORP — `require-corp` los rompería.
  async headers() {
    const aislamiento = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
    ];
    return [
      { source: "/app/o/:orgId/dev", headers: aislamiento },
      { source: "/app/o/:orgId/dev/:ruta*", headers: aislamiento },
    ];
  },
};

/**
 * Función y no el objeto a secas, solo para poder mirar `phase`.
 *
 * `initOpenNextCloudflareForDev()` intenta lanzar el binario de `workerd`
 * —el runtime real de Cloudflare— para que `next dev` hable con bindings
 * locales. Eso está bien en un `next dev` de verdad y es un desastre en
 * cualquier `next build`: dentro de la imagen de Docker (`node:22-alpine`)
 * ese binario no está instalado —su script de postinstalación no corre ahí—,
 * y el build entero se caía con `spawn workerd ENOENT`. `PHASE_DEVELOPMENT_SERVER`
 * es la única señal de Next.js pensada exactamente para esto: distinguir
 * "esto es el servidor de desarrollo" de "esto es una compilación", sin
 * adivinar por variables de entorno que cambian según quién lo invoque.
 */
export default async function config(phase: string): Promise<NextConfig> {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    const { initOpenNextCloudflareForDev } = await import("@opennextjs/cloudflare");
    initOpenNextCloudflareForDev();
  }
  return nextConfig;
}
