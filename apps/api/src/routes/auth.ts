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
import { env } from "../env.js";
import {
  HttpError,
  forbidden,
  limiteEstricto,
  parseBody,
  requireUser,
  unauthorized,
} from "../lib/http.js";
import { enviarVerificacion, hashToken } from "./account.js";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("correo inválido").max(254),
  password: z
    .string()
    .min(10, "la contraseña necesita al menos 10 caracteres")
    .max(200, "contraseña demasiado larga"),
});

const registration = credentials.extend({
  displayName: z.string().trim().max(80).default(""),
  /** Obligatorio salvo en modo abierto o para la primera cuenta. */
  inviteToken: z.string().min(10).optional(),
});

export type Me = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  /** La cartelera. Viaja con la sesión porque el selector de presencia
   *  vive en la barra y está en pantalla siempre. */
  presence: "available" | "busy_open" | "do_not_disturb";
  title: string | null;
};

async function loadMe(db: Db, userId: string): Promise<Me> {
  const { rows } = await db.query<Me>(
    `select u.id, u.email::text as "email",
            p.display_name as "displayName",
            p.avatar_url   as "avatarUrl",
            p.presence, p.title,
            (u.email_verified_at is not null) as "emailVerified"
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
  /**
   * Alta.
   *
   * Por defecto solo por invitación: una instancia de equipo con el registro
   * abierto es una instancia donde entra cualquiera que encuentre la URL. Las
   * dos excepciones son `SIGNUP_MODE=open` y la primera cuenta de la
   * instancia, porque si no, no habría nadie que pudiera invitar.
   */
  app.post("/auth/register", limiteEstricto, async (request, reply) => {
    const { email, password, displayName, inviteToken } = parseBody(registration, request.body);
    const passwordHash = await hashPassword(password);

    const { me, tokens } = await withUser(null, async (db) => {
      const { rows: conteo } = await db.query<{ user_count: string }>(
        "select public.user_count()",
      );
      const esPrimera = Number(conteo[0]!.user_count) === 0;
      const abierto = env.SIGNUP_MODE === "open";

      let invitacionHash: string | null = null;

      if (!abierto && !esPrimera) {
        if (!inviteToken) {
          throw forbidden("esta instancia solo admite altas por invitación");
        }

        const { rows: invitaciones } = await db.query<{
          email: string;
          expired: boolean;
          accepted: boolean;
        }>(
          `select email::text as email, expired, accepted
             from public.invitation_by_token($1)`,
          [hashToken(inviteToken)],
        );
        const invitacion = invitaciones[0];

        if (!invitacion || invitacion.expired || invitacion.accepted) {
          throw forbidden("la invitación no es válida o ha caducado");
        }
        // La invitación es para una dirección concreta. Sin esto, reenviar el
        // correo a otra persona le daría acceso a la organización.
        if (invitacion.email.toLowerCase() !== email) {
          throw forbidden(`esa invitación es para ${invitacion.email}`);
        }
        invitacionHash = hashToken(inviteToken);
      }

      const { rows } = await db.query<{ register_user: string }>(
        "select public.register_user($1, $2, $3)",
        [email, passwordHash, displayName],
      );
      const userId = rows[0]!.register_user;

      // Canjear la invitación en la misma transacción que el alta: si fallara
      // después, quedaría una cuenta creada fuera de toda organización y con
      // la invitación gastada.
      if (invitacionHash) {
        await db.query("select public.accept_invitation($1,$2)", [invitacionHash, userId]);
      }

      await enviarVerificacion(db, userId, email);

      const tokens = await openSession(db, userId, request.headers["user-agent"] ?? "");
      return {
        me: { id: userId, email, displayName, avatarUrl: null, emailVerified: false },
        tokens,
      };
    });

    setSessionCookies(reply, tokens.accessToken, tokens.refreshToken);
    return reply.status(201).send({ user: me, accessToken: tokens.accessToken });
  });

  app.post("/auth/login", limiteEstricto, async (request, reply) => {
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

    if (env.REQUIRE_EMAIL_VERIFICATION && !me.emailVerified) {
      // Sin cookies: la sesión no llega a abrirse. El token de refresco que se
      // creó arriba queda huérfano y caduca solo.
      throw forbidden("confirma tu correo antes de entrar");
    }

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

    if (env.REQUIRE_EMAIL_VERIFICATION && !me.emailVerified) {
      // Sin cookies: la sesión no llega a abrirse. El token de refresco que se
      // creó arriba queda huérfano y caduca solo.
      throw forbidden("confirma tu correo antes de entrar");
    }

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
