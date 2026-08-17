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
  // documento esté cross-origin-aislado. Acotado a esa ruta y no global:
  // `credentialless` (no `require-corp`) porque el widget de Spotify y la
  // barra de llamada persistente viven en el layout raíz de /app y cargan
  // recursos cross-origin (portadas de álbum) que no llevan cabecera CORP —
  // `require-corp` los rompería.
  async headers() {
    return [
      {
        source: "/app/o/:orgId/dev/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
