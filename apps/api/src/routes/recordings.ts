import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { notFound, parseBody, parseParams, requireUser } from "../lib/http.js";

const uuid = z.string().uuid();

/**
 * Grabaciones de llamada.
 *
 * El archivo lo produce y lo sube el navegador de quien graba; aquí solo se
 * enlaza con la sesión y se guarda quién dijo que sí. Ver
 * docs/decisiones/0001-cifrado-de-salas.md — que el servidor no participe en
 * la grabación no es una carencia, es la consecuencia de que el audio vaya
 * cifrado entre pares.
 */
export async function recordingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/channels/:channelId/recordings", async (request) => {
    const userId = requireUser(request);
    const { channelId } = parseParams(z.object({ channelId: uuid }), request.params);

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select r.id, r.started_at as "startedAt", r.ended_at as "endedAt",
                r.file_id as "fileId", p.display_name as "startedByName",
                f.name as "fileName", f.size_bytes::bigint as "sizeBytes",
                f.mime_type as "mimeType",
                coalesce(
                  (select json_agg(json_build_object(
                            'displayName', c.display_name, 'granted', c.granted)
                          order by c.responded_at)
                     from call_recording_consents c where c.recording_id = r.id),
                  '[]'::json
                ) as consents
           from call_recordings r
           join call_sessions s on s.id = r.session_id
           left join profiles p on p.id = r.started_by
           left join files f on f.id = r.file_id
          where s.channel_id = $1
          order by r.started_at desc
          limit 50`,
        [channelId],
      );
      return { recordings: rows };
    });
  });

  /**
   * Enlazar el archivo subido con la grabación.
   *
   * Se llama después de subir y confirmar el archivo por la ruta normal de la
   * biblioteca: una grabación es un archivo más, con las mismas políticas de
   * acceso y la misma URL firmada. Lo único que añade esta llamada es de qué
   * llamada salió.
   */
  app.post("/recordings/:recordingId/file", async (request) => {
    const userId = requireUser(request);
    const { recordingId } = parseParams(z.object({ recordingId: uuid }), request.params);
    const body = parseBody(z.object({ fileId: uuid }), request.body);

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ session_id: string }>(
        `update call_recordings
            set file_id = $2, ended_at = coalesce(ended_at, now())
          where id = $1
          returning session_id`,
        [recordingId, body.fileId],
      );
      // La política de UPDATE exige ser quien la empezó; si no lo eres, esto
      // no actualiza nada y no hay que decir por qué.
      if (!rows[0]) throw notFound("grabación no encontrada");

      await db.query("update files set call_session_id = $2 where id = $1", [
        body.fileId,
        rows[0].session_id,
      ]);

      return { ok: true };
    });
  });
}
