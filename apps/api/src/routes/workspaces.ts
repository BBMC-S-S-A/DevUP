import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { notFound, parseBody, parseParams, requireUser } from "../lib/http.js";

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
                o.immersive_enabled as "immersiveEnabled"
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
      const { rows } = await db.query(
        `select m.user_id as "userId", m.role, m.created_at as "joinedAt",
                p.display_name as "displayName", p.avatar_url as "avatarUrl"
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
