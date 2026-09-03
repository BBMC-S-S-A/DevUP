import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { env } from "../env.js";
import { badRequest, forbidden, notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
import {
  buildOrgAssetKey,
  deleteObject,
  headObject,
  organizationOfKey,
  signDownload,
  signUpload,
} from "../storage/s3.js";

const uuid = z.string().uuid();
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/,
    "el identificador admite minúsculas, números y guiones, entre 3 y 40 caracteres",
  );

/**
 * Organizaciones, workspaces y canales.
 *
 * Ninguna consulta lleva `where organization_id = ...`: el filtrado lo hace
 * RLS a partir de `app.user_id`. Añadir el filtro a mano no haría daño, pero
 * daría la impresión de que es él quien protege, y el día que alguien lo
 * olvide en una consulta nueva el aislamiento tiene que seguir en pie.
 */
export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  // --- Organizaciones -------------------------------------------------------
  app.get("/organizations", async (request) => {
    const userId = requireUser(request);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select o.id, o.name, o.slug, o.created_at as "createdAt", m.role,
                o.immersive_enabled as "immersiveEnabled", o.logo_key as "logoKey"
           from organizations o
           join organization_members m on m.organization_id = o.id
          where m.user_id = $1
          order by o.created_at`,
        [userId],
      );
      return { organizations: rows };
    });
  });

  /**
   * Ajustes de la organización.
   *
   * Hoy solo apaga la vista inmersiva. No lleva comprobación de rol: la
   * política `organizations_update` ya exige is_org_admin, así que a un
   * miembro raso el UPDATE le afecta a cero filas y responde 404 — que es la
   * respuesta correcta, porque decir «existe pero no puedes» ya filtra que
   * existe.
   */
  app.patch("/organizations/:orgId", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({ immersiveEnabled: z.boolean() }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `update organizations set immersive_enabled = $2
          where id = $1
      returning id, name, slug, immersive_enabled as "immersiveEnabled"`,
        [orgId, body.immersiveEnabled],
      );
      if (rows.length === 0) throw notFound("organización no encontrada");
      return { organization: rows[0] };
    });
  });

  app.post("/organizations", async (request, reply) => {
    const userId = requireUser(request);
    const body = parseBody(
      z.object({ name: z.string().trim().min(1).max(80), slug }),
      request.body,
    );

    const organization = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ create_organization: string }>(
        "select public.create_organization($1, $2)",
        [body.name, body.slug],
      );
      const id = rows[0]!.create_organization;
      const { rows: created } = await db.query(
        `select id, name, slug, created_at as "createdAt" from organizations where id = $1`,
        [id],
      );
      return created[0];
    });

    return reply.status(201).send({ organization: { ...organization, role: "owner" } });
  });

  app.get("/organizations/:orgId/members", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    return withUser(userId, async (db) => {
      // `presence` va en la misma fila que nombre y avatar: si ya se puede ver
      // quién es alguien en esta lista, verle el estado que él mismo puso no
      // abre ninguna puerta nueva. Antes solo se leía en `/auth/me` —de uno
      // mismo—; el panel personal lo necesita de los demás para "quién está".
      const { rows } = await db.query(
        `select m.user_id as "userId", m.role, m.created_at as "joinedAt",
                p.display_name as "displayName", p.avatar_url as "avatarUrl",
                p.presence
           from organization_members m
           join profiles p on p.id = m.user_id
          where m.organization_id = $1
          order by m.created_at`,
        [orgId],
      );
      return { members: rows };
    });
  });

  app.post("/organizations/:orgId/members", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        email: z.string().trim().toLowerCase().email(),
        role: z.enum(["admin", "member"]).default("member"),
      }),
      request.body,
    );

    // add_member_by_email comprueba dentro que quien llama es administrador:
    // es SECURITY DEFINER y sin esa comprobación sería una puerta abierta.
    const added = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ add_member_by_email: string }>(
        "select public.add_member_by_email($1, $2, $3)",
        [orgId, body.email, body.role],
      );
      return rows[0]!.add_member_by_email;
    });

    return reply.status(201).send({ userId: added, role: body.role });
  });

  app.delete("/organizations/:orgId/members/:memberId", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId, memberId } = parseParams(
      z.object({ orgId: uuid, memberId: uuid }),
      request.params,
    );
    await withUser(userId, (db) =>
      db.query("delete from organization_members where organization_id = $1 and user_id = $2", [
        orgId,
        memberId,
      ]),
    );
    return reply.status(204).send();
  });

  /**
   * Subir o bajar a alguien entre admin y miembro.
   *
   * No es lo mismo que traspasar la propiedad: eso implica que deje de haber
   * cero propietarios en algún instante, y es una operación distinta con sus
   * propias garantías. Esta ruta se queda corta a propósito y solo mueve gente
   * entre los otros dos roles.
   */
  app.patch("/organizations/:orgId/members/:memberId", async (request) => {
    const userId = requireUser(request);
    const { orgId, memberId } = parseParams(
      z.object({ orgId: uuid, memberId: uuid }),
      request.params,
    );
    const body = parseBody(z.object({ role: z.enum(["admin", "member"]) }), request.body);

    if (memberId === userId) throw badRequest("no puedes cambiar tu propio rol");

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ role: string }>(
        "select role from organization_members where organization_id = $1 and user_id = $2",
        [orgId, memberId],
      );
      const actual = rows[0];
      if (!actual) throw notFound("esa persona no es miembro de la organización");
      if (actual.role === "owner") {
        throw forbidden("no se puede cambiar el rol del propietario");
      }

      const { rows: actualizado } = await db.query<{ userId: string; role: string }>(
        `update organization_members set role = $3
          where organization_id = $1 and user_id = $2
        returning user_id as "userId", role`,
        [orgId, memberId, body.role],
      );
      // Sin permiso, la política organization_members_update afecta a cero
      // filas: no hay excepción que atrapar, solo una fila que no cambió.
      if (actualizado.length === 0) {
        throw forbidden("sin permiso para cambiar roles en esta organización");
      }
      return { member: actualizado[0] };
    });
  });

  // --- Foto de la organización ------------------------------------------------
  /**
   * Paso 1: reservar la clave y firmar la subida.
   *
   * El permiso se comprueba aquí a mano y no solo con RLS porque firmar una
   * URL no toca la base de datos — sin esta comprobación, cualquier miembro
   * podría obtener un PUT firmado hacia la carpeta de la organización, aunque
   * el POST de confirmación de más abajo fuera a rechazarle igualmente el
   * UPDATE. Mejor no dejar que suba nada que luego no va a poder colgarse.
   */
  app.post("/organizations/:orgId/logo", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().max(255).default("application/octet-stream"),
      }),
      request.body,
    );

    await withUser(userId, async (db) => {
      const { rows } = await db.query<{ ok: boolean }>("select public.is_org_admin($1) as ok", [
        orgId,
      ]);
      if (!rows[0]?.ok) {
        throw forbidden("solo quien administra puede cambiar la foto de la organización");
      }
    });

    const logoKey = buildOrgAssetKey(orgId, body.fileName);
    return {
      logoKey,
      uploadUrl: await signUpload(logoKey, body.mimeType),
      expiresIn: env.S3_SIGNED_URL_TTL,
    };
  });

  /** Paso 2: confirmar, y borrar la foto anterior si había una. */
  app.post("/organizations/:orgId/logo/confirm", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(z.object({ logoKey: z.string().min(1).max(500) }), request.body);

    // La organización tiene que aparecer en la propia clave: sin esto,
    // cualquiera con sesión podría confirmar una clave ajena y colgarle a su
    // organización la foto de otra.
    if (organizationOfKey(body.logoKey) !== orgId) {
      throw badRequest("la clave no pertenece a esta organización");
    }

    const head = await headObject(body.logoKey);
    if (!head) throw badRequest("la subida no llegó a completarse");

    const previous = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ logoKey: string | null }>(
        `select logo_key as "logoKey" from organizations where id = $1`,
        [orgId],
      );
      if (rows.length === 0) throw notFound("organización no encontrada");

      const { rowCount } = await db.query("update organizations set logo_key = $2 where id = $1", [
        orgId,
        body.logoKey,
      ]);
      if (!rowCount) {
        throw forbidden("solo quien administra puede cambiar la foto de la organización");
      }
      return rows[0]!.logoKey;
    });

    if (previous && previous !== body.logoKey) await deleteObject(previous);
    return { logoKey: body.logoKey };
  });

  /** URL firmada para pintar la foto. `null` si la organización no tiene. */
  app.get("/organizations/:orgId/logo-url", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);

    const key = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ logoKey: string | null }>(
        `select logo_key as "logoKey" from organizations where id = $1`,
        [orgId],
      );
      if (rows.length === 0) throw notFound("organización no encontrada");
      return rows[0]!.logoKey;
    });

    if (!key) return { url: null };
    return { url: await signDownload(key, "logo", "inline"), expiresIn: env.S3_SIGNED_URL_TTL };
  });

  app.delete("/organizations/:orgId/logo", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);

    const previous = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ logoKey: string | null }>(
        `select logo_key as "logoKey" from organizations where id = $1`,
        [orgId],
      );
      if (rows.length === 0) throw notFound("organización no encontrada");
      if (!rows[0]!.logoKey) return null;

      const { rowCount } = await db.query("update organizations set logo_key = null where id = $1", [
        orgId,
      ]);
      // Sin permiso, la política de UPDATE afecta a cero filas: no hay nada
      // que borrar del almacén tampoco, porque en la base no cambió nada.
      return rowCount ? rows[0]!.logoKey : null;
    });

    if (previous) await deleteObject(previous);
    return reply.status(204).send();
  });

  // --- Enlaces de la organización ---------------------------------------------
  app.get("/organizations/:orgId/links", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select id, label, url, position, created_at as "createdAt"
           from organization_links where organization_id = $1
          order by position, created_at`,
        [orgId],
      );
      return { links: rows };
    });
  });

  app.post("/organizations/:orgId/links", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        label: z.string().trim().min(1).max(60),
        url: z.string().trim().min(1).max(2000).url("tiene que ser una URL válida"),
      }),
      request.body,
    );

    const link = await withUser(userId, async (db) => {
      // Al final de la lista siempre, para no reordenar los que ya había cada
      // vez que se añade uno.
      const { rows: siguiente } = await db.query<{ n: string }>(
        "select coalesce(max(position), -1) + 1 as n from organization_links where organization_id = $1",
        [orgId],
      );
      const { rows } = await db.query(
        `insert into organization_links (organization_id, label, url, position, created_by)
         values ($1,$2,$3,$4,$5)
         returning id, label, url, position, created_at as "createdAt"`,
        [orgId, body.label, body.url, Number(siguiente[0]!.n), userId],
      );
      return rows[0];
    });

    return reply.status(201).send({ link });
  });

  app.delete("/organizations/:orgId/links/:linkId", async (request, reply) => {
    const userId = requireUser(request);
    const { linkId } = parseParams(z.object({ orgId: uuid, linkId: uuid }), request.params);
    await withUser(userId, (db) => db.query("delete from organization_links where id = $1", [linkId]));
    return reply.status(204).send();
  });

  // --- Workspaces -----------------------------------------------------------
  app.get("/organizations/:orgId/workspaces", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select id, organization_id as "organizationId", name, visibility,
                created_by as "createdBy", created_at as "createdAt"
           from workspaces where organization_id = $1
          order by visibility desc, created_at`,
        [orgId],
      );
      return { workspaces: rows };
    });
  });

  app.post("/organizations/:orgId/workspaces", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(80),
        // Personal significa que solo lo ve quien lo crea, aunque el resto de
        // la organización sea de plena confianza. Es el sitio donde alguien
        // trabaja solo sin salirse del equipo.
        visibility: z.enum(["shared", "personal"]).default("shared"),
      }),
      request.body,
    );

    const workspace = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into workspaces (organization_id, name, created_by, visibility)
         values ($1, $2, $3, $4)
         returning id, organization_id as "organizationId", name, visibility,
                   created_by as "createdBy", created_at as "createdAt"`,
        [orgId, body.name, userId, body.visibility],
      );
      return rows[0];
    });

    return reply.status(201).send({ workspace });
  });

  app.get("/workspaces/:workspaceId", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select id, organization_id as "organizationId", name, visibility,
                created_by as "createdBy", created_at as "createdAt"
           from workspaces where id = $1`,
        [workspaceId],
      );
      // RLS no distingue «no existe» de «no puedes verlo», y responder cosas
      // distintas para cada caso ya filtraría que existe.
      if (!rows[0]) throw notFound("workspace no encontrado");
      return { workspace: rows[0] };
    });
  });

  // --- Canales --------------------------------------------------------------
  app.get("/workspaces/:workspaceId/channels", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select id, workspace_id as "workspaceId", name, kind,
                is_private as "isPrivate", created_at as "createdAt"
           from channels where workspace_id = $1
          order by kind, name`,
        [workspaceId],
      );
      return { channels: rows };
    });
  });

  app.post("/workspaces/:workspaceId/channels", async (request, reply) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(80),
        kind: z.enum(["text", "voice"]).default("voice"),
        isPrivate: z.boolean().default(false),
      }),
      request.body,
    );

    const channel = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ create_channel: string }>(
        "select public.create_channel($1, $2, $3, $4)",
        [workspaceId, body.name, body.kind, body.isPrivate],
      );
      const { rows: created } = await db.query(
        `select id, workspace_id as "workspaceId", name, kind,
                is_private as "isPrivate", created_at as "createdAt"
           from channels where id = $1`,
        [rows[0]!.create_channel],
      );
      return created[0];
    });

    return reply.status(201).send({ channel });
  });

  app.get("/channels/:channelId", async (request) => {
    const userId = requireUser(request);
    const { channelId } = parseParams(z.object({ channelId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select c.id, c.workspace_id as "workspaceId", c.name, c.kind,
                c.is_private as "isPrivate", c.created_at as "createdAt",
                w.organization_id as "organizationId"
           from channels c
           join workspaces w on w.id = c.workspace_id
          where c.id = $1`,
        [channelId],
      );
      if (!rows[0]) throw notFound("canal no encontrado");
      return { channel: rows[0] };
    });
  });

  app.delete("/channels/:channelId", async (request, reply) => {
    const userId = requireUser(request);
    const { channelId } = parseParams(z.object({ channelId: uuid }), request.params);
    await withUser(userId, (db) => db.query("delete from channels where id = $1", [channelId]));
    return reply.status(204).send();
  });
}
