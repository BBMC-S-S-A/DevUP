import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import {
  authorizeUrl,
  exchangeCode,
  getAppToken,
  getProfile,
  refreshAccessToken,
  searchTracks,
} from "../connectors/spotify.js";
import { type Db, withUser } from "../db/pool.js";
import { env } from "../env.js";
import { badRequest, notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
import { announceSpotifySession } from "../realtime/signaling.js";
import { decryptSecret, encryptSecret } from "../security/vault.js";

const uuid = z.string().uuid();
const STATE_AUDIENCE = "devup-spotify-state";
const stateSecret = new TextEncoder().encode(env.AUTH_SECRET);

type StoredTokens = { accessToken: string; refreshToken: string };

/**
 * Conecta y sincroniza la reproducción de Spotify por canal de voz.
 *
 * El audio nunca pasa por el servidor: lo único que se guarda y se reparte es
 * el estado ("qué suena, en qué segundo"). Ver la cabecera de
 * 0017_spotify.sql para el porqué completo.
 */
export async function spotifyRoutes(app: FastifyInstance): Promise<void> {
  // --- Conectar --------------------------------------------------------------
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

  // --- Buscar ------------------------------------------------------------------
  //
  // No exige tener Spotify conectado: el token de aplicación basta para
  // buscar, así que cualquiera puede añadir canciones a la cola aunque no
  // tenga cuenta de Spotify o no la haya conectado todavía.
  app.get("/spotify/search", { onRequest: requireSession }, async (request) => {
    const { q } = parseBody(z.object({ q: z.string().trim().min(1).max(200) }), request.query);
    const token = await getAppToken();
    return { tracks: await searchTracks(token, q) };
  });

  // --- Cola ----------------------------------------------------------------
  app.get("/channels/:channelId/spotify/queue", { onRequest: requireSession }, async (request) => {
    const userId = requireUser(request);
    const { channelId } = parseParams(z.object({ channelId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select id, track_uri as "trackUri", track_name as "trackName",
                track_artist as "trackArtist", track_image_url as "trackImageUrl",
                duration_ms as "durationMs", added_by as "addedBy"
           from channel_queue_tracks
          where channel_id = $1
          order by position`,
        [channelId],
      );
      return { queue: rows };
    });
  });

  app.post("/channels/:channelId/spotify/queue", { onRequest: requireSession }, async (request, reply) => {
    const userId = requireUser(request);
    const { channelId } = parseParams(z.object({ channelId: uuid }), request.params);
    const body = parseBody(
      z.object({
        trackUri: z.string().min(1),
        trackName: z.string().min(1).max(200),
        trackArtist: z.string().min(1).max(200),
        trackImageUrl: z.string().url().nullable().default(null),
        durationMs: z.number().int().positive().nullable().default(null),
      }),
      request.body,
    );

    const track = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ position: number }>(
        "select coalesce(max(position), 0) + 1000 as position from channel_queue_tracks where channel_id = $1",
        [channelId],
      );
      const inserted = await db.query(
        `insert into channel_queue_tracks
           (channel_id, track_uri, track_name, track_artist, track_image_url, duration_ms, added_by, position)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id, track_uri as "trackUri", track_name as "trackName",
                   track_artist as "trackArtist", track_image_url as "trackImageUrl",
                   duration_ms as "durationMs", added_by as "addedBy"`,
        [
          channelId,
          body.trackUri,
          body.trackName,
          body.trackArtist,
          body.trackImageUrl,
          body.durationMs,
          userId,
          rows[0]!.position,
        ],
      );
      return inserted.rows[0];
    });

    announceSpotifySession(channelId, { kind: "queue-changed" });
    return reply.status(201).send({ track });
  });

  app.delete("/spotify/queue/:trackId", { onRequest: requireSession }, async (request, reply) => {
    const userId = requireUser(request);
    const { trackId } = parseParams(z.object({ trackId: uuid }), request.params);
    const channelId = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ channel_id: string }>(
        "delete from channel_queue_tracks where id = $1 returning channel_id",
        [trackId],
      );
      return rows[0]?.channel_id ?? null;
    });
    if (!channelId) throw notFound("no encontrada");
    announceSpotifySession(channelId, { kind: "queue-changed" });
    return reply.status(204).send();
  });

  // --- Sesión (qué suena ahora) ----------------------------------------------
  app.get("/channels/:channelId/spotify/session", { onRequest: requireSession }, async (request) => {
    const userId = requireUser(request);
    const { channelId } = parseParams(z.object({ channelId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select track_uri as "trackUri", track_name as "trackName",
                track_artist as "trackArtist", track_image_url as "trackImageUrl",
                duration_ms as "durationMs", position_ms as "positionMs",
                is_playing as "isPlaying", updated_at as "updatedAt"
           from channel_listening_sessions
          where channel_id = $1`,
        [channelId],
      );
      return { session: rows[0] ?? null };
    });
  });

  /**
   * Actualiza el estado compartido — la persona que controla la reproducción
   * manda aquí cada cambio (nueva canción, pausa, salto) y el resto se entera
   * por el mismo socket que ya reparte los mensajes del canal.
   */
  app.post("/channels/:channelId/spotify/session", { onRequest: requireSession }, async (request) => {
    const userId = requireUser(request);
    const { channelId } = parseParams(z.object({ channelId: uuid }), request.params);
    const body = parseBody(
      z.object({
        trackUri: z.string().nullable(),
        trackName: z.string().max(200).nullable(),
        trackArtist: z.string().max(200).nullable(),
        trackImageUrl: z.string().url().nullable(),
        durationMs: z.number().int().positive().nullable(),
        positionMs: z.number().int().min(0).default(0),
        isPlaying: z.boolean(),
      }),
      request.body,
    );

    const session = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into channel_listening_sessions
           (channel_id, track_uri, track_name, track_artist, track_image_url,
            duration_ms, position_ms, is_playing, updated_by, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
         on conflict (channel_id) do update
           set track_uri = excluded.track_uri, track_name = excluded.track_name,
               track_artist = excluded.track_artist, track_image_url = excluded.track_image_url,
               duration_ms = excluded.duration_ms, position_ms = excluded.position_ms,
               is_playing = excluded.is_playing, updated_by = excluded.updated_by,
               updated_at = now()
         returning track_uri as "trackUri", track_name as "trackName",
                   track_artist as "trackArtist", track_image_url as "trackImageUrl",
                   duration_ms as "durationMs", position_ms as "positionMs",
                   is_playing as "isPlaying", updated_at as "updatedAt"`,
        [
          channelId,
          body.trackUri,
          body.trackName,
          body.trackArtist,
          body.trackImageUrl,
          body.durationMs,
          body.positionMs,
          body.isPlaying,
          userId,
        ],
      );
      return rows[0];
    });

    announceSpotifySession(channelId, { kind: "session-changed" });
    return { session };
  });
}

/**
 * Token de acceso válido del usuario, refrescando si hace falta. Lanza si no
 * tiene Spotify conectado — quien llama decide si eso es un 404 o un
 * "conecta tu cuenta" en la interfaz.
 */
async function getValidUserToken(userId: string): Promise<string> {
  return withUser(userId, async (db) => getValidUserTokenWithDb(db, userId));
}

async function getValidUserTokenWithDb(db: Db, userId: string): Promise<string> {
  const { rows } = await db.query<{
    connection_id: string;
    encrypted_secret: Buffer;
    expires_at: Date | null;
  }>(
    `select c.id as connection_id, s.encrypted_secret, s.expires_at
       from connections c
       join connection_secrets s on s.connection_id = c.id
      where c.provider = 'spotify' and c.user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw notFound("Spotify no está conectado");

  const stored = JSON.parse(decryptSecret(row.encrypted_secret)) as StoredTokens;
  const expired = !row.expires_at || row.expires_at.getTime() < Date.now() + 30_000;
  if (!expired) return stored.accessToken;

  const refreshed = await refreshAccessToken(stored.refreshToken);
  const packed: StoredTokens = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? stored.refreshToken,
  };
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await db.query(
    "update connection_secrets set encrypted_secret = $2, expires_at = $3 where connection_id = $1",
    [row.connection_id, encryptSecret(JSON.stringify(packed)), expiresAt],
  );
  return refreshed.access_token;
}
