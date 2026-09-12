import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { parseParams, parseQuery, requireUser } from "../lib/http.js";
import { cierresPorPersona } from "../lib/actividad.js";

/**
 * Leer el registro de actividad: qué ha pasado, y quién lo hizo.
 *
 * QUÉ RESUELVE. Hasta ahora una tarea guardaba su estado actual y nada más, así
 * que se podía decir «Ana tiene cuatro en Hecho» pero no «Ana cerró cuatro esta
 * semana». La tabla la crea `0038_registro_de_actividad.sql`; esto es lo que
 * deja mirarla.
 *
 * TRES PREGUNTAS Y NO UNA API GENÉRICA. Se puede pedir la historia de un
 * espacio, la de una persona o la de una cosa concreta, porque son las tres
 * preguntas que se hacen: «¿qué ha pasado aquí?», «¿en qué anda fulano?» y
 * «¿qué le ha pasado a esta tarea?». Un solo punto con quince filtros sería
 * más flexible y menos útil: nadie sabría cuál de las quince combinaciones
 * está pensada para su pantalla.
 *
 * EL AISLAMIENTO NO LO PONE ESTA RUTA. Todo va por `withUser`, así que RLS
 * decide qué renglones entran: la historia de un espacio personal no la ve
 * nadie más, ni quien administra. Es la misma frontera que el resto del
 * producto y no una comprobación aparte que pueda divergir.
 *
 * NO HAY PUNTO PARA ESCRIBIR, y es deliberado. Un renglón se escribe desde
 * dentro, en la misma transacción que hizo el cambio que cuenta (ver
 * `lib/actividad.ts`). Abrir un `POST` dejaría escribir historia sin que
 * hubiera pasado nada, que es exactamente lo que este registro existe para
 * impedir.
 */

const uuid = z.string().uuid();

/** Cuántos renglones caben en una página. */
const POR_PAGINA = 50;

/** La ventana por defecto al mirar una persona: lo que dura un sprint. */
const DIAS_POR_DEFECTO = 14;

const COLUMNAS = `
  a.id,
  a.verb        as "verbo",
  a.subject_type as "sujeto",
  a.subject_id   as "sujetoId",
  a.subject_label as "sujetoNombre",
  a.detail       as "detalle",
  a.source       as "procedencia",
  a.at           as "cuando",
  a.actor_id     as "actorId",
  p.display_name as "actorNombre",
  p.avatar_url   as "actorAvatar"`;

