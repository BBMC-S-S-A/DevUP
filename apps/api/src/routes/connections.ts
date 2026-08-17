import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { type Db, withUser } from "../db/pool.js";
import { notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
import { decryptSecret, encryptSecret } from "../security/vault.js";

const uuid = z.string().uuid();
const PROVIDERS = ["github", "spotify"] as const;

const CONNECTION_COLUMNS = `
  id, provider, display_name as "displayName", created_at as "createdAt"`;

/**
 * Bóveda de credenciales: conectar y desconectar cuentas ajenas (GitHub de la
 * organización, Spotify de una persona). Ninguna ruta de este archivo
 * selecciona `encrypted_secret` para devolverlo — la única función que lo
 * lee es `getDecryptedSecret`, pensada para que la use un conector (GitHub,
 * Spotify) al llamar a la API de fuera, nunca para servir una respuesta.
 */
export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  // --- De organización --------------------------------------------------------
  app.get("/organizations/:orgId/connections", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${CONNECTION_COLUMNS} from connections
          where organization_id = $1 order by created_at`,
        [orgId],
      );
      return { connections: rows };
    });
  });

  app.post("/organizations/:orgId/connections", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        provider: z.enum(PROVIDERS),
        displayName: z.string().trim().max(80).default(""),
        secret: z.string().min(1).max(4000),
      }),
      request.body,
    );

    const connection = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into connections (provider, organization_id, display_name, created_by)
         values ($1,$2,$3,$4) returning id`,
        [body.provider, orgId, body.displayName, userId],
      );
      const id = rows[0]!.id;
      await db.query(
        "insert into connection_secrets (connection_id, encrypted_secret) values ($1,$2)",
        [id, encryptSecret(body.secret)],
      );
      const { rows: full } = await db.query(
        `select ${CONNECTION_COLUMNS} from connections where id = $1`,
        [id],
      );
      return full[0];
    });

    return reply.status(201).send({ connection });
  });

  // --- Personales --------------------------------------------------------------
  app.get("/connections", async (request) => {
    const userId = requireUser(request);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${CONNECTION_COLUMNS} from connections
          where user_id = $1 order by created_at`,
        [userId],
      );
      return { connections: rows };
    });
  });

  app.post("/connections", async (request, reply) => {
    const userId = requireUser(request);
    const body = parseBody(
      z.object({
        provider: z.enum(PROVIDERS),
        displayName: z.string().trim().max(80).default(""),
        secret: z.string().min(1).max(4000),
      }),
      request.body,
    );

    const connection = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into connections (provider, user_id, display_name, created_by)
         values ($1,$2,$3,$4) returning id`,
        [body.provider, userId, body.displayName, userId],
      );
      const id = rows[0]!.id;
      await db.query(
        "insert into connection_secrets (connection_id, encrypted_secret) values ($1,$2)",
        [id, encryptSecret(body.secret)],
      );
      const { rows: full } = await db.query(
        `select ${CONNECTION_COLUMNS} from connections where id = $1`,
        [id],
      );
      return full[0];
    });

    return reply.status(201).send({ connection });
  });

  // --- Desconectar ---------------------------------------------------------
  app.delete("/connections/:connectionId", async (request, reply) => {
    const userId = requireUser(request);
    const { connectionId } = parseParams(z.object({ connectionId: uuid }), request.params);
    const { rowCount } = await withUser(userId, (db) =>
      db.query("delete from connections where id = $1", [connectionId]),
    );
    if (!rowCount) throw notFound("conexión no encontrada");
    return reply.status(204).send();
  });
}

/**
 * Descifra el secreto de una conexión para que un conector llame a su
 * proveedor. Nunca se expone en una respuesta HTTP — quien la use hace la
 * llamada saliente con el valor y lo descarta.
 */
export async function getDecryptedSecret(db: Db, connectionId: string): Promise<string> {
  const { rows } = await db.query<{ encrypted_secret: Buffer }>(
    "select encrypted_secret from connection_secrets where connection_id = $1",
    [connectionId],
  );
  if (!rows[0]) throw notFound("conexión no encontrada");
  return decryptSecret(rows[0].encrypted_secret);
}
