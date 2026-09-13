import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { ejecutarSQL, listarTablas } from "../connectors/basedatos.js";
import { esConfigRailway, variablesDeRailway } from "../connectors/proveedores.js";
import { type Db, withUser } from "../db/pool.js";
import { badGateway, badRequest, parseBody, parseParams, requireUser } from "../lib/http.js";
import { getDecryptedSecret } from "./connections.js";

const uuid = z.string().uuid();

/** Los nombres bajo los que Railway suele guardar la cadena de una Postgres. */
const VARIABLES_DE_CONEXION = ["DATABASE_URL", "DATABASE_PUBLIC_URL", "POSTGRES_URL"];

/**
 * Administrar la base de datos propia de un workspace: tablas y SQL de
 * verdad, no solo el criterio de las migraciones (esa pantalla se queda,
 * vive en `github.ts`, ruta `/migraciones`).
 *
 * DOS FORMAS DE LLEGAR A LA CADENA DE CONEXIÓN, EN ESTE ORDEN:
 *
 * 1. Un secreto `postgres` pegado a mano — sigue existiendo para quien no
 *    despliega en Railway, o quiere apuntar a una base distinta de la que
 *    usa su propio servicio.
 * 2. SI NO HAY UNO, se busca sola: un entorno de este workspace que ya tiene
 *    configurado un servicio de Railway (0063, para desplegar) es también el
 *    servicio que ya tiene su propia `DATABASE_URL` puesta por Railway. Pedir
 *    que se pegue otra vez a mano, cuando Railway ya la tiene, es pedir un
 *    paso que no hace falta — y es exactamente lo que se pidió arreglar.
 */
async function conexionDeBase(
  db: Db,
  workspaceId: string,
): Promise<{ connectionString: string }> {
  const { rows } = await db.query<{ id: string }>(
    `select id from connections
      where workspace_id = $1 and provider = 'postgres'
      order by created_at limit 1`,
    [workspaceId],
  );
  const connectionId = rows[0]?.id;
  if (connectionId) {
    return { connectionString: await getDecryptedSecret(db, connectionId) };
  }

  const { rows: entornos } = await db.query<{
    provider_config: { railway?: unknown };
    connection_id: string;
  }>(
    `select e.provider_config, c.id as connection_id
       from environments e
       join connections c on c.id = e.connection_id and c.provider = 'railway'
      where e.workspace_id = $1 and e.provider_config ? 'railway'
      order by e.created_at limit 1`,
    [workspaceId],
  );
  const entorno = entornos[0];
  const configRailway = entorno?.provider_config.railway;
  if (!entorno || !esConfigRailway(configRailway)) {
    throw badRequest(
      "este workspace no tiene ninguna base de datos conectada todavía — conecta una en " +
        "Base de datos, o configura Railway en un entorno de Infraestructura",
    );
  }

  const token = await getDecryptedSecret(db, entorno.connection_id);
  let variables: Record<string, string>;
  try {
    variables = await variablesDeRailway(token, configRailway);
  } catch (error) {
    throw badGateway(
      error instanceof Error
        ? `no se pudo leer las variables de Railway: ${error.message}`
        : "no se pudo leer las variables de Railway",
    );
  }

  const nombreEncontrado = VARIABLES_DE_CONEXION.find((n) => variables[n]);
  const connectionString = nombreEncontrado ? variables[nombreEncontrado] : undefined;
  if (!connectionString) {
    throw badRequest(
      "el servicio de Railway conectado a este workspace no tiene una DATABASE_URL — " +
        "revisa las variables de ese servicio en Railway, o conecta una base a mano en Base de datos",
    );
  }
  return { connectionString };
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