export async function actividadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  /**
   * Lo último que ha pasado en un espacio.
   *
   * Se pagina por `antes` —la marca del último renglón visto— y no por número
   * de página: la tabla solo crece por arriba, así que «página 2» significaría
   * una cosa distinta cada vez que alguien escribe algo mientras se lee.
   */
  app.get("/workspaces/:workspaceId/actividad", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const { antes, desde, limite } = parseQuery(
      z.object({
        antes: z.string().datetime().optional(),
        /**
         * Desde cuándo mirar. Es lo que contesta «¿qué ha pasado desde ayer?»,
         * que es la pregunta con la que alguien vuelve al trabajo — y la que
         * usa `que_ha_pasado` desde el MCP.
         */
        desde: z.string().datetime().optional(),
        limite: z.coerce.number().int().min(1).max(POR_PAGINA).default(POR_PAGINA),
      }),
      request.query,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS}
           from activity a
           left join profiles p on p.id = a.actor_id
          where a.workspace_id = $1
            and ($2::timestamptz is null or a.at < $2::timestamptz)
            and ($3::timestamptz is null or a.at >= $3::timestamptz)
          order by a.at desc
          limit $4`,
        [workspaceId, antes ?? null, desde ?? null, limite],
      );
      // `hayMas` sale de haber llenado la página, no de contar el total: contar
      // una tabla que solo crece es caro y a nadie le sirve el número.
      return { actividad: rows, hayMas: rows.length === limite };
    });
  });

  /**
   * Qué ha hecho una persona, en todos los espacios de la organización a los
   * que quien mira también llega.
   *
   * Ese matiz es lo que hace honesta la respuesta: si fulano trabaja en un
   * proyecto que yo no veo, su trabajo de ahí no aparece. Enseñarlo sería
   * filtrar por la puerta de atrás lo que el aislamiento cierra por delante.
   */
  app.get("/organizations/:orgId/actividad/:personaId", async (request) => {
    const userId = requireUser(request);
    const { orgId, personaId } = parseParams(
      z.object({ orgId: uuid, personaId: uuid }),
      request.params,
    );
    const { dias } = parseQuery(
      z.object({ dias: z.coerce.number().int().min(1).max(365).default(DIAS_POR_DEFECTO) }),
      request.query,
    );

    return withUser(userId, async (db) => {
      const [renglones, resumen] = await Promise.all([
        db.query(
          `select ${COLUMNAS}
             from activity a
             left join profiles p on p.id = a.actor_id
            where a.organization_id = $1
              and a.actor_id = $2
              and a.at > now() - ($3 || ' days')::interval
            order by a.at desc
            limit $4`,
          [orgId, personaId, dias, POR_PAGINA],
        ),
        // El recuento por verbo es lo que contesta «cerró cuatro esta semana»
        // sin que nadie tenga que contar renglones a ojo.
        db.query(
          `select a.verb as "verbo", count(*)::int as "cuantas"
             from activity a
            where a.organization_id = $1
              and a.actor_id = $2
              and a.at > now() - ($3 || ' days')::interval
            group by a.verb
            order by 2 desc`,
          [orgId, personaId, dias],
        ),
      ]);

      return { dias, actividad: renglones.rows, porVerbo: resumen.rows };
    });
  });

  /** Qué le ha pasado a una cosa concreta: el historial de una tarea. */
  app.get("/actividad/de/:sujetoId", async (request) => {
    const userId = requireUser(request);
    const { sujetoId } = parseParams(z.object({ sujetoId: uuid }), request.params);

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS}
           from activity a
           left join profiles p on p.id = a.actor_id
          where a.subject_id = $1
          order by a.at desc
          limit $2`,
        [sujetoId, POR_PAGINA],
      );
      return { actividad: rows };
    });
  });

  /**
   * La línea de tiempo de una ORGANIZACIÓN entera, con filtros.
   *
   * LLEGÓ DEL CAMINO B Y NO SOBRA, aunque arriba ya haya una de espacio. Son
   * preguntas distintas: la de arriba es «qué ha pasado en este proyecto» y
   * esta es «qué ha pasado en la empresa», cruzando todos los espacios a los
   * que quien mira llega. Es la que usa el MCP para contestar «¿qué me he
   * perdido?» sin tener que recorrer los espacios uno a uno.
   *
   * EL FILTRO POR VERBO ACEPTABA FAMILIAS —`verbo like 'tarea.%'`— porque allí
   * los verbos llevaban espacio de nombres. Aquí no lo llevan: son palabras
   * sueltas (`movio`, `cerro`), y la familia es `subject_type`. Así que el
   * filtro de familia pasa a ser por sujeto, que es lo que de verdad se estaba
   * preguntando: «todo lo del tablero».
   */
  app.get("/organizations/:organizationId/activity", async (request) => {
    const userId = requireUser(request);
    const { organizationId } = parseParams(z.object({ organizationId: uuid }), request.params);
    const q = parseQuery(
      z.object({
        workspaceId: uuid.optional(),
        actorId: uuid.optional(),
        verbo: z.string().max(40).optional(),
        sujeto: z.string().max(40).optional(),
        origen: z.enum(["persona", "regla", "agente"]).optional(),
        dias: z.coerce.number().int().min(1).max(365).optional(),
        limite: z.coerce.number().int().min(1).max(200).optional(),
      }),
      request.query,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS}
           from activity a
           left join profiles p on p.id = a.actor_id
          where a.organization_id = $1
            and a.at > now() - ($2::int || ' days')::interval
            and ($3::uuid is null or a.workspace_id = $3)
            and ($4::uuid is null or a.actor_id = $4)
            and ($5::text is null or a.verb = $5)
            and ($6::text is null or a.subject_type = $6)
            and ($7::text is null or a.source::text = $7)
          order by a.at desc
          limit $8`,
        [
          organizationId,
          q.dias ?? DIAS_POR_DEFECTO,
          q.workspaceId ?? null,
          q.actorId ?? null,
          q.verbo ?? null,
          q.sujeto ?? null,
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
   * También del camino B, y es la única de las suyas que no tenía equivalente
   * aquí: la de arriba cuenta los verbos de UNA persona, y esta compara a todas
   * las de la organización. Es la auditoría del tablero.
   *
   * SE CUENTA POR VERBO Y NO EN UN TOTAL. Un número único obligaría a decidir
   * ya cuánto vale cerrar una tarea frente a crearla, que es justo la decisión
   * que no está tomada. El desglose deja que la pantalla enseñe lo que hay
   * —cuatro cerradas, dos creadas— sin inventarse una equivalencia.
   *
   * LA PROCEDENCIA VIAJA EN EL DESGLOSE porque sin ella una persona que le pide
   * diez tareas a su asistente aparecería trabajando el doble que quien las
   * escribió a mano. Las dos cosas cuentan, pero no son la misma y no deben
   * sumarse solas.
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
                a.verb as "verbo",
                a.source as "origen",
                count(*)::int as veces,
                max(a.at) as "ultimaVez"
           from activity a
           left join profiles p on p.id = a.actor_id
          where a.organization_id = $1
            and a.at > now() - ($2::int || ' days')::interval
            and ($3::uuid is null or a.workspace_id = $3)
            and a.actor_id is not null
          group by a.actor_id, p.display_name, a.verb, a.source
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
}
