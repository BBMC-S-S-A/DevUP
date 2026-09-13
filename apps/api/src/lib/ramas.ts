import type { Db } from "../db/pool.js";

/**
 * Las ramas de trabajo: quién responde de cada una, qué cuelga y qué falta por
 * repartir.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * DOS DEUDAS QUE ESTO PAGA, Y LAS DOS ESTABAN ESCRITAS:
 *
 *   · La cabecera de la 0050 prometió que lo archivado en una rama **sin
 *     delegado no se asigna a nadie: aparece en «por repartir»**. Esa lista no
 *     existía. Una promesa en el comentario de una migración y ninguna consulta
 *     que la cumpla es peor que no haberla hecho: quien lea la migración se cree
 *     que el producto lo hace.
 *
 *   · El §6.1 de `CAMINOS.md` lo pidió la sesión de interfaz —«abierta una
 *     rama, quiénes han tocado sus tareas últimamente y cuándo fue la última
 *     vez»— y explicó bien por qué no podía hacerlo sola: el recuento por
 *     persona no admite entrar por categoría, y cruzarlo en la pantalla exigía
 *     traerse el tablero entero y volver a unir a mano lo que la base ya sabe
 *     unir. Eso es exactamente cómo nacen las segundas fuentes de verdad.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * LO QUE «QUIÉN HA TRABAJADO» SIGNIFICA DE VERDAD, y conviene decirlo porque la
 * frase corta miente un poco: es **quién ha tocado las tareas que HOY están en
 * esta rama**. Una tarea puede cambiar de rama, y su historia se va con ella.
 * Así que si algo se movió de Workflow a DevVerse, el trabajo que se le hizo
 * antes aparece ahora bajo DevVerse.
 *
 * Es lo correcto para la pregunta que se hace —«¿quién sabe de esto?»— y sería
 * lo incorrecto para «¿cuánto se trabajó en esta rama en septiembre?». La
 * segunda necesitaría que el registro guardara la rama de cada hecho, que es
 * otra tabla y otra decisión. Mientras no exista, esta función no la contesta y
 * no finge que sí.
 *
 * NO HAY NÚMERO ÚNICO POR PERSONA, y lo pidieron así: «una cifra al lado de una
 * rama tendría el mismo problema que al lado de una cara». Sale el desglose por
 * verbo, que deja que la pantalla enseñe lo que hay sin inventarse una
 * equivalencia entre crear y cerrar.
 */

export type Rama = {
  id: string;
  nombre: string;
  color: number;
  gerentes: { id: string; nombre: string | null }[];
  pendientes: number;
  cerradasReciente: number;
  porRepartir: number;
};

/**
 * Las ramas de un espacio, con lo que hace falta para decidir cuál abrir.
 *
 * `porRepartir` va en la lista y no solo en el detalle a propósito: es lo único
 * de aquí que pide una acción, y esconderlo detrás de un clic por rama
 * significaría abrir cinco para descubrir que hay trabajo esperando en la
 * tercera.
 */
export async function ramasDe(
  db: Db,
  filtro: { workspaceId: string; dias: number },
): Promise<Rama[]> {
  const { rows } = await db.query<Rama>(
    `select c.id, c.name as nombre, c.color,
            coalesce(
              (select json_agg(json_build_object('id', p.id, 'nombre', p.display_name)
                               order by p.display_name)
                 from task_category_owners o
                 join profiles p on p.id = o.user_id
                where o.category_id = c.id),
              '[]'::json
            ) as gerentes,
            (select count(*) from tasks t
               join task_columns col on col.id = t.column_id
              where t.category_id = c.id and not col.is_terminal)::int as pendientes,
            (select count(*) from activity a
               join tasks t on t.id = a.subject_id
              where t.category_id = c.id and a.verb = 'cerro'
                and a.subject_type = 'tarea'
                and a.at > now() - ($2::int || ' days')::interval)::int as "cerradasReciente",
            -- La promesa de la 0050: lo que cayó aquí y no tiene a nadie.
            (select count(*) from tasks t
               join task_columns col on col.id = t.column_id
              where t.category_id = c.id and not col.is_terminal
                and t.assignee_id is null)::int as "porRepartir"
       from task_categories c
      where c.workspace_id = $1
      order by c.position, c.name`,
    [filtro.workspaceId, filtro.dias],
  );
  return rows;
}

export type DetalleDeRama = {
  porRepartir: { id: string; titulo: string; prioridad: number | null; columna: string }[];
  quienHaTrabajado: {
    id: string;
    nombre: string | null;
    porVerbo: Record<string, number>;
    ultimaVez: string;
  }[];
};

/** Lo que se abre al entrar en una rama: lo que espera, y quién anda por aquí. */
export async function detalleDeRama(
  db: Db,
  filtro: { categoryId: string; dias: number },
): Promise<DetalleDeRama> {
  const [porRepartir, gente] = await Promise.all([
    db.query(
      `select t.id, t.title as titulo, t.prioridad, col.name as columna
         from tasks t
         join task_columns col on col.id = t.column_id
        where t.category_id = $1 and not col.is_terminal and t.assignee_id is null
        order by t.prioridad desc, t.created_at
        limit 50`,
      [filtro.categoryId],
    ),
    /**
     * Quién ha tocado las tareas de esta rama. Ver la cabecera para qué
     * significa exactamente, que no es lo mismo que la frase corta.
     *
     * Por verbo y no en un total: es lo que pidió el §6.1, y por el mismo
     * motivo que en la auditoría — un número único obliga a decidir ya cuánto
     * vale cerrar frente a crear, que es justo la decisión que no está tomada.
     */
    db.query(
      `select a.actor_id as id, p.display_name as nombre,
              jsonb_object_agg(a.verb, a.veces) as "porVerbo",
              max(a.ultima) as "ultimaVez"
         from (
           select a.actor_id, a.verb, count(*)::int as veces, max(a.at) as ultima
             from activity a
             join tasks t on t.id = a.subject_id
            where t.category_id = $1
              and a.subject_type = 'tarea'
              and a.actor_id is not null
              and a.at > now() - ($2::int || ' days')::interval
            group by a.actor_id, a.verb
         ) a
         left join profiles p on p.id = a.actor_id
        group by a.actor_id, p.display_name
        order by max(a.ultima) desc`,
      [filtro.categoryId, filtro.dias],
    ),
  ]);

  return {
    porRepartir: porRepartir.rows as DetalleDeRama["porRepartir"],
    quienHaTrabajado: gente.rows as DetalleDeRama["quienHaTrabajado"],
  };
}
