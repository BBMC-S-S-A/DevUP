import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { NextConfig } from "next";

// Un solo .env en la raíz del monorepo, compartido por la API y la web. Next
// solo mira su propio directorio, así que lo cargamos a mano antes de que se
// evalúe la configuración.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../.env") });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Salida autocontenida para la imagen de Docker: node_modules entero en una
  // imagen de producción son cientos de megas que no hacen falta.
  output: "standalone",
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
  // Van en TODAS las rutas y no solo en /dev: COOP/COEP son propiedades del
  // contexto de navegación que solo se fijan en una carga completa del
  // documento. Next.js navega entre páginas del lado del cliente sin
  // recargar — quien llega a /dev por un clic desde /app conserva las
  // cabeceras (o la ausencia de ellas) de la página por la que entró
  // primero a la pestaña, nunca las de /dev. Puestas aquí, cualquier punto
  // de entrada (login, /app, lo que sea) ya nace cross-origin-aislado y esa
  // condición sobrevive a la navegación interna.
  //
  // `credentialless` (no `require-corp`) porque el widget de Spotify, la
  // barra de llamada persistente y el iframe de previsualización de PDF
  // cargan recursos cross-origin (portadas de álbum, el propio PDF firmado
  // de S3/MinIO) que no llevan cabecera CORP — `require-corp` los rompería.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
