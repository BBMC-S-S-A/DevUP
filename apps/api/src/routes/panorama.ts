import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { parseParams, parseQuery, requireUser } from "../lib/http.js";
import { panoramaDeOrganizacion } from "../lib/panorama.js";

/**
 * La portada de una organización.
 *
 * QUÉ PANTALLA ARREGLA. Hoy enseña **la lista de sus espacios de trabajo**, que
 * es casi lo único que no hace falta saber: los espacios ya están en el menú
 * lateral, a un clic, y repetirlos en el centro gasta la mejor posición del
 * producto en un índice. Quien entra a una organización no viene a contar
 * espacios — viene a ver cómo va: qué se está haciendo, quién lo hace, quién
 * está disponible y dónde hay algo atascado.
 *
 * La consulta vive en `lib/panorama.ts`; el porqué de cada trozo está allí.
 */

const uuid = z.string().uuid();

export async function panoramaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/organizations/:orgId/panorama", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const { dias } = parseQuery(
      z.object({ dias: z.coerce.number().int().min(1).max(90).default(7) }),
      request.query,
    );

    return withUser(userId, async (db) => ({
      dias,
      ...(await panoramaDeOrganizacion(db, { organizationId: orgId, dias })),
    }));
  });
}
