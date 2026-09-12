import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { type Db, withUser } from "../db/pool.js";
import { type Origen, anotar, recorta } from "../lib/actividad.js";
import { notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
import { notificar } from "./notifications.js";

const uuid = z.string().uuid();

const TASK_COLUMNS = `
  t.id, t.workspace_id as "workspaceId", t.column_id as "columnId",
  t.title, t.description, t.position, t.assignee_id as "assigneeId",
  t.due_date as "dueDate", t.created_at as "createdAt", t.updated_at as "updatedAt",
  t.category_id as "categoryId",
  p.display_name as "assigneeName",
  coalesce(
    (select json_agg(json_build_object('id', g.id, 'name', g.name, 'color', g.color)
                     order by g.name)
       from task_tags tt join tags g on g.id = tt.tag_id
      where tt.task_id = t.id),
    '[]'::json
  ) as tags,
  -- Cuántos adjuntos tiene, para que la tarjeta lo diga sin abrirla. El
  -- subselect se evalúa bajo RLS, así que cuenta solo lo que quien mira
  -- podría ver de todas formas.
  (select count(*) from files f
    where f.task_id = t.id and f.status = 'ready' and f.deleted_at is null
  )::int as "adjuntos"`;

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

/**
 * Avisa a quien recibe una tarea, salvo que se la haya asignado a sí mismo.
 *
 * El aviso no puede tirar la petición: la tarea ya está asignada y no se va a
 * desasignar porque la campana no suene. Pero tampoco se traga en silencio —
 * un aviso que no sale y que nadie anota es indistinguible de uno que nadie
 * leyó, y el síntoma («nunca me entero de lo que me asignan») no señala a la
 * causa. Por eso el registro es opcional en la firma pero se pasa siempre que
 * hay uno a mano.
 */
async function avisarAsignacion(
  db: Db,
  taskId: string,
  assigneeId: string,
  actorId: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  if (assigneeId === actorId) return;
  const { rows } = await db.query<{ title: string; workspace_id: string }>(
    "select title, workspace_id::text as workspace_id from tasks where id = $1",
    [taskId],
  );
  const tarea = rows[0];
  if (!tarea) return;
  await notificar(
    db,
    assigneeId,
    "task_assigned",
    "Te han asignado una tarea",
    tarea.title,
    `/app/w/${tarea.workspace_id}/board`,
  ).catch((fallo: unknown) => {
    log?.warn({ err: fallo, taskId, assigneeId }, "no se pudo avisar de una asignación");
  });
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  /** El tablero entero en una consulta: columnas con sus tarjetas dentro. */
  app.get("/workspaces/:workspaceId/board", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);

    return withUser(userId, async (db) => {
      const { rows: columns } = await db.query(
        `select id, name, position, is_terminal as "isTerminal" from task_columns
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

      // Las áreas viajan aparte y no dentro de las columnas: son el OTRO eje
      // del tablero, y meterlas dentro obligaría a repetirlas en cada columna.
      // La interfaz agrupa o filtra con ellas según le convenga.
      const { rows: categories } = await db.query(
        `select c.id, c.name, c.color, c.position,
                c.owner_id as "ownerId", p.display_name as "ownerName",
                (select count(*) from tasks t where t.category_id = c.id)::int as tareas
           from task_categories c
           left join profiles p on p.id = c.owner_id
          where c.workspace_id = $1
          order by c.position, c.name`,
        [workspaceId],
      );

      return {
        categories,
        columns: columns.map((column) => ({
          ...column,
          tasks: tasks.filter((task) => task.columnId === column.id),
        })),
      };
    });
  });

  // ---------------------------------------------------------------------
  // Áreas (categorías)
  //
  // El otro eje del tablero: la columna dice EN QUÉ ESTADO está algo, el área
  // dice DE QUÉ TRATA y de quién es. Ver la cabecera de la 0039 para por qué
  // no son etiquetas.
  // ---------------------------------------------------------------------

  app.get("/workspaces/:workspaceId/categories", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select c.id, c.name, c.color, c.position,
                c.owner_id as "ownerId", p.display_name as "ownerName",
                (select count(*) from tasks t where t.category_id = c.id)::int as tareas
           from task_categories c
           left join profiles p on p.id = c.owner_id
          where c.workspace_id = $1
          order by c.position, c.name`,
        [workspaceId],
      );
      return { categories: rows };
    });
  });

  app.post("/workspaces/:workspaceId/categories", async (request, reply) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(40),
        color: z.number().int().min(0).max(15).optional(),
        /** Quién la lleva. Puede quedarse sin dueño y decidirse después. */
        ownerId: uuid.nullish(),
      }),
      request.body,
    );

    const category = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into task_categories (workspace_id, name, color, owner_id, position, created_by)
         values (
           $1, $2, $3, $4,
           coalesce((select max(position) from task_categories where workspace_id = $1), 0) + $5,
           $6
         )
         returning id, name, color, position, owner_id as "ownerId"`,
        [workspaceId, body.name, body.color ?? 0, body.ownerId ?? null, STEP, userId],
      );
      if (!rows[0]) throw notFound("workspace no encontrado");
      return rows[0];
    });

    return reply.status(201).send({ category: { ...category, tareas: 0 } });
  });

  app.patch("/categories/:categoryId", async (request) => {
    const userId = requireUser(request);
    const { categoryId } = parseParams(z.object({ categoryId: uuid }), request.params);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(40).optional(),
        color: z.number().int().min(0).max(15).optional(),
        ownerId: uuid.nullish(),
      }),
      request.body,
    );
    const enviado = body as Record<string, unknown>;

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `update task_categories
            set name = coalesce($2, name),
                color = coalesce($3, color),
                owner_id = case when $4 then $5::uuid else owner_id end
          where id = $1
          returning id, name, color, position, owner_id as "ownerId"`,
        [
          categoryId,
          body.name ?? null,
          body.color ?? null,
          // `null` explícito significa «quítale el dueño», que no es lo mismo
          // que no mandar el campo. Mismo patrón que el responsable de una tarea.
          "ownerId" in enviado,
          body.ownerId ?? null,
        ],
      );
      if (!rows[0]) throw notFound("categoría no encontrada");
      return { category: rows[0] };
    });
  });

  app.delete("/categories/:categoryId", async (request, reply) => {
    const userId = requireUser(request);
    const { categoryId } = parseParams(z.object({ categoryId: uuid }), request.params);
    // Las tareas NO caen con ella: se quedan sin clasificar. Ver la 0039.
    await withUser(userId, (db) =>
      db.query("delete from task_categories where id = $1", [categoryId]),
    );
    return reply.status(204).send();
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
         returning id, name, position, is_terminal as "isTerminal"`,
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
      z
        .object({
          name: z.string().trim().min(1).max(40).optional(),
          /** Si terminar en esta columna cuenta como terminar (migración 0037). */
          isTerminal: z.boolean().optional(),
        })
        // Los dos campos son opcionales por separado, pero un PATCH sin
        // ninguno es una petición que no pide nada: se rechaza en vez de
        // devolver un 200 que no cambió nada, que es indistinguible de haber
        // funcionado.
        .refine((v) => v.name !== undefined || v.isTerminal !== undefined, {
          message: "no hay nada que cambiar: manda «name», «isTerminal» o los dos",
        }),
      request.body,
    );

    return withUser(userId, async (db) => {
      // `coalesce` para que mandar solo uno de los dos no borre el otro.
      const { rows } = await db.query(
        `update task_columns
            set name = coalesce($2, name),
                is_terminal = coalesce($3, is_terminal)
          where id = $1
          returning id, name, position, is_terminal as "isTerminal"`,
        [columnId, body.name ?? null, body.isTerminal ?? null],
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
        categoryId: uuid.nullish(),
      }),
      request.body,
    );

    const task = await withUser(userId, (db) =>
      crearTareaEnDb(
        db,
        {
          workspaceId,
          columnId: body.columnId,
          title: body.title,
          description: body.description,
          assigneeId: body.assigneeId ?? null,
          dueDate: body.dueDate ?? null,
          tagIds: body.tagIds,
          categoryId: body.categoryId ?? null,
          autor: userId,
        },
        request.log,
      ),
    );

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
        categoryId: uuid.nullish(),
      }),
      request.body,
    );

    const body_ = body as Record<string, unknown>;

    return withUser(userId, async (db) => {
      const { rows: previa } = await db.query<{
        assignee_id: string | null;
        title: string;
        workspace_id: string;
        category_id: string | null;
      }>("select assignee_id, title, workspace_id, category_id from tasks where id = $1", [taskId]);
      const anterior = previa[0]?.assignee_id ?? null;
      const areaAnterior = previa[0]?.category_id ?? null;

      const { rowCount } = await db.query(
        `update tasks set
           title       = coalesce($2, title),
           description = coalesce($3, description),
           assignee_id = case when $4 then $5::uuid else assignee_id end,
           due_date    = case when $6 then $7::date else due_date end,
           category_id = case when $8 then $9::uuid else category_id end
         where id = $1`,
        [
          taskId,
          body.title ?? null,
          body.description ?? null,
          "assigneeId" in body_,
          body.assigneeId ?? null,
          "dueDate" in body_,
          body.dueDate ?? null,
          "categoryId" in body_,
          body.categoryId ?? null,
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

      // Solo cuando la asignación cambia: guardar la tarjeta por cualquier otro
      // motivo no debe volver a avisar a quien ya la tenía.
      if ("assigneeId" in body_ && body.assigneeId && body.assigneeId !== anterior) {
        await avisarAsignacion(db, taskId, body.assigneeId, userId, request.log);
      }

      // El título del resumen es el de ANTES de este `patch` si también se
      // renombró en la misma llamada. Es lo correcto: la asignación ocurrió
      // sobre la tarjeta que existía, no sobre la que queda después.
      if ("assigneeId" in body_ && (body.assigneeId ?? null) !== anterior) {
        const titulo = recorta(previa[0]?.title ?? "");
        await anotar(db, {
          workspaceId: previa[0]!.workspace_id,
          actorId: userId,
          verbo: "tarea.asignada",
          objetoTipo: "tarea",
          objetoId: taskId,
          resumen: body.assigneeId ? `asignó «${titulo}»` : `quitó el responsable de «${titulo}»`,
          datos: { assigneeId: body.assigneeId ?? null, anterior },
        });
      }

      // Cambiar de área es mover trabajo de un frente a otro, así que deja
      // rastro. No hereda el delegado: reclasificar una tarea que ya tiene
      // responsable no debe quitársela a quien la estaba haciendo.
      if ("categoryId" in body_ && (body.categoryId ?? null) !== areaAnterior) {
        await anotar(db, {
          workspaceId: previa[0]!.workspace_id,
          actorId: userId,
          verbo: "tarea.reclasificada",
          objetoTipo: "tarea",
          objetoId: taskId,
          resumen: `cambió de área «${recorta(previa[0]?.title ?? "")}»`,
          datos: { categoryId: body.categoryId ?? null, anterior: areaAnterior },
        });
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

    return withUser(userId, async (db) => ({
      task: await moverTareaEnDb(db, taskId, body.columnId, body.afterTaskId ?? null, {
        actorId: userId,
      }),
    }));
  });

  app.delete("/tasks/:taskId", async (request, reply) => {
    const userId = requireUser(request);
    const { taskId } = parseParams(z.object({ taskId: uuid }), request.params);
    await withUser(userId, async (db) => {
      // Se lee antes de borrar porque después no hay a quién preguntarle el
      // título, y un «borró una tarea» sin decir cuál no sirve de nada.
      const { rows } = await db.query<{ title: string; workspace_id: string }>(
        "select title, workspace_id from tasks where id = $1",
        [taskId],
      );
      const { rowCount } = await db.query("delete from tasks where id = $1", [taskId]);
      if (rowCount === 0 || !rows[0]) return;

      await anotar(db, {
        workspaceId: rows[0].workspace_id,
        actorId: userId,
        verbo: "tarea.borrada",
        objetoTipo: "tarea",
        // Sin `objetoId`: la fila a la que apuntaría ya no existe, y guardar
        // el identificador de algo borrado invita a intentar resolverlo.
        objetoId: null,
        resumen: `borró «${recorta(rows[0].title)}»`,
        datos: { taskId },
      });
    });
    return reply.status(204).send();
  });
}

// ---------------------------------------------------------------------------
// Lo que comparten la ruta y el asistente de dentro del producto
//
// POR QUE ESTAN EXTRAIDAS. `asistente.ts` tambien crea y mueve tareas, y
// copiar el SQL alli habria perdido dos cosas en silencio: el calculo de la
// posicion —que decide donde cae la tarjeta en la columna— y el AVISO a quien
// recibe la tarea. Una tarea creada por el asistente que no notifica a su
// responsable es una tarea que nadie ve.
//
// Reciben `db` y no abren transaccion: la abre quien llama, con `withUser`, y
// asi el aislamiento por RLS es el mismo por los dos caminos.
// ---------------------------------------------------------------------------

export async function crearTareaEnDb(
  db: Db,
  datos: {
    workspaceId: string;
    columnId: string;
    title: string;
    description: string;
    assigneeId: string | null;
    dueDate: string | null;
    tagIds: string[];
    categoryId?: string | null;
    autor: string;
    /** Quién lo pidió de verdad. El asistente pasa `agente` para que su
     *  trabajo no se sume al de la persona en la auditoría. */
    origen?: Origen;
  },
  log?: FastifyBaseLogger,
): Promise<Record<string, unknown>> {
  // EL GESTO QUE HACE ÚTILES LAS ÁREAS: si la tarea se archiva en un área que
  // tiene dueño y nadie dijo a quién asignarla, se asigna a quien lleva esa
  // área. Se deja de repartir tareas una a una y se pasa a clasificarlas.
  // Un responsable explícito siempre gana: el automatismo rellena huecos, no
  // discute decisiones.
  let assigneeId = datos.assigneeId;
  if (!assigneeId && datos.categoryId) {
    const { rows: duenyo } = await db.query<{ owner_id: string | null }>(
      "select owner_id from task_categories where id = $1",
      [datos.categoryId],
    );
    assigneeId = duenyo[0]?.owner_id ?? null;
  }

  const { rows } = await db.query<{ id: string }>(
    `insert into tasks
       (workspace_id, column_id, title, description, assignee_id, due_date, position,
        created_by, category_id)
     values (
       $1, $2, $3, $4, $5, $6,
       coalesce((select max(position) from tasks where column_id = $2), 0) + $7,
       $8, $9
     )
     returning id`,
    [
      datos.workspaceId,
      datos.columnId,
      datos.title,
      datos.description,
      assigneeId,
      datos.dueDate,
      STEP,
      datos.autor,
      datos.categoryId ?? null,
    ],
  );
  const taskId = rows[0]!.id;
  await attachTaskTags(db, taskId, datos.tagIds);
  if (assigneeId) await avisarAsignacion(db, taskId, assigneeId, datos.autor, log);

  await anotar(db, {
    workspaceId: datos.workspaceId,
    actorId: datos.autor,
    origen: datos.origen ?? "persona",
    verbo: "tarea.creada",
    objetoTipo: "tarea",
    objetoId: taskId,
    resumen: `creó «${recorta(datos.title)}»`,
    datos: { columnId: datos.columnId, assigneeId, categoryId: datos.categoryId ?? null },
  });

  // Asignar al crear también es una asignación. Se anota aparte y no solo
  // dentro de `datos` para que la regla quede simple: TODA asignación es una
  // fila `tarea.asignada`. Si el nacimiento fuera la excepción, cualquier
  // consulta de «qué me han asignado» tendría que acordarse de mirar dos
  // verbos, y tarde o temprano alguna se olvidaría de uno.
  if (assigneeId) {
    await anotar(db, {
      workspaceId: datos.workspaceId,
      actorId: datos.autor,
      origen: datos.origen ?? "persona",
      verbo: "tarea.asignada",
      objetoTipo: "tarea",
      objetoId: taskId,
      resumen: `asignó «${recorta(datos.title)}»`,
      datos: { assigneeId, anterior: null },
    });
  }

  return loadTask(db, taskId);
}

export async function moverTareaEnDb(
  db: Db,
  taskId: string,
  columnId: string,
  afterTaskId: string | null,
  quien?: { actorId: string | null; origen?: Origen },
): Promise<Record<string, unknown>> {
  // El estado de partida, ANTES de tocar nada: de qué columna sale y si esa
  // columna terminaba. Es lo que convierte un movimiento en «cerró» o
  // «reabrió» en vez de en un genérico «movió», que es la diferencia entre
  // poder contestar «¿qué cerró Ana esta semana?» y no poder.
  const { rows: antesRows } = await db.query<{
    title: string;
    column_id: string;
    workspace_id: string;
    columna: string;
    terminal: boolean;
  }>(
    `select t.title, t.column_id, t.workspace_id, c.name as columna, c.is_terminal as terminal
       from tasks t join task_columns c on c.id = t.column_id
      where t.id = $1`,
    [taskId],
  );
  const antes = antesRows[0];
  if (!antes) throw notFound("tarea no encontrada");

  const { rows: previousRows } = await db.query<{ position: number }>(
    "select position from tasks where id = $1 and column_id = $2",
    [afterTaskId, columnId],
  );
  const previous = previousRows[0]?.position ?? null;

  const { rows: nextRows } = await db.query<{ position: number }>(
    `select position from tasks
      where column_id = $1 and id <> $2 and ($3::float8 is null or position > $3)
      order by position limit 1`,
    [columnId, taskId, previous],
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
    [taskId, columnId, position],
  );
  if (rowCount === 0) throw notFound("tarea no encontrada");

  // Reordenar dentro de la misma columna no se anota. Arrastrar una tarjeta
  // dos puestos arriba no es un hecho que nadie vaya a querer recordar, y
  // anotarlo llenaría la historia de ruido hasta esconder lo que sí importa.
  if (quien && antes.column_id !== columnId) {
    const { rows: destinoRows } = await db.query<{ name: string; is_terminal: boolean }>(
      "select name, is_terminal from task_columns where id = $1",
      [columnId],
    );
    const destino = destinoRows[0];

    const cierra = destino?.is_terminal === true && !antes.terminal;
    const reabre = destino?.is_terminal === false && antes.terminal;
    const verbo = cierra ? "tarea.cerrada" : reabre ? "tarea.reabierta" : "tarea.movida";
    const titulo = recorta(antes.title);
    const resumen = cierra
      ? `cerró «${titulo}»`
      : reabre
        ? `reabrió «${titulo}»`
        : `movió «${titulo}» de ${antes.columna} a ${destino?.name ?? "otra columna"}`;

    await anotar(db, {
      workspaceId: antes.workspace_id,
      actorId: quien.actorId,
      origen: quien.origen ?? "persona",
      verbo,
      objetoTipo: "tarea",
      objetoId: taskId,
      resumen,
      datos: {
        desde: { columnId: antes.column_id, nombre: antes.columna, terminal: antes.terminal },
        hasta: { columnId, nombre: destino?.name ?? null, terminal: destino?.is_terminal ?? null },
      },
    });
  }

  return loadTask(db, taskId);
}
