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
};

export default nextConfig;
