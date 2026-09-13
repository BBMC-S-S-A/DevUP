import type { Db } from "../db/pool.js";

/**
 * Lo que pinta cada widget del panel, en una sola petición.
 *
 * EL PROBLEMA QUE ESTO RESUELVE NO ES QUE FALTEN DATOS. Casi todos existían ya,
 * cada uno en su ruta: la actividad en `/workspaces/:id/actividad`, los no
 * leídos en `/workspaces/:id/unread`, el tablero en `/workspaces/:id/board`. El
 * problema es lo que pasa al juntarlos: **un panel de ocho widgets son ocho
 * peticiones al abrirlo**, ocho barras de carga y ocho oportunidades de que una
 * llegue tarde y deje un hueco que no se distingue de un widget vacío.
 *
 * Es el mismo razonamiento de `/me/inicio`, `/tasks/:id/contexto` y el
 * panorama, y aquí pesa más que en ninguno: el panel es la primera pantalla que
 * se ve al entrar a un espacio, y es la que más trozos tiene.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SE CALCULA SOLO LO QUE SE PIDE, y por eso la ruta recibe la lista de widgets.
 * Servir siempre las ocho consultas para pintar las dos que alguien tenga
 * puestas sería cambiar ocho peticiones pequeñas por una grande y lenta, que no
 * es una mejora: es el mismo trabajo con menos avisos. Quien pide el panel ya
 * sabe qué widgets tiene —los acaba de leer de `panel_de`— así que decírselo al
 * servidor no cuesta nada.
 *
 * EL CATÁLOGO SIGUE VIVIENDO EN EL CLIENTE, que es la decisión de 0019 y sigue
 * valiendo: qué widgets existen y cómo se pintan es cosa suya. Lo de aquí es
 * distinto —de dónde salen los datos de los que SÍ necesitan servidor— y por eso
 * un widget que se pinte solo (un reloj, unas notas) no tiene que aparecer en
 * esta lista ni pide tocar nada.
 *
 * Y EL AISLAMIENTO, COMO SIEMPRE, ES DE LAS POLÍTICAS. Ninguna de estas
 * consultas comprueba permisos: todas corren bajo `withUser`, así que un canal
 * privado al que quien mira no pertenece no aparece en sus no leídos, y no
 * porque aquí se filtre, sino porque para esa sesión no existe.
 */

/** Los que necesitan servidor. Uno que se pinte solo no tiene por qué estar. */
export const WIDGETS_CON_DATOS = [
  "mis_tareas",
  "atascadas",
  "actividad",
  "no_leidos",
  "repositorios",
  "resumen",
] as const;

export type WidgetConDatos = (typeof WIDGETS_CON_DATOS)[number];

/** Cuánto cabe en una tarjeta antes de que haya que desplazarla. */
const POR_TARJETA = 8;

type Consulta = (db: Db, ws: string, dias: number) => Promise<unknown>;

