import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../../auth/plugin.js";
import { getAppToken, searchTracks } from "../../connectors/spotify.js";
import { withUser } from "../../db/pool.js";
import { parseBody, parseParams, requireUser } from "../../lib/http.js";
import { announceSpotifySession } from "../../realtime/signaling.js";

const uuid = z.string().uuid();

/**
 * La música de un canal: qué se puede buscar, qué hay en la cola y qué suena.
 *
 * El audio nunca pasa por el servidor: lo único que se guarda y se reparte es
 * el estado («qué suena, en qué segundo»). Ver la cabecera de
 * 0017_spotify.sql para el porqué completo.
 */
export async function spotifySalaRoutes(app: FastifyInstance): Promise<void> {
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
    /**
     * Borrar algo que ya no está no es un fallo: es el resultado que se pedía.
     *
     * Una misma pista se quita dos veces por caminos distintos —al ponerla, y
     * otra vez cuando el reproductor avisa de que empezó a sonar— y la segunda
     * llegaba a una fila que ya no existía. Contestar 404 ahí llenaba la consola
     * de errores rojos por un funcionamiento correcto, que es la mejor forma de
     * que nadie mire la consola cuando falle algo de verdad.
     *
     * Sin fila no hay nada que anunciar: la sala ya se enteró con el primer
     * borrado.
     */
    if (!channelId) return reply.status(204).send();
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
