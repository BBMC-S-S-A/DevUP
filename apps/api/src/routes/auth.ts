import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  REFRESH_COOKIE,
  clearSessionCookies,
  requireSession,
  setSessionCookies,
} from "../auth/plugin.js";
import { burnTime, hashPassword, verifyPassword } from "../auth/password.js";
import {
  hashRefreshToken,
  newRefreshToken,
  refreshTtlSeconds,
  signAccessToken,
} from "../auth/tokens.js";
import { type Db, withUser } from "../db/pool.js";
import { HttpError, parseBody, requireUser, unauthorized } from "../lib/http.js";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("correo inválido").max(254),
  password: z
    .string()
    .min(10, "la contraseña necesita al menos 10 caracteres")
    .max(200, "contraseña demasiado larga"),
});

const registration = credentials.extend({
  displayName: z.string().trim().max(80).default(""),
});

export type Me = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
};

async function loadMe(db: Db, userId: string): Promise<Me> {
  const { rows } = await db.query<Me>(
    `select u.id, u.email::text as "email",
            p.display_name as "displayName",
            p.avatar_url   as "avatarUrl"
       from users u
       join profiles p on p.id = u.id
      where u.id = $1`,
    [userId],
  );
  const me = rows[0];
  if (!me) throw unauthorized("la cuenta ya no existe");
  return me;
}

/** Abre sesión: token de acceso corto y token de refresco rotatorio. */
async function openSession(
  db: Db,
  userId: string,
  userAgent: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const { token, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);
  await db.query("select public.session_open($1, $2, $3, $4)", [
    userId,
    hash,
    expiresAt.toISOString(),
    userAgent.slice(0, 300),
  ]);
  return { accessToken: await signAccessToken(userId), refreshToken: token };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    const { email, password, displayName } = parseBody(registration, request.body);
    const passwordHash = await hashPassword(password);

    // Sin identidad: el alta pasa por register_user(), que es SECURITY DEFINER
    // justamente porque en este punto todavía no hay nadie a quien atribuirle
    // la transacción.
    const { me, tokens } = await withUser(null, async (db) => {
      const { rows } = await db.query<{ register_user: string }>(
        "select public.register_user($1, $2, $3)",
        [email, passwordHash, displayName],
      );
      const userId = rows[0]!.register_user;
      const tokens = await openSession(db, userId, request.headers["user-agent"] ?? "");
      // La lectura del propio perfil ya sí va con identidad.
      return { me: { id: userId, email, displayName, avatarUrl: null }, tokens };
    });

    setSessionCookies(reply, tokens.accessToken, tokens.refreshToken);
    return reply.status(201).send({ user: me, accessToken: tokens.accessToken });
  });

  app.post("/auth/login", async (request, reply) => {
    const { email, password } = parseBody(credentials, request.body);

    const result = await withUser(null, async (db) => {
      const { rows } = await db.query<{ user_id: string; password_hash: string }>(
        "select user_id, password_hash from public.auth_credentials($1)",
        [email],
      );
      const found = rows[0];

      if (!found) {
        // Gastar el mismo tiempo que una comprobación real. Sin esto, la
        // diferencia de latencia deja enumerar qué correos tienen cuenta.
        await burnTime(password);
        return null;
      }

      if (!(await verifyPassword(password, found.password_hash))) return null;

      const tokens = await openSession(db, found.user_id, request.headers["user-agent"] ?? "");
      return { userId: found.user_id, tokens };
    });

    if (!result) {
      // Un solo mensaje para «no existe» y «contraseña incorrecta».
      throw new HttpError(401, "correo o contraseña incorrectos", "credenciales_invalidas");
    }

    const me = await withUser(result.userId, (db) => loadMe(db, result.userId));
    setSessionCookies(reply, result.tokens.accessToken, result.tokens.refreshToken);
    return reply.send({ user: me, accessToken: result.tokens.accessToken });
  });

  /**
   * Rotación del token de refresco: se canjea y se revoca en la misma
   * sentencia (ver session_consume), así que reutilizar uno ya gastado no
   * devuelve nada. Un token robado sirve una sola vez y deja de valer en
   * cuanto el dueño legítimo refresque.
   */
  app.post("/auth/refresh", async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE];
    if (!presented) throw unauthorized("no hay token de refresco");

    const result = await withUser(null, async (db) => {
      const { rows } = await db.query<{ user_id: string }>(
        "select user_id from public.session_consume($1)",
        [hashRefreshToken(presented)],
      );
      const consumed = rows[0];
      if (!consumed) return null;
      const tokens = await openSession(db, consumed.user_id, request.headers["user-agent"] ?? "");
      return { userId: consumed.user_id, tokens };
    });

    if (!result) {
      clearSessionCookies(reply);
      throw unauthorized("la sesión ha caducado");
    }

    const me = await withUser(result.userId, (db) => loadMe(db, result.userId));
    setSessionCookies(reply, result.tokens.accessToken, result.tokens.refreshToken);
    return reply.send({ user: me, accessToken: result.tokens.accessToken });
  });

  app.post("/auth/logout", async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE];
    if (presented) {
      await withUser(null, (db) =>
        db.query("select public.session_revoke($1)", [hashRefreshToken(presented)]),
      );
    }
    clearSessionCookies(reply);
    return reply.status(204).send();
  });

  app.get("/auth/me", { onRequest: requireSession }, async (request) => {
    const userId = requireUser(request);
    const me = await withUser(userId, (db) => loadMe(db, userId));
    return { user: me };
  });

  /**
   * Token efímero para el WebSocket.
   *
   * El navegador no deja fijar cabeceras en `new WebSocket()`, así que la
   * alternativa habitual es mandar el token en la URL — donde acaba en los
   * registros del servidor y del proxy. Este token dura un minuto y sirve solo
   * para abrir la conexión.
   */
  app.get("/auth/ws-ticket", { onRequest: requireSession }, async (request) => {
    const userId = requireUser(request);
    return { ticket: await signAccessToken(userId), expiresIn: 60 };
  });

  app.get("/auth/sessions", { onRequest: requireSession }, async (request) => {
    const userId = requireUser(request);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select id, user_agent as "userAgent", created_at as "createdAt",
                expires_at as "expiresAt", revoked_at as "revokedAt"
           from sessions
          where revoked_at is null and expires_at > now()
          order by created_at desc`,
      );
      return { sessions: rows };
    });
  });
}