const CONSULTAS: Record<WidgetConDatos, Consulta> = {
  /**
   * Lo mío, aquí.
   *
   * No es «mis tareas» de `/me/inicio`: aquella cruza organizaciones para
   * contestar «¿qué tengo?» sin entrar a ninguna. Esta es la de este espacio, y
   * por eso puede permitirse enseñar la columna — que es lo que dice si algo
   * está esperando a alguien o esperándome a mí.
   */
  mis_tareas: async (db, ws) => {
    const { rows } = await db.query(
      `select t.id, t.title as titulo, t.prioridad, t.tipo,
              t.due_date as "vence", c.name as columna
         from tasks t
         join task_columns c on c.id = t.column_id
        where t.workspace_id = $1
          and t.assignee_id = public.current_user_id()
          and not c.is_terminal
        order by (t.due_date is not null and t.due_date < current_date) desc,
                 t.prioridad desc, t.due_date nulls last, t.position
        limit $2`,
      [ws, POR_TARJETA],
    );
    return rows;
  },

  /**
   * Lo que lleva parado.
   *
   * La versión de espacio de lo que el panorama hace para la organización
   * entera. Se repite el criterio a propósito —empezada y sin tocar en la
   * ventana— porque es el que define la palabra, y no «vencida»: una tarea sin
   * fecha no vence nunca y puede llevar tres semanas quieta.
   */
  atascadas: async (db, ws, dias) => {
    const { rows } = await db.query(
      `select t.id, t.title as titulo, p.display_name as responsable,
              coalesce((select max(a.at) from activity a where a.subject_id = t.id),
                       t.created_at) as "ultimoToque"
         from tasks t
         join task_columns c on c.id = t.column_id
         left join profiles p on p.id = t.assignee_id
        where t.workspace_id = $1
          and not c.is_terminal
          and c.position > (select min(c2.position) from task_columns c2
                             where c2.workspace_id = $1)
          and coalesce((select max(a.at) from activity a where a.subject_id = t.id),
                       t.created_at) < now() - ($2::int || ' days')::interval
        order by 4 asc
        limit $3`,
      [ws, dias, POR_TARJETA],
    );
    return rows;
  },

  /** Los últimos hechos. Sin la hora: la misma raya de `que_ha_pasado`. */
  actividad: async (db, ws) => {
    const { rows } = await db.query(
      `select a.verb as verbo, a.subject_type as sujeto, a.subject_label as "sujetoNombre",
              a.detail as detalle, a.source as procedencia, a.at as cuando,
              p.display_name as "actorNombre"
         from activity a
         left join profiles p on p.id = a.actor_id
        where a.workspace_id = $1
        order by a.at desc
        limit $2`,
      [ws, POR_TARJETA],
    );
    return rows;
  },

  /**
   * Los canales con algo sin leer, con su nombre.
   *
   * `unread_counts` devuelve identificadores y números, que le basta a un punto
   * rojo en el menú pero no a una tarjeta: ahí hace falta el nombre. Se junta
   * aquí en vez de dejar que la pantalla cruce dos listas, porque cruzarlas
   * fuera significa pedir también la de canales — otra petición, y volvemos al
   * problema de arriba.
   *
   * Y solo los que tienen algo: un widget de no leídos que enseña ceros está
   * ocupando sitio para decir que no pasa nada.
   */
  no_leidos: async (db, ws) => {
    const { rows } = await db.query(
      `select u.channel_id as "canalId", c.name as canal, c.kind as tipo,
              u.unread::int as "sinLeer"
         from public.unread_counts($1) u
         join channels c on c.id = u.channel_id
        where u.unread > 0
        order by u.unread desc
        limit $2`,
      [ws, POR_TARJETA],
    );
    return rows;
  },

  /**
   * Los repositorios del espacio, con lo último que se sabe de ellos.
   *
   * `refrescado` viaja a propósito: las estadísticas las trae un barrendero cada
   * diez minutos, y un número sin fecha al lado se lee como si fuera de ahora.
   * Si el refresco lleva dos días fallando, el widget tiene que poder decirlo en
   * vez de enseñar con toda confianza la cifra de anteayer.
   */
  repositorios: async (db, ws) => {
    const { rows } = await db.query(
      `select r.id, r.full_name as nombre,
              s.data as datos, s.refreshed_at as refrescado, s.last_error as fallo
         from github_repos r
         left join github_repo_stats s on s.github_repo_id = r.id
        where r.workspace_id = $1
        order by r.full_name
        limit $2`,
      [ws, POR_TARJETA],
    );
    return rows;
  },

  /**
   * Los números de arriba: pendientes, empezadas y cerradas en la ventana.
   *
   * LOS TRES JUNTOS O NINGUNO. «12 pendientes» a secas no distingue un proyecto
   * vivo de uno parado; con «4 empezadas» y «11 cerradas esta semana» al lado,
   * el mismo 12 cuenta otra cosa. Un widget de una sola cifra grande es el que
   * mejor queda y el que menos dice.
   */
  resumen: async (db, ws, dias) => {
    const { rows } = await db.query(
      `select
         (select count(*) from tasks t join task_columns c on c.id = t.column_id
           where t.workspace_id = $1 and not c.is_terminal)::int as pendientes,
         (select count(*) from tasks t join task_columns c on c.id = t.column_id
           where t.workspace_id = $1 and not c.is_terminal
             and c.position > (select min(c2.position) from task_columns c2
                                where c2.workspace_id = $1))::int as "enCurso",
         (select count(*) from activity a
           where a.workspace_id = $1 and a.verb = 'cerro' and a.subject_type = 'tarea'
             and a.at > now() - ($2::int || ' days')::interval)::int as "cerradas"`,
      [ws, dias],
    );
    return rows[0];
  },
};

/**
 * Sirve los widgets pedidos, cada uno bajo su nombre.
 *
 * EN PARALELO Y NO EN FILA: son consultas independientes contra la misma
 * conexión, y encadenarlas sumaría sus tiempos sin ninguna razón. Lo que no se
 * hace es tragarse un fallo — si una consulta revienta, revienta la petición.
 * Devolver el panel con un widget en blanco y los demás llenos sería lo peor de
 * los dos mundos: parecería que ese widget no tiene nada que enseñar.
 */
export async function datosDeWidgets(
  db: Db,
  filtro: { workspaceId: string; widgets: WidgetConDatos[]; dias: number },
): Promise<Record<string, unknown>> {
  const pedidos = [...new Set(filtro.widgets)];

  const resultados = await Promise.all(
    pedidos.map(async (w) => [w, await CONSULTAS[w](db, filtro.workspaceId, filtro.dias)] as const),
  );

  return Object.fromEntries(resultados);
}
