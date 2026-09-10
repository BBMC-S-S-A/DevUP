import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import {
  accessTtlSeconds,
  hashRefreshToken,
  newRefreshToken,
  refreshTtlSeconds,
  safeEqual,
  signAccessToken,
} from "../auth/tokens.js";
import { withUser } from "../db/pool.js";
import { env } from "../env.js";
import { HttpError, parseBody, parseQuery, requireUser } from "../lib/http.js";

/**
 * El servidor de autorización OAuth 2.1 para el MCP remoto.
 *
 * Por qué esto y no un token pegado a mano: docs/HEARTH-Y-LA-PUERTA-MCP.md ya
 * había decidido dejar el transporte remoto para después porque "obliga a
 * montar OAuth: servidor de autorización, consentimiento y registro de
 * clientes". Esto es exactamente eso, y nada más — no se inventa un sistema
 * de identidad nuevo.
 *
 * EL TOKEN QUE SALE DE AQUÍ ES UNA SESIÓN NORMAL. `/oauth/token` termina
 * llamando a `session_open`, la misma función que usan `/auth/login` y
 * `/auth/refresh` (vía `openSession` en `auth.ts`). Para el resto de la API,
 * una petición autenticada por un cliente OAuth es indistinguible de una del
 * navegador: mismo `Authorization: Bearer`, misma tabla `sessions`, mismo
 * `GET /auth/sessions` para verla en "Conexiones de agente" (se lista con
 * `isAgent: true` y el nombre del cliente OAuth como `label`, sin código
 * nuevo en esa pantalla).
 *
 * LA API SOLO DEVUELVE JSON O REDIRECCIONES, NUNCA HTML PROPIO — igual que ya
 * hace `/auth/google`. La pantalla de consentimiento vive en `apps/web`
 * (`/app/autorizar-agente`), no aquí: `GET /oauth/authorize` valida y
 * redirige a esa pantalla, que ya hereda el guardián de sesión de
 * `(privado)/app/layout.tsx` — si no hay sesión, ya sabe mandar a `/login`.
 */

const oauthError = (status: number, code: string, message: string) => new HttpError(status, message, code);

/** Snake_case a propósito: es lo único de esta API que no sigue camelCase.
 *  El formato lo dicta RFC 6749, no nuestra convención — un cliente OAuth
 *  genérico (el de Claude, el que sea) espera exactamente estas claves. */
type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
};

async function emitirToken(userId: string, etiqueta: { label: string; isAgent: boolean }): Promise<TokenResponse> {
  const { token, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);
  await withUser(null, (db) =>
    db.query("select public.session_open($1, $2, $3, $4, $5, $6)", [
      userId,
      hash,
      expiresAt.toISOString(),
      "devup-mcp-remoto",
      etiqueta.label,
      etiqueta.isAgent,
    ]),
  );
  return {
    access_token: await signAccessToken(userId),
    token_type: "Bearer",
    expires_in: accessTtlSeconds,
    refresh_token: token,
  };
}

/** De dónde sale esta API, para construir URLs que se apuntan a sí misma en
 *  la metadata de descubrimiento. `trustProxy` ya está activo en
 *  server.ts, así que `request.protocol` refleja https detrás de Railway. */
function origenPropio(request: FastifyRequest): string {
  return `${request.protocol}://${request.headers.host}`;
}

