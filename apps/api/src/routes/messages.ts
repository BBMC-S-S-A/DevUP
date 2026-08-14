import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { type Db, withUser } from "../db/pool.js";
import { notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
import { announceMessage } from "../realtime/signaling.js";
import { notificar } from "./notifications.js";

const uuid = z.string().uuid();

const MESSAGE_COLUMNS = `
  m.id, m.channel_id as "channelId", m.author_id as "authorId",
  m.body, m.reply_to as "replyTo", m.file_id as "fileId",
  m.created_at as "createdAt", m.edited_at as "editedAt",
  coalesce(p.display_name, 'cuenta eliminada') as "authorName",
  case when f.id is null then null else json_build_object(
    'id', f.id, 'name', f.name, 'mimeType', f.mime_type, 'sizeBytes', f.size_bytes::text
  ) end as file,
  case when r.id is null then null else json_build_object(
    'id', r.id,
    'authorName', coalesce(rp.display_name, 'cuenta eliminada'),
    'body', left(r.body, 140)
  ) end as "replyPreview"`;

const MESSAGE_FROM = `
  from messages m
  left join profiles p on p.id = m.author_id
  left join files f on f.id = m.file_id
  left join messages r on r.id = m.reply_to
  left join profiles rp on rp.id = r.author_id`;

async function loadMessage(db: Db, id: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query(`select ${MESSAGE_COLUMNS} ${MESSAGE_FROM} where m.id = $1`, [id]);
  if (!rows[0]) throw notFound("mensaje no encontrado");
  return rows[0];
}

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  /**
   * Historial del canal, del más nuevo al más viejo.
   *
   * Se pagina por marca de tiempo (`before`) y no por número de página: en una
   * conversación viva, la página 2 cambia de contenido entre que se pide la 1 y
   * la 2, y se acaban viendo mensajes repetidos o saltados.
   */
  app.get("/channels/:channelId/messages", async (request) => {
    const userId = requireUser(request);
    const { channelId } = parseParams(z.object({ channelId: uuid }), request.params);
    const query = parseBody(
      z.object({
        before: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
      request.query,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${MESSAGE_COLUMNS} ${MESSAGE_FROM}
          where m.channel_id = $1
            and m.deleted_at is null
            and ($2::timestamptz is null or m.created_at < $2)
          order by m.created_at desc
          limit $3`,
        [channelId, query.before ?? null, query.limit],
      );
      // Se devuelven en orden de lectura; el orden inverso era solo para que
      // el LIMIT cogiera los últimos.
      return { messages: rows.reverse() };
    });
  });

  app.post("/channels/:channelId/messages", async (request, reply) => {
    const userId = requireUser(request);
    const { channelId } = parseParams(z.object({ channelId: uuid }), request.params);
    const body = parseBody(
      z.object({
        body: z.string().trim().min(1).max(8000),
        replyTo: uuid.nullish(),
        fileId: uuid.nullish(),
      }),
      request.body,
    );

    const message = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into messages (channel_id, author_id, body, reply_to, file_id)
         values ($1, $2, $3, $4, $5) returning id`,
        [channelId, userId, body.body, body.replyTo ?? null, body.fileId ?? null],
      );
      // Escribir cuenta como haber leído: no tiene sentido que tu propio
      // mensaje te deje el canal marcado como no leído.
      await db.query("select public.mark_channel_read($1)", [channelId]);
      const creado = await loadMessage(db, rows[0]!.id);

      // Menciones. `resolve_mentions` solo devuelve gente con acceso al canal,
      // así que escribir «@Alguien» en un canal privado no le notifica nada a
      // quien no está dentro — que además le revelaría que ese canal existe.
      // Esto fue falso hasta la migración 0008: la función miraba la
      // pertenencia a la organización y no el acceso al canal.
      const { rows: mencionados } = await db.query<{ user_id: string; display_name: string }>(
        "select user_id, display_name from public.resolve_mentions($1,$2)",
        [channelId, body.body],
      );

      const { rows: contexto } = await db.query<{ canal: string; workspace: string }>(
        `select c.name as canal, c.workspace_id::text as workspace
           from channels c where c.id = $1`,
        [channelId],
      );

      for (const mencionado of mencionados) {
        if (mencionado.user_id === userId) continue; // mencionarse a uno mismo no avisa
        await notificar(
          db,
          mencionado.user_id,
          "mention",
          `Te han mencionado en #${contexto[0]?.canal ?? "un canal"}`,
          body.body.slice(0, 140),
          `/app/w/${contexto[0]?.workspace ?? ""}/c/${channelId}`,
        ).catch(() => {
          // Que falle un aviso no debe tumbar el mensaje: lo importante ya
          // está escrito y repartido.
        });
      }

      return creado;
    });

    announceMessage(channelId, "created", message);
    return reply.status(201).send({ message });
  });

  app.patch("/messages/:messageId", async (request) => {
    const userId = requireUser(request);
    const { messageId } = parseParams(z.object({ messageId: uuid }), request.params);
    const body = parseBody(
      z.object({ body: z.string().trim().min(1).max(8000) }),
      request.body,
    );

    const message = await withUser(userId, async (db) => {
      const { rowCount } = await db.query(
        "update messages set body = $2, edited_at = now() where id = $1 and deleted_at is null",
        [messageId, body.body],
      );
      // La política solo deja editar al autor; para cualquier otro esto son
      // cero filas y no hay que explicar por qué.
      if (rowCount === 0) throw notFound("mensaje no encontrado");
      return loadMessage(db, messageId);
    });

    announceMessage(String(message.channelId), "updated", message);
    return { message };
  });

  app.delete("/messages/:messageId", async (request, reply) => {
    const userId = requireUser(request);
    const { messageId } = parseParams(z.object({ messageId: uuid }), request.params);

    const removed = await withUser(userId, async (db) => {
      // Borrado suave: las respuestas a este mensaje siguen teniendo sentido y
      // el hilo no se rompe. El cuerpo sí se vacía — «borrar» tiene que borrar
      // de verdad lo que se escribió.
      const { rows } = await db.query<{ channel_id: string }>(
        `update messages set deleted_at = now(), body = '(mensaje eliminado)'
          where id = $1 and deleted_at is null
          returning channel_id`,
        [messageId],
      );
      return rows[0]?.channel_id ?? null;
    });

    if (!removed) throw notFound("mensaje no encontrado");
    announceMessage(removed, "deleted", { id: messageId, channelId: removed });
    return reply.status(204).send();
  });

  app.post("/channels/:channelId/read", async (request, reply) => {
    const userId = requireUser(request);
    const { channelId } = parseParams(z.object({ channelId: uuid }), request.params);
    await withUser(userId, (db) =>
      db.query("select public.mark_channel_read($1)", [channelId]),
    );
    return reply.status(204).send();
  });

  app.get("/workspaces/:workspaceId/unread", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ channel_id: string; unread: string }>(
        "select channel_id, unread from public.unread_counts($1)",
        [workspaceId],
      );
      return {
        unread: Object.fromEntries(rows.map((r) => [r.channel_id, Number(r.unread)])),
      };
    });
  });
}
