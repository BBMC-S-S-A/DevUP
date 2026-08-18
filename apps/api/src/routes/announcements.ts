import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
import { notificar } from "./notifications.js";

const uuid = z.string().uuid();

/**
 * El sistema de noticias.
 *
 * Publicar exige administrar la organización — la política `announcements_insert`
 * de 0019 lo exige, y una escritura sin permiso llega aquí como una violación
 * de RLS que `translateDbError` ya traduce a un 403 legible. Leer solo exige
 * ser miembro: una noticia es para todo el equipo, no solo para quien la
 * publicó.
 */
const COLUMNS = `
  a.id, a.organization_id as "organizationId", a.title, a.body,
  a.created_at as "createdAt", a.updated_at as "updatedAt",
  a.author_id as "authorId", coalesce(p.display_name, 'cuenta eliminada') as "authorName"`;

export async function announcementRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/organizations/:orgId/announcements", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNS} from announcements a
           left join profiles p on p.id = a.author_id
          where a.organization_id = $1
          order by a.created_at desc`,
        [orgId],
      );
      return { announcements: rows };
    });
  });

  /**
   * Publicar avisa a todo el resto de la organización, una notificación por
   * persona. `notify()` (0006) exige que emisor y destinatario compartan
   * organización, y aquí siempre la comparten porque la lista de miembros sale
   * de la misma organización que publica — nunca hace falta una función
   * `security definer` nueva para esto.
   *
   * En serie y con su propio `catch`: un correo que no llega a notificarse no
   * debería impedir que la noticia se dé por publicada, que es lo que de
   * verdad pidió quien la escribió.
   */
  app.post("/organizations/:orgId/announcements", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        title: z.string().trim().min(1).max(140),
        body: z.string().trim().min(1).max(4000),
      }),
      request.body,
    );

    const { announcement, miembros } = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into announcements (organization_id, author_id, title, body)
         values ($1,$2,$3,$4) returning id`,
        [orgId, userId, body.title, body.body],
      );
      const id = rows[0]!.id;

      const { rows: cargado } = await db.query(
        `select ${COLUMNS} from announcements a
           left join profiles p on p.id = a.author_id
          where a.id = $1`,
        [id],
      );

      const { rows: miembros } = await db.query<{ userId: string }>(
        `select user_id as "userId" from organization_members where organization_id = $1`,
        [orgId],
      );

      return { announcement: cargado[0], miembros };
    });

    await withUser(userId, async (db) => {
      for (const { userId: destinatario } of miembros) {
        if (destinatario === userId) continue;
        await notificar(
          db,
          destinatario,
          "announcement",
          "Noticia nueva",
          body.title,
          `/app/o/${orgId}/noticias`,
        ).catch(() => {});
      }
    });

    return reply.status(201).send({ announcement });
  });

  app.patch("/announcements/:id", async (request) => {
    const userId = requireUser(request);
    const { id } = parseParams(z.object({ id: uuid }), request.params);
    const body = parseBody(
      z.object({
        title: z.string().trim().min(1).max(140),
        body: z.string().trim().min(1).max(4000),
      }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `update announcements set title = $2, body = $3, updated_at = now()
          where id = $1
        returning id`,
        [id, body.title, body.body],
      );
      if (rows.length === 0) throw notFound("noticia no encontrada");

      const { rows: cargado } = await db.query(
        `select ${COLUMNS} from announcements a
           left join profiles p on p.id = a.author_id
          where a.id = $1`,
        [id],
      );
      return { announcement: cargado[0] };
    });
  });

  app.delete("/announcements/:id", async (request, reply) => {
    const userId = requireUser(request);
    const { id } = parseParams(z.object({ id: uuid }), request.params);
    await withUser(userId, (db) => db.query("delete from announcements where id = $1", [id]));
    return reply.status(204).send();
  });
}
