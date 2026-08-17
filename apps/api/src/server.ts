import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyError } from "fastify";
import { authPlugin } from "./auth/plugin.js";
import { closePool, withUser } from "./db/pool.js";
import { env, webOrigins } from "./env.js";
import { HttpError, translateDbError } from "./lib/http.js";
import { signalingRoutes } from "./realtime/signaling.js";
import { worldSocketRoutes } from "./realtime/world.js";
import { accountRoutes } from "./routes/account.js";
import { authRoutes } from "./routes/auth.js";
import { connectionRoutes } from "./routes/connections.js";
import { fileRoutes } from "./routes/files.js";
import { githubRoutes, refreshRepo } from "./routes/github.js";
import { iceRoutes } from "./routes/ice.js";
import { messageRoutes } from "./routes/messages.js";
import { notificationRoutes } from "./routes/notifications.js";
import { recordingRoutes } from "./routes/recordings.js";
import { salesRoutes } from "./routes/sales.js";
import { searchRoutes } from "./routes/search.js";
import { spotifyRoutes } from "./routes/spotify.js";
import { taskRoutes } from "./routes/tasks.js";
import { worldRoutes } from "./routes/world.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { decryptSecret } from "./security/vault.js";
import { deleteObjects, ensureBucket } from "./storage/s3.js";

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const SWEEP_AGE = "2 hours";
const GITHUB_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    transport:
      env.NODE_ENV === "production"
        ? undefined
        : { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
    // Nunca en los registros: la cookie lleva la sesión y el ticket del
    // WebSocket viaja en la URL.
    redact: ["req.headers.cookie", "req.headers.authorization", "req.query.ticket"],
  },
  trustProxy: true,
});

await app.register(cors, {
  origin: webOrigins,
  // Sin esto el navegador no manda la cookie de sesión y todo responde 401
  // sin explicar por qué.
  credentials: true,
});

await app.register(cookie);

// La API solo devuelve JSON, así que la mayor parte de helmet sobra; lo que
// aporta es impedir que un navegador adivine el tipo de una respuesta y la
// trate como HTML. La CSP se desactiva porque aquí no se sirven páginas.
await app.register(helmet, { contentSecurityPolicy: false });

/**
 * Límite de peticiones.
 *
 * El global es generoso: lo que de verdad protege es el límite específico de
 * /auth/login y /auth/register, más abajo. Sin él, probar contraseñas contra
 * una cuenta conocida es cuestión de dejar un script corriendo — scrypt hace
 * caro cada intento para el servidor, pero no impide que se intenten miles.
 *
 * El contador vive en memoria. Con varias instancias detrás de un balanceador
 * cada una cuenta por su cuenta y el límite efectivo se multiplica; ahí hay
 * que pasarle un almacén en Redis.
 */
await app.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: "1 minute",
  // Detrás de un proxy, `ip` ya viene de X-Forwarded-For porque trustProxy
  // está activo. Sin eso, todas las peticiones parecerían venir del balanceador
  // y el límite caería sobre todo el mundo a la vez.
  keyGenerator: (request) => request.ip,
  // El plugin lanza tal cual lo que devuelva esto, así que el `statusCode`
  // tiene que venir dentro: sin él, Fastify no sabe que es un 429 y acaba
  // respondiendo 500 a algo que solo pedía esperar un minuto.
  errorResponseBuilder: (_request, context) => ({
    statusCode: 429,
    // `code` y no `error`: es lo que lee el manejador global para componer la
    // respuesta, y así el cliente distingue un 429 de una validación fallida.
    code: "demasiadas_peticiones",
    message: `demasiadas peticiones seguidas; vuelve a intentarlo en ${context.after}`,
  }),
});

await app.register(websocket, { options: { maxPayload: 256 * 1024 } });
await app.register(authPlugin);

