import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { parseParams, parseQuery, requireUser } from "../lib/http.js";

/**
 * La auditoría del EQUIPO, que es la otra mitad de la pantalla.
 *
 * QUÉ SE AUDITA AQUÍ, Y POR QUÉ HACÍA FALTA DECIRLO. La pantalla de Auditoría
 * nació mirando el repositorio —migraciones e integraciones—, porque así se
 * leyó la palabra al construirla. Lo que se pedía era lo otro: cómo trabaja la
 * gente junta. Las dos cosas valen y ahora conviven; esta es la segunda.
 *
 * TODO SALE DE LO QUE YA SE GUARDA. No hay tabla nueva ni migración: los
 * mensajes, las llamadas y las tareas ya anotan quién y cuándo. Lo que se hace
 * aquí es cruzarlo.
 *
 * LO QUE ESTO **NO** PUEDE CONTESTAR, y va dicho también en la pantalla porque
 * un número sin su letra pequeña se lee como una verdad: no hay registro de
 * actividad —lo señala la propia propuesta de arquitectura, §6—, así que no se
 * puede reconstruir «qué pasó esta semana» como una historia. Y una tarea no
 * guarda cuándo se terminó: lo más cercano es `updated_at`, que es cuándo se
 * tocó por última vez. Para una tarea que se movió a «hecho» y ya no se tocó
 * más, las dos cosas coinciden; para una que se editó después, no. Se usa, y
 * se avisa de que es una aproximación.
 *
 * EL AISLAMIENTO NO LO PONE ESTA RUTA. Todas las consultas van por `withUser`,
 * así que RLS decide qué filas entran: los canales privados a los que alguien
 * no pertenece no cuentan para su auditoría, y eso es lo correcto — la
 * auditoría enseña el equipo que quien mira puede ver, no el que existe.
 */

const uuid = z.string().uuid();

/** La ventana por defecto. Un trimestre es lo que hace falta para que un
 *  patrón de colaboración se distinga del ruido de una semana rara. */
const DIAS_POR_DEFECTO = 90;

/** Una tarea abierta sin tocar tantos días se considera parada. */
const DIAS_PARA_ESTAR_PARADA = 14;

type Persona = { userId: string; displayName: string | null };

/** Sin nombre puesto, se dice así y no con un guion mudo. */
const comoSeLlama = (nombre: string | null | undefined) => nombre || "Sin nombre";

