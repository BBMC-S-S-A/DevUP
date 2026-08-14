import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { type Db, withUser } from "../db/pool.js";
import { notFound, parseBody, parseParams, requireUser } from "../lib/http.js";

const uuid = z.string().uuid();

const TASK_COLUMNS = `
  t.id, t.workspace_id as "workspaceId", t.column_id as "columnId",
  t.title, t.description, t.position, t.assignee_id as "assigneeId",
  t.due_date as "dueDate", t.created_at as "createdAt", t.updated_at as "updatedAt",
  p.display_name as "assigneeName",
  coalesce(
    (select json_agg(json_build_object('id', g.id, 'name', g.name, 'color', g.color)
                     order by g.name)
       from task_tags tt join tags g on g.id = tt.tag_id
      where tt.task_id = t.id),
    '[]'::json
  ) as tags`;

async function loadTask(db: Db, taskId: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query(
    `select ${TASK_COLUMNS} from tasks t
       left join profiles p on p.id = t.assignee_id
      where t.id = $1`,
    [taskId],
  );
  if (!rows[0]) throw notFound("tarea no encontrada");
  return rows[0];
}

/** Igual que en archivos: solo entran etiquetas de la organización del tablero. */
async function attachTaskTags(db: Db, taskId: string, tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) return;
  await db.query(
    `insert into task_tags (task_id, tag_id)
     select $1, g.id
       from tags g
      where g.id = any($2::uuid[])
        and g.organization_id = (
          select w.organization_id from tasks t
            join workspaces w on w.id = t.workspace_id
           where t.id = $1
        )
     on conflict do nothing`,
    [taskId, tagIds],
  );
}

