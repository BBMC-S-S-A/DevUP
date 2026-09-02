import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";
import { unauthorized } from "../lib/http.js";
import { accessTtlSeconds, refreshTtlSeconds, verifyAccessToken } from "./tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Id del usuario autenticado, o null. Lo fija el hook de abajo. */
    userId: string | null;
  }
}

export const ACCESS_COOKIE = "devup_access";
export const REFRESH_COOKIE = "devup_refresh";

const baseCookie = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  // Ver el porqué de esta variable en env.ts. Se lee de env y no se deja fija
  // en 'lax' porque el día que la web y la API vuelvan a compartir dominio
  // registrable, cambiar esto tiene que ser una variable de entorno, no un
  // redeploy de código.
  sameSite: env.COOKIE_SAME_SITE,
  path: "/",
} as const;

export function setSessionCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
): void {
  void reply.setCookie(ACCESS_COOKIE, accessToken, {
    ...baseCookie,
    maxAge: accessTtlSeconds,
  });
  void reply.setCookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookie,
    maxAge: refreshTtlSeconds,
    // El de refresco solo hace falta en su propia ruta; limitarlo reduce la
    // superficie por la que puede escaparse.
    path: "/auth",
  });
}

export function clearSessionCookies(reply: FastifyReply): void {
  void reply.clearCookie(ACCESS_COOKIE, { ...baseCookie });
  void reply.clearCookie(REFRESH_COOKIE, { ...baseCookie, path: "/auth" });
}

/**
 * Resuelve la identidad de cada petición.
 *
 * Acepta la cookie o `Authorization: Bearer` — lo segundo para el WebSocket y
 * para clientes que no son navegadores (la CLI y los agentes de más adelante).
 * Nunca falla: deja `userId` a null y son las rutas las que exigen sesión.
 */
async function resolveIdentity(request: FastifyRequest): Promise<void> {
  request.userId = null;

  const header = request.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const token = bearer ?? request.cookies[ACCESS_COOKIE] ?? null;
  if (!token) return;

  request.userId = await verifyAccessToken(token);
}

/** Hook para rutas que exigen sesión. */
export async function requireSession(request: FastifyRequest): Promise<void> {
  if (!request.userId) throw unauthorized();
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest("userId", null);
  app.addHook("onRequest", resolveIdentity);
});
