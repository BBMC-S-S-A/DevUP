import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { fetchGithubFileContent, fetchGithubStats, fetchGithubTree } from "../connectors/github.js";
import {
  CARPETAS,
  analizarMigracion,
  migracionesDelArbol,
} from "../connectors/migraciones.js";
import { ARCHIVOS_DE_INTERES, diagnosticar } from "../connectors/integraciones.js";
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

  /**
   * Las migraciones de un repositorio, pasadas por el criterio.
   *
   * SE LEEN, NO SE EJECUTAN. Ni se conecta a la base del cliente ni se corre
   * nada: se piden los archivos y se analiza el texto. Ejecutar para averiguar
   * si algo es seguro es el orden equivocado.
   *
   * SE PIDEN EN SERIE Y CON TOPE. Cada archivo es una petición a GitHub, y un
   * repositorio con doscientas migraciones agotaría el límite de la
   * organización entera en una sola visita a esta pantalla. Se leen las
   * últimas cuarenta, que es donde está lo que se acaba de escribir, y se dice
   * cuántas se dejaron fuera — un tope silencioso se lee como «todo está
   * bien», que es justo lo contrario de lo que esta pantalla existe para
   * decir.
   */
  app.get("/github/repos/:repoId/migraciones", async (request) => {
    const userId = requireUser(request);
    const { repoId } = parseParams(z.object({ repoId: uuid }), request.params);

    const { token, fullName } = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ connection_id: string; full_name: string }>(
        "select connection_id, full_name from github_repos where id = $1",
        [repoId],
      );
      if (!rows[0]) throw notFound("repositorio no encontrado");
      return {
        token: await getDecryptedSecret(db, rows[0].connection_id),
        fullName: rows[0].full_name,
      };
    });

    const arbol = await fetchGithubTree(token, fullName);
    const todas = migracionesDelArbol(arbol.map((e) => e.path));

    if (todas.length === 0) {
      return {
        fullName,
        carpetasMiradas: CARPETAS,
        migraciones: [],
        omitidas: 0,
      };
    }

    const TOPE = 40;
    const omitidas = Math.max(0, todas.length - TOPE);
    const aLeer = todas.slice(-TOPE);

    const migraciones = [];
    for (const archivo of aLeer) {
      try {
        const sql = await fetchGithubFileContent(token, fullName, archivo);
        migraciones.push(analizarMigracion(archivo, sql));
      } catch (error) {
        // Un archivo ilegible —demasiado grande, o retirado entre el árbol y
        // la lectura— no tira el análisis de los otros treinta y nueve.
        migraciones.push({
          archivo,
          veredicto: "aviso" as const,
          hallazgos: [
            {
              severidad: "aviso" as const,
              regla: "idempotente" as const,
              mensaje:
                error instanceof Error
                  ? `No se pudo leer: ${error.message}`
                  : "No se pudo leer este archivo.",
              linea: null,
            },
          ],
        });
      }
    }

    return { fullName, carpetasMiradas: CARPETAS, migraciones, omitidas };
  });

  /**
   * Qué se está haciendo a mano en este repositorio.
   *
   * Lee el árbol y unos pocos archivos concretos —los manifiestos de
   * dependencias y una muestra del código de servidor— y devuelve
   * recomendaciones con su prueba. No ejecuta nada y no escribe nada.
   *
   * LOS ARCHIVOS SE ELIGEN, NO SE DESCARGA EL REPOSITORIO. Cada uno es una
   * petición a GitHub contra un límite compartido por toda la organización:
   * bajarse el proyecto para diagnosticarlo dejaría sin cuota al resto del
   * conector. Con los manifiestos y una docena de archivos de servidor se
   * responde a todo lo que hoy se pregunta.
   */
  app.get("/github/repos/:repoId/integraciones", async (request) => {
    const userId = requireUser(request);
    const { repoId } = parseParams(z.object({ repoId: uuid }), request.params);

    const { token, fullName } = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ connection_id: string; full_name: string }>(
        "select connection_id, full_name from github_repos where id = $1",
        [repoId],
      );
      if (!rows[0]) throw notFound("repositorio no encontrado");
      return {
        token: await getDecryptedSecret(db, rows[0].connection_id),
        fullName: rows[0].full_name,
      };
    });

    const arbol = await fetchGithubTree(token, fullName);
    const rutas = arbol.filter((e) => e.type === "blob").map((e) => e.path);

    const aLeer = [
      // Manifiestos, incluidos los de los subproyectos: en un monorepo la raíz
      // solo tiene herramientas de construcción.
      ...rutas.filter((r) => ARCHIVOS_DE_INTERES.some((n) => r === n || r.endsWith(`/${n}`))).slice(0, 8),
      // Y una muestra del código de servidor, que es donde se ve lo que se
      // hace a mano.
      ...rutas
        .filter((r) => /\.(ts|js|mjs|py|go|rb|php)$/.test(r) && /(^|\/)(src|app|server|api|lib)\//.test(r))
        .slice(0, 12),
    ];

    const archivos = new Map<string, string>();
    for (const archivo of aLeer) {
      try {
        archivos.set(archivo, await fetchGithubFileContent(token, fullName, archivo));
      } catch {
        // Un archivo que no se puede leer se salta: el diagnóstico se hace con
        // lo que haya, y decir menos es mejor que no decir nada.
      }
    }

    return {
      fullName,
      recomendaciones: diagnosticar({ rutas, archivos }),
      archivosLeidos: archivos.size,
    };
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

  /**
   * Árbol completo del repositorio, para el entorno de desarrollo embebido
   * (Fase 0, ver docs/decisiones/0004-conector-github-embebido-y-agente-ia.md).
   * Mismo lookup que `refresh`: se busca la conexión del repo y se descifra
   * su token en la misma petición — no se cachea el árbol en ningún lado
   * todavía, siempre se pide fresco a GitHub.
   */
  app.get("/github/repos/:repoId/tree", async (request) => {
    const userId = requireUser(request);
    const { repoId } = parseParams(z.object({ repoId: uuid }), request.params);

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ connection_id: string; full_name: string }>(
        "select connection_id, full_name from github_repos where id = $1",
        [repoId],
      );
      if (!rows[0]) throw notFound("repositorio no encontrado");
      const token = await getDecryptedSecret(db, rows[0].connection_id);
      const tree = await fetchGithubTree(token, rows[0].full_name);
      return { tree };
    });
  });

  /** Contenido de un archivo del repositorio, para abrirlo en el editor. */
  app.get("/github/repos/:repoId/file", async (request) => {
    const userId = requireUser(request);
    const { repoId } = parseParams(z.object({ repoId: uuid }), request.params);
    const { path } = parseBody(z.object({ path: z.string().min(1) }), request.query);

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ connection_id: string; full_name: string }>(
        "select connection_id, full_name from github_repos where id = $1",
        [repoId],
      );
      if (!rows[0]) throw notFound("repositorio no encontrado");
      const token = await getDecryptedSecret(db, rows[0].connection_id);
      const content = await fetchGithubFileContent(token, rows[0].full_name, path);
      return { path, content };
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
