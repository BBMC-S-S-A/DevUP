import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { badRequest, parseParams, parseQuery, requireUser } from "../lib/http.js";
import { cierresPorPersona, diarioPorSemanas } from "../lib/actividad.js";

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

/**
 * Lo mismo, más de dónde salió cada hecho.
 *
 * Solo lo usa la vista que cruza organizaciones: ahí «Ana movió la tarea Pagos»
 * sin decir en qué espacio es una frase que no sitúa a nadie. En las rutas de
 * un espacio concreto sobraría, porque el espacio ya lo puso quien preguntó.
 */
const COLUMNAS_CON_SITIO = `${COLUMNAS},
  a.workspace_id as "espacioId",
  w.name         as "espacio",
  o.name         as "organizacion"`;

export async function actividadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  /**
   * Qué ha pasado en TODO, cruzando organizaciones.
   *
   * LA PREGUNTA DEL LUNES, que es la que ninguna de las rutas de abajo sabía
   * contestar. Todas piden una organización o un espacio, y quien vuelve de una
   * semana fuera no quiere preguntar cinco veces: quiere saber qué se ha
   * perdido. Con dos organizaciones se podía recorrer a mano; con las de un
   * estudio que lleva varios clientes, no.
   *
   * ESTO NO ES UN AGUJERO EN EL AISLAMIENTO, y conviene ver por qué. No hay ni
   * un `where organization_id` aquí, igual que en el resto del producto: la
   * consulta va por `withUser`, así que las políticas de `activity` deciden qué
   * renglones existen para quien mira. Cruzar organizaciones no significa ver
   * más — significa no tener que nombrar cada una. Quien no pertenezca a
   * ninguna recibe una lista vacía, no un error.
   *
   * SE FILTRA POR NOMBRE DE PERSONA Y NO POR IDENTIFICADOR, al revés que las de
   * abajo. Es deliberado: el que pregunta esto suele ser el asistente, que tiene
   * «Carlos» y no un uuid, y obligarle a resolverlo antes serían dos viajes y
   * una lista de personas que nadie pidió. Si el texto encaja con dos, salen
   * las dos — cada renglón dice quién fue, así que la respuesta se explica sola.
   *
   * Y ESE FILTRO NO ENSEÑA A NADIE QUE NO SE VIERA YA: el nombre sale de
   * `profiles`, que también va bajo RLS, así que buscar por el nombre de alguien
   * de otra empresa no devuelve sus renglones — devuelve ninguno, que es lo
   * mismo que contesta un nombre inventado.
   */
  app.get("/me/actividad", async (request) => {
    const userId = requireUser(request);
    const q = parseQuery(
      z.object({
        /**
         * Un instante exacto. Es lo que manda el MCP, que ya sabe traducir
         * «desde el lunes» o «8h» a una fecha — y esa traducción tiene que
         * vivir en un solo sitio o las dos acabarán contestando cosas
         * distintas a la misma pregunta.
         */
        desde: z.string().datetime().optional(),
        /** La alternativa cómoda para una pantalla, que piensa en días. */
        dias: z.coerce.number().int().min(1).max(365).optional(),
        antes: z.string().datetime().optional(),
        quien: z.string().trim().min(1).max(80).optional(),
        verbo: z.string().max(40).optional(),
        sujeto: z.string().max(40).optional(),
        origen: z.enum(["persona", "regla", "agente"]).optional(),
        organizationId: uuid.optional(),
        workspaceId: uuid.optional(),
        limite: z.coerce.number().int().min(1).max(POR_PAGINA).default(POR_PAGINA),
      }),
      request.query,
    );

    // `desde` manda sobre `dias` cuando llegan los dos: es el más preciso, y
    // quien manda un instante exacto sabe mejor lo que quiere.
    const desde =
      q.desde ??
      (q.dias === undefined ? null : new Date(Date.now() - q.dias * 86_400_000).toISOString());

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS_CON_SITIO}
           from activity a
           left join profiles p on p.id = a.actor_id
           left join workspaces w on w.id = a.workspace_id
           left join organizations o on o.id = a.organization_id
          where ($1::timestamptz is null or a.at >= $1::timestamptz)
            and ($2::timestamptz is null or a.at < $2::timestamptz)
            and ($3::text is null or p.display_name ilike '%' || $3 || '%')
            and ($4::text is null or a.verb = $4)
            and ($5::text is null or a.subject_type = $5)
            and ($6::text is null or a.source::text = $6)
            and ($7::uuid is null or a.organization_id = $7)
            and ($8::uuid is null or a.workspace_id = $8)
          order by a.at desc
          limit $9`,
        [
          desde,
          q.antes ?? null,
          q.quien ?? null,
          q.verbo ?? null,
          q.sujeto ?? null,
          q.origen ?? null,
          q.organizationId ?? null,
          q.workspaceId ?? null,
          q.limite,
        ],
      );

      return { actividad: rows, hayMas: rows.length === q.limite };
    });
  });

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
   * El diario del proyecto: qué pasó cada semana.
   *
   * NO ES «EL REGISTRO CON TÍTULOS CADA SIETE DÍAS». Eso sería paginar con
   * encabezados. Un diario contesta otra cosa: «¿cómo ha ido este proyecto?»,
   * y para eso lo que importa de una semana no son sus cuarenta movimientos
   * sino tres datos — cuánto se cerró, quién estuvo, y qué quedó terminado.
   *
   * POR ESO LOS HITOS SON LOS CIERRES Y NO LOS CAMBIOS. Mover una tarjeta tres
   * veces deja tres renglones y no terminó nada; cerrarla deja uno y es lo
   * único que una semana después alguien recuerda. Un diario que contara
   * movimientos daría sus semanas más llenas a quien más arrastra tarjetas.
   *
   * ─────────────────────────────────────────────────────────────────────────
   *
   * LAS SEMANAS VACÍAS SALEN, Y ESA ES LA DECISIÓN QUE MÁS IMPORTA. Lo obvio
   * es agrupar lo que hay y devolver solo las semanas con algo dentro. Pero
   * entonces dos entradas seguidas parecen consecutivas cuando entre ellas hubo
   * un mes de nada: el diario **comprime el tiempo** y cuenta un ritmo que no
   * existió. Y no falla — sale una lista perfectamente ordenada.
   *
   * Que una semana aparezca en blanco es información, y de la que más se mira:
   * es lo que enseña un parón, unas vacaciones, o un proyecto que se quedó
   * quieto mientras nadie lo decía en voz alta. De ahí el `generate_series`:
   * las semanas las pone el calendario, no los datos.
   *
   * EL HUSO HORARIO NO ES UN DETALLE DE PRESENTACIÓN AQUÍ. Agrupar por semana
   * en UTC mete lo que se cerró un domingo por la tarde en Bogotá dentro de la
   * semana siguiente, porque allí ya es lunes. Nadie lo notaría —la lista se ve
   * bien— y sin embargo el hito estaría en la casilla equivocada. Se recibe el
   * huso y se trunca en él; UTC solo es lo que se usa si no lo dicen.
   */
  app.get("/workspaces/:workspaceId/diario", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const { semanas, tz } = parseQuery(
      z.object({
        semanas: z.coerce.number().int().min(1).max(52).default(8),
        /**
         * Un nombre IANA («America/Bogota»). No se valida contra una lista
         * nuestra: Postgres conoce la suya, que es la que de verdad manda, y
         * mantener una copia aquí solo garantiza que algún día discrepen.
         *
         * SIN VALOR POR DEFECTO DESDE LA 0056. Antes caía a `UTC`, y eso
         * convertía «no me lo dijeron» en «cuenta los domingos en la semana
         * siguiente» para media Colombia — con la lista viéndose perfectamente
         * normal. Ahora, cuando no viene, se usa el huso que la persona tenga
         * guardado, y solo si tampoco lo ha dicho se cae a UTC.
         */
        tz: z.string().trim().max(60).optional(),
      }),
      request.query,
    );

    return withUser(userId, async (db) => {
      // El huso, por orden: el que pida quien llama, el que tenga guardado, y
      // UTC como último recurso. `huso_de` (0056) resuelve los dos últimos, y
      // el «o UTC» está escrito ahí una sola vez a propósito.
      const usado =
        tz ??
        (
          await db.query<{ huso_de: string }>("select public.huso_de($1)", [userId])
        ).rows[0]!.huso_de;

      try {
        // La consulta vive en `lib/actividad.ts`: ver allí por qué, que no es
        // solo por poder probarla sin servidor.
        const semanasDelDiario = await diarioPorSemanas(db, {
          workspaceId,
          semanas,
          tz: usado,
        });
        // Se devuelve el que se USÓ y no el que se pidió: quien no mandó
        // ninguno necesita saber en cuál están las cuentas que está leyendo.
        return { semanas: semanasDelDiario, tz: usado };
      } catch (fallo) {
        // 22023 es lo que contesta Postgres ante un huso que no conoce. Se
        // traduce porque «invalid value for parameter TimeZone» no le dice a
        // nadie que lo que hay que corregir es la letra de «America/Bogota».
        if ((fallo as { code?: string }).code === "22023") {
          throw badRequest(`no conozco el huso horario «${usado}»`);
        }
        throw fallo;
      }
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
