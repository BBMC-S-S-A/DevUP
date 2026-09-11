import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { type Db, withUser } from "../db/pool.js";
import { notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
import { notificar } from "./notifications.js";

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

      await avisarDeLaGrabacion(db, recordingId, rows[0].session_id, userId, request.log);

      return { ok: true };
    });
  });
}

/**
 * Avisa a quien salió en la grabación de que ya está guardada.
 *
 * ERA EL ÚNICO TIPO DE AVISO DECLARADO Y NUNCA EMITIDO. `notifications.kind`
 * admite `recording` desde la 0004 y no se emitía ni una vez, así que grabar
 * una llamada era, para todos los demás, como si no hubiera pasado.
 *
 * Y el agujero era mayor de lo que parecía: `GET /channels/:id/recordings`
 * existe y no lo llama nadie. Sin este aviso, una grabación se sube y se queda
 * en la biblioteca sin que nadie sepa que está ahí. Por eso el enlace lleva a
 * los archivos del espacio, que es donde de verdad aparece — una grabación es
 * un archivo más, con las mismas políticas.
 *
 * SOLO A QUIEN DIJO QUE SÍ. Avisar a quien no dio su consentimiento sería
 * contarle que se guardó una grabación en la que decidió no salir. Y no a quien
 * la sube, que ya lo sabe.
 */
async function avisarDeLaGrabacion(
  db: Db,
  recordingId: string,
  sessionId: string,
  quienSube: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const { rows: destino } = await db.query<{ workspace_id: string; channel_name: string }>(
    `select c.workspace_id::text as workspace_id, c.name as channel_name
       from call_sessions s
       join channels c on c.id = s.channel_id
      where s.id = $1`,
    [sessionId],
  );
  const donde = destino[0];
  if (!donde) return;

  const { rows: gente } = await db.query<{ user_id: string }>(
    `select distinct user_id
       from call_recording_consents
      where recording_id = $1 and granted and user_id is not null and user_id <> $2`,
    [recordingId, quienSube],
  );

  for (const { user_id } of gente) {
    await notificar(
      db,
      user_id,
      "recording",
      "Ya está la grabación",
      `La grabación de la llamada en #${donde.channel_name} está en los archivos.`,
      `/app/w/${donde.workspace_id}/archivos`,
    ).catch((fallo: unknown) => {
      // Como los demás avisos: no puede tirar la petición —la grabación ya
      // está enlazada y no se va a desenlazar— pero no se traga en silencio.
      log.warn({ err: fallo, recordingId, destinatario: user_id }, "no se pudo avisar de una grabación");
    });
  }
}
