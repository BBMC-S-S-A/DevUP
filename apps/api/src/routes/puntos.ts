import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { parseParams, parseQuery, requireUser } from "../lib/http.js";
import { asientosDe, marcadorDeOrganizacion } from "../lib/puntos.js";

/**
 * Los puntos: qué se ha ganado y de dónde sale cada uno.
 *
 * NO HAY RUTA PARA DAR PUNTOS, Y ESO ES EL DISEÑO. Se ganan en la base, al
 * entrar una tarea en una columna final (0055). Una ruta que reparta puntos
 * los convierte en algo que se puede pedir, y entonces dejan de medir nada.
 *
 * Las dos que hay son de LECTURA y van juntas a propósito: el marcador dice
 * cuánto, y los asientos dicen de qué. Publicar el primero sin el segundo es
 * publicar un número que hay que creerse.
 */

const uuid = z.string().uuid();

export async function puntosRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/organizations/:orgId/puntos", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const { dias } = parseQuery(
      z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }),
      request.query,
    );

    return withUser(userId, async (db) => ({
      dias,
      gente: await marcadorDeOrganizacion(db, { organizationId: orgId, dias }),
    }));
  });

  /**
   * Los asientos de una persona.
   *
   * De cualquiera de la organización, no solo los propios: las políticas de la
   * 0055 ya abren los puntos a quien comparte organización, y esconder aquí lo
   * que allí está abierto no protegería nada — solo haría imposible contrastar
   * un total, que es para lo que existe.
   */
  app.get("/organizations/:orgId/puntos/:personaId", async (request) => {
    const userId = requireUser(request);
    const { orgId, personaId } = parseParams(
      z.object({ orgId: uuid, personaId: uuid }),
      request.params,
    );
    const { dias, limite } = parseQuery(
      z.object({
        dias: z.coerce.number().int().min(1).max(365).default(30),
        limite: z.coerce.number().int().min(1).max(200).default(50),
      }),
      request.query,
    );

    return withUser(userId, async (db) => ({
      dias,
      asientos: await asientosDe(db, {
        userId: personaId,
        organizationId: orgId,
        dias,
        limite,
      }),
    }));
  });
}
