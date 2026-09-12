import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { type Db, withUser } from "../db/pool.js";
import { env } from "../env.js";
import { badRequest, notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
import { announceFileChange } from "../realtime/signaling.js";
import {
  buildStorageKey,
  deleteObject,
  headObject,
  signDownload,
  signUpload,
} from "../storage/s3.js";

const uuid = z.string().uuid();

const FILE_COLUMNS = `
  f.id, f.organization_id as "organizationId", f.workspace_id as "workspaceId",
  f.channel_id as "channelId", f.task_id as "taskId",
  -- De qué llamada salió, si salió de una. La columna existía desde la 0004 y
  -- se escribía al enlazar una grabación, pero no la leía nadie: en la
  -- biblioteca una grabación era indistinguible de cualquier otro archivo, y
  -- como tampoco se avisaba de que existía, grabar una llamada era para los
  -- demás como si no hubiera pasado.
  f.call_session_id as "callSessionId",
  f.name, f.description, f.mime_type as "mimeType",
  f.size_bytes::bigint as "sizeBytes", f.status, f.uploaded_by as "uploadedBy",
  f.created_at as "createdAt",
  coalesce(p.display_name, 'cuenta eliminada') as "uploadedByName",
  coalesce(
    (select json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)
                     order by t.name)
       from file_tags ft join tags t on t.id = ft.tag_id
      where ft.file_id = f.id),
    '[]'::json
  ) as tags`;

async function loadFile(db: Db, fileId: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query(
    `select ${FILE_COLUMNS}
       from files f
       left join profiles p on p.id = f.uploaded_by
      where f.id = $1 and f.deleted_at is null`,
    [fileId],
  );
  if (!rows[0]) throw notFound("archivo no encontrado");
  return rows[0];
}

/**
 * Asocia etiquetas a un archivo, quedándose solo con las que pertenecen a la
 * organización del archivo.
 *
 * La política de file_tags comprueba que el archivo sea visible, pero no dice
 * nada de la etiqueta: con un `unnest` directo, un id de etiqueta de otra
 * organización entraría y su nombre aparecería luego en el listado. No es fácil
 * de acertar —los ids ajenos no se pueden listar— pero tampoco hay razón para
 * dejarlo abierto.
 */
async function attachTags(db: Db, fileId: string, tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) return;
  await db.query(
    `insert into file_tags (file_id, tag_id)
     select $1, t.id
       from tags t
      where t.id = any($2::uuid[])
        and t.organization_id = (select organization_id from files where id = $1)
     on conflict do nothing`,
    [fileId, tagIds],
  );
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  // --- Etiquetas ------------------------------------------------------------
  app.get("/organizations/:orgId/tags", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        // El nombre del jefe viene en la misma fila: la pantalla de Categorías
        // lo enseña siempre, y pedirlo aparte sería una consulta por categoría.
        `select t.id, t.name, t.color,
                t.owner_id as "ownerId",
                p.display_name as "ownerName",
                (select count(*)::int from file_tags ft where ft.tag_id = t.id) as "fileCount"
           from tags t
           left join profiles p on p.id = t.owner_id
          where t.organization_id = $1 order by t.name`,
        [orgId],
      );
      return { tags: rows };
    });
  });

  app.post("/organizations/:orgId/tags", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(40),
        // Sin valor por defecto a propósito: «no me dices color» y «lo quiero
        // gris» tienen que poder distinguirse, o resolver una categoría por su
        // nombre le borra el color que ya tenía. Ver `asegurarEtiqueta`.
        color: z
          .enum(["slate", "blue", "green", "amber", "red", "violet", "pink", "teal"])
          .optional(),
      }),
      request.body,
    );

    const tag = await withUser(userId, async (db) => {
      return asegurarEtiqueta(db, orgId, body.name, body.color ?? null, userId);
    });

    return reply.status(201).send({ tag });
  });

  /**
   * Renombrar una categoría, o cambiarle el color.
   *
   * NO SE PODÍA, y desde que las categorías filtran el tablero eso pesa: una
   * escrita con una errata se quedaba así para siempre, porque la única salida
   * era borrarla —y borrarla se lleva por delante su vínculo con todas las
   * tareas y archivos que la llevaban, que es una pérdida real de trabajo por
   * arreglar una letra.
   *
   * El `unique (organization_id, name)` de la 0002 sigue mandando: renombrar a
   * uno que ya existe se rechaza, y hay que decirlo con una frase y no con un
   * error de Postgres.
   */
  app.patch("/tags/:tagId", async (request) => {
    const userId = requireUser(request);
    const { tagId } = parseParams(z.object({ tagId: uuid }), request.params);
    const body = parseBody(
      z
        .object({
          name: z.string().trim().min(1).max(40).optional(),
          color: z
            .enum(["slate", "blue", "green", "amber", "red", "violet", "pink", "teal"])
            .optional(),
          /**
           * Quién lleva la rama. `null` explícito la deja sin jefe, que es
           * distinto de no mandar el campo — de ahí `nullish` y el uso de `in`
           * más abajo en vez de comprobar si es falsy.
           */
          ownerId: uuid.nullish(),
        })
        // Un PATCH sin nada que cambiar devolvería un 200 indistinguible de
        // haber funcionado. Se rechaza.
        .refine((v) => Object.keys(v).length > 0, {
          message: "no hay nada que cambiar: manda «name», «color» u «ownerId»",
        }),
      request.body,
    );

    const cuerpo = body as Record<string, unknown>;
    const cambiaJefe = "ownerId" in cuerpo;

    return withUser(userId, async (db) => {
      /**
       * Que el jefe sea de la organización de la categoría.
       *
       * LA BASE NO PUEDE COMPROBARLO: una clave foránea solo mira `users`, que
       * no sabe de organizaciones. Sin esto, cualquiera con acceso a una
       * categoría podría nombrar jefe a una persona de otra empresa pasando su
       * identificador a mano — y su nombre aparecería en una pantalla donde no
       * pinta nada. Se mira bajo RLS, así que la consulta solo ve lo que quien
       * llama ya podía ver.
       */
      if (cambiaJefe && body.ownerId) {
        const { rows: vale } = await db.query<{ ok: boolean }>(
          `select exists (
             select 1
               from organization_members m
               join tags g on g.organization_id = m.organization_id
              where g.id = $1 and m.user_id = $2
           ) as ok`,
          [tagId, body.ownerId],
        );
        if (!vale[0]?.ok) {
          throw badRequest("esa persona no pertenece a la organización de la categoría");
        }
      }

      const { rows } = await db
        .query<{ id: string; name: string; color: string; ownerId: string | null }>(
          `update tags
              set name = coalesce($2, name),
                  color = coalesce($3, color),
                  owner_id = case when $4 then $5::uuid else owner_id end
            where id = $1
        returning id, name, color, owner_id as "ownerId"`,
          [tagId, body.name ?? null, body.color ?? null, cambiaJefe, body.ownerId ?? null],
        )
        .catch((fallo: unknown) => {
          // 23505 es la violación de unicidad. Traducirla aquí es la diferencia
          // entre «ya tenéis una categoría con ese nombre» y un volcado de
          // Postgres en la pantalla.
          if (typeof fallo === "object" && fallo !== null && (fallo as { code?: string }).code === "23505") {
            throw badRequest("ya hay una categoría con ese nombre en esta organización");
          }
          throw fallo;
        });
      if (!rows[0]) throw notFound("categoría no encontrada");
      return { tag: rows[0] };
    });
  });

  app.delete("/tags/:tagId", async (request, reply) => {
    const userId = requireUser(request);
    const { tagId } = parseParams(z.object({ tagId: uuid }), request.params);
    await withUser(userId, (db) => db.query("delete from tags where id = $1", [tagId]));
    return reply.status(204).send();
  });

  /**
   * Los adjuntos de una tarea.
   *
   * Ruta propia y no un filtro del listado del espacio: quien abre una tarea
   * no sabe —ni tiene por qué— en qué espacio vive, y el aislamiento ya lo
   * pone RLS sobre `files`. Solo los que llegaron a subirse: un adjunto en
   * 'pending' es una reserva que puede no haber terminado nunca.
   */
  app.get("/tasks/:taskId/files", async (request) => {
    const userId = requireUser(request);
    const { taskId } = parseParams(z.object({ taskId: uuid }), request.params);

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${FILE_COLUMNS}
           from files f
           left join profiles p on p.id = f.uploaded_by
          where f.task_id = $1 and f.status = 'ready' and f.deleted_at is null
          order by f.created_at asc`,
        [taskId],
      );
      return { files: rows };
    });
  });

  // --- Listado y búsqueda ---------------------------------------------------
  app.get("/workspaces/:workspaceId/files", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const query = parseBody(
      z.object({
        q: z.string().trim().max(200).optional(),
        channelId: uuid.optional(),
        tags: z.string().optional(), // ids separados por coma
        limit: z.coerce.number().int().min(1).max(200).default(60),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      request.query,
    );

    const tagIds = (query.tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => /^[0-9a-f-]{36}$/i.test(t));

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${FILE_COLUMNS}
           from files f
           left join profiles p on p.id = f.uploaded_by
          where f.workspace_id = $1
            and f.deleted_at is null
            and f.status = 'ready'
            and ($2::uuid is null or f.channel_id = $2)
            and (
              $3::text is null
              or to_tsvector('simple', coalesce(f.name,'') || ' ' || coalesce(f.description,''))
                 @@ plainto_tsquery('simple', $3)
              or f.name ilike '%' || $3 || '%'
            )
            and (
              cardinality($4::uuid[]) = 0
              or (
                select count(distinct ft.tag_id) from file_tags ft
                 where ft.file_id = f.id and ft.tag_id = any($4::uuid[])
              ) = cardinality($4::uuid[])
            )
          order by f.created_at desc
          limit $5 offset $6`,
        [
          workspaceId,
          query.channelId ?? null,
          query.q && query.q.length > 0 ? query.q : null,
          tagIds,
          query.limit,
          query.offset,
        ],
      );
      return { files: rows };
    });
  });

  app.get("/files/:fileId", async (request) => {
    const userId = requireUser(request);
    const { fileId } = parseParams(z.object({ fileId: uuid }), request.params);
    return withUser(userId, async (db) => ({ file: await loadFile(db, fileId) }));
  });

  // --- Subida ---------------------------------------------------------------
  /**
   * Paso 1: reservar la fila y devolver una URL firmada.
   *
   * El orden —fila antes que objeto— es deliberado y contrario a lo que decía
   * el plan original. Ver la cabecera de db/migrations/0002_files.sql: con
   * subida directa al almacén, la API nunca se entera de si el cliente
   * terminó, así que reservar primero es lo único que mantiene todo objeto
   * referenciado por una fila.
   */
  app.post("/workspaces/:workspaceId/files", async (request, reply) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().max(255).default("application/octet-stream"),
        sizeBytes: z.number().int().min(0).max(env.MAX_UPLOAD_BYTES),
        channelId: uuid.nullish(),
        // Adjunto de una tarea del tablero. Que la tarea sea de ESTE espacio
        // lo comprueba la política de alta (0028), no esto: aquí solo se
        // valida la forma.
        taskId: uuid.nullish(),
        description: z.string().trim().max(2000).default(""),
      }),
      request.body,
    );

    const reserved = await withUser(userId, async (db) => {
      // La organización sale del workspace bajo RLS: si no se tiene acceso,
      // aquí no hay fila y la petición muere sin llegar a firmar nada.
      const { rows: ws } = await db.query<{ organizationId: string }>(
        `select organization_id as "organizationId" from workspaces where id = $1`,
        [workspaceId],
      );
      const organizationId = ws[0]?.organizationId;
      if (!organizationId) throw notFound("workspace no encontrado");

      const storageKey = buildStorageKey(organizationId, workspaceId, body.name);
      const { rows } = await db.query<{ id: string; storage_key: string }>(
        `insert into files
           (organization_id, workspace_id, channel_id, task_id, storage_key, name,
            description, mime_type, size_bytes, uploaded_by, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
         returning id, storage_key`,
        [
          organizationId,
          workspaceId,
          body.channelId ?? null,
          body.taskId ?? null,
          storageKey,
          body.name,
          body.description,
          body.mimeType,
          body.sizeBytes,
          userId,
        ],
      );
      return rows[0]!;
    });

    return reply.status(201).send({
      fileId: reserved.id,
      uploadUrl: await signUpload(reserved.storage_key, body.mimeType),
      expiresIn: env.S3_SIGNED_URL_TTL,
    });
  });

  /**
   * Paso 2: confirmar. El tamaño y el tipo se toman del objeto real, no de lo
   * que dijo el cliente al reservar — quien firma la subida puede mentir sobre
   * ambas cosas.
   */
  app.post("/files/:fileId/confirm", async (request) => {
    const userId = requireUser(request);
    const { fileId } = parseParams(z.object({ fileId: uuid }), request.params);
    const body = parseBody(
      z.object({ tagIds: z.array(uuid).max(20).default([]) }),
      request.body ?? {},
    );

    const storageKey = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ storage_key: string; status: string }>(
        "select storage_key, status from files where id = $1",
        [fileId],
      );
      if (!rows[0]) throw notFound("archivo no encontrado");
      return rows[0].storage_key;
    });

    const head = await headObject(storageKey);
    if (!head) {
      // La subida no llegó. Se retira la reserva para que no quede una fila
      // fantasma esperando al barrendero.
      await withUser(userId, (db) => db.query("delete from files where id = $1", [fileId]));
      throw badRequest("la subida no llegó a completarse");
    }

    if (head.size > env.MAX_UPLOAD_BYTES) {
      await withUser(userId, (db) => db.query("delete from files where id = $1", [fileId]));
      await deleteObject(storageKey);
      throw badRequest("el archivo supera el tamaño máximo permitido");
    }

    return withUser(userId, async (db) => {
      await db.query(
        `update files set status = 'ready', size_bytes = $2, mime_type = $3 where id = $1`,
        [fileId, head.size, head.contentType],
      );
      await attachTags(db, fileId, body.tagIds);
      const file = await loadFile(db, fileId);
      announceFileChange(String(file.workspaceId), "created", fileId);
      return { file };
    });
  });

  // --- Descarga -------------------------------------------------------------
  app.get("/files/:fileId/download-url", async (request) => {
    const userId = requireUser(request);
    const { fileId } = parseParams(z.object({ fileId: uuid }), request.params);
    const { disposition } = parseBody(
      z.object({ disposition: z.enum(["inline", "attachment"]).default("inline") }),
      request.query,
    );

    // Firmar sin comprobar antes la pertenencia sería la fuga entre clientes
    // que las políticas de almacenamiento evitaban en el diseño anterior. La
    // comprobación es este SELECT: si RLS no devuelve la fila, no se firma.
    const file = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ storage_key: string; name: string }>(
        "select storage_key, name from files where id = $1 and deleted_at is null",
        [fileId],
      );
      if (!rows[0]) throw notFound("archivo no encontrado");
      return rows[0];
    });

    return {
      url: await signDownload(file.storage_key, file.name, disposition),
      expiresIn: env.S3_SIGNED_URL_TTL,
    };
  });

  // --- Edición y borrado ----------------------------------------------------
  app.patch("/files/:fileId", async (request) => {
    const userId = requireUser(request);
    const { fileId } = parseParams(z.object({ fileId: uuid }), request.params);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(255).optional(),
        description: z.string().trim().max(2000).optional(),
        tagIds: z.array(uuid).max(20).optional(),
      }),
      request.body,
    );

    return withUser(userId, async (db) => {
      if (body.name !== undefined || body.description !== undefined) {
        const { rowCount } = await db.query(
          `update files set name = coalesce($2, name), description = coalesce($3, description)
            where id = $1`,
          [fileId, body.name ?? null, body.description ?? null],
        );
        if (rowCount === 0) throw notFound("archivo no encontrado");
      }

      if (body.tagIds) {
        await db.query("delete from file_tags where file_id = $1 and tag_id <> all($2::uuid[])", [
          fileId,
          body.tagIds,
        ]);
        await attachTags(db, fileId, body.tagIds);
      }

      const file = await loadFile(db, fileId);
      announceFileChange(String(file.workspaceId), "updated", fileId);
      return { file };
    });
  });

  app.delete("/files/:fileId", async (request, reply) => {
    const userId = requireUser(request);
    const { fileId } = parseParams(z.object({ fileId: uuid }), request.params);

    const removed = await withUser(userId, async (db) => {
      // RLS decide quién puede borrar: el que subió o un administrador. Si la
      // política no deja, esto borra cero filas y no hay nada que limpiar.
      const { rows } = await db.query<{ storage_key: string; workspace_id: string }>(
        "delete from files where id = $1 returning storage_key, workspace_id",
        [fileId],
      );
      return rows[0] ?? null;
    });

    if (!removed) throw notFound("archivo no encontrado");
    await deleteObject(removed.storage_key);
    announceFileChange(removed.workspace_id, "deleted", fileId);
    return reply.status(204).send();
  });
}

