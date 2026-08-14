import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyAccessToken } from "../auth/tokens.js";
import { withUser } from "../db/pool.js";
import { type Member, channelHub, fileHub, send, voiceHub } from "./hub.js";

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
  z.object({
    type: z.literal("state"),
    muted: z.boolean(),
    camera: z.boolean().optional(),
    sharing: z.boolean().optional(),
  }),
  z.object({ type: z.literal("recording-request") }),
  z.object({ type: z.literal("recording-consent"), recordingId: z.string().uuid(), granted: z.boolean() }),
  z.object({ type: z.literal("recording-stop") }),
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
  camera: m.camera,
  sharing: m.sharing,
});

/**
 * Negociación del consentimiento para grabar.
 *
 * La grabación ocurre en el navegador de quien graba — el servidor no ve el
 * audio, va cifrado entre pares. Ver docs/decisiones/0001-cifrado-de-salas.md.
 * Como el sistema no puede impedir técnicamente que alguien grabe su propia
 * pantalla, lo que sí puede hacer es que grabar dentro de DevUP sea siempre un
 * acto explícito, anunciado y anotado.
 *
 * La regla es una y no admite matices: **nadie queda grabado sin haber dicho
 * que sí**. Un solo «no» cancela la grabación para todos, y quien entra a una
 * llamada que ya se está grabando tiene que aceptarlo igual que el resto.
 */
type RoomRecording = {
  id: string;
  requesterPeerId: string;
  requesterUserId: string;
  requesterName: string;
  /** Pares que todavía no han contestado. Vacío = luz verde. */
  pending: Set<string>;
  state: "pending" | "recording";
};

const recordings = new Map<string, RoomRecording>();

async function saveConsent(
  userId: string,
  recordingId: string,
  member: { peerId: string; userId: string; displayName: string },
  granted: boolean,
): Promise<void> {
  await withUser(userId, (db) =>
    db.query("select public.record_recording_consent($1,$2,$3,$4,$5)", [
      recordingId,
      member.peerId,
      member.userId,
      member.displayName,
      granted,
    ]),
  );
}

