import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyAccessToken } from "../auth/tokens.js";
import { withUser } from "../db/pool.js";
import { type Member, fileHub, send, voiceHub } from "./hub.js";

const HEARTBEAT_MS = 30_000;

/**
 * Mensajes que acepta el servidor. Todo lo que llega por el socket es de
 * fuera: se valida igual que un cuerpo HTTP.
 *
 * `signal` lleva la carga de WebRTC —SDP y candidatos ICE— sin mirarla. El
 * servidor es un cartero: no entiende ni necesita entender lo que reparte, y
 * el audio ni siquiera pasa por aquí.
 */
const inbound = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("signal"),
    to: z.string().uuid(),
    data: z.unknown(),
  }),
  z.object({ type: z.literal("state"), muted: z.boolean() }),
  z.object({ type: z.literal("pong") }),
]);

type Identity = { userId: string; displayName: string };

/** Autentica el socket con el ticket efímero y comprueba el acceso al canal. */
async function authorize(
  request: FastifyRequest,
  scope: { channelId?: string; workspaceId?: string },
): Promise<Identity | null> {
  const { ticket } = request.query as { ticket?: string };
  if (!ticket) return null;

  const userId = await verifyAccessToken(ticket);
  if (!userId) return null;

  return withUser(userId, async (db) => {
    // Se pregunta a la base, no a la memoria: la pertenencia puede haber
    // cambiado desde que se emitió el ticket.
    if (scope.channelId) {
      const { rows } = await db.query<{ ok: boolean }>(
        "select public.can_access_channel($1) as ok",
        [scope.channelId],
      );
      if (!rows[0]?.ok) return null;
    }
    if (scope.workspaceId) {
      const { rows } = await db.query<{ ok: boolean }>(
        "select public.can_access_workspace($1) as ok",
        [scope.workspaceId],
      );
      if (!rows[0]?.ok) return null;
    }

    const { rows: profile } = await db.query<{ display_name: string }>(
      "select display_name from profiles where id = $1",
      [userId],
    );
    return { userId, displayName: profile[0]?.display_name ?? "alguien" };
  });
}

const publicMember = (m: Member) => ({
  peerId: m.peerId,
  userId: m.userId,
  displayName: m.displayName,
  muted: m.muted,
});

export async function signalingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Sala de voz. Un socket por pestaña; el `peerId` lo asigna el servidor.
   *
   * Que lo asigne el servidor y no el cliente resuelve dos cosas a la vez:
   * nadie puede suplantar el identificador de otro par, y una misma persona
   * abierta en dos pestañas obtiene dos identidades distintas — que es
   * exactamente lo que hace falta para que se oigan entre sí en vez de
   * pisarse.
   */
  app.get("/ws/voice", { websocket: true }, async (socket, request) => {
    const params = z
      .object({ channelId: z.string().uuid() })
      .safeParse(request.query);

    if (!params.success) {
      send(socket, { type: "error", message: "falta channelId" });
      socket.close(1008, "canal invalido");
      return;
    }

    const channelId = params.data.channelId;
    const identity = await authorize(request, { channelId });
    if (!identity) {
      send(socket, { type: "error", message: "sin acceso al canal" });
      socket.close(1008, "sin acceso");
      return;
    }

    const peerId = randomUUID();
    const me: Member = {
      peerId,
      userId: identity.userId,
      displayName: identity.displayName,
      socket,
      muted: false,
      alive: true,
    };

    // El historial se abre antes de anunciar la presencia: si join_call
    // fallara, no queremos a nadie intentando conectar con un par que no
    // llegó a entrar.
    let callSessionId: string | null = null;
    try {
      callSessionId = await withUser(identity.userId, async (db) => {
        const { rows } = await db.query<{ join_call: string }>(
          "select public.join_call($1, $2)",
          [channelId, peerId],
        );
        return rows[0]!.join_call;
      });
    } catch (error) {
      app.log.error({ error }, "join_call falló");
      send(socket, { type: "error", message: "no se pudo entrar en la llamada" });
      socket.close(1011, "join_call");
      return;
    }

    const existing = voiceHub.members(channelId).map(publicMember);
    voiceHub.join(channelId, me);

    send(socket, { type: "welcome", peerId, peers: existing });
    voiceHub.broadcast(channelId, { type: "peer-joined", peer: publicMember(me) }, peerId);

    const heartbeat = setInterval(() => {
      if (!me.alive) {
        // Ni pong ni cierre: el otro extremo está muerto pero el socket sigue
        // abierto. Sin esto, un portátil que se duerme deja un participante
        // fantasma en la sala hasta que caduque el TCP.
        socket.terminate();
        return;
      }
      me.alive = false;
      send(socket, { type: "ping" });
    }, HEARTBEAT_MS);

    socket.on("message", (raw: Buffer) => {
      let message: z.infer<typeof inbound>;
      try {
        message = inbound.parse(JSON.parse(raw.toString()));
      } catch {
        return; // Ruido: se ignora en silencio, no merece cerrar la conexión.
      }

      switch (message.type) {
        case "signal": {
          // El emisor lo pone el servidor. Si viniera del cliente, cualquiera
          // podría mandar una SDP haciéndose pasar por otro par de la sala.
          voiceHub.sendTo(channelId, message.to, {
            type: "signal",
            from: peerId,
            data: message.data,
          });
          break;
        }
        case "state": {
          me.muted = message.muted;
          voiceHub.broadcast(
            channelId,
            { type: "peer-state", peerId, muted: me.muted },
            peerId,
          );
          break;
        }
        case "pong": {
          me.alive = true;
          break;
        }
      }
    });

    socket.on("close", () => {
      clearInterval(heartbeat);
      voiceHub.leave(channelId, peerId);
      voiceHub.broadcast(channelId, { type: "peer-left", peerId });

      // Cierre del historial en mejor-esfuerzo. `reap_call_peer` sirve tanto
      // para la salida limpia como para la brusca, así que no hace falta
      // distinguirlas.
      void withUser(identity.userId, (db) =>
        db.query("select public.reap_call_peer($1)", [peerId]),
      ).catch((error: unknown) => {
        app.log.warn({ error, peerId, callSessionId }, "no se pudo cerrar el participante");
      });
    });
  });

  /**
   * Novedades de la biblioteca de archivos: subir algo en una pestaña tiene
   * que aparecer en la otra. Sustituye a la publicación de Realtime sobre la
   * tabla `files`.
   */
  app.get("/ws/files", { websocket: true }, async (socket, request) => {
    const params = z
      .object({ workspaceId: z.string().uuid() })
      .safeParse(request.query);

    if (!params.success) {
      socket.close(1008, "workspace invalido");
      return;
    }

    const workspaceId = params.data.workspaceId;
    const identity = await authorize(request, { workspaceId });
    if (!identity) {
      socket.close(1008, "sin acceso");
      return;
    }

    const peerId = randomUUID();
    fileHub.join(workspaceId, {
      peerId,
      userId: identity.userId,
      displayName: identity.displayName,
      socket,
      muted: false,
      alive: true,
    });

    send(socket, { type: "welcome" });
    socket.on("close", () => fileHub.leave(workspaceId, peerId));
  });
}

/** Avisa al workspace de que su biblioteca ha cambiado. */
export function announceFileChange(
  workspaceId: string,
  action: "created" | "updated" | "deleted",
  fileId: string,
): void {
  fileHub.broadcast(workspaceId, { type: "file-change", action, fileId });
}
