import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { parseParams, parseQuery, requireUser } from "../lib/http.js";

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
    const { antes, limite } = parseQuery(
      z.object({
        antes: z.string().datetime().optional(),
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
          order by a.at desc
          limit $3`,
        [workspaceId, antes ?? null, limite],
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
}
