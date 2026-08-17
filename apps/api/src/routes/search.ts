import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { parseBody, parseParams, requireUser } from "../lib/http.js";

const uuid = z.string().uuid();

/**
 * Búsqueda global (S6): mensajes, archivos, tareas, clientes, servicios y
 * oportunidades desde un solo sitio, en vez de una búsqueda por workspace.
 *
 * Sin `where organization_id` puesto aquí de más: ya va dentro de
 * `global_search`, y el aislamiento de verdad lo siguen poniendo las
 * políticas de cada tabla — la función no es `security definer`.
 */
export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/organizations/:orgId/search", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const { q, limit } = parseBody(
      z.object({
        q: z.string().trim().min(1).max(200),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }),
      request.query,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select entity, id, title, snippet,
                workspace_id as "workspaceId", channel_id as "channelId",
                rank, created_at as "createdAt"
           from global_search($1, $2, $3)`,
        [orgId, q, limit],
      );
      return { results: rows };
    });
  });
}