const STEP = 1000;

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  /** El tablero entero en una consulta: columnas con sus tarjetas dentro. */
  app.get("/workspaces/:workspaceId/board", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);

    return withUser(userId, async (db) => {
      const { rows: columns } = await db.query(
        `select id, name, position from task_columns
          where workspace_id = $1 order by position, created_at`,
        [workspaceId],
      );

      const { rows: tasks } = await db.query(
        `select ${TASK_COLUMNS} from tasks t
           left join profiles p on p.id = t.assignee_id
          where t.workspace_id = $1
          order by t.position, t.created_at`,
        [workspaceId],
      );

      return {
        columns: columns.map((column) => ({
          ...column,
          tasks: tasks.filter((task) => task.columnId === column.id),
        })),
      };
    });
  });

  app.post("/workspaces/:workspaceId/columns", async (request, reply) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const body = parseBody(
      z.object({ name: z.string().trim().min(1).max(40) }),
      request.body,
    );

    const column = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into task_columns (workspace_id, name, position)
         values (
           $1, $2,
           coalesce((select max(position) from task_columns where workspace_id = $1), 0) + $3
         )
         returning id, name, position`,
        [workspaceId, body.name, STEP],
      );
      if (!rows[0]) throw notFound("workspace no encontrado");
      return rows[0];
    });

    return reply.status(201).send({ column: { ...column, tasks: [] } });
  });

  app.patch("/columns/:columnId", async (request) => {
    const userId = requireUser(request);
    const { columnId } = parseParams(z.object({ columnId: uuid }), request.params);
    const body = parseBody(
      z.object({ name: z.string().trim().min(1).max(40) }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        "update task_columns set name = $2 where id = $1 returning id, name, position",
        [columnId, body.name],
      );
      if (!rows[0]) throw notFound("columna no encontrada");
      return { column: rows[0] };
    });
  });

  app.delete("/columns/:columnId", async (request, reply) => {
    const userId = requireUser(request);
    const { columnId } = parseParams(z.object({ columnId: uuid }), request.params);
    // Las tareas caen con la columna por la cascada de la clave foránea. Es lo
    // que espera quien borra una columna llena, pero la interfaz avisa antes.
    await withUser(userId, (db) => db.query("delete from task_columns where id = $1", [columnId]));
    return reply.status(204).send();
  });

  app.post("/workspaces/:workspaceId/tasks", async (request, reply) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const body = parseBody(
      z.object({
        columnId: uuid,
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(4000).default(""),
        assigneeId: uuid.nullish(),
        dueDate: z.string().date().nullish(),
        tagIds: z.array(uuid).max(20).default([]),
      }),
      request.body,
    );

    const task = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into tasks
           (workspace_id, column_id, title, description, assignee_id, due_date, position, created_by)
         values (
           $1, $2, $3, $4, $5, $6,
           coalesce((select max(position) from tasks where column_id = $2), 0) + $7,
           $8
         )
         returning id`,
        [
          workspaceId,
          body.columnId,
          body.title,
          body.description,
          body.assigneeId ?? null,
          body.dueDate ?? null,
          STEP,
          userId,
        ],
      );
      const taskId = rows[0]!.id;
      await attachTaskTags(db, taskId, body.tagIds);
      return loadTask(db, taskId);
    });

    return reply.status(201).send({ task });
  });

  app.patch("/tasks/:taskId", async (request) => {
    const userId = requireUser(request);
    const { taskId } = parseParams(z.object({ taskId: uuid }), request.params);
    const body = parseBody(
      z.object({
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().max(4000).optional(),
        // `null` explícito significa «quitar el responsable», que es distinto
        // de no mandar el campo. De ahí `nullish().optional()` y el uso de
        // `in` más abajo en vez de comprobar si es falsy.
        assigneeId: uuid.nullish(),
        dueDate: z.string().date().nullish(),
        tagIds: z.array(uuid).max(20).optional(),
      }),
      request.body,
    );

    const body_ = body as Record<string, unknown>;

    return withUser(userId, async (db) => {
      const { rowCount } = await db.query(
        `update tasks set
           title       = coalesce($2, title),
           description = coalesce($3, description),
           assignee_id = case when $4 then $5::uuid else assignee_id end,
           due_date    = case when $6 then $7::date else due_date end
         where id = $1`,
        [
          taskId,
          body.title ?? null,
          body.description ?? null,
          "assigneeId" in body_,
          body.assigneeId ?? null,
          "dueDate" in body_,
          body.dueDate ?? null,
        ],
      );
      if (rowCount === 0) throw notFound("tarea no encontrada");

      if (body.tagIds) {
        await db.query("delete from task_tags where task_id = $1 and tag_id <> all($2::uuid[])", [
          taskId,
          body.tagIds,
        ]);
        await attachTaskTags(db, taskId, body.tagIds);
      }

      return { task: await loadTask(db, taskId) };
    });
  });

  /**
   * Mover una tarjeta.
   *
   * El cliente dice dónde la ha soltado —columna destino y tras qué tarjeta—,
   * y la posición la calcula el servidor. Podría calcularla el cliente y
   * mandarla ya hecha, pero entonces dos personas arrastrando a la vez sobre
   * el mismo hueco se pisarían con posiciones calculadas sobre estados
   * distintos. Aquí se resuelve dentro de una transacción, sobre lo que hay.
   */
  app.post("/tasks/:taskId/move", async (request) => {
    const userId = requireUser(request);
    const { taskId } = parseParams(z.object({ taskId: uuid }), request.params);
    const body = parseBody(
      z.object({ columnId: uuid, afterTaskId: uuid.nullish() }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows: previousRows } = await db.query<{ position: number }>(
        "select position from tasks where id = $1 and column_id = $2",
        [body.afterTaskId ?? null, body.columnId],
      );
      const previous = previousRows[0]?.position ?? null;

      const { rows: nextRows } = await db.query<{ position: number }>(
        `select position from tasks
          where column_id = $1 and id <> $2 and ($3::float8 is null or position > $3)
          order by position limit 1`,
        [body.columnId, taskId, previous],
      );
      const next = nextRows[0]?.position ?? null;

      const position =
        previous === null && next === null
          ? STEP
          : previous === null
            ? next! - STEP
            : next === null
              ? previous + STEP
              : (previous + next) / 2;

      const { rowCount } = await db.query(
        "update tasks set column_id = $2, position = $3 where id = $1",
        [taskId, body.columnId, position],
      );
      if (rowCount === 0) throw notFound("tarea no encontrada");

      return { task: await loadTask(db, taskId) };
    });
  });

  app.delete("/tasks/:taskId", async (request, reply) => {
    const userId = requireUser(request);
    const { taskId } = parseParams(z.object({ taskId: uuid }), request.params);
    await withUser(userId, (db) => db.query("delete from tasks where id = $1", [taskId]));
    return reply.status(204).send();
  });
}
