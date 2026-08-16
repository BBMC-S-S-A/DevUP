/**
 * La oficina: presencia y movimiento de la vista inmersiva.
 *
 * Una sala por workspace. Ver docs/decisiones/0002-vistas-profesional-e-inmersiva.md.
 *
 * DOS DECISIONES QUE EXPLICAN LA FORMA DE TODO ESTE ARCHIVO
 *
 * 1. Se reparte por tick, no por mensaje. Reenviar cada movimiento en cuanto
 *    llega es N² mensajes: con veinte personas moviéndose a 10 Hz son unos
 *    4.000 mensajes por segundo. Acumulando lo que cambió y mandando un solo
 *    mensaje por tick con todos los que se movieron, son 10. La diferencia no
 *    es de eficiencia sino de si esto se sostiene en pie con un equipo dentro.
 *
 * 2. La posición es del cliente; la zona, no. Hacer trampas caminando no le
 *    quita nada a nadie, así que el servidor acepta las coordenadas sin
 *    discutirlas —solo las acota al tamaño de la planta para que nadie se
 *    salga del lienzo—. Entrar en una zona es otra cosa: una zona proyecta un
 *    canal, y anunciar que alguien entró en la zona de un canal privado a
 *    quien no pertenece a ese canal es contarle que existe. Por eso el
 *    conjunto de zonas permitidas se resuelve contra la base al conectar, y
 *    el reparto de zonas se filtra con él.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyAccessToken } from "../auth/tokens.js";
import { withUser } from "../db/pool.js";
import { type WorldMember, send, worldHub } from "./hub.js";

const HEARTBEAT_MS = 30_000;
/** 10 Hz. Suficiente para que se vea fluido con interpolación en el cliente. */
const TICK_MS = 100;
/**
 * Nadie necesita mandar posición más de veinte veces por segundo. Lo que pase
 * de ahí se ignora en vez de cerrar el socket: un navegador que se atasca y
 * suelta una ráfaga al recuperarse es normal, y echarlo sería peor.
 */
const MIN_MOVE_GAP_MS = 45;

const inbound = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("move"),
    x: z.number().finite(),
    y: z.number().finite(),
    facing: z.enum(["n", "s", "e", "o"]),
    moving: z.boolean(),
  }),
  z.object({ type: z.literal("zone"), zoneId: z.string().uuid().nullable() }),
  z.object({ type: z.literal("pong") }),
]);

const publicMember = (m: WorldMember) => ({
  peerId: m.peerId,
  userId: m.userId,
  displayName: m.displayName,
  x: m.x,
  y: m.y,
  facing: m.facing,
  moving: m.moving,
});

/**
 * Qué puede ver quien se conecta.
 *
 * Se pregunta a la base y no a la memoria porque la pertenencia puede haber
 * cambiado desde que se emitió el ticket. Las zonas salen ya filtradas por
 * RLS: la política de `world_zones` cuelga de `can_access_channel`, así que
 * esta consulta no lleva ni un `where` de seguridad y aun así devuelve solo
 * lo que esta persona puede ver.
 */
async function authorize(
  request: FastifyRequest,
  workspaceId: string,
): Promise<{ userId: string; displayName: string; allowedZones: Set<string>; spawn: { x: number; y: number } } | null> {
  const { ticket } = request.query as { ticket?: string };
  if (!ticket) return null;

  const userId = await verifyAccessToken(ticket);
  if (!userId) return null;

  return withUser(userId, async (db) => {
    const { rows: ok } = await db.query<{ ok: boolean }>(
      "select public.can_access_workspace($1) as ok",
      [workspaceId],
    );
    if (!ok[0]?.ok) return null;

    // La organización puede tener la oficina apagada. Se comprueba también
    // aquí y no solo en la ruta HTTP: un cliente que se salte el mapa y abra
    // el socket directamente entraría igual.
    const { rows: enabled } = await db.query<{ ok: boolean }>(
      "select public.world_enabled_for_workspace($1) as ok",
      [workspaceId],
    );
    if (!enabled[0]?.ok) return null;

    // Prepara la planta de paso: un canal creado hace diez segundos ya tiene
    // su zona cuando alguien entra, sin ningún proceso de fondo vigilando.
    const { rows: room } = await db.query<{ ensure_world_room: string }>(
      "select public.ensure_world_room($1)",
      [workspaceId],
    );
    const roomId = room[0]!.ensure_world_room;

    // Se piden ordenadas: la primera es la que se usa para decidir dónde
    // aparece la gente.
    const { rows: zones } = await db.query<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>("select id, x, y, width, height from world_zones where room_id = $1 order by y, x", [
      roomId,
    ]);

    const { rows: size } = await db.query<{ width: number; height: number }>(
      "select width, height from world_rooms where id = $1",
      [roomId],
    );

    const { rows: profile } = await db.query<{ display_name: string }>(
      "select display_name from profiles where id = $1",
      [userId],
    );

    const first = zones[0];

    return {
      userId,
      displayName: profile[0]?.display_name ?? "alguien",
      allowedZones: new Set(zones.map((z) => z.id)),
      // Se aparece justo delante de la puerta de la primera sala que se puede
      // ver, en el pasillo. Aparecer en el centro geométrico de la planta
      // —lo que se hacía antes— dejaba a la gente en mitad de un descampado,
      // sin ninguna sala a la vista y sin saber hacia dónde ir; con una
      // oficina de pocos canales, la mitad del mapa está vacía.
      //
      // El pasillo, nunca dentro: la primera sala visible podría no ser la
      // primera de la planta, y meter a alguien dentro de una sala nada más
      // entrar decide por él a qué canal se une.
      spawn: first
        ? {
            x: first.x + Math.floor(first.width / 2) + 0.5,
            y: first.y + first.height + 0.6,
          }
        : {
            x: (size[0]?.width ?? 32) / 2,
            y: (size[0]?.height ?? 24) - 3,
          },
    };
  });
}

