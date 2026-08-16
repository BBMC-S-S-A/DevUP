import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { HttpError, parseBody, parseParams, requireUser } from "../lib/http.js";

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
      // Una organización puede tener la oficina apagada. Se comprueba antes de
      // preparar nada: si está apagada, ni siquiera se crea la planta.
      const { rows: enabled } = await db.query<{ ok: boolean }>(
        "select public.world_enabled_for_workspace($1) as ok",
        [workspaceId],
      );
      if (!enabled[0]?.ok) {
        throw new HttpError(403, "la vista inmersiva está desactivada en esta organización", "world_disabled");
      }

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

      const { rows: zones } = await db.query<{ id: string }>(
        `select z.id,
                z.channel_id as "channelId",
                z.x, z.y, z.width, z.height, z.palette,
                z.customized, z.material,
                c.name       as "channelName",
                c.kind       as "channelKind",
                c.is_private as "channelPrivate"
           from world_zones z
           join channels c on c.id = z.channel_id
          where z.room_id = $1
          order by z.y, z.x`,
        [roomId],
      );

      // Los muebles de todas las salas de una vez. Una consulta por sala
      // serían veinte consultas al abrir una oficina de veinte canales, y RLS
      // ya filtra: solo llegan los de las salas que esta persona puede ver.
      const { rows: props } = await db.query<{
        zoneId: string;
        id: string;
        kind: string;
        x: number;
        y: number;
        facing: string;
        tone: number;
      }>(
        `select p.id, p.zone_id as "zoneId", p.kind, p.x, p.y, p.facing, p.tone
           from world_props p
           join world_zones z on z.id = p.zone_id
          where z.room_id = $1
          order by p.y, p.x`,
        [roomId],
      );

      const byZone = new Map<string, unknown[]>();
      for (const piece of props) {
        const list = byZone.get(piece.zoneId) ?? [];
        list.push(piece);
        byZone.set(piece.zoneId, list);
      }

      return {
        room: rooms[0] ?? null,
        zones: zones.map((zone) => ({ ...zone, props: byZone.get(zone.id) ?? [] })),
      };
    });
  });

  /**
   * Guardar el mobiliario de una sala.
   *
   * Llega la sala entera, no un mueble: arrastrar un sofá por la pantalla son
   * decenas de posiciones intermedias y ninguna interesa. El límite de 120
   * piezas no es arbitrario — una sala de 11×9 tiene 63 casillas de suelo, así
   * que 120 ya deja sitio para apilar y sigue acotando lo que un cliente
   * hablando el protocolo a mano puede meter de una vez.
   */
  app.put("/world/zones/:zoneId/props", async (request) => {
    const userId = requireUser(request);
    const { zoneId } = parseParams(z.object({ zoneId: uuid }), request.params);
    const body = parseBody(
      z.object({
        props: z
          .array(
            z.object({
              kind: z.string().min(1).max(40),
              x: z.number().int().min(0).max(40),
              y: z.number().int().min(0).max(40),
              facing: z.enum(["n", "s", "e", "o"]).default("s"),
              tone: z.number().int().min(0).max(63).default(0),
            }),
          )
          .max(120),
      }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ save_world_props: number }>(
        "select public.save_world_props($1, $2::jsonb)",
        [zoneId, JSON.stringify(body.props)],
      );
      return { saved: rows[0]!.save_world_props };
    });
  });

  /**
   * Lo que los muebles tienen que mostrar.
   *
   * Ver docs/plan-mundo-y-plataforma.md §6: un mueble no decora, proyecta algo
   * que ya es cierto. La pizarra muestra el tablero, la estantería cuenta los
   * archivos del canal, el monitor se enciende si hay actividad reciente.
   *
   * Va aparte del mapa y no dentro, y se pide cada medio minuto. El mapa
   * cambia cuando alguien amuebla —casi nunca— y esto cambia con cada tarea
   * que se mueve. Meterlo en la misma respuesta obligaría a rehacer la escena
   * entera cada treinta segundos, que es reconstruir muros y colisiones para
   * cambiar un número.
   *
   * Sin un solo `where` de seguridad: RLS ya filtra los canales, así que las
   * cuentas solo incluyen lo que esta persona puede ver.
   */
  app.get("/workspaces/:workspaceId/world/live", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);

    return withUser(userId, async (db) => {
      // El tablero es del workspace, no del canal: cualquier pizarra de la
      // oficina muestra el mismo estado del sprint. Es correcto y además es lo
      // útil — se entra a una sala cualquiera y se ve cómo va la semana.
      const { rows: board } = await db.query<{ name: string; count: string }>(
        `select c.name, count(t.id)::text as count
           from task_columns c
           left join tasks t on t.column_id = c.id
          where c.workspace_id = $1
          group by c.id, c.name, c.position
          order by c.position`,
        [workspaceId],
      );

      const { rows: channels } = await db.query<{
        channelId: string;
        files: string;
        lastMessageAt: Date | null;
      }>(
        `select ch.id as "channelId",
                (select count(*) from files f
                  where f.channel_id = ch.id and f.status = 'ready')::text as files,
                (select max(m.created_at) from messages m
                  where m.channel_id = ch.id and m.deleted_at is null) as "lastMessageAt"
           from channels ch
          where ch.workspace_id = $1`,
        [workspaceId],
      );

      return {
        board: board.map((c) => ({ name: c.name, count: Number(c.count) })),
        channels: channels.map((c) => ({
          channelId: c.channelId,
          files: Number(c.files),
          lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        })),
      };
    });
  });

  /** Volver al amueblado deducido del nombre del canal. */
  app.post("/world/zones/:zoneId/reset", async (request) => {
    const userId = requireUser(request);
    const { zoneId } = parseParams(z.object({ zoneId: uuid }), request.params);
    await withUser(userId, (db) =>
      db.query("select public.reset_world_zone($1)", [zoneId]),
    );
    return { reset: true };
  });

  /** El material del suelo de una sala. Nulo devuelve al deducido por el tema. */
  app.patch("/world/zones/:zoneId", async (request) => {
    const userId = requireUser(request);
    const { zoneId } = parseParams(z.object({ zoneId: uuid }), request.params);
    const body = parseBody(
      z.object({ material: z.number().int().min(0).max(7).nullable() }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `update world_zones set material = $2 where id = $1
       returning id, material, customized`,
        [zoneId, body.material],
      );
      if (rows.length === 0) throw new HttpError(404, "zona no encontrada", "no_encontrado");
      return { zone: rows[0] };
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
                top_tone  as "topTone",  bottom_tone as "bottomTone",
                hat, glasses, beard, shoes,
                hat_tone as "hatTone", shoes_tone as "shoesTone"
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
        // Las capas nuevas son opcionales: un cliente que no las conozca sigue
        // guardando su avatar en vez de recibir un 400.
        hat: piece.default(0),
        glasses: piece.default(0),
        beard: piece.default(0),
        shoes: piece.default(0),
        hatTone: tone.default(0),
        shoesTone: tone.default(0),
      }),
      request.body,
    );

    await withUser(userId, (db) =>
      db.query("select public.upsert_world_avatar($1::jsonb)", [JSON.stringify(body)]),
    );

    return { avatar: { userId, ...body } };
  });
}
