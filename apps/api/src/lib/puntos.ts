import type { Db } from "../db/pool.js";

/**
 * Lo que se ha ganado, y con qué detrás.
 *
 * EL AISLAMIENTO NO SE ESCRIBE AQUÍ. Ninguna de estas consultas lleva un
 * `where organization_id` de más: las políticas de la 0055 deciden qué filas
 * existen para quien pregunta. Añadirlo a mano sería una segunda regla de
 * visibilidad que mantener alineada con la de verdad — y cuando las dos
 * discrepan, la que gana no es la que se lee en el código.
 */

export type PuntosDeUnaPersona = {
  id: string;
  nombre: string | null;
  total: number;
  /** De ese total, cuánto se ganó en tareas por las que no pasó nadie más. */
  aSolas: number;
  porMotivo: Record<string, number>;
  tareas: number;
};

/**
 * El marcador de una organización.
 *
 * DEVUELVE `aSolas` AL LADO DEL TOTAL Y NO EN OTRA PANTALLA. Es la decisión
 * entera de la 0055: no se bloquea a quien trabaja solo, se dice. Un total sin
 * ese número al lado es exactamente el dato que se puede inflar sin que se note,
 * y separarlos en dos vistas es lo mismo que no tenerlo — nadie abre la segunda.
 */
export async function marcadorDeOrganizacion(
  db: Db,
  filtro: { organizationId: string; dias: number },
): Promise<PuntosDeUnaPersona[]> {
  const { rows } = await db.query<PuntosDeUnaPersona>(
    `select p.user_id as id,
            pr.display_name as nombre,
            sum(p.cantidad)::int as total,
            sum(p.cantidad) filter (where p.a_solas)::int as "aSolas",
            count(distinct p.task_id)::int as tareas,
            coalesce(
              jsonb_object_agg(p.motivo, p.suma_motivo) filter (where p.motivo is not null),
              '{}'::jsonb
            ) as "porMotivo"
       from (
         select user_id, organization_id, a_solas, task_id, motivo, cantidad,
                sum(cantidad) over (partition by user_id, motivo) as suma_motivo
           from public.puntos
          where organization_id = $1
            and at >= now() - make_interval(days => $2)
       ) p
       left join public.profiles pr on pr.id = p.user_id
      group by p.user_id, pr.display_name
      order by total desc, pr.display_name`,
    [filtro.organizationId, filtro.dias],
  );
  return rows;
}

export type Asiento = {
  id: string;
  tarea: string | null;
  titulo: string;
  motivo: string;
  cantidad: number;
  aSolas: boolean;
  cuando: string;
};

/**
 * Los asientos de una persona: de dónde sale cada punto de su total.
 *
 * SIN ESTO EL MARCADOR NO SE PUEDE COMPROBAR, y un marcador que no se puede
 * comprobar es solo un número grande. El título va copiado en la tabla, así que
 * un asiento sigue diciendo de qué tarea vino aunque esa tarea ya no exista.
 */
export async function asientosDe(
  db: Db,
  filtro: { userId: string; organizationId: string; dias: number; limite: number },
): Promise<Asiento[]> {
  const { rows } = await db.query<Asiento>(
    `select p.id, p.task_id as tarea, p.task_label as titulo, p.motivo::text as motivo,
            p.cantidad, p.a_solas as "aSolas", p.at as cuando
       from public.puntos p
      where p.user_id = $1
        and p.organization_id = $2
        and p.at >= now() - make_interval(days => $3)
      order by p.at desc
      limit $4`,
    [filtro.userId, filtro.organizationId, filtro.dias, filtro.limite],
  );
  return rows;
}
