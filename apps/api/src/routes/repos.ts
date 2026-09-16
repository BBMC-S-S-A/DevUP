/**
 * Repositorios alojados en DevUP (0068): crearlos, verlos y borrarlos.
 *
 * ESTO ES LA PANTALLA; EL PROTOCOLO ESTÁ EN `git.ts`. Aquí todo es sesión y
 * JSON como en el resto de la API. Allí no hay sesión ni JSON porque quien
 * llama es el programa `git`.
 *
 * EL ORDEN AL CREAR ES AL REVÉS QUE AL ALOJAR UNA BASE, y a propósito. En 0066
 * la base se crea primero en Postgres y se anota después, porque una fila que
 * dice que existe una base que no existe manda a la gente a una conexión
 * muerta. Aquí la fila va PRIMERO: es la fila la que lleva la política de RLS
 * que decide si esta persona puede crear algo en este espacio, así que crear la
 * carpeta antes sería escribir en disco sin haber preguntado si se podía. El
 * peor caso queda al revés —una fila sin carpeta— y se nota enseguida, porque
 * clonar contesta que no existe.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import {
  borrarRepo,
  commitsDelRepo,
  crearRepo,
  existeRepo,
  ramasDelRepo,
} from "../git/almacen.js";
import { badRequest, notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
import { hashDeToken } from "./git.js";

const uuid = z.string().uuid();

/** Ver el porqué del formato en la cabecera de `almacen.ts`. */
const slugZ = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/,
    "el nombre va en minúsculas, con números y guiones, y no empieza ni acaba en guión",
  );

const ramaZ = z.string().trim().regex(/^[A-Za-z0-9._/-]{1,100}$/);

const COLUMNAS = `
  id, slug, description, default_branch as "defaultBranch",
  size_bytes::bigint as "sizeBytes", pushed_at as "pushedAt", created_at as "createdAt"`;

/**
 * La dirección para clonar.
 *
 * SE COMPONE CON EL HOST POR EL QUE LLEGÓ LA PETICIÓN, no con una variable de
 * entorno. Es la única forma de que salga una orden de clonado que funcione
 * desde donde la van a pegar: quien está mirando la pantalla llegó a esta API
 * por alguna dirección, y esa es la buena. Una variable más que configurar es
 * una variable más que alguien olvida, y el síntoma sería una orden de
 * `git clone` que no conecta desde ningún sitio y que nadie sabe por qué.
 *
 * `protocol` y `host` salen de las cabeceras del proxy porque el servidor
 * arranca con `trustProxy` — sin eso, detrás de Cloudflare esto diría `http` y
 * el puerto interno.
 *
 * `host` Y NO `hostname`: `hostname` QUITA EL PUERTO. En producción da igual
 * porque el puerto es el de siempre, pero en desarrollo salía
 * `http://localhost/git/…` —sin el `:4000`— y esa orden de clonado no conecta
 * con nada. Se vio probándolo; leyendo el código no se ve.
 */
function urlDeClonado(request: FastifyRequest, workspaceId: string, slug: string): string {
  const host = request.host || request.headers.host || request.hostname;
  return `${request.protocol}://${host}/git/${workspaceId}/${slug}.git`;
}

