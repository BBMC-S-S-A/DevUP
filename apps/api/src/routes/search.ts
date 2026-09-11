import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { parseBody, parseParams, requireUser } from "../lib/http.js";

const uuid = z.string().uuid();

const CONSULTA = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const COLUMNAS = `entity, id, title, snippet,
                  organization_id as "organizationId",
                  workspace_id as "workspaceId", channel_id as "channelId",
                  rank, created_at as "createdAt"`;

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

  /**
   * En todo lo que alcanza esta cuenta, sin elegir organización.
   *
   * Es la que usa la paleta de comandos, y la que hacía falta: quien pertenece
   * a tres organizaciones tenía que saber de antemano en cuál estaba lo que
   * buscaba, que es justo lo que no se sabe cuando se busca.
   *
   * No abre nada que estuviera cerrado. `global_search` recibe nulo y deja de
   * acotar; lo que queda visible lo siguen decidiendo las políticas de cada
   * tabla, exactamente igual que cuando se pedía una organización concreta.
   * Ver la cabecera de la migración 0036.
   */
  app.get("/search", async (request) => {
    const userId = requireUser(request);
    const { q, limit } = parseBody(CONSULTA, request.query);

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS} from global_search(null, $1, $2)`,
        [q, limit],
      );
      return { results: rows };
    });
  });

  /**
   * Acotada a una organización. Se conserva porque hay un sitio donde acotar
   * es lo correcto —la pantalla de buscar de una organización, donde ya has
   * dicho en cuál estás— y porque quitarla rompería a quien la esté usando.
   */
  app.get("/organizations/:orgId/search", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const { q, limit } = parseBody(CONSULTA, request.query);

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS} from global_search($1, $2, $3)`,
        [orgId, q, limit],
      );
      return { results: rows };
    });
  });
}
