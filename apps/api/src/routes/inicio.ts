import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { parseQuery, requireUser } from "../lib/http.js";

/**
 * La portada: todo lo mío, de todos los espacios a la vez.
 *
 * LA PREGUNTA QUE EL PRODUCTO NO PODÍA CONTESTAR, Y ES LA MÁS BÁSICA DE TODAS.
 * Hasta aquí, «¿qué tengo que hacer?» solo se podía preguntar DENTRO de un
 * espacio de trabajo: el tablero es de un espacio, la auditoría es de un
 * espacio, el panel es de un espacio. Alguien que lleva tres clientes tenía que
 * entrar a los tres y sumar de cabeza. El MCP lo resolvía a lo bruto
 * —`mis_tareas` recorre los espacios uno por uno desde fuera—, y la web ni eso.
 *
 * UNA SOLA PETICIÓN, Y ESO ES LA MITAD DEL DISEÑO. La alternativa era que la
 * portada pidiera la lista de organizaciones, luego los espacios de cada una, y
 * luego el tablero de cada espacio: con tres organizaciones y ocho espacios son
 * doce peticiones en cascada para pintar una pantalla que se abre cada mañana.
 * Aquí son tres consultas en una transacción.
 *
 * EL AISLAMIENTO NO LO PONE ESTA RUTA, y aquí la tentación de creer lo
 * contrario es máxima, porque es la única que consulta sin decir de qué
 * organización. Va por `withUser`: las políticas de `tasks` y de `activity`
 * deciden qué filas entran. Una tarea de un espacio al que ya no se tiene
 * acceso simplemente no existe para esta consulta — sin un solo `where
 * organization_id` que alguien pueda olvidarse de escribir.
 *
 * LO QUE NO DEVUELVE, A PROPÓSITO: ningún porcentaje ni ninguna puntuación. El
 * desglose por verbo sí, el total no. Cuánto vale cerrar una tarea frente a
 * crearla es la decisión de participación que sigue abierta
 * (`plan-agentes-y-participacion.md` §T3), y un número único en la portada la
 * tomaría por la puerta de atrás: en cuanto aparece, es el marcador.
 */

/** Un mes. Lo bastante para que «lo que he hecho» tenga forma sin volverse un
 *  historial que nadie lee. */
const DIAS_POR_DEFECTO = 30;

export async function inicioRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/me/inicio", async (request) => {
    const userId = requireUser(request);
    const q = parseQuery(
      z.object({ dias: z.coerce.number().int().min(1).max(365).optional() }),
      request.query,
    );
    const dias = q.dias ?? DIAS_POR_DEFECTO;

    return withUser(userId, async (db) => {
      /**
       * Mis tareas abiertas, ordenadas como se miran.
       *
       * EL ORDEN ES LA RESPUESTA. Una lista de cuarenta tareas ordenada por
       * fecha de creación no contesta «¿qué hago ahora?»: hay que leerla
       * entera. Esta pone delante lo vencido —que es lo único que ya está
       * costando algo—, después lo urgente, después lo que vence antes. Quien
       * abra esto por la mañana tiene su día en las cinco primeras líneas.
       *
       * `not c.is_terminal` y no «la columna no se llama Hecho»: desde la 0037
       * el tablero sabe qué columna termina, y eso es justo para que esta clase
       * de pregunta no tenga que adivinarlo por el nombre.
       */
      const { rows: tareas } = await db.query(
        `select t.id, t.title, t.due_date as "vence",
                t.prioridad, t.tipo,
                c.name as columna,
                w.id as "espacioId", w.name as espacio,
                o.id as "organizacionId", o.name as organizacion,
                cat.name as area,
                (select count(*) from task_evidence e where e.task_id = t.id)::int as evidencias
           from tasks t
           join task_columns c on c.id = t.column_id
           join workspaces w on w.id = t.workspace_id
           join organizations o on o.id = w.organization_id
           left join task_categories cat on cat.id = t.category_id
          where t.assignee_id = public.current_user_id()
            and not c.is_terminal
          order by (t.due_date is not null and t.due_date < current_date) desc,
                   t.prioridad desc,
                   t.due_date nulls last,
                   t.position
          limit 100`,
      );

      /**
       * Lo que he hecho, contado por verbo y por origen.
       *
       * CRUZANDO TODAS LAS ORGANIZACIONES, que es lo que la auditoría por
       * espacio no puede hacer. Y con el origen separado: lo que le pedí a mi
       * asistente cuenta, pero no es lo mismo que lo que tecleé, y sumarlos
       * solos convertiría esta cifra en una que nadie debería tomarse en serio.
       */
      const { rows: resumen } = await db.query(
        `select a.verb as "verbo", a.source as "origen", count(*)::int as veces
           from activity a
          where a.actor_id = public.current_user_id()
            and a.at > now() - ($1::int || ' days')::interval
          group by a.verb, a.source
          order by veces desc`,
        [dias],
      );

      /** Los últimos hechos míos, para «¿en qué andaba yo?» al volver. */
      const { rows: ultimos } = await db.query(
        `select a.verb as "verbo", a.source as "origen",
                a.subject_label as "resumen", a.at as "ocurridoEn",
                a.subject_type as "objetoTipo", a.subject_id as "objetoId",
                w.id as "espacioId", w.name as espacio
           from activity a
           left join workspaces w on w.id = a.workspace_id
          where a.actor_id = public.current_user_id()
            and a.at > now() - ($1::int || ' days')::interval
          order by a.at desc
          limit 20`,
        [dias],
      );

      return { dias, tareas, resumen, ultimos };
    });
  });
}