export async function reposRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/workspaces/:workspaceId/repos", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS} from hosted_repos where workspace_id = $1 order by slug`,
        [workspaceId],
      );
      return {
        repos: rows.map((r) => ({
          ...(r as Record<string, unknown>),
          cloneUrl: urlDeClonado(request, workspaceId, (r as { slug: string }).slug),
        })),
      };
    });
  });

  app.post("/workspaces/:workspaceId/repos", async (request, reply) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const body = parseBody(
      z.object({
        slug: slugZ,
        description: z.string().trim().max(300).default(""),
        defaultBranch: ramaZ.default("main"),
      }),
      request.body,
    );

    // La fila primero: es su política la que autoriza. Ver la cabecera.
    const repo = await withUser(userId, async (db) => {
      const { rows: existe } = await db.query(
        "select 1 from hosted_repos where workspace_id = $1 and slug = $2",
        [workspaceId, body.slug],
      );
      if (existe.length > 0) throw badRequest("ya hay un repositorio con ese nombre en este espacio");

      const { rows } = await db.query(
        `insert into hosted_repos
           (workspace_id, organization_id, slug, description, default_branch, created_by)
         values ($1,(select organization_id from workspaces where id = $1),$2,$3,$4,$5)
         returning ${COLUMNAS}`,
        [workspaceId, body.slug, body.description, body.defaultBranch, userId],
      );
      return rows[0] as { slug: string };
    });

    try {
      await crearRepo(workspaceId, body.slug, body.defaultBranch);
    } catch (error) {
      // La carpeta no se creó, así que la fila sobra: se quita para no dejar un
      // repositorio que se ve en la lista y no se puede clonar.
      await withUser(userId, (db) =>
        db.query("delete from hosted_repos where workspace_id = $1 and slug = $2", [
          workspaceId,
          body.slug,
        ]),
      );
      throw badRequest(
        error instanceof Error ? `no se pudo crear el repositorio: ${error.message}` : "no se pudo crear",
      );
    }

    return reply.status(201).send({ repo: { ...repo, cloneUrl: urlDeClonado(request, workspaceId, body.slug) } });
  });

  /**
   * Lo que hay dentro, sin clonar: ramas y últimos commits.
   *
   * Se lee del repositorio de verdad, no de una tabla: una copia del historial
   * en la base se desincroniza con el primer push que llegue mientras nadie
   * mira, y entonces la pantalla miente con aplomo.
   */
  app.get("/workspaces/:workspaceId/repos/:slug", async (request) => {
    const userId = requireUser(request);
    const { workspaceId, slug } = parseParams(
      z.object({ workspaceId: uuid, slug: slugZ }),
      request.params,
    );

    const repo = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS} from hosted_repos where workspace_id = $1 and slug = $2`,
        [workspaceId, slug],
      );
      return rows[0] as { defaultBranch: string } | undefined;
    });
    if (!repo) throw notFound("no hay ningún repositorio con ese nombre");

    if (!(await existeRepo(workspaceId, slug))) {
      return { repo: { ...repo, cloneUrl: urlDeClonado(request, workspaceId, slug) }, ramas: [], commits: [] };
    }

    const ramas = await ramasDelRepo(workspaceId, slug);
    const cual = ramas.find((r) => r.nombre === repo.defaultBranch)?.nombre ?? ramas[0]?.nombre;
    const commits = cual ? await commitsDelRepo(workspaceId, slug, cual) : [];
    return { repo: { ...repo, cloneUrl: urlDeClonado(request, workspaceId, slug) }, ramas, commits };
  });

  /**
   * Borrar: se lleva el historial entero y no hay vuelta atrás.
   *
   * LA FILA SE BORRA PRIMERO, DENTRO DE LA TRANSACCIÓN, igual que al desalojar
   * una base (0066): quien no tiene mando sobre el espacio choca con la
   * política ANTES de que se destruya nada. La política es la única
   * autorización, así que tiene que correr antes del destrozo.
   */
  app.delete("/workspaces/:workspaceId/repos/:slug", async (request) => {
    const userId = requireUser(request);
    const { workspaceId, slug } = parseParams(
      z.object({ workspaceId: uuid, slug: slugZ }),
      request.params,
    );

    const habia = await withUser(userId, async (db) => {
      const { rowCount } = await db.query(
        "delete from hosted_repos where workspace_id = $1 and slug = $2",
        [workspaceId, slug],
      );
      return (rowCount ?? 0) > 0;
    });
    if (!habia) throw notFound("no hay ningún repositorio con ese nombre");

    await borrarRepo(workspaceId, slug);
    return { borrado: true };
  });

  // --- Contraseñas de git ----------------------------------------------------

  app.get("/git-tokens", async (request) => {
    const userId = requireUser(request);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select id, name, created_at as "createdAt", last_used_at as "lastUsedAt"
           from git_tokens where revoked_at is null order by created_at desc`,
      );
      return { tokens: rows };
    });
  });

  /**
   * La contraseña SE ENSEÑA UNA VEZ Y NO VUELVE. En la base solo queda su
   * hash, así que ninguna ruta puede servirla otra vez ni aunque quisiera: el
   * mismo trato que la cadena de conexión de una base alojada.
   */
  app.post("/git-tokens", async (request, reply) => {
    const userId = requireUser(request);
    const { name } = parseBody(
      z.object({ name: z.string().trim().min(1).max(60) }),
      request.body,
    );

    // base64url: la misma entropía en menos caracteres y sin símbolos que haya
    // que escapar al pegarla en una URL o en un fichero de configuración.
    const token = `devup_${randomBytes(24).toString("base64url")}`;

    const fila = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into git_tokens (user_id, name, token_hash) values ($1,$2,$3)
         returning id, name, created_at as "createdAt"`,
        [userId, name, hashDeToken(token)],
      );
      return rows[0];
    });

    return reply.status(201).send({ token: { ...(fila as object), secreto: token } });
  });

  app.delete("/git-tokens/:id", async (request) => {
    const userId = requireUser(request);
    const { id } = parseParams(z.object({ id: uuid }), request.params);
    const habia = await withUser(userId, async (db) => {
      // Se marca revocada en vez de borrarse: `token_hash` es único, y una fila
      // que desaparece deja de contar como «esta contraseña ya existió».
      const { rowCount } = await db.query(
        "update git_tokens set revoked_at = now() where id = $1 and revoked_at is null",
        [id],
      );
      return (rowCount ?? 0) > 0;
    });
    if (!habia) throw notFound("esa contraseña ya no existe");
    return { revocada: true };
  });
}
