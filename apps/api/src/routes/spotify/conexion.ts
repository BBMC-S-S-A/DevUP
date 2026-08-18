import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { requireSession } from "../../auth/plugin.js";
import { authorizeUrl, exchangeCode, getProfile } from "../../connectors/spotify.js";
import { withUser } from "../../db/pool.js";
import { env } from "../../env.js";
import { badRequest, parseBody, requireUser } from "../../lib/http.js";
import { encryptSecret } from "../../security/vault.js";
import { getValidUserToken, type StoredTokens } from "./token.js";

const STATE_AUDIENCE = "devup-spotify-state";
const stateSecret = new TextEncoder().encode(env.AUTH_SECRET);

/**
 * Conectar una cuenta de Spotify y mantener su token vivo.
 *
 * Salió de `routes/spotify.ts`, que mezclaba el OAuth con la cola y la sesión
 * de la sala. Son dos asuntos distintos: esto es de la persona, y lo otro es
 * del canal.
 */
export async function spotifyConexionRoutes(app: FastifyInstance): Promise<void> {
  //
  // El estado que Spotify devuelve en el callback lleva el userId firmado, en
  // vez de depender de que la cookie de sesión sobreviva la ida y vuelta por
  // un dominio ajeno — eso dependería del SameSite de la cookie, y esto no.
  app.get("/integrations/spotify/authorize", { onRequest: requireSession }, async (request, reply) => {
    if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_REDIRECT_URI) {
      throw badRequest("Spotify no está configurado en esta instancia todavía");
    }
    const userId = requireUser(request);
    const state = await new SignJWT({ userId, nonce: randomBytes(8).toString("hex") })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience(STATE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(stateSecret);
    return reply.redirect(authorizeUrl(state));
  });

  app.get("/integrations/spotify/callback", async (request, reply) => {
    const query = parseBody(
      z.object({ code: z.string().optional(), state: z.string(), error: z.string().optional() }),
      request.query,
    );
    if (query.error || !query.code) {
      return reply.redirect(`${env.APP_BASE_URL}/app?spotify=denegado`);
    }

    let userId: string;
    try {
      const { payload } = await jwtVerify(query.state, stateSecret, { audience: STATE_AUDIENCE });
      if (typeof payload.userId !== "string") throw new Error("estado inválido");
      userId = payload.userId;
    } catch {
      return reply.redirect(`${env.APP_BASE_URL}/app?spotify=estado-invalido`);
    }

    /**
     * De aquí en adelante, cualquier fallo tiene que volver a la aplicación.
     *
     * Sin este `try`, un canje de código fallido subía como excepción y el
     * manejador global respondía un 500 en JSON — y esto es un callback de
     * OAuth, así que ese JSON se lo come el navegador de la persona a pantalla
     * completa en una URL de la API. Peor todavía: el motivo real quedaba solo
     * en los registros del servidor, que es justo donde nadie lo va a buscar
     * cuando lo que ve es «algo ha ido mal».
     *
     * El código de autorización es de UN SOLO USO: recargar esta página o
     * llegar aquí dos veces falla siempre, y por eso el mensaje que se manda de
     * vuelta sugiere reintentar la conexión desde el principio.
     */
    try {
      const tokens = await exchangeCode(query.code);
      await withUser(userId, async (db) => {
        const existing = await db.query<{ id: string }>(
          "select id from connections where provider = 'spotify' and user_id = $1",
          [userId],
        );
        const connectionId =
          existing.rows[0]?.id ??
          (
            await db.query<{ id: string }>(
              `insert into connections (provider, user_id, display_name, created_by)
               values ('spotify', $1, 'Spotify', $1) returning id`,
              [userId],
            )
          ).rows[0]!.id;

        const packed: StoredTokens = {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? "",
        };
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
        await db.query(
          `insert into connection_secrets (connection_id, encrypted_secret, expires_at)
           values ($1,$2,$3)
           on conflict (connection_id) do update
             set encrypted_secret = excluded.encrypted_secret, expires_at = excluded.expires_at`,
          [connectionId, encryptSecret(JSON.stringify(packed)), expiresAt],
        );
      });
    } catch (fallo) {
      request.log.error({ err: fallo }, "el canje del código de Spotify falló");
      return reply.redirect(`${env.APP_BASE_URL}/app?spotify=fallo-canje`);
    }

    return reply.redirect(`${env.APP_BASE_URL}/app?spotify=conectado`);
  });

  app.get("/me/spotify/status", { onRequest: requireSession }, async (request) => {
    const userId = requireUser(request);
    const token = await getValidUserToken(userId).catch(() => null);
    if (!token) return { connected: false, premium: false };
    const profile = await getProfile(token).catch(() => null);
    return { connected: true, premium: profile?.product === "premium" };
  });

  app.delete("/integrations/spotify", { onRequest: requireSession }, async (request, reply) => {
    const userId = requireUser(request);
    await withUser(userId, (db) =>
      db.query("delete from connections where provider = 'spotify' and user_id = $1", [userId]),
    );
    return reply.status(204).send();
  });

  /**
   * El token de acceso, para el propio navegador.
   *
   * A diferencia del PAT de GitHub —que nunca sale del servidor porque la API
   * hace de proxy—, el Web Playback SDK de Spotify corre en el navegador y
   * necesita el token él mismo para hablar con Spotify directamente: así está
   * diseñado su SDK. No es una fuga de la bóveda: es el token de acceso de la
   * propia persona, de corta duración (~1 hora) y renovable; el refresh token
   * de verdad no sale de aquí.
   */
  app.get("/me/spotify/token", { onRequest: requireSession }, async (request) => {
    const userId = requireUser(request);
    const accessToken = await getValidUserToken(userId);
    return { accessToken };
  });

}
