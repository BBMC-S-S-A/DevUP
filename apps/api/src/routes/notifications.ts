import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { type Db, withUser } from "../db/pool.js";
import { parseBody, parseParams, requireUser } from "../lib/http.js";
import { announceNotification } from "../realtime/signaling.js";

const uuid = z.string().uuid();

const COLUMNS = `
  n.id, n.kind, n.title, n.body, n.link,
  n.created_at as "createdAt", n.read_at as "readAt",
  coalesce(p.display_name, '') as "actorName"`;

/**
 * Crea una notificación y la empuja por el socket si la persona está conectada.
 *
 * `notify()` es SECURITY DEFINER —escribe en la bandeja de otro— y comprueba
 * dentro que emisor y destinatario comparten organización. Nunca se llama a la
 * tabla directamente desde aquí.
 */
export async function notificar(
  db: Db,
  destinatario: string,
  kind: "mention" | "task_assigned" | "invitation" | "recording" | "announcement",
  title: string,
  body: string,
  link: string,
): Promise<void> {
  const { rows } = await db.query<{ notify: string }>("select public.notify($1,$2,$3,$4,$5)", [
    destinatario,
    kind,
    title,
    body,
    link,
  ]);
  const id = rows[0]?.notify;
  if (!id) return;

  const { rows: creada } = await db.query(
    `select ${COLUMNS} from notifications n
       left join profiles p on p.id = n.actor_id
      where n.id = $1`,
    [id],
  );
  // La lectura va bajo RLS y la fila es de otra persona, así que aquí no
  // aparece. Se compone lo mínimo para el aviso en vivo; el detalle completo lo
  // carga el destinatario cuando abra la campana.
  announceNotification(destinatario, creada[0] ?? { id, kind, title, body, link });
}

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/notifications", async (request) => {
    const userId = requireUser(request);
    const query = parseBody(
      z.object({
        unreadOnly: z
          .string()
          .optional()
          .transform((v) => v === "true"),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }),
      request.query,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNS} from notifications n
           left join profiles p on p.id = n.actor_id
          where ($1::boolean is not true or n.read_at is null)
          order by n.created_at desc
          limit $2`,
        [query.unreadOnly, query.limit],
      );
      const { rows: pendientes } = await db.query<{ n: string }>(
        "select count(*)::text as n from notifications where read_at is null",
      );
      return { notifications: rows, unread: Number(pendientes[0]!.n) };
    });
  });

  app.post("/notifications/:id/read", async (request, reply) => {
    const userId = requireUser(request);
    const { id } = parseParams(z.object({ id: uuid }), request.params);
    await withUser(userId, (db) =>
      db.query("update notifications set read_at = now() where id = $1 and read_at is null", [id]),
    );
    return reply.status(204).send();
  });

  app.post("/notifications/read-all", async (request, reply) => {
    const userId = requireUser(request);
    await withUser(userId, (db) =>
      db.query("update notifications set read_at = now() where read_at is null"),
    );
    return reply.status(204).send();
  });
}
