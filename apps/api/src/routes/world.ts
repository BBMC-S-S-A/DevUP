import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { parseBody, parseParams, requireUser } from "../lib/http.js";

const uuid = z.string().uuid();
/** Los índices de catálogo y de paleta van acotados igual que en el esquema. */
const piece = z.number().int().min(0).max(63);
const tone = z.number().int().min(0).max(15);

/**
 * La planta de la oficina y el avatar de cada quien.
 *
 * Ver docs/decisiones/0002-vistas-profesional-e-inmersiva.md.
 *
 * Ninguna consulta lleva un `where` de seguridad: la política de
 * `world_zones` cuelga de `can_access_channel`, así que el mapa sale ya
 * filtrado zona por zona. Eso es deliberado y es la diferencia entre enviar
 * la planta entera y esconder trozos en el cliente —que revelaría los nombres
 * de los canales privados— y no enviarlos nunca.
 */
export async function worldRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/workspaces/:workspaceId/world", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);

    return withUser(userId, async (db) => {
      // Prepara la planta y coloca los canales que aún no tengan zona. Es
      // idempotente y barato, y evita cualquier proceso de fondo vigilando la
      // creación de canales.
      const { rows: room } = await db.query<{ ensure_world_room: string }>(
        "select public.ensure_world_room($1)",
        [workspaceId],
      );
      const roomId = room[0]!.ensure_world_room;

      const { rows: rooms } = await db.query<{
        id: string;
        width: number;
        height: number;
      }>("select id, width, height from world_rooms where id = $1", [roomId]);

      const { rows: zones } = await db.query(
        `select z.id,
                z.channel_id as "channelId",
                z.x, z.y, z.width, z.height, z.palette,
                c.name       as "channelName",
                c.kind       as "channelKind",
                c.is_private as "channelPrivate"
           from world_zones z
           join channels c on c.id = z.channel_id
          where z.room_id = $1
          order by z.y, z.x`,
        [roomId],
      );

      return { room: rooms[0] ?? null, zones };
    });
  });

  /**
   * Los avatares de la organización, para poder dibujar a quien esté dentro.
   *
   * Se piden todos de una vez y no uno por avatar que aparece: en una oficina
   * con quince personas, quince peticiones al entrar es lo que convierte una
   * pantalla instantánea en una que tarda dos segundos.
   */
  app.get("/world/avatars", async (request) => {
    const userId = requireUser(request);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select user_id as "userId", body, hair, top, bottom,
                skin_tone as "skinTone", hair_tone as "hairTone",
                top_tone  as "topTone",  bottom_tone as "bottomTone"
           from world_avatars`,
      );
      return { avatars: rows };
    });
  });

  app.put("/world/avatar", async (request) => {
    const userId = requireUser(request);
    const body = parseBody(
      z.object({
        body: piece,
        hair: piece,
        top: piece,
        bottom: piece,
        skinTone: tone,
        hairTone: tone,
        topTone: tone,
        bottomTone: tone,
      }),
      request.body,
    );

    await withUser(userId, (db) =>
      db.query("select public.upsert_world_avatar($1,$2,$3,$4,$5,$6,$7,$8)", [
        body.body,
        body.hair,
        body.top,
        body.bottom,
        body.skinTone,
        body.hairTone,
        body.topTone,
        body.bottomTone,
      ]),
    );

    return { avatar: { userId, ...body } };
  });
}
