import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { badRequest, notFound, parseBody, parseParams, requireUser } from "../lib/http.js";

const uuid = z.string().uuid();

const EVENT_COLUMNS = `
  e.id, e.workspace_id as "workspaceId", e.channel_id as "channelId",
  e.title, e.description, e.starts_at as "startsAt",
  e.duration_minutes as "durationMinutes",
  e.created_by as "createdBy", e.created_at as "createdAt",
  c.name as "channelName",
  (select count(*) from meeting_attendees a where a.event_id = e.id)::int as "attendeeCount"`;

/**
 * Reuniones con hora, dentro de un espacio.
 *
 * NO SE TOCA LA SALA DE VOZ DESDE AQUÍ: `channelId` solo apunta a un canal que
 * ya existe, para que la reunión aparezca «en Diseño, a las 3» — crear o
 * borrar canales sigue siendo cosa de `workspaces.ts`.
 */
export async function reunionesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/workspaces/:workspaceId/events", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${EVENT_COLUMNS},
                exists(
                  select 1 from meeting_attendees a
                   where a.event_id = e.id and a.user_id = $2
                ) as "attending"
           from meeting_events e
           left join channels c on c.id = e.channel_id
          where e.workspace_id = $1
          order by e.starts_at`,
        [workspaceId, userId],
      );
      return { events: rows };
    });
  });

  app.post("/workspaces/:workspaceId/events", async (request, reply) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const body = parseBody(
      z.object({
        title: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000).default(""),
        startsAt: z.string().datetime(),
        durationMinutes: z.number().int().min(1).max(1440),
        channelId: uuid.nullable().default(null),
      }),
      request.body,
    );

    const event = await withUser(userId, async (db) => {
      // El canal, si se dio uno, tiene que ser de ESTE espacio — sin esto,
      // alguien podría convocar «en Diseño» apuntando de hecho al canal de
      // otro espacio al que también tenga acceso.
      if (body.channelId) {
        const { rows } = await db.query(
          "select 1 from channels where id = $1 and workspace_id = $2",
          [body.channelId, workspaceId],
        );
        if (!rows[0]) throw badRequest("ese canal no es de este espacio");
      }

      const { rows } = await db.query<{ id: string }>(
        `insert into meeting_events
           (workspace_id, channel_id, title, description, starts_at, duration_minutes, created_by)
         values ($1,$2,$3,$4,$5,$6,$7)
         returning id`,
        [
          workspaceId,
          body.channelId,
          body.title,
          body.description,
          body.startsAt,
          body.durationMinutes,
          userId,
        ],
      );
      const id = rows[0]!.id;

      // Quien convoca asiste: no tendría sentido preguntarle si va a su
      // propia reunión.
      await db.query(
        "insert into meeting_attendees (event_id, user_id) values ($1,$2)",
        [id, userId],
      );

      const { rows: full } = await db.query(
        `select ${EVENT_COLUMNS}, true as "attending"
           from meeting_events e
           left join channels c on c.id = e.channel_id
          where e.id = $1`,
        [id],
      );
      return full[0];
    });

    return reply.status(201).send({ event });
  });

  app.delete("/events/:eventId", async (request, reply) => {
    const userId = requireUser(request);
    const { eventId } = parseParams(z.object({ eventId: uuid }), request.params);
    const { rowCount } = await withUser(userId, (db) =>
      db.query("delete from meeting_events where id = $1", [eventId]),
    );
    if (!rowCount) throw notFound("reunión no encontrada");
    return reply.status(204).send();
  });

  /** Apuntarse. Repetirlo no hace nada nuevo: `on conflict do nothing`. */
  app.post("/events/:eventId/asistencia", async (request, reply) => {
    const userId = requireUser(request);
    const { eventId } = parseParams(z.object({ eventId: uuid }), request.params);

    await withUser(userId, async (db) => {
      const { rows } = await db.query("select 1 from meeting_events where id = $1", [eventId]);
      if (!rows[0]) throw notFound("reunión no encontrada");
      await db.query(
        "insert into meeting_attendees (event_id, user_id) values ($1,$2) on conflict do nothing",
        [eventId, userId],
      );
    });

    return reply.status(204).send();
  });

  app.delete("/events/:eventId/asistencia", async (request, reply) => {
    const userId = requireUser(request);
    const { eventId } = parseParams(z.object({ eventId: uuid }), request.params);
    await withUser(userId, (db) =>
      db.query("delete from meeting_attendees where event_id = $1 and user_id = $2", [eventId, userId]),
    );
    return reply.status(204).send();
  });
}
