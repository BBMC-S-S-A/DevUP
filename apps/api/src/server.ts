import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyError } from "fastify";
import { authPlugin } from "./auth/plugin.js";
import { closePool, withUser } from "./db/pool.js";
import { env, webOrigins } from "./env.js";
import { HttpError, translateDbError } from "./lib/http.js";
import { signalingRoutes } from "./realtime/signaling.js";
import { authRoutes } from "./routes/auth.js";
import { fileRoutes } from "./routes/files.js";
import { recordingRoutes } from "./routes/recordings.js";
import { taskRoutes } from "./routes/tasks.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { deleteObjects, ensureBucket } from "./storage/s3.js";

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const SWEEP_AGE = "2 hours";

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

  if (error.validation || error.statusCode === 400) {
    return reply.status(400).send({ error: "solicitud_invalida", message: error.message });
  }

  // Lo que llega aquí es un fallo nuestro: se registra entero y se responde
  // genérico, porque el mensaje de Postgres suele describir el esquema.
  request.log.error({ err: error }, "error no controlado");
  return reply.status(500).send({ error: "error_interno", message: "algo ha ido mal" });
});

app.get("/health", async () => ({ status: "ok", now: new Date().toISOString() }));

await app.register(authRoutes);
await app.register(workspaceRoutes);
await app.register(fileRoutes);
await app.register(taskRoutes);
await app.register(recordingRoutes);
await app.register(signalingRoutes);

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

await ensureBucket();
const sweeper = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
void sweep();

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} recibido, cerrando`);
  clearInterval(sweeper);
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