async function clienteRegistrado(clientId: string): Promise<{ clientName: string; redirectUris: string[] } | null> {
  return withUser(null, async (db) => {
    const { rows } = await db.query<{ clientName: string; redirectUris: string[] }>(
      `select client_name as "clientName", redirect_uris as "redirectUris"
         from oauth_clients where client_id = $1`,
      [clientId],
    );
    return rows[0] ?? null;
  });
}

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Descubrimiento (RFC 8414). Lo primero que lee un cliente MCP al pegar
   * la URL — sin esto, no sabe ni a dónde registrarse. Público, sin sesión.
   */
  app.get("/.well-known/oauth-authorization-server", async (request) => {
    const base = origenPropio(request);
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      // Cliente público: no hay client_secret, PKCE es la defensa.
      token_endpoint_auth_methods_supported: ["none"],
    };
  });

  /**
   * Registro dinámico de clientes (RFC 7591). Claude lo llama solo, una vez
   * por instalación, antes de conocer ningún dato de la persona.
   */
  app.post("/oauth/register", async (request, reply) => {
    const body = parseBody(
      z.object({
        client_name: z.string().trim().min(1).max(200),
        redirect_uris: z.array(z.string().url()).min(1).max(10),
      }),
      request.body,
    );

    const clientId = randomBytes(16).toString("base64url");
    await withUser(null, (db) =>
      db.query(
        `insert into oauth_clients (client_id, client_name, redirect_uris)
         values ($1, $2, $3::jsonb)`,
        [clientId, body.client_name, JSON.stringify(body.redirect_uris)],
      ),
    );

    return reply.status(201).send({
      client_id: clientId,
      client_name: body.client_name,
      redirect_uris: body.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  /**
   * Autorización. Sin sesión propia aquí — se valida lo que se pueda validar
   * sin una (que el cliente y el redirect_uri existan y coincidan; redirigir
   * a un redirect_uri no verificado es la vulnerabilidad clásica de un
   * servidor de autorización, así que eso falla aquí y no allá) y se manda
   * el resto a la pantalla de consentimiento real, en `apps/web`.
   */
  app.get("/oauth/authorize", async (request, reply) => {
    const query = parseQuery(
      z.object({
        response_type: z.literal("code"),
        client_id: z.string().min(1),
        redirect_uri: z.string().url(),
        state: z.string().optional(),
        code_challenge: z.string().min(43).max(128),
        code_challenge_method: z.literal("S256"),
        scope: z.string().optional(),
      }),
      request.query,
    );

    const cliente = await clienteRegistrado(query.client_id);
    if (!cliente) throw oauthError(400, "invalid_client", "cliente OAuth no registrado");
    if (!cliente.redirectUris.includes(query.redirect_uri)) {
      throw oauthError(400, "invalid_request", "redirect_uri no coincide con el registrado");
    }

    const destino = new URL("/app/autorizar-agente", env.APP_BASE_URL);
    destino.searchParams.set("client_id", query.client_id);
    destino.searchParams.set("client_name", cliente.clientName);
    destino.searchParams.set("redirect_uri", query.redirect_uri);
    destino.searchParams.set("code_challenge", query.code_challenge);
    if (query.state) destino.searchParams.set("state", query.state);
    return reply.redirect(destino.toString());
  });

  /**
   * El consentimiento en sí. Lo llama la pantalla de `apps/web`, con sesión
   * real — quien aprueba es quien está autenticado en este momento, no un
   * id que alguien pudiera pasar como parámetro.
   */
  app.post("/oauth/consentir", { onRequest: requireSession }, async (request) => {
    const userId = requireUser(request);
    const body = parseBody(
      z.object({
        client_id: z.string().min(1),
        redirect_uri: z.string().url(),
        state: z.string().optional(),
        code_challenge: z.string().min(43).max(128),
      }),
      request.body,
    );

    const cliente = await clienteRegistrado(body.client_id);
    if (!cliente) throw oauthError(400, "invalid_client", "cliente OAuth no registrado");
    if (!cliente.redirectUris.includes(body.redirect_uri)) {
      throw oauthError(400, "invalid_request", "redirect_uri no coincide con el registrado");
    }

    const codigo = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await withUser(userId, (db) =>
      db.query(
        `insert into oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, expires_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [codigo, body.client_id, userId, body.redirect_uri, body.code_challenge, expiresAt.toISOString()],
      ),
    );

    const destino = new URL(body.redirect_uri);
    destino.searchParams.set("code", codigo);
    if (body.state) destino.searchParams.set("state", body.state);
    return { redirectTo: destino.toString() };
  });

  /**
   * El canje. Público — quien llega aquí todavía no tiene sesión de DevUP,
   * es justo lo que esta ruta concede. Acepta `application/x-www-form-urlencoded`
   * (RFC 6749 lo exige así; `@fastify/formbody` lo registra en server.ts)
   * y también JSON, por si algún cliente lo manda distinto.
   */
  app.post("/oauth/token", async (request) => {
    const body = parseBody(
      z.discriminatedUnion("grant_type", [
        z.object({
          grant_type: z.literal("authorization_code"),
          code: z.string().min(1),
          redirect_uri: z.string().url(),
          client_id: z.string().min(1),
          code_verifier: z.string().min(43).max(128),
        }),
        z.object({
          grant_type: z.literal("refresh_token"),
          refresh_token: z.string().min(1),
        }),
      ]),
      request.body,
    );

    if (body.grant_type === "authorization_code") {
      const canjeado = await withUser(null, async (db) => {
        const { rows } = await db.query<{
          userId: string;
          clientId: string;
          redirectUri: string;
          codeChallenge: string;
        }>(
          `select user_id as "userId", client_id as "clientId",
                  redirect_uri as "redirectUri", code_challenge as "codeChallenge"
             from public.oauth_code_consume($1)`,
          [body.code],
        );
        return rows[0] ?? null;
      });
      if (!canjeado) throw oauthError(400, "invalid_grant", "código inválido, ya usado o caducado");
      if (canjeado.clientId !== body.client_id || canjeado.redirectUri !== body.redirect_uri) {
        throw oauthError(400, "invalid_grant", "el código no corresponde a este cliente o redirect_uri");
      }

      const reto = createHash("sha256").update(body.code_verifier).digest("base64url");
      if (!safeEqual(reto, canjeado.codeChallenge)) {
        throw oauthError(400, "invalid_grant", "code_verifier no corresponde al code_challenge original");
      }

      const cliente = await clienteRegistrado(canjeado.clientId);
      const etiqueta = cliente?.clientName || "conexión OAuth";
      return emitirToken(canjeado.userId, { label: etiqueta, isAgent: true });
    }

    // grant_type === "refresh_token" — mismo camino que POST /auth/refresh,
    // sin cookies: el token viaja en el cuerpo porque un cliente OAuth
    // remoto no comparte cookies con esta API.
    const consumido = await withUser(null, async (db) => {
      const { rows } = await db.query<{ user_id: string; label: string; is_agent: boolean }>(
        "select user_id, label, is_agent from public.session_consume($1)",
        [hashRefreshToken(body.refresh_token)],
      );
      return rows[0] ?? null;
    });
    if (!consumido) throw oauthError(400, "invalid_grant", "el token de refresco ha caducado o ya no es válido");

    return emitirToken(consumido.user_id, { label: consumido.label, isAgent: consumido.is_agent });
  });
}
