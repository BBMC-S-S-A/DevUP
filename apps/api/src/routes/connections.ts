import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { canjear, comenzar, githubOauthConfigurado, type TransitoGithub } from "../auth/github.js";
import { type Db, withUser } from "../db/pool.js";
import { env } from "../env.js";
import { notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
import { decryptSecret, encryptSecret } from "../security/vault.js";

const uuid = z.string().uuid();
// `anthropic` es la clave de IA de cada persona, para el asistente de dentro
// del producto (0030). Va aqui y no en una tabla propia porque es exactamente
// lo que esta boveda ya sabe guardar: un secreto ajeno, de una persona,
// cifrado y separado de la fila que se puede listar.
// `gemini` es la segunda opcion de clave de IA (0031): capa gratuita real,
// para quien no quiera gastar nada en el asistente. Google usa ese contenido
// para mejorar sus productos, y eso lo dice la pantalla, no solo aqui.
const PROVIDERS = ["github", "spotify", "anthropic", "gemini"] as const;

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

  /**
   * --- De workspace ---------------------------------------------------------
   *
   * El token de GitHub vive aquí desde 0035, no en la organización: cada
   * proyecto tiene su git, y con una credencial compartida el aislamiento
   * sería de mentira —el token de un equipo abriría los repositorios privados
   * que otro equipo conectara—.
   */
  app.get("/workspaces/:workspaceId/connections", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${CONNECTION_COLUMNS} from connections
          where workspace_id = $1 order by created_at`,
        [workspaceId],
      );
      return { connections: rows };
    });
  });

  app.post("/workspaces/:workspaceId/connections", async (request, reply) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
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
        `insert into connections (provider, workspace_id, display_name, created_by)
         values ($1,$2,$3,$4) returning id`,
        [body.provider, workspaceId, body.displayName, userId],
      );
      const id = rows[0]!.id;
      await db.query(
        "insert into connection_secrets (connection_id, encrypted_secret) values ($1,$2)",
        [id, encryptSecret(body.secret)],
      );

      // Un token de GitHub adopta los repositorios que ya estaban sin él. Ver
      // el porqué en la ruta equivalente de organización, más abajo.
      if (body.provider === "github") {
        await db.query(
          `update github_repos set connection_id = $1
            where workspace_id = $2 and connection_id is null`,
          [id, workspaceId],
        );
      }

      const { rows: full } = await db.query(
        `select ${CONNECTION_COLUMNS} from connections where id = $1`,
        [id],
      );
      return full[0];
    });

    return reply.status(201).send({ connection });
  });

  // --- Conectar GitHub sin pegar un token a mano -----------------------------
  //
  // Solo existen si las tres variables de entorno están puestas — mismo trato
  // que `/auth/google`: un botón que lleva a una ruta que no existe es peor
  // que no tener botón. Ver auth/github.ts para el porqué del alcance `repo`
  // y de por qué no hay PKCE aquí.
  if (githubOauthConfigurado()) {
    const COOKIE_TRANSITO = "devup_github_oauth";

    const volver = (reply: FastifyReply, workspaceId: string | null, motivo?: string) => {
      const destino = workspaceId ? `/app/w/${workspaceId}/github` : "/app";
      const query = motivo ? `?error=${encodeURIComponent(motivo)}` : "?connected=1";
      return reply.redirect(`${env.APP_BASE_URL}${destino}${query}`);
    };

    app.get("/workspaces/:workspaceId/connections/github/start", async (request, reply) => {
      requireUser(request);
      const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
      const { url, transito } = comenzar(workspaceId);

      void reply.setCookie(COOKIE_TRANSITO, JSON.stringify(transito), {
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        // `lax`, no `strict`: GitHub trae de vuelta al navegador con una
        // navegación de nivel superior, igual que Google — con `strict` la
        // cookie no viajaría y el callback no encontraría el estado.
        sameSite: "lax",
        path: "/connections/github",
        maxAge: 600,
      });

      return reply.redirect(url);
    });

    app.get("/connections/github/callback", async (request, reply) => {
      const userId = requireUser(request);
      const { code, state, error } = request.query as { code?: string; state?: string; error?: string };

      const crudo = request.cookies[COOKIE_TRANSITO];
      void reply.clearCookie(COOKIE_TRANSITO, { path: "/connections/github" });

      let transito: TransitoGithub | null = null;
      if (crudo) {
        try {
          transito = JSON.parse(crudo) as TransitoGithub;
        } catch {
          transito = null;
        }
      }

      // Cancelar en la pantalla de GitHub es un caso normal, no una avería.
      if (error) return volver(reply, transito?.workspaceId ?? null, "se canceló la conexión con GitHub");
      if (!transito || !code || !state) {
        return volver(reply, transito?.workspaceId ?? null, "la sesión de conexión caducó, inténtalo otra vez");
      }
      // El anti-CSRF: sin esto, alguien podría hacer que tu navegador complete
      // el callback con SU código y conectaras SU cuenta de GitHub a tu
      // organización.
      if (transito.estado !== state) {
        return volver(reply, transito.workspaceId, "la sesión de conexión no coincide");
      }

      try {
        const identidad = await canjear(code);

        await withUser(userId, async (db) => {
          const { rows } = await db.query<{ id: string }>(
            `insert into connections (provider, workspace_id, display_name, created_by)
             values ('github',$1,$2,$3) returning id`,
            [transito!.workspaceId, identidad.login, userId],
          );
          const id = rows[0]!.id;
          await db.query(
            "insert into connection_secrets (connection_id, encrypted_secret) values ($1,$2)",
            [id, encryptSecret(identidad.token)],
          );
          // Mismo motivo que en el alta manual de más arriba: adoptar los
          // repositorios públicos que ya estaban sin token en este workspace.
          await db.query(
            `update github_repos set connection_id = $1
              where workspace_id = $2 and connection_id is null`,
            [id, transito!.workspaceId],
          );
        });

        return volver(reply, transito.workspaceId);
      } catch (fallo) {
        request.log.warn(
          { err: fallo instanceof Error ? fallo.message : fallo },
          "falló la conexión OAuth con GitHub",
        );
        return volver(reply, transito.workspaceId, "no se pudo completar la conexión con GitHub");
      }
    });
  }

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

      /**
       * Un token de GitHub adopta los repositorios que se añadieron sin él.
       *
       * Desde 0034 se puede pegar el enlace de un repositorio público sin
       * conectar nada. Quien luego conecta un token lo hace precisamente para
       * que eso funcione mejor —alcanzar lo privado, y entrar en la pasada
       * automática, que se salta los que no tienen credencial—. Sin esto, el
       * token quedaría conectado y sin efecto sobre lo que ya está en la
       * pantalla: la peor clase de fallo, el que no se ve.
       */
      if (body.provider === "github") {
        await db.query(
          `update github_repos set connection_id = $1
            where organization_id = $2 and connection_id is null`,
          [id, orgId],
        );
      }

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
