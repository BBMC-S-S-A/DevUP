import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { type Db, withUser } from "../db/pool.js";
import { notFound, parseBody, parseParams, parseQuery, requireUser } from "../lib/http.js";
import { olvidarNodo, retejerTarea, vecinosDe } from "../lib/grafo.js";
import { detalleDeRama, ramasDe } from "../lib/ramas.js";
import { type Procedencia, anotar, recorta } from "../lib/actividad.js";
import { announceBoardChange } from "../realtime/signaling.js";
import { notificar } from "./notifications.js";

const uuid = z.string().uuid();

const TASK_COLUMNS = `
  t.id, t.workspace_id as "workspaceId", t.column_id as "columnId",
  t.title, t.description, t.position, t.assignee_id as "assigneeId",
  t.due_date as "dueDate", t.created_at as "createdAt", t.updated_at as "updatedAt",
  t.category_id as "categoryId",
  t.tipo, t.prioridad, t.contexto, t.criterio,
  p.display_name as "assigneeName",
  -- Las ramas viajan enteras en el tablero y no solo contadas: son dos o tres
  -- por tarjeta como mucho, y saber EN CUÁL se está tocando algo es justo lo
  -- que se mira sin abrir la tarjeta. Contarlas habría obligado a abrir cada
  -- una para responder «¿quién está en la rama de pagos?».
  coalesce(
    (select json_agg(json_build_object(
              'id', b.id, 'nombre', b.nombre, 'estado', b.estado,
              'repoId', b.github_repo_id, 'repo', r.full_name)
            order by b.created_at)
       from task_branches b
       left join github_repos r on r.id = b.github_repo_id
      where b.task_id = t.id),
    '[]'::json
  ) as ramas,
  -- La evidencia sí va contada: puede ser larga y con notas de párrafos, y en
  -- la tarjeta lo único que hace falta saber es si hay o no hay.
  (select count(*) from task_evidence e where e.task_id = t.id)::int as "evidencias",
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

/**
 * La evidencia entera, que solo se pide al abrir una tarjeta.
 *
 * No va en `TASK_COLUMNS` a propósito: un tablero de cuarenta tarjetas cargaría
 * cuarenta listas de notas que nadie está mirando. En la tarjeta basta con
 * saber cuántas hay; al abrirla, se quieren leer.
 */
const EVIDENCIA = `
  coalesce(
    (select json_agg(json_build_object(
              'id', e.id, 'tipo', e.tipo, 'url', e.url, 'titulo', e.titulo,
              'nota', e.nota, 'autorId', e.created_by,
              'autor', ep.display_name, 'creadaEn', e.created_at)
            order by e.created_at)
       from task_evidence e
       left join profiles ep on ep.id = e.created_by
      where e.task_id = t.id),
    '[]'::json
  ) as evidencia`;

async function loadTask(db: Db, taskId: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query(
    `select ${TASK_COLUMNS}, ${EVIDENCIA} from tasks t
       left join profiles p on p.id = t.assignee_id
      where t.id = $1`,
    [taskId],
  );
  if (!rows[0]) throw notFound("tarea no encontrada");
  return rows[0];
}

/**
 * El vocabulario de la ficha, compartido por crear y editar.
 *
 * Escrito una vez porque son dos rutas que tienen que aceptar exactamente lo
 * mismo: el día que se acepte un tipo nuevo al crear pero no al editar, el
 * síntoma será una tarjeta que no se deja corregir y nadie sabrá por qué.
 */
const TIPOS = [
  "funcionalidad",
  "arreglo",
  "mejora",
  "deuda",
  "investigacion",
  "documentacion",
  "diseno",
  "infraestructura",
] as const;

/** 0 baja · 1 normal · 2 alta · 3 urgente. Ver la cabecera de la 0042. */
const prioridadZ = z.number().int().min(0).max(3);
const tipoZ = z.enum(TIPOS);

const PRIORIDAD_EN_PALABRAS = ["baja", "normal", "alta", "urgente"] as const;

/**
 * Una evidencia, tal y como llega.
 *
 * La regla de «con algo dentro» la pone también la base (ver la 0042), y eso no
 * es duplicar por duplicar: aquí se comprueba para poder decir QUÉ falta —«una
 * nota sin texto no prueba nada»— en vez de devolver una violación de
 * restricción que nadie puede leer. Abajo se comprueba para que siga siendo
 * verdad aunque algún día alguien escriba por otra puerta.
 */
export const evidenciaZ = z
  .object({
    tipo: z.enum(["pr", "commit", "enlace", "nota"]),
    url: z.string().trim().url().max(2000).nullish(),
    titulo: z.string().trim().max(200).default(""),
    nota: z.string().trim().max(2000).default(""),
  })
  .refine((e) => e.tipo === "nota" || Boolean(e.url), {
    message: "una evidencia que no es una nota tiene que apuntar a algo: falta la URL",
    path: ["url"],
  })
  .refine((e) => e.tipo !== "nota" || e.nota.length > 0, {
    message: "una nota sin texto no prueba nada",
    path: ["nota"],
  });

type Evidencia = z.infer<typeof evidenciaZ>;

const COMO_SE_LLAMA_LA_PRUEBA: Record<Evidencia["tipo"], string> = {
  pr: "un PR",
  commit: "un commit",
  enlace: "un enlace",
  nota: "una nota",
};

/**
 * Guarda una evidencia y la anota. Compartida por las dos puertas —añadirla
 * suelta y cerrar con ella— para que las dos escriban lo mismo.
 */
export async function anotarEvidencia(
  db: Db,
  datos: {
    taskId: string;
    workspaceId: string;
    titulo: string;
    autor: string;
    evidencia: Evidencia;
  },
): Promise<void> {
  const e = datos.evidencia;
  await db.query(
    `insert into task_evidence (task_id, tipo, url, titulo, nota, created_by)
     values ($1, $2::public.evidence_kind, $3, $4, $5, $6)`,
    [datos.taskId, e.tipo, e.url ?? null, e.titulo, e.nota, datos.autor],
  );

  await anotar(db, {
    workspaceId: datos.workspaceId,
    actorId: datos.autor,
    verbo: "evidencio",
    sujeto: "tarea",
    sujetoId: datos.taskId,
    sujetoNombre: datos.titulo,
    detalle: { tipo: e.tipo, url: e.url ?? null },
  });

  // Las dos puertas de la evidencia —añadirla suelta y cerrar con ella— pasan
  // por aquí, así que tejer en este punto y no en cada ruta es lo que evita que
  // cerrar una tarea con su PR deje el grafo sin la arista que sí aparece al
  // adjuntar el mismo PR por separado.
  await retejerTarea(db, datos.taskId);
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
                (select count(*) from tasks t where t.category_id = c.id)::int as tareas,
                -- GERENTES EN PLURAL desde la 0050. El ownerId de abajo se
                -- queda solo por no romper a quien todavía lo lea: con uno
                -- solo, unas vacaciones dejan la rama sin nadie que responda, y
                -- devolver esa columna a secas enseñaría un dueño que ya no es
                -- el que manda — un dato viejo con cara de dato bueno.
                -- (Sin comillas invertidas ahí: esto vive dentro de una
                -- plantilla de JavaScript y una sola cerraría la cadena.)
                coalesce(
                  (select json_agg(json_build_object('id', p2.id, 'nombre', p2.display_name)
                                   order by p2.display_name)
                     from task_category_owners o
                     join profiles p2 on p2.id = o.user_id
                    where o.category_id = c.id),
                  '[]'::json
                ) as gerentes,
                c.owner_id as "ownerId", p.display_name as "ownerName"
           from task_categories c
           left join profiles p on p.id = c.owner_id
          where c.workspace_id = $1
          order by c.position, c.name`,
        [workspaceId],
      );
      return { categories: rows };
    });
  });

  /**
   * Las ramas de un espacio: quién responde de cada una y qué espera dentro.
   *
   * No sustituye a `/categories`, que es la lista para el filtro del tablero.
   * Esta contesta otra pregunta —«¿cómo va cada rama y dónde hay trabajo sin
   * repartir?»— y por eso trae recuentos que a un filtro le sobrarían.
   */
  app.get("/workspaces/:workspaceId/ramas", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const { dias } = parseQuery(
      z.object({ dias: z.coerce.number().int().min(1).max(90).default(7) }),
      request.query,
    );
    return withUser(userId, async (db) => ({
      dias,
      ramas: await ramasDe(db, { workspaceId, dias }),
    }));
  });

  /**
   * Lo que se abre al entrar en una rama.
   *
   * `porRepartir` es la promesa de la 0050: archivar en una rama NO asigna a
   * nadie, y lo que cae sin delegado espera aquí. `quienHaTrabajado` es el §6.1
   * que pidió la sesión de interfaz — con el matiz de qué significa exactamente,
   * que está en `lib/ramas.ts` y no es lo mismo que la frase corta.
   */
  app.get("/categories/:categoryId/rama", async (request) => {
    const userId = requireUser(request);
    const { categoryId } = parseParams(z.object({ categoryId: uuid }), request.params);
    const { dias } = parseQuery(
      z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }),
      request.query,
    );
    return withUser(userId, async (db) => ({
      dias,
      ...(await detalleDeRama(db, { categoryId, dias })),
    }));
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
      const { rows } = await db.query<{ id: string }>(
        `insert into task_categories (workspace_id, name, color, position, created_by)
         values (
           $1, $2, $3,
           coalesce((select max(position) from task_categories where workspace_id = $1), 0) + $4,
           $5
         )
         returning id, name, color, position`,
        [workspaceId, body.name, body.color ?? 0, STEP, userId],
      );
      if (!rows[0]) throw notFound("workspace no encontrado");

      // EL `ownerId` DE ENTRADA SE SIGUE ACEPTANDO, PERO YA NO ESCRIBE LA
      // COLUMNA. La 0050 retiró `task_categories.owner_id` —«no escribir
      // aquí»— y movió los gerentes a su propia tabla, en plural. Quitar el
      // campo de la petición habría roto en silencio a quien lo manda (el MCP
      // manda un responsable al crear un área), así que se traduce.
      if (body.ownerId) {
        await db.query("select public.set_category_owner($1,$2,true)", [
          rows[0].id,
          body.ownerId,
        ]);
      }
      return rows[0];
    });

    return reply.status(201).send({ category: { ...category, tareas: 0, gerentes: [] } });
  });

  app.patch("/categories/:categoryId", async (request) => {
    const userId = requireUser(request);
    const { categoryId } = parseParams(z.object({ categoryId: uuid }), request.params);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(40).optional(),
        color: z.number().int().min(0).max(15).optional(),
      }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `update task_categories
            set name = coalesce($2, name),
                color = coalesce($3, color)
          where id = $1
          returning id, name, color, position`,
        [categoryId, body.name ?? null, body.color ?? null],
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

  /**
   * Quién responde de una rama. En plural desde la 0050.
   *
   * POR QUÉ UNA RUTA APARTE Y NO UN CAMPO DEL PATCH. Porque ya no es un campo:
   * son varias personas, y el gesto real es «añade a este» o «quita a este»,
   * no «la lista de gerentes ahora es esta». Mandar la lista entera convierte
   * dos personas editando a la vez en una que borra a la otra sin enterarse.
   *
   * QUIÉN PUEDE: lo decide `set_category_owner`, y pide poder GESTIONAR el
   * espacio, no solo verlo — nombrar a quien responde de un área es repartir
   * poder, no clasificar. La misma respuesta para «no existe» y «no es tuya»,
   * para que no se puedan probar identificadores.
   *
   * Idempotentes las dos: poner a quien ya está, o quitar a quien no está, no
   * es un error — es el estado que se pedía.
   */
  app.put("/categories/:categoryId/gerentes/:userId", async (request) => {
    const quienLlama = requireUser(request);
    const { categoryId, userId } = parseParams(
      z.object({ categoryId: uuid, userId: uuid }),
      request.params,
    );
    await withUser(quienLlama, (db) =>
      db.query("select public.set_category_owner($1,$2,true)", [categoryId, userId]),
    );
    return { gerente: true };
  });

  app.delete("/categories/:categoryId/gerentes/:userId", async (request) => {
    const quienLlama = requireUser(request);
    const { categoryId, userId } = parseParams(
      z.object({ categoryId: uuid, userId: uuid }),
      request.params,
    );
    await withUser(quienLlama, (db) =>
      db.query("select public.set_category_owner($1,$2,false)", [categoryId, userId]),
    );
    return { gerente: false };
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
        tipo: tipoZ.nullish(),
        prioridad: prioridadZ.optional(),
        contexto: z.string().trim().max(4000).default(""),
        criterio: z.string().trim().max(4000).default(""),
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
          tipo: body.tipo ?? null,
          prioridad: body.prioridad,
          contexto: body.contexto,
          criterio: body.criterio,
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
        // `tipo` usa el mismo truco que `assigneeId`: `null` explícito es
        // «quitar el tipo», que no es lo mismo que no mandar el campo.
        tipo: tipoZ.nullish(),
        prioridad: prioridadZ.optional(),
        contexto: z.string().trim().max(4000).optional(),
        criterio: z.string().trim().max(4000).optional(),
      }),
      request.body,
    );

    const body_ = body as Record<string, unknown>;

    return withUser(userId, async (db) => {
      // De paso se trae el espacio y su organización: hacen falta para el
      // renglón del registro y `loadTask` no devuelve la organización. Y el
      // área y el título, que son del camino B: el título tiene que ser el de
      // ANTES de este `patch`, porque la asignación ocurrió sobre la tarjeta
      // que existía y no sobre la que queda después.
      const { rows: previa } = await db.query<{
        assignee_id: string | null;
        workspace_id: string;
        organization_id: string;
        title: string;
        category_id: string | null;
        prioridad: number;
      }>(
        `select t.assignee_id, t.workspace_id, w.organization_id, t.title, t.category_id,
                t.prioridad
           from tasks t join workspaces w on w.id = t.workspace_id
          where t.id = $1`,
        [taskId],
      );
      const anterior = previa[0]?.assignee_id ?? null;
      const areaAnterior = previa[0]?.category_id ?? null;
      const prioridadAnterior = previa[0]?.prioridad ?? 1;

      const { rowCount } = await db.query(
        `update tasks set
           title       = coalesce($2, title),
           description = coalesce($3, description),
           assignee_id = case when $4 then $5::uuid else assignee_id end,
           due_date    = case when $6 then $7::date else due_date end,
           category_id = case when $8 then $9::uuid else category_id end,
           tipo        = case when $10 then $11::public.task_kind else tipo end,
           prioridad   = coalesce($12, prioridad),
           contexto    = coalesce($13, contexto),
           criterio    = coalesce($14, criterio)
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
          "tipo" in body_,
          body.tipo ?? null,
          body.prioridad ?? null,
          body.contexto ?? null,
          body.criterio ?? null,
        ],
      );
      if (rowCount === 0) throw notFound("tarea no encontrada");

      // El ÚNICO cambio de campo que deja rastro. Subir algo a urgente es una
      // decisión que alguien tomó y que otro querrá entender después —«¿por qué
      // se paró todo el martes?»—; corregir el tipo o el contexto es arreglar
      // la ficha, y anotarlo llenaría la historia de ruido hasta esconder lo
      // que importa.
      if (body.prioridad !== undefined && body.prioridad !== prioridadAnterior) {
        const sube = body.prioridad > prioridadAnterior;
        await anotar(db, {
          workspaceId: previa[0]!.workspace_id,
          actorId: userId,
          verbo: "priorizo",
          sujeto: "tarea",
          sujetoId: taskId,
          sujetoNombre: previa[0]?.title ?? "",
          detalle: {
            a: PRIORIDAD_EN_PALABRAS[body.prioridad],
            de: PRIORIDAD_EN_PALABRAS[prioridadAnterior],
            sube,
          },
        });
      }

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

      const tarea = await loadTask(db, taskId);

      // Un `PATCH` puede traer varias cosas a la vez, pero el registro cuenta
      // una sola: la que le importa a quien lo lee después. Cambiar de
      // responsable es lo que se pregunta —«¿quién se la quedó?»— y renombrar,
      // lo segundo. Mover la fecha o retocar el texto no merece un renglón:
      // llenaría la historia de ruido y taparía lo que sí se busca.
      const cambioResponsable = "assigneeId" in body_ && (body.assigneeId ?? null) !== anterior;
      if (cambioResponsable || body.title !== undefined) {
        await anotar(db, {
          workspaceId: previa[0]!.workspace_id,
          organizationId: previa[0]!.organization_id,
          actorId: userId,
          verbo: cambioResponsable ? (body.assigneeId ? "asigno" : "desasigno") : "renombro",
          sujeto: "tarea",
          sujetoId: taskId,
          sujetoNombre: String(tarea.title ?? ""),
          detalle: cambioResponsable ? { a: body.assigneeId ?? null } : {},
        });
      }

      // Reclasificar viene del camino B y se conserva: cambiar de área es mover
      // trabajo de un frente a otro, y quien lea la historia después va a
      // preguntar por qué esto dejó de estar donde estaba. No hereda el
      // delegado del área nueva, a propósito: reclasificar una tarea que ya
      // tiene responsable no debe quitársela a quien la está haciendo.
      if ("categoryId" in body_ && (body.categoryId ?? null) !== areaAnterior) {
        await anotar(db, {
          workspaceId: previa[0]!.workspace_id,
          organizationId: previa[0]!.organization_id,
          actorId: userId,
          verbo: "reclasifico",
          sujeto: "tarea",
          sujetoId: taskId,
          sujetoNombre: String(tarea.title ?? ""),
          detalle: { a: body.categoryId ?? null, de: areaAnterior },
        });
      }

      announceBoardChange(String(tarea.workspaceId), "updated", taskId);
      return { task: tarea };
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
        userId,
      }),
    }));
  });

  /**
   * Una tarea entera, con su evidencia.
   *
   * El tablero no la trae —cuarenta tarjetas serían cuarenta listas de notas
   * que nadie está mirando—, así que al abrir una tarjeta hace falta esta.
   */
  app.get("/tasks/:taskId", async (request) => {
    const userId = requireUser(request);
    const { taskId } = parseParams(z.object({ taskId: uuid }), request.params);
    return withUser(userId, async (db) => ({ task: await loadTask(db, taskId) }));
  });

  /**
   * Todo lo que rodea a una tarea, de una vez.
   *
   * ES LA TESIS DEL PRODUCTO EN UNA RUTA. Lo que se pierde al volver a algo que
   * se dejó hace tres semanas no es el código: es **por qué se hizo así**. Esa
   * respuesta existe, pero repartida —en quién la movió y cuándo, en la rama
   * donde se tocó, en el PR que la cerró, en el archivo que alguien colgó—, y
   * juntarla a mano son seis pantallas y media hora. Esto la junta.
   *
   * ─────────────────────────────────────────────────────────────────────────
   *
   * UNA PETICIÓN Y NO SEIS, por lo mismo que `/me/inicio`. Seis peticiones
   * encadenadas no son solo más lentas: son seis oportunidades de pintar media
   * pantalla y dejar la otra media girando, y quien la mira no sabe si lo que
   * falta es que no existe o que no ha llegado.
   *
   * LA HISTORIA VA HACIA DELANTE, al revés que en todas las demás rutas del
   * registro. Allí lo último arriba es lo correcto —se mira para ponerse al
   * día—. Aquí se lee para reconstruir, y una reconstrucción se cuenta desde el
   * principio: primero se creó, luego se asignó, luego se movió. Del revés hay
   * que leerla dos veces.
   *
   * Y LO QUE NO ESTÁ ENLAZADO, NO SE INVENTA. La tentación aquí es rellenar:
   * buscar mensajes que mencionen el título, grabaciones de esa semana,
   * archivos del mismo espacio. Todo eso son conjeturas, y una conjetura
   * metida entre hechos no se distingue de un hecho — se lee con la misma
   * confianza y decide igual. Lo que sale es lo que el grafo tiene tejido: lo
   * deducido de algo cierto, o lo que enlazó una persona. Si está vacío, está
   * vacío, y eso también es una respuesta.
   */
  app.get("/tasks/:taskId/contexto", async (request) => {
    const userId = requireUser(request);
    const { taskId } = parseParams(z.object({ taskId: uuid }), request.params);

    return withUser(userId, async (db) => {
      // `loadTask` lanza si RLS no devuelve la fila, así que lo de abajo solo
      // corre para quien puede ver la tarea. No hace falta comprobarlo aparte.
      const task = await loadTask(db, taskId);

      const [historia, enlaces] = await Promise.all([
        db.query(
          `select a.verb as "verbo", a.detail as "detalle", a.source as "procedencia",
                  a.at as "cuando", a.actor_id as "actorId",
                  p.display_name as "actorNombre"
             from activity a
             left join profiles p on p.id = a.actor_id
            where a.subject_id = $1 and a.subject_type = 'tarea'
            order by a.at asc
            limit 200`,
          [taskId],
        ),
        vecinosDe(db, "tarea", taskId),
      ]);

      return { task, historia: historia.rows, enlaces };
    });
  });

  // --- Las ramas donde se está tocando --------------------------------------
  //
  // Varias por tarea a propósito (ver la 0042): un plan partido en dos caminos
  // son dos ramas de la misma tarea, no dos tareas.

  app.post("/tasks/:taskId/ramas", async (request, reply) => {
    const userId = requireUser(request);
    const { taskId } = parseParams(z.object({ taskId: uuid }), request.params);
    const body = parseBody(
      z.object({
        nombre: z.string().trim().min(1).max(255),
        repoId: uuid.nullish(),
        estado: z.enum(["abierta", "fusionada", "descartada"]).default("abierta"),
      }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows: previa } = await db.query<{ title: string; workspace_id: string }>(
        "select title, workspace_id from tasks where id = $1",
        [taskId],
      );
      if (!previa[0]) throw notFound("tarea no encontrada");

      // `on conflict do update` y no `do nothing`: apuntar dos veces la misma
      // rama es lo que hace alguien que quiere corregir su estado, y contestar
      // «ya estaba» con un 200 vacío deja la pantalla enseñando lo viejo.
      const { rows } = await db.query<{ id: string }>(
        `insert into task_branches (task_id, nombre, github_repo_id, estado, created_by)
         values ($1, $2, $3, $4::public.branch_state, $5)
         on conflict (task_id, github_repo_id, nombre)
           do update set estado = excluded.estado
         returning id`,
        [taskId, body.nombre, body.repoId ?? null, body.estado, userId],
      );

      await anotar(db, {
        workspaceId: previa[0].workspace_id,
        actorId: userId,
        verbo: "enlazo",
        sujeto: "tarea",
        sujetoId: taskId,
        sujetoNombre: previa[0].title,
        detalle: { rama: recorta(body.nombre, 40), repoId: body.repoId ?? null, estado: body.estado },
      });

      await retejerTarea(db, taskId);

      return reply.status(201).send({ task: await loadTask(db, taskId), ramaId: rows[0]!.id });
    });
  });

  /**
   * Cambiar el estado de una rama.
   *
   * `descartada` no es lo mismo que borrarla, y por eso existe: un camino que
   * se probó y se abandonó es información —quien lo vuelva a pensar ya sabe que
   * se intentó— y borrar la fila la tira.
   */
  app.patch("/ramas/:ramaId", async (request) => {
    const userId = requireUser(request);
    const { ramaId } = parseParams(z.object({ ramaId: uuid }), request.params);
    const body = parseBody(
      z.object({ estado: z.enum(["abierta", "fusionada", "descartada"]) }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ task_id: string }>(
        `update task_branches set estado = $2::public.branch_state
          where id = $1 returning task_id`,
        [ramaId, body.estado],
      );
      if (!rows[0]) throw notFound("esa rama no existe");
      // Sin retejer a propósito: el enlace dice «esta tarea se toca en este
      // repositorio», y eso sigue siendo verdad cuando la rama se descarta. Un
      // camino que se probó y se abandonó se tocó igual.
      return { task: await loadTask(db, rows[0].task_id) };
    });
  });

  app.delete("/ramas/:ramaId", async (request, reply) => {
    const userId = requireUser(request);
    const { ramaId } = parseParams(z.object({ ramaId: uuid }), request.params);
    await withUser(userId, async (db) => {
      const { rows } = await db.query<{ task_id: string }>(
        "delete from task_branches where id = $1 returning task_id",
        [ramaId],
      );
      // Quitarla sí, porque quitarla dice que nunca estuvo. Y si RLS no dejó
      // borrar, no hay filas y no hay nada que rehacer.
      if (rows[0]) await retejerTarea(db, rows[0].task_id);
    });
    return reply.status(204).send();
  });

  // --- La evidencia ---------------------------------------------------------

  app.post("/tasks/:taskId/evidencia", async (request, reply) => {
    const userId = requireUser(request);
    const { taskId } = parseParams(z.object({ taskId: uuid }), request.params);
    const body = parseBody(evidenciaZ, request.body);

    return withUser(userId, async (db) => {
      const { rows: previa } = await db.query<{ title: string; workspace_id: string }>(
        "select title, workspace_id from tasks where id = $1",
        [taskId],
      );
      if (!previa[0]) throw notFound("tarea no encontrada");

      await anotarEvidencia(db, {
        taskId,
        workspaceId: previa[0].workspace_id,
        titulo: previa[0].title,
        autor: userId,
        evidencia: body,
      });

      return reply.status(201).send({ task: await loadTask(db, taskId) });
    });
  });

  /**
   * Quitar una evidencia.
   *
   * Es la única forma de corregir una: la tabla no tiene política de UPDATE a
   * propósito (ver la 0042), porque cambiar en silencio lo que alguien afirmó
   * dejando su nombre debajo es justo lo que un registro de pruebas no puede
   * permitir. Borrar y volver a poner sí deja rastro de las dos cosas.
   */
  app.delete("/evidencia/:evidenciaId", async (request, reply) => {
    const userId = requireUser(request);
    const { evidenciaId } = parseParams(z.object({ evidenciaId: uuid }), request.params);
    await withUser(userId, async (db) => {
      const { rows } = await db.query<{ task_id: string }>(
        "delete from task_evidence where id = $1 returning task_id",
        [evidenciaId],
      );
      if (rows[0]) await retejerTarea(db, rows[0].task_id);
    });
    return reply.status(204).send();
  });

  /**
   * Marcar como hecha, con su prueba en el mismo gesto.
   *
   * POR QUÉ NO BASTA CON ARRASTRARLA A «HECHO», que ya funciona. Porque son dos
   * gestos distintos y esta ruta es la que hace que la evidencia exista de
   * verdad: si adjuntar la prueba fuera un paso aparte —cerrar primero, abrir
   * la tarjeta después y pegar el PR—, nadie daría el segundo. Aquí las dos
   * cosas caen en la misma transacción: **o se cerró con su prueba, o no se
   * cerró**.
   *
   * LA COLUMNA DESTINO NO SE PIDE, SE BUSCA. Quien cierra una tarea no está
   * pensando en qué columna es la terminal de este tablero, está pensando en
   * que ya está. Si hay varias terminales se coge la primera por posición, que
   * es la que la pantalla enseña antes.
   *
   * Y NO SE EXIGE LA EVIDENCIA. Se ofrece. Hacerla obligatoria convertiría la
   * primera tarea sin PR —una decisión, una llamada, algo que se resolvió
   * hablando— en un callejón sin salida, y la respuesta de la gente a un campo
   * obligatorio que estorba es escribir «ok» y seguir.
   */
  app.post("/tasks/:taskId/hecha", async (request) => {
    const userId = requireUser(request);
    const { taskId } = parseParams(z.object({ taskId: uuid }), request.params);
    const body = parseBody(
      z.object({ evidencia: evidenciaZ.optional() }),
      request.body ?? {},
    );

    return withUser(userId, async (db) => {
      const { rows: previa } = await db.query<{ title: string; workspace_id: string }>(
        "select title, workspace_id from tasks where id = $1",
        [taskId],
      );
      if (!previa[0]) throw notFound("tarea no encontrada");

      const { rows: terminal } = await db.query<{ id: string }>(
        `select id from task_columns
          where workspace_id = $1 and is_terminal
          order by position limit 1`,
        [previa[0].workspace_id],
      );
      if (!terminal[0]) {
        throw notFound(
          "este tablero no tiene ninguna columna marcada como final: " +
            "marca una en los ajustes de la columna y vuelve a intentarlo",
        );
      }

      // La evidencia ANTES de mover: así, si algo falla al cerrar, no queda una
      // prueba colgando de una tarea que sigue abierta. La transacción lo
      // garantiza en los dos sentidos, pero el orden deja la intención clara.
      if (body.evidencia) {
        await anotarEvidencia(db, {
          taskId,
          workspaceId: previa[0].workspace_id,
          titulo: previa[0].title,
          autor: userId,
          evidencia: body.evidencia,
        });
      }

      await moverTareaEnDb(db, taskId, terminal[0].id, null, { userId });
      return { task: await loadTask(db, taskId) };
    });
  });

  app.delete("/tasks/:taskId", async (request, reply) => {
    const userId = requireUser(request);
    const { taskId } = parseParams(z.object({ taskId: uuid }), request.params);
    try {
      await withUser(userId, async (db) => {
        // Se lee antes de borrar: después no queda de dónde sacar ni el título ni
        // el espacio, y un renglón que dice «borró algo» no es un renglón.
        const { rows } = await db.query<{
          workspace_id: string;
          organization_id: string;
          title: string;
        }>(
          `select t.workspace_id, w.organization_id, t.title
             from tasks t join workspaces w on w.id = t.workspace_id
            where t.id = $1`,
          [taskId],
        );
        const previa = rows[0];
        if (!previa) return;

        // Antes del borrado, y no después: ver `olvidarNodo`. Cuando la fila ya
        // no está, sus enlaces dejan de ser alcanzables —la política exige ver
        // los dos extremos— y se quedan en la tabla para siempre.
        await olvidarNodo(db, "tarea", taskId);

        const { rowCount } = await db.query("delete from tasks where id = $1", [taskId]);
        // Si RLS no dejó borrar, lo de arriba habría tirado los enlaces de una
        // tarea que sigue existiendo. Se sale por excepción para que la
        // transacción de `withUser` se deshaga entera; fuera se vuelve al 204 de
        // siempre, que es lo que esta ruta contestaba ya en ese caso.
        if (!rowCount) throw new NoSeBorro();

        await anotar(db, {
          workspaceId: previa.workspace_id,
          organizationId: previa.organization_id,
          actorId: userId,
          verbo: "borro",
          sujeto: "tarea",
          // Sin `sujetoId`: la tarea ya no existe, y apuntar a una fila que no
          // está invita a hacerle un `join` que no devolverá nada.
          sujetoNombre: previa.title,
        });
        announceBoardChange(previa.workspace_id, "deleted", taskId);
      });
    } catch (fallo) {
      if (!(fallo instanceof NoSeBorro)) throw fallo;
    }
    return reply.status(204).send();
  });
}

/**
 * «La tarea no se borró, deshaz la transacción.»
 *
 * No es un error de la petición —quien no puede borrar recibe el mismo 204 que
 * antes—, sino la forma de que el `rollback` de `withUser` recupere los enlaces
 * que se quitaron por adelantado. Tiene clase propia y no es un `Error` suelto
 * para que el `catch` de arriba no se trague, de paso, un fallo de verdad.
 */
class NoSeBorro extends Error {}

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
    tipo?: string | null;
    prioridad?: number;
    contexto?: string;
    criterio?: string;
    autor: string;
    /** Quién la crea de verdad: una persona, o un agente por la puerta MCP. */
    procedencia?: Procedencia;
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
        created_by, category_id, tipo, prioridad, contexto, criterio)
     values (
       $1, $2, $3, $4, $5, $6,
       coalesce((select max(position) from tasks where column_id = $2), 0) + $7,
       $8, $9, $10::public.task_kind, coalesce($11, 1), coalesce($12, ''), coalesce($13, '')
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
      datos.tipo ?? null,
      datos.prioridad ?? null,
      datos.contexto ?? null,
      datos.criterio ?? null,
    ],
  );
  const taskId = rows[0]!.id;
  await attachTaskTags(db, taskId, datos.tagIds);
  if (datos.assigneeId) await avisarAsignacion(db, taskId, datos.assigneeId, datos.autor, log);

  const { rows: deQuien } = await db.query<{ organization_id: string }>(
    "select organization_id from workspaces where id = $1",
    [datos.workspaceId],
  );
  const organizationId = deQuien[0]?.organization_id ?? "";

  await anotar(db, {
    workspaceId: datos.workspaceId,
    organizationId,
    actorId: datos.autor,
    procedencia: datos.procedencia,
    verbo: "creo",
    sujeto: "tarea",
    sujetoId: taskId,
    sujetoNombre: datos.title,
  });

  // Asignar al crear TAMBIÉN es una asignación, y va en su propio renglón. Es
  // del camino B y se conserva porque la regla que deja es la simple: toda
  // asignación es una fila `asigno`. Si el nacimiento fuera la excepción,
  // cualquier consulta de «qué me han asignado» tendría que acordarse de mirar
  // dos verbos, y tarde o temprano alguna se olvidaría de uno.
  if (datos.assigneeId) {
    await anotar(db, {
      workspaceId: datos.workspaceId,
      organizationId,
      actorId: datos.autor,
      procedencia: datos.procedencia,
      verbo: "asigno",
      sujeto: "tarea",
      sujetoId: taskId,
      sujetoNombre: datos.title,
      detalle: { a: datos.assigneeId },
    });
  }

  const tarea = await loadTask(db, taskId);
  announceBoardChange(datos.workspaceId, "created", taskId);
  return tarea;
}

/**
 * De dónde a dónde va una tarjeta, y si eso significa cerrarla.
 *
 * Se lee ANTES de mover, porque después ya no se puede saber de qué columna
 * venía. Y sirve para las dos cosas que hay que anotar: el detalle del
 * renglón —«de Por hacer a En curso»— y el verbo, que no es el mismo si la
 * columna de destino es terminal: eso no es mover, es cerrar, y es la
 * pregunta que se le hace al registro («¿cuántas cerró esta semana?»).
 *
 * `mismaColumna` viene del camino B y arregla un ruido que este lado tenía:
 * arrastrar una tarjeta dos puestos dentro de su propia columna escribía un
 * «movió … de Por hacer a Por hacer». Reordenar no es un hecho que nadie vaya
 * a querer recordar, y anotarlo esconde lo que sí importa.
 */
async function saltoDeColumna(
  db: Db,
  taskId: string,
  columnId: string,
): Promise<{
  workspaceId: string;
  organizationId: string;
  titulo: string;
  desde: string | null;
  hasta: string | null;
  cierra: boolean;
  reabre: boolean;
  mismaColumna: boolean;
}> {
  const { rows } = await db.query<{
    workspace_id: string;
    organization_id: string;
    title: string;
    misma: boolean;
    desde: string | null;
    desde_terminal: boolean | null;
    hasta: string | null;
    hasta_terminal: boolean | null;
  }>(
    `select t.workspace_id, w.organization_id, t.title,
            (t.column_id = $2) as misma,
            origen.name as desde, origen.is_terminal as desde_terminal,
            destino.name as hasta, destino.is_terminal as hasta_terminal
       from tasks t
       join workspaces w on w.id = t.workspace_id
       left join task_columns origen on origen.id = t.column_id
       left join task_columns destino on destino.id = $2
      where t.id = $1`,
    [taskId, columnId],
  );
  const f = rows[0];
  return {
    workspaceId: f?.workspace_id ?? "",
    organizationId: f?.organization_id ?? "",
    titulo: f?.title ?? "",
    desde: f?.desde ?? null,
    hasta: f?.hasta ?? null,
    cierra: Boolean(f?.hasta_terminal) && !f?.desde_terminal,
    reabre: Boolean(f?.desde_terminal) && !f?.hasta_terminal,
    mismaColumna: Boolean(f?.misma),
  };
}

export async function moverTareaEnDb(
  db: Db,
  taskId: string,
  columnId: string,
  afterTaskId: string | null,
  /**
   * Quién la mueve. Opcional porque no todos los caminos tienen persona
   * —el asistente de dentro mueve por su cuenta— y un renglón sin actor sigue
   * valiendo: dice qué pasó aunque no diga quién.
   */
  actor?: { userId: string | null; procedencia?: Procedencia },
): Promise<Record<string, unknown>> {
  const salto = await saltoDeColumna(db, taskId, columnId);

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

  // Reordenar dentro de la misma columna NO se anota (ver `saltoDeColumna`).
  // El renglón va DENTRO de la transacción de quien llama: si el movimiento se
  // deshace, lo que lo contaba se deshace con él.
  if (!salto.mismaColumna) {
    await anotar(db, {
      workspaceId: salto.workspaceId,
      organizationId: salto.organizationId,
      actorId: actor?.userId ?? null,
      procedencia: actor?.procedencia,
      verbo: salto.cierra ? "cerro" : salto.reabre ? "reabrio" : "movio",
      sujeto: "tarea",
      sujetoId: taskId,
      sujetoNombre: salto.titulo,
      detalle: { de: salto.desde, a: salto.hasta },
    });
  }

  const tarea = await loadTask(db, taskId);
  // El aviso va FUERA de la transacción en el tiempo —no se puede deshacer un
  // mensaje ya enviado— pero se dispara aquí porque es donde se sabe qué pasó.
  // `announce*` no espera a nadie: reparte a quien esté escuchando y vuelve.
  announceBoardChange(salto.workspaceId, "moved", taskId);
  return tarea;
}
