import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { parseBody, parseParams, requireUser } from "../lib/http.js";

const uuid = z.string().uuid();

/**
 * Búsqueda global dentro de una organización.
 *
 * `search_everything` corre con los privilegios de quien llama a propósito, así
 * que RLS decide qué aparece: un canal privado ajeno, un workspace personal de
 * otra persona o una organización que no es la suya no salen en los resultados
 * sin que aquí haya un solo filtro. Ver la cabecera de
 * db/migrations/0007_busqueda.sql — una caja de búsqueda con SECURITY DEFINER
 * sería la mayor fuga posible del producto.
 */
export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/organizations/:orgId/search", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const query = parseBody(
      z.object({
        q: z.string().trim().max(200).default(""),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }),
      request.query,
    );

    // Con menos de dos caracteres, cualquier consulta devuelve media base de
    // datos y no ayuda a nadie.
    if (query.q.length < 2) return { results: [] };

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select kind, id, title, snippet, link,
                workspace_id as "workspaceId", workspace_name as "workspaceName",
                created_at as "createdAt"
           from public.search_everything($1, $2, $3)`,
        [orgId, query.q, query.limit],
      );
      return { results: rows };
    });
  });
}