async function closeRecording(userId: string, recordingId: string): Promise<void> {
  await withUser(userId, (db) =>
    db.query("update call_recordings set ended_at = now() where id = $1 and ended_at is null", [
      recordingId,
    ]),
  );
}

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
      camera: false,
      sharing: false,
      alive: true,
    };

    // El historial se abre antes de anunciar la presencia: si join_call
    // fallara, no queremos a nadie intentando conectar con un par que no
    // llegó a entrar.
    let callSessionId: string | null = null;
    let startedAt: string | null = null;
    try {
      const opened = await withUser(identity.userId, async (db) => {
        const { rows } = await db.query<{ join_call: string }>(
          "select public.join_call($1, $2)",
          [channelId, peerId],
        );
        const sessionId = rows[0]!.join_call;
        // La duración se cuenta desde que se abrió la sesión, no desde que
        // entró cada uno: quien llega tarde tiene que ver el tiempo que lleva
        // la llamada, no el suyo.
        const { rows: session } = await db.query<{ started_at: Date }>(
          "select started_at from call_sessions where id = $1",
          [sessionId],
        );
        return { sessionId, startedAt: session[0]?.started_at.toISOString() ?? null };
      });
      callSessionId = opened.sessionId;
      startedAt = opened.startedAt;
    } catch (error) {
      app.log.error({ error }, "join_call falló");
      send(socket, { type: "error", message: "no se pudo entrar en la llamada" });
      socket.close(1011, "join_call");
      return;
    }

    const existing = voiceHub.members(channelId).map(publicMember);
    voiceHub.join(channelId, me);

    send(socket, { type: "welcome", peerId, peers: existing, startedAt });
    voiceHub.broadcast(channelId, { type: "peer-joined", peer: publicMember(me) }, peerId);

    // Quien entra a una llamada que ya se está grabando tiene que enterarse
    // antes de decir nada, y aceptarlo como los demás. Su cliente muestra un
    // aviso que bloquea hasta que responda.
    const ongoing = recordings.get(channelId);
    if (ongoing?.state === "recording") {
      ongoing.pending.add(peerId);
      send(socket, {
        type: "recording-active",
        recordingId: ongoing.id,
        startedBy: ongoing.requesterName,
      });
    }

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

    const requestRecording = async (): Promise<void> => {
      if (recordings.has(channelId)) {
        send(socket, { type: "error", message: "ya hay una grabación en curso" });
        return;
      }
      if (!callSessionId) return;

      let recordingId: string;
      try {
        recordingId = await withUser(identity.userId, async (db) => {
          const { rows } = await db.query<{ id: string }>(
            "insert into call_recordings (session_id, started_by) values ($1, $2) returning id",
            [callSessionId, identity.userId],
          );
          return rows[0]!.id;
        });
      } catch (error) {
        app.log.error({ error }, "no se pudo abrir la grabación");
        send(socket, { type: "error", message: "no se pudo iniciar la grabación" });
        return;
      }

      const others = voiceHub.members(channelId).filter((m) => m.peerId !== peerId);
      const recording: RoomRecording = {
        id: recordingId,
        requesterPeerId: peerId,
        requesterUserId: identity.userId,
        requesterName: identity.displayName,
        pending: new Set(others.map((m) => m.peerId)),
        state: "pending",
      };
      recordings.set(channelId, recording);

      // Quien pide grabar consiente por el hecho de pedirlo.
      await saveConsent(identity.userId, recordingId, me, true).catch(() => {});

      if (recording.pending.size === 0) {
        recording.state = "recording";
        voiceHub.broadcast(channelId, {
          type: "recording-started",
          recordingId,
          startedBy: identity.displayName,
        });
        return;
      }

      for (const other of others) {
        send(other.socket, {
          type: "recording-request",
          recordingId,
          displayName: identity.displayName,
        });
      }
    };

    const answerRecording = async (recordingId: string, granted: boolean): Promise<void> => {
      const recording = recordings.get(channelId);
      if (!recording || recording.id !== recordingId) return;
      if (!recording.pending.has(peerId)) return;

      await saveConsent(identity.userId, recordingId, me, granted).catch(() => {});

      if (!granted) {
        // Un solo «no» cancela para todos. No existe la grabación parcial: en
        // una malla, quien graba recibe el audio de todos los demás, así que
        // «grabo solo a los que dijeron que sí» no se puede cumplir.
        recordings.delete(channelId);
        await closeRecording(recording.requesterUserId, recordingId).catch(() => {});
        voiceHub.broadcast(channelId, {
          type: "recording-denied",
          recordingId,
          by: identity.displayName,
        });
        return;
      }

      recording.pending.delete(peerId);
      if (recording.pending.size === 0 && recording.state === "pending") {
        recording.state = "recording";
        voiceHub.broadcast(channelId, {
          type: "recording-started",
          recordingId,
          startedBy: recording.requesterName,
        });
      }
    };

    const stopRecording = async (reason: string): Promise<void> => {
      const recording = recordings.get(channelId);
      // Solo la detiene quien la empezó: es su navegador el que tiene el
      // archivo a medias.
      if (!recording || recording.requesterPeerId !== peerId) return;

      recordings.delete(channelId);
      await closeRecording(recording.requesterUserId, recording.id).catch(() => {});
      voiceHub.broadcast(channelId, {
        type: "recording-stopped",
        recordingId: recording.id,
        reason,
      });
    };

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
          if (message.camera !== undefined) me.camera = message.camera;
          if (message.sharing !== undefined) me.sharing = message.sharing;
          voiceHub.broadcast(
            channelId,
            {
              type: "peer-state",
              peerId,
              muted: me.muted,
              camera: me.camera,
              sharing: me.sharing,
            },
            peerId,
          );
          break;
        }

        case "recording-request": {
          void requestRecording();
          break;
        }

        case "recording-consent": {
          void answerRecording(message.recordingId, message.granted);
          break;
        }

        case "recording-stop": {
          void stopRecording("la detuvo quien la había empezado");
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

      const recording = recordings.get(channelId);
      if (recording?.requesterPeerId === peerId) {
        // Se fue quien grababa. El archivo se queda en su navegador a medias y
        // aquí no hay nada que salvar, pero el resto tiene que dejar de ver el
        // indicador rojo inmediatamente.
        recordings.delete(channelId);
        void closeRecording(recording.requesterUserId, recording.id).catch(() => {});
        voiceHub.broadcast(channelId, {
          type: "recording-stopped",
          recordingId: recording.id,
          reason: "quien grababa salió de la llamada",
        });
      } else if (recording && recording.pending.delete(peerId)) {
        // Se fue antes de contestar. Irse no es consentir, pero tampoco
        // bloquea: ya no está en la sala, así que no se le va a grabar.
        if (recording.pending.size === 0 && recording.state === "pending") {
          recording.state = "recording";
          voiceHub.broadcast(channelId, {
            type: "recording-started",
            recordingId: recording.id,
            startedBy: recording.requesterName,
          });
        }
      }

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
      camera: false,
      sharing: false,
      alive: true,
    });

    send(socket, { type: "welcome" });
    socket.on("close", () => fileHub.leave(workspaceId, peerId));
  });

  /**
   * Conversación de un canal.
   *
   * Sala aparte de la de voz porque son cosas distintas: se puede estar
   * leyendo un canal sin estar en su llamada, y al revés. La autorización es
   * la misma `can_access_channel`, así que un canal privado no reparte nada a
   * quien no está dentro.
   */
  app.get("/ws/channel", { websocket: true }, async (socket, request) => {
    const params = z.object({ channelId: z.string().uuid() }).safeParse(request.query);
    if (!params.success) {
      socket.close(1008, "canal invalido");
      return;
    }

    const channelId = params.data.channelId;
    const identity = await authorize(request, { channelId });
    if (!identity) {
      socket.close(1008, "sin acceso");
      return;
    }

    const peerId = randomUUID();
    channelHub.join(channelId, {
      peerId,
      userId: identity.userId,
      displayName: identity.displayName,
      socket,
      muted: false,
      camera: false,
      sharing: false,
      alive: true,
    });

    send(socket, { type: "welcome" });
    socket.on("close", () => channelHub.leave(channelId, peerId));
  });
}

/** Reparte un mensaje nuevo, editado o borrado a quien tenga el canal abierto. */
export function announceMessage(
  channelId: string,
  action: "created" | "updated" | "deleted",
  message: Record<string, unknown>,
): void {
  channelHub.broadcast(channelId, { type: "message", action, message });
}

/** Avisa al workspace de que su biblioteca ha cambiado. */
export function announceFileChange(
  workspaceId: string,
  action: "created" | "updated" | "deleted",
  fileId: string,
): void {
  fileHub.broadcast(workspaceId, { type: "file-change", action, fileId });
}