/**
 * Da de alta una etiqueta, o devuelve la que ya hubiera.
 *
 * Crear una etiqueta que ya existe devuelve la existente en vez de un
 * conflicto: quien escribe «diseño» en el selector quiere esa etiqueta, no un
 * error. Extraida porque el asistente tambien la necesita — marca con
 * «agente» todo lo que crea, y esa marca es lo que hace revisable y
 * reversible que un modelo escriba en el tablero de un equipo.
 */
export async function asegurarEtiqueta(
  db: Db,
  organizationId: string,
  nombre: string,
  /**
   * Null cuando quien llama solo sabe el NOMBRE de la categoría.
   *
   * POR QUÉ IMPORTA LA DIFERENCIA. El color tenía valor por defecto y el
   * `do update` lo escribía siempre, así que resolver por nombre una categoría
   * que ya existía le borraba a la organización el color que alguien le había
   * puesto: «Ventas» en verde volvía a gris. Mientras solo lo llamaba la
   * etiqueta «agente» —que siempre manda violeta— no se notaba; con la puerta
   * MCP poniendo categorías, pasaría en cada tarea que creara un agente.
   *
   * Ahora null quiere decir «no toques el color», y un color de verdad sigue
   * mandando, que es lo que hace falta cuando lo elige una persona.
   */
  color: string | null,
  autor: string,
): Promise<{ id: string; name: string; color: string }> {
  const { rows } = await db.query<{ id: string; name: string; color: string }>(
    `insert into tags (organization_id, name, color, created_by)
     values ($1, $2, coalesce($3, 'slate'), $4)
     on conflict (organization_id, name) do update set color = coalesce($3, tags.color)
     returning id, name, color`,
    [organizationId, nombre, color, autor],
  );
  return rows[0]!;
}
