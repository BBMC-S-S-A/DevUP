import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { fetchGithubStats } from "../connectors/github.js";
import { type Db, withUser } from "../db/pool.js";
import { notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
import { getDecryptedSecret } from "./connections.js";

const uuid = z.string().uuid();
const FULL_NAME = /^[\w.-]+\/[\w.-]+$/;

const REPO_COLUMNS = `
  r.id, r.connection_id as "connectionId", r.full_name as "fullName", r.created_at as "createdAt",
  s.data, s.refreshed_at as "refreshedAt", s.last_error as "lastError"`;

/**
 * Refresca las estadísticas de un repositorio y las guarda, incluso si la
 * llamada a GitHub falla — un error visible en pantalla es mejor que una
 * pantalla que no dice por qué lleva vacía desde que se conectó.
 */
export async function refreshRepo(db: Db, repoId: string, token: string, fullName: string): Promise<void> {
  try {
    const stats = await fetchGithubStats(token, fullName);
    await db.query("select public.upsert_github_repo_stats($1, $2::jsonb, null)", [
      repoId,
      JSON.stringify(stats),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "fallo desconocido";
    // null y no '{}': un fallo al refrescar no debe borrar la última lectura
    // buena, solo anotar el error. Ver la cabecera de upsert_github_repo_stats.
    await db.query("select public.upsert_github_repo_stats($1, null, $2)", [repoId, message]);
  }
}

export async function githubRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/organizations/:orgId/github/repos", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${REPO_COLUMNS}
           from github_repos r
           join connections c on c.id = r.connection_id
           left join github_repo_stats s on s.github_repo_id = r.id
          where c.organization_id = $1
          order by r.created_at`,
        [orgId],
      );
      return { repos: rows };
    });
  });

  /**
   * Añadir un repositorio hace también la primera lectura, en la misma
   * petición: esperar a la siguiente pasada del barrendero dejaría la
   * pantalla vacía varios minutos justo después de conectar algo, que es
   * cuando más se está mirando.
   */
  app.post("/organizations/:orgId/github/repos", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        connectionId: uuid,
        fullName: z.string().trim().regex(FULL_NAME, "escribe «organización/repositorio»"),
      }),
      request.body,
    );

    const { repoId, token } = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into github_repos (connection_id, full_name, added_by)
         values ($1,$2,$3) returning id`,
        [body.connectionId, body.fullName, userId],
      );
      const id = rows[0]!.id;
      const token = await getDecryptedSecret(db, body.connectionId);
      return { repoId: id, token };
    });

    await withUser(userId, (db) => refreshRepo(db, repoId, token, body.fullName));

    const repo = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${REPO_COLUMNS} from github_repos r
           left join github_repo_stats s on s.github_repo_id = r.id
          where r.id = $1`,
        [repoId],
      );
      return rows[0];
    });

    return reply.status(201).send({ repo });
  });

  app.post("/github/repos/:repoId/refresh", async (request) => {
    const userId = requireUser(request);
    const { repoId } = parseParams(z.object({ repoId: uuid }), request.params);

    await withUser(userId, async (db) => {
      const { rows } = await db.query<{ connection_id: string; full_name: string }>(
        "select connection_id, full_name from github_repos where id = $1",
        [repoId],
      );
      if (!rows[0]) throw notFound("repositorio no encontrado");
      const token = await getDecryptedSecret(db, rows[0].connection_id);
      await refreshRepo(db, repoId, token, rows[0].full_name);
    });

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${REPO_COLUMNS} from github_repos r
           left join github_repo_stats s on s.github_repo_id = r.id
          where r.id = $1`,
        [repoId],
      );
      return { repo: rows[0] };
    });
  });

  app.delete("/github/repos/:repoId", async (request, reply) => {
    const userId = requireUser(request);
    const { repoId } = parseParams(z.object({ repoId: uuid }), request.params);
    const { rowCount } = await withUser(userId, (db) =>
      db.query("delete from github_repos where id = $1", [repoId]),
    );
    if (!rowCount) throw notFound("repositorio no encontrado");
    return reply.status(204).send();
  });
}