/**
 * Relojes de reparto, uno por sala con gente dentro.
 *
 * Se arranca al entrar el primero y se para al salir el último: un intervalo
 * por workspace corriendo para siempre es exactamente el tipo de fuga que no
 * da la cara hasta que hay cien workspaces.
 */
const ticks = new Map<string, NodeJS.Timeout>();

function startTicking(workspaceId: string): void {
  if (ticks.has(workspaceId)) return;

  const timer = setInterval(() => {
    const members = worldHub.members(workspaceId);
    if (members.length === 0) {
      stopTicking(workspaceId);
      return;
    }

    const moves = members.filter((m) => m.dirty).map(publicMember);
    if (moves.length === 0) return;

    for (const m of members) m.dirty = false;
    // Un solo mensaje con todos los que se movieron. Es la diferencia entre
    // N² y N mensajes por tick.
    worldHub.broadcast(workspaceId, { type: "tick", moves });
  }, TICK_MS);

  // El reloj no debe mantener vivo el proceso: si la API se está apagando,
  // que no sea esto lo que la retiene.
  timer.unref?.();
  ticks.set(workspaceId, timer);
}

function stopTicking(workspaceId: string): void {
  const timer = ticks.get(workspaceId);
  if (!timer) return;
  clearInterval(timer);
  ticks.delete(workspaceId);
}

export async function worldSocketRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ws/world", { websocket: true }, async (socket, request) => {
    const params = z.object({ workspaceId: z.string().uuid() }).safeParse(request.query);
    if (!params.success) {
      send(socket, { type: "error", message: "falta workspaceId" });
      socket.close(1008, "workspace invalido");
      return;
    }

    const workspaceId = params.data.workspaceId;
    const identity = await authorize(request, workspaceId);
    if (!identity) {
      send(socket, { type: "error", message: "sin acceso al workspace" });
      socket.close(1008, "sin acceso");
      return;
    }

    // Igual que en la sala de voz: el identificador de par lo asigna el
    // servidor. Nadie suplanta a nadie, y la misma persona en dos pestañas
    // son dos avatares en vez de uno peleándose consigo mismo.
    const peerId = randomUUID();
    const me: WorldMember = {
      peerId,
      userId: identity.userId,
      displayName: identity.displayName,
      socket,
      x: identity.spawn.x,
      y: identity.spawn.y,
      facing: "s",
      moving: false,
      zoneId: null,
      allowedZones: identity.allowedZones,
      lastMoveAt: 0,
      dirty: false,
      alive: true,
    };

    const existing = worldHub.members(workspaceId);
    worldHub.join(workspaceId, me);
    startTicking(workspaceId);

    send(socket, {
      type: "welcome",
      peerId,
      you: publicMember(me),
      // Cada quien recibe la zona de los demás solo si puede verla. Sin este
      // filtro, entrar a la oficina revelaría quién está en la sala de
      // dirección aunque la sala en sí no se dibuje.
      peers: existing.map((m) => ({
        ...publicMember(m),
        zoneId: m.zoneId && me.allowedZones.has(m.zoneId) ? m.zoneId : null,
      })),
    });

    worldHub.broadcast(workspaceId, { type: "peer-joined", peer: publicMember(me) }, peerId);

    const heartbeat = setInterval(() => {
      if (!me.alive) {
        // Ni pong ni cierre: el otro extremo está muerto pero el socket sigue
        // abierto. Sin esto, un portátil que se duerme deja un avatar de pie
        // en la oficina hasta que caduque el TCP.
        socket.terminate();
        return;
      }
      me.alive = false;
      send(socket, { type: "ping" });
    }, HEARTBEAT_MS);

    socket.on("message", (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const message = inbound.safeParse(parsed);
      if (!message.success) return;

      switch (message.data.type) {
        case "pong":
          me.alive = true;
          return;

        case "move": {
          const now = Date.now();
          if (now - me.lastMoveAt < MIN_MOVE_GAP_MS) return;
          me.lastMoveAt = now;

          // Se acotan las coordenadas, no se validan contra el mobiliario. Que
          // alguien atraviese una mesa no le da ninguna ventaja; que se salga
          // del lienzo sí rompe el dibujo de todos los demás.
          me.x = clamp(message.data.x, 0, 200);
          me.y = clamp(message.data.y, 0, 200);
          me.facing = message.data.facing;
          me.moving = message.data.moving;
          me.dirty = true;
          return;
        }

        case "zone": {
          const zoneId = message.data.zoneId;
          // AQUÍ ESTÁ LA FRONTERA. Un cliente puede mandar el identificador de
          // cualquier zona; solo se acepta si estaba en el conjunto que se
          // resolvió contra la base al conectar.
          if (zoneId !== null && !me.allowedZones.has(zoneId)) return;
          if (me.zoneId === zoneId) return;

          me.zoneId = zoneId;
          worldHub.broadcastWhere(
            workspaceId,
            { type: "peer-zone", peerId, zoneId },
            (other) => zoneId === null || other.allowedZones.has(zoneId),
            peerId,
          );
          return;
        }
      }
    });

    const leave = (): void => {
      clearInterval(heartbeat);
      worldHub.leave(workspaceId, peerId);
      worldHub.broadcast(workspaceId, { type: "peer-left", peerId });
      if (worldHub.members(workspaceId).length === 0) stopTicking(workspaceId);
    };

    socket.on("close", leave);
    socket.on("error", leave);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