export async function auditoriaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/workspaces/:workspaceId/auditoria/equipo", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const { dias } = parseQuery(
      z.object({ dias: z.coerce.number().int().min(7).max(365).default(DIAS_POR_DEFECTO) }),
      request.query,
    );

    return withUser(userId, async (db) => {
      /**
       * Quién responde a quién en los canales del espacio.
       *
       * Se cuenta por `reply_to` y no por «escribieron en el mismo canal»: dos
       * personas en un canal de cuarenta no han colaborado por estar ahí. Una
       * respuesta sí es una interacción dirigida, que es lo que se quiere ver.
       *
       * El par se ordena (`least`/`greatest`) para que A→B y B→A sean la misma
       * fila: lo que interesa es la relación, no la dirección.
       */
      const { rows: porMensajes } = await db.query<{ a: string; b: string; n: string }>(
        `select least(m.author_id, p.author_id) as a,
                greatest(m.author_id, p.author_id) as b,
                count(*)::text as n
           from messages m
           join messages p on p.id = m.reply_to
           join channels c on c.id = m.channel_id
          where c.workspace_id = $1
            and m.created_at > now() - ($2 || ' days')::interval
            and m.author_id is not null and p.author_id is not null
            and m.author_id <> p.author_id
          group by 1, 2`,
        [workspaceId, dias],
      );

      /**
       * Quién coincide con quién en una llamada.
       *
       * Dos filas de la misma sesión es coincidir. No se mide el solapamiento
       * real en el tiempo —quien entra cuando el otro acaba de salir cuenta
       * igual— porque afinar eso pide comparar intervalos por pares y el dato
       * que aporta no cambia la lectura: siguen siendo dos personas que fueron
       * a la misma reunión.
       */
      const { rows: porLlamadas } = await db.query<{ a: string; b: string; n: string }>(
        `select least(x.user_id, y.user_id) as a,
                greatest(x.user_id, y.user_id) as b,
                count(distinct x.session_id)::text as n
           from call_participants x
           join call_participants y
             on y.session_id = x.session_id and y.user_id <> x.user_id
           join call_sessions s on s.id = x.session_id
           join channels c on c.id = s.channel_id
          where c.workspace_id = $1
            and x.joined_at > now() - ($2 || ' days')::interval
          group by 1, 2`,
        [workspaceId, dias],
      );

      /** Cómo se reparte el trabajo, y qué llega a terminarse. */
      const { rows: carga } = await db.query<{
        user_id: string | null;
        abiertas: string;
        hechas: string;
      }>(
        `select t.assignee_id as user_id,
                count(*) filter (where not col.is_terminal)::text as abiertas,
                count(*) filter (where col.is_terminal)::text as hechas
           from tasks t
           join task_columns col on col.id = t.column_id
          where t.workspace_id = $1
          group by 1`,
        [workspaceId],
      );

      /**
       * Cuánto tarda una tarea en llegar a una columna terminal.
       *
       * Mediana y no media: una tarea abandonada seis meses arrastra la media
       * hasta volverla mentira, y la mediana aguanta eso sin inmutarse.
       */
      const { rows: cierre } = await db.query<{ dias: string | null; cuantas: string }>(
        `select percentile_cont(0.5) within group (
                  order by extract(epoch from (t.updated_at - t.created_at)) / 86400
                )::numeric(10,1)::text as dias,
                count(*)::text as cuantas
           from tasks t
           join task_columns col on col.id = t.column_id
          where t.workspace_id = $1 and col.is_terminal`,
        [workspaceId],
      );

      /** Dónde se queda el trabajo parado, columna por columna. */
      const { rows: columnas } = await db.query<{
        columna: string;
        abiertas: string;
        dias_sin_tocar: string | null;
      }>(
        `select col.name as columna,
                count(t.id)::text as abiertas,
                (percentile_cont(0.5) within group (
                   order by extract(epoch from (now() - t.updated_at)) / 86400
                 ))::numeric(10,1)::text as dias_sin_tocar
           from task_columns col
           left join tasks t on t.column_id = col.id
          where col.workspace_id = $1 and not col.is_terminal
          group by col.id, col.name, col.position
          order by col.position`,
        [workspaceId],
      );

      /** Las que llevan más tiempo quietas, con nombre y responsable. */
      const { rows: paradas } = await db.query(
        `select t.id, t.title as titulo,
                col.name as columna,
                u.display_name as responsable,
                (extract(epoch from (now() - t.updated_at)) / 86400)::int as dias
           from tasks t
           join task_columns col on col.id = t.column_id
           left join profiles u on u.id = t.assignee_id
          where t.workspace_id = $1
            and not col.is_terminal
            and t.updated_at < now() - ($2 || ' days')::interval
          order by t.updated_at
          limit 10`,
        [workspaceId, DIAS_PARA_ESTAR_PARADA],
      );

      /**
       * Quién está en el espacio. Hace falta para dos cosas: poner nombre a los
       * identificadores, y saber quién NO aparece en ninguna pareja — que es el
       * dato que más cuesta ver a ojo y el que más importa.
       */
      const { rows: personas } = await db.query<Persona>(
        `select distinct m.user_id as "userId",
                nullif(btrim(coalesce(p.display_name, '')), '') as "displayName"
           from organization_members m
           join workspaces w on w.organization_id = m.organization_id
           left join profiles p on p.id = m.user_id
          where w.id = $1`,
        [workspaceId],
      );

      const nombre = new Map(personas.map((p) => [p.userId, p.displayName]));

      // Las dos fuentes se suman en una sola relación: hablarse por escrito y
      // verse en una llamada son la misma cosa contada por dos sitios.
      const parejas = new Map<string, { a: string; b: string; mensajes: number; llamadas: number }>();
      const sumar = (a: string, b: string, campo: "mensajes" | "llamadas", n: number) => {
        const clave = `${a}|${b}`;
        const actual = parejas.get(clave) ?? { a, b, mensajes: 0, llamadas: 0 };
        actual[campo] += n;
        parejas.set(clave, actual);
      };
      for (const r of porMensajes) sumar(r.a, r.b, "mensajes", Number(r.n));
      for (const r of porLlamadas) sumar(r.a, r.b, "llamadas", Number(r.n));

      const conRelacion = new Set<string>();
      const juntos = [...parejas.values()]
        .map((p) => {
          conRelacion.add(p.a);
          conRelacion.add(p.b);
          return {
            ...p,
            nombreA: comoSeLlama(nombre.get(p.a)),
            nombreB: comoSeLlama(nombre.get(p.b)),
            total: p.mensajes + p.llamadas,
          };
        })
        .sort((x, y) => y.total - x.total);

      return {
        dias,
        juntos,
        // Quien no aparece con nadie. No es un juicio: puede estar de
        // vacaciones o trabajar solo por su cuenta. Es una pregunta, no una
        // conclusión, y la pantalla lo dice así.
        sueltos: personas.filter((p) => !conRelacion.has(p.userId)),
        carga: carga
          .filter((c) => c.user_id !== null)
          .map((c) => ({
            userId: c.user_id!,
            displayName: comoSeLlama(nombre.get(c.user_id!)),
            abiertas: Number(c.abiertas),
            hechas: Number(c.hechas),
          }))
          .sort((x, y) => y.abiertas - x.abiertas),
        sinResponsable: carga
          .filter((c) => c.user_id === null)
          .reduce((suma, c) => suma + Number(c.abiertas) + Number(c.hechas), 0),
        cierre: {
          diasMediana: cierre[0]?.dias ? Number(cierre[0].dias) : null,
          terminadas: Number(cierre[0]?.cuantas ?? 0),
        },
        columnas: columnas.map((c) => ({
          columna: c.columna,
          abiertas: Number(c.abiertas),
          diasSinTocar: c.dias_sin_tocar ? Number(c.dias_sin_tocar) : null,
        })),
        paradas,
        umbralParada: DIAS_PARA_ESTAR_PARADA,
      };
    });
  });
}