app.setErrorHandler((error: FastifyError, request, reply) => {
  if (error instanceof HttpError) {
    return reply.status(error.status).send({ error: error.code, message: error.message });
  }

  const translated = translateDbError(error);
  if (translated) {
    return reply
      .status(translated.status)
      .send({ error: translated.code, message: translated.message });
  }

  if (error.validation) {
    return reply.status(400).send({ error: "solicitud_invalida", message: error.message });
  }

  // Los 4xx que genera el propio Fastify —límite de peticiones, ruta
  // inexistente, cuerpo demasiado grande— ya traen su código y su mensaje.
  // Sin esto se convertían en un 500 genérico, y el cliente que recibía un 429
  // no tenía forma de saber que solo tenía que esperar.
  const status = error.statusCode ?? 500;
  if (status >= 400 && status < 500) {
    return reply.status(status).send({
      error: error.code ?? "solicitud_invalida",
      message: error.message,
    });
  }

  // Lo que llega aquí es un fallo nuestro: se registra entero y se responde
  // genérico, porque el mensaje de Postgres suele describir el esquema.
  request.log.error({ err: error }, "error no controlado");
  return reply.status(500).send({ error: "error_interno", message: "algo ha ido mal" });
});

app.get("/health", async () => ({ status: "ok", now: new Date().toISOString() }));

await app.register(authRoutes);
await app.register(accountRoutes);
await app.register(connectionRoutes);
await app.register(workspaceRoutes);
await app.register(fileRoutes);
await app.register(githubRoutes);
await app.register(iceRoutes);
await app.register(taskRoutes);
await app.register(messageRoutes);
await app.register(notificationRoutes);
await app.register(recordingRoutes);
await app.register(salesRoutes);
await app.register(searchRoutes);
await app.register(spotifyRoutes);
await app.register(worldRoutes);
await app.register(signalingRoutes);
await app.register(worldSocketRoutes);

/**
 * Barrendero de subidas abandonadas.
 *
 * Una reserva que nunca se confirmó —pestaña cerrada a mitad, red caída— deja
 * una fila 'pending' y, a veces, un objeto en el almacén. Aquí se borran
 * ambos. Que la fila exista es justo lo que hace posible encontrar el objeto:
 * con el orden inverso, el objeto sería inencontrable y se pagaría para
 * siempre.
 */
async function sweep(): Promise<void> {
  try {
    const keys = await withUser(null, async (db) => {
      const { rows } = await db.query<{ storage_key: string }>(
        "select storage_key from public.sweep_abandoned_uploads($1::interval)",
        [SWEEP_AGE],
      );
      return rows.map((r) => r.storage_key);
    });
    if (keys.length > 0) {
      await deleteObjects(keys);
      app.log.info(`[barrendero] ${keys.length} subida(s) abandonada(s) retirada(s)`);
    }
  } catch (error) {
    app.log.warn({ error }, "[barrendero] pasada fallida");
  }
}

/**
 * Refresco periódico de los repositorios de GitHub conectados.
 *
 * No en cada carga de pantalla: un token normal tiene 5000 peticiones por
 * hora, y una organización con varios repos abiertos a la vez los agota
 * rápido si cada visita dispara una llamada nueva.
 *
 * `withUser(null, ...)` corre sin identidad, así que las dos consultas que
 * leen a través de organizaciones ajenas tienen que ser `security definer`
 * (`list_github_repos_for_refresh`, `get_connection_secret_for_refresh`) —
 * ver la cabecera de 0016_github.sql. Un repo que falle (token revocado,
 * repo borrado) no debe frenar el resto.
 */
async function refreshGithubRepos(): Promise<void> {
  try {
    const repos = await withUser(null, async (db) => {
      const { rows } = await db.query<{ repo_id: string; connection_id: string; full_name: string }>(
        "select repo_id, connection_id, full_name from public.list_github_repos_for_refresh()",
      );
      return rows;
    });

    for (const repo of repos) {
      try {
        await withUser(null, async (db) => {
          const { rows } = await db.query<{ get_connection_secret_for_refresh: Buffer | null }>(
            "select public.get_connection_secret_for_refresh($1)",
            [repo.connection_id],
          );
          const packed = rows[0]?.get_connection_secret_for_refresh;
          if (!packed) return;
          const token = decryptSecret(packed);
          await refreshRepo(db, repo.repo_id, token, repo.full_name);
        });
      } catch (error) {
        app.log.warn({ error, repo: repo.full_name }, "[github] no se pudo refrescar un repositorio");
      }
    }
  } catch (error) {
    app.log.warn({ error }, "[github] pasada de refresco fallida");
  }
}

await ensureBucket();
const sweeper = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
void sweep();
const githubSweeper = setInterval(() => void refreshGithubRepos(), GITHUB_REFRESH_INTERVAL_MS);
void refreshGithubRepos();

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} recibido, cerrando`);
  clearInterval(sweeper);
  clearInterval(githubSweeper);
  await app.close();
  await closePool();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
