import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { ejecutarSQL, listarTablas } from "../connectors/basedatos.js";
import { type Db, withUser } from "../db/pool.js";
import { badGateway, badRequest, parseBody, parseParams, requireUser } from "../lib/http.js";
import { getDecryptedSecret } from "./connections.js";

const uuid = z.string().uuid();

/**
 * Administrar la base de datos propia de un workspace: tablas y SQL de
 * verdad, no solo el criterio de las migraciones (esa pantalla se queda,
 * vive en `github.ts`, ruta `/migraciones`).
 *
 * UNA SOLA CONEXIÓN POR WORKSPACE A PROPÓSITO. Igual que Railway o GitHub:
 * el primer secreto con provider `postgres` que se encuentre es el que se
 * usa. Si algún día hace falta más de una base por workspace, esto se
 * amplía; hoy sería una complejidad que nadie pidió.
 */
async function conexionDeBase(
  db: Db,
  workspaceId: string,
): Promise<{ connectionId: string; connectionString: string }> {
  const { rows } = await db.query<{ id: string }>(
    `select id from connections
      where workspace_id = $1 and provider = 'postgres'
      order by created_at limit 1`,
    [workspaceId],
  );
  const connectionId = rows[0]?.id;
  if (!connectionId) {
    throw badRequest("este workspace no tiene ninguna base de datos conectada todavía");
  }
  return { connectionId, connectionString: await getDecryptedSecret(db, connectionId) };
}

export async function basedatosRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/workspaces/:workspaceId/database/tables", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);

    return withUser(userId, async (db) => {
      const { connectionString } = await conexionDeBase(db, workspaceId);
      try {
        return { tables: await listarTablas(connectionString) };
      } catch (error) {
        throw badGateway(
          error instanceof Error ? `no se pudo leer la base: ${error.message}` : "no se pudo leer la base",
        );
      }
    });
  });

  /**
   * SIN LÍMITE DE PETICIONES PROPIO A PROPÓSITO: `requireSession` ya exige
   * estar dentro del equipo, y una consola SQL que además recorta por
   * frecuencia sorprendería a quien está en medio de depurar algo de verdad.
   * El único límite que importa aquí es el `statement_timeout` del propio
   * conector.
   */
  app.post("/workspaces/:workspaceId/database/query", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const { sql } = parseBody(z.object({ sql: z.string().trim().min(1).max(20_000) }), request.body);

    return withUser(userId, async (db) => {
      const { connectionString } = await conexionDeBase(db, workspaceId);
      try {
        return await ejecutarSQL(connectionString, sql);
      } catch (error) {
        // El mensaje de Postgres se devuelve tal cual — "syntax error at or
        // near…", "relation … does not exist" — es exactamente lo que
        // alguien necesita leer para corregir su propia consulta.
        throw badGateway(error instanceof Error ? error.message : "la consulta falló");
      }
    });
  });
}
