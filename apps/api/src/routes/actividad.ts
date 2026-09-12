import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { parseParams, parseQuery, requireUser } from "../lib/http.js";
import { cierresPorPersona } from "../lib/actividad.js";

/**
 * La lectura del registro de actividad.
 *
 * QUÉ CONTESTA QUE ANTES NO SE PODÍA. `auditoria.ts` avisa en su cabecera de
 * que no puede reconstruir «qué pasó esta semana» como una historia, porque una
 * tarea guarda su estado y no su recorrido. Con la 0038 sí se puede, y estas
 * tres lecturas son las tres preguntas que la pedían:
 *
 *   · **Qué ha pasado aquí** — la línea de tiempo de un espacio o de la
 *     organización. Es también lo que el MCP necesita para contestar «¿qué me
 *     he perdido?».
 *   · **Qué ha hecho cada uno** — el recuento por persona y verbo, que es la
 *     auditoría del tablero.
 *   · **Qué le ha pasado a esto** — la historia de una tarjeta al abrirla.
 *
 * EL AISLAMIENTO NO LO PONE ESTA RUTA, y conviene decirlo porque aquí sería
 * fácil creer que sí. Todas las consultas van por `withUser`, así que la
 * política de la 0038 decide qué filas entran: la actividad de un espacio al
 * que quien mira no tiene acceso no aparece, ni en la línea de tiempo ni en los
 * recuentos. Un recuento que sumara filas invisibles sería peor que un fallo
 * visible — enseñaría que alguien hizo cosas en un sitio que se supone que no
 * existe para quien mira.
 *
 * LO QUE ESTA RUTA NO HACE, A PROPÓSITO: no calcula porcentajes de
 * participación. Devuelve hechos contados. Convertir eso en un «quién va
 * ganando» es una decisión de producto que está abierta en
 * `plan-agentes-y-participacion.md` §T3, y adelantarla aquí sería tomarla por
 * la puerta de atrás.
 */

const uuid = z.string().uuid();

/** Un mes. Suficiente para «qué ha pasado» sin traerse un año de historia a
 *  una pantalla que se lee de un vistazo. */
const DIAS_POR_DEFECTO = 30;

const COLUMNAS = `
  a.id, a.verbo, a.origen, a.resumen, a.datos,
  a.objeto_tipo as "objetoTipo", a.objeto_id as "objetoId",
  a.workspace_id as "workspaceId", a.actor_id as "actorId",
  a.ocurrido_en as "ocurridoEn",
  p.display_name as "actorNombre",
  w.name as "workspaceNombre"`;

const DESDE = `
  from activity a
  left join profiles p on p.id = a.actor_id
  left join workspaces w on w.id = a.workspace_id`;

export async function actividadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireSession);

  /**
   * La línea de tiempo de una organización, con filtros opcionales.
   *
   * `verbo` acepta tanto el verbo entero (`tarea.cerrada`) como la familia
   * (`tarea`), que es lo que permite preguntar «todo lo del tablero» sin tener
   * que enumerar los verbos que existan hoy — y sin que la lista se quede coja
   * el día que se añada uno.
   */
  app.get("/organizations/:organizationId/activity", async (request) => {
    const userId = requireUser(request);
    const { organizationId } = parseParams(z.object({ organizationId: uuid }), request.params);
    const q = parseQuery(
      z.object({
        workspaceId: uuid.optional(),
        actorId: uuid.optional(),
        verbo: z.string().max(40).optional(),
        origen: z.enum(["persona", "regla", "agente"]).optional(),
        dias: z.coerce.number().int().min(1).max(365).optional(),
        limite: z.coerce.number().int().min(1).max(200).optional(),
      }),
      request.query,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS} ${DESDE}
          where a.organization_id = $1
            and a.ocurrido_en > now() - ($2::int || ' days')::interval
            and ($3::uuid is null or a.workspace_id = $3)
            and ($4::uuid is null or a.actor_id = $4)
            and ($5::text is null or a.verbo = $5 or a.verbo like $5 || '.%')
            and ($6::text is null or a.origen::text = $6)
          order by a.ocurrido_en desc
          limit $7`,
        [
          organizationId,
          q.dias ?? DIAS_POR_DEFECTO,
          q.workspaceId ?? null,
          q.actorId ?? null,
          q.verbo ?? null,
          q.origen ?? null,
          q.limite ?? 100,
        ],
      );
      return { actividad: rows };
    });
  });

  /**
   * El recuento por persona: qué hizo cada uno y cuándo fue la última vez.
   *
   * SE CUENTA POR VERBO Y NO EN UN TOTAL. Un número único obligaría a decidir
   * ya cuánto vale cerrar una tarea frente a crearla, que es justo la decisión
   * que no está tomada. Devolver el desglose deja que la pantalla enseñe lo que
   * hay —cuatro cerradas, dos creadas— sin inventarse una equivalencia.
   *
   * EL ORIGEN VIAJA EN EL DESGLOSE porque sin él una persona que le pide diez
   * tareas a su asistente aparecería trabajando el doble que quien las escribió
   * a mano. Las dos cosas cuentan, pero no son la misma y no deben sumarse solas.
   */
  app.get("/organizations/:organizationId/activity/summary", async (request) => {
    const userId = requireUser(request);
    const { organizationId } = parseParams(z.object({ organizationId: uuid }), request.params);
    const q = parseQuery(
      z.object({
        workspaceId: uuid.optional(),
        dias: z.coerce.number().int().min(1).max(365).optional(),
      }),
      request.query,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select a.actor_id as "actorId",
                p.display_name as "actorNombre",
                a.verbo,
                a.origen,
                count(*)::int as veces,
                max(a.ocurrido_en) as "ultimaVez"
           from activity a
           left join profiles p on p.id = a.actor_id
          where a.organization_id = $1
            and a.ocurrido_en > now() - ($2::int || ' days')::interval
            and ($3::uuid is null or a.workspace_id = $3)
            and a.actor_id is not null
          group by a.actor_id, p.display_name, a.verbo, a.origen
          order by veces desc`,
        [organizationId, q.dias ?? DIAS_POR_DEFECTO, q.workspaceId ?? null],
      );

      // El cálculo vive en `lib/actividad.ts` para poder probarlo sin levantar
      // el servidor: es la única consulta del registro que calcula algo en vez
      // de contarlo, y por tanto la única que puede estar mal sin fallar.
      const cierres = await cierresPorPersona(db, {
        organizationId,
        dias: q.dias ?? DIAS_POR_DEFECTO,
        workspaceId: q.workspaceId ?? null,
      });

      return { resumen: rows, cierres };
    });
  });

  /**
   * La historia de una cosa concreta: qué le ha pasado a esta tarjeta.
   *
   * Sin ventana de días a propósito. La historia de una tarea es corta por
   * naturaleza —se crea, se mueve tres veces y se cierra— y cortarla por fecha
   * escondería justo el principio, que es la parte que explica de dónde salió.
   */
  app.get("/activity/:objetoTipo/:objetoId", async (request) => {
    const userId = requireUser(request);
    const { objetoTipo, objetoId } = parseParams(
      z.object({ objetoTipo: z.string().max(40), objetoId: uuid }),
      request.params,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS} ${DESDE}
          where a.objeto_tipo = $1 and a.objeto_id = $2
          order by a.ocurrido_en asc
          limit 200`,
        [objetoTipo, objetoId],
      );
      return { actividad: rows };
    });
  });
}
