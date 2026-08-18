import type { FastifyInstance } from "fastify";
import { spotifyConexionRoutes } from "./spotify/conexion.js";
import { spotifySalaRoutes } from "./spotify/sala.js";

/**
 * Spotify, en dos mitades que no se parecen: conectar una cuenta (de la
 * persona) y gobernar la música de un canal (de la sala). Este archivo solo las
 * junta, para que `server.ts` siga registrando una sola cosa.
 */
export async function spotifyRoutes(app: FastifyInstance): Promise<void> {
  await app.register(spotifyConexionRoutes);
  await app.register(spotifySalaRoutes);
}
