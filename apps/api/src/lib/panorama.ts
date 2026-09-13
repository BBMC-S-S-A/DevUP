import type { Db } from "../db/pool.js";

/**
 * El panorama de una organización: qué hay aquí, quién está, y en qué anda cada
 * cual.
 *
 * QUÉ PANTALLA ARREGLA. Hoy la portada de una organización enseña **la lista de
 * sus espacios de trabajo**, que es casi lo único que no hace falta saber: los
 * espacios ya están en el menú lateral, a un clic, y repetirlos en el centro de
 * la pantalla gasta la mejor posición del producto en un índice. Quien entra a
 * una organización no viene a ver cuántos espacios tiene — viene a ver **cómo
 * va**: qué se está haciendo, quién lo está haciendo, quién está disponible
 * ahora mismo y dónde hay algo atascado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * UNA PETICIÓN, por lo mismo que `/me/inicio` y `/tasks/:id/contexto`: son
 * cinco consultas que ninguna pantalla debería encadenar. Cinco peticiones son
 * cinco oportunidades de pintar media portada y dejar la otra media girando, y
 * quien mira no sabe si lo que falta es que no existe o que no ha llegado.
 *
 * SIN UN SOLO `where organization_id` DE MÁS DEL QUE HACE FALTA PARA ACOTAR.
 * El aislamiento lo ponen las políticas, como en todo el producto: un espacio
 * de esta organización al que quien mira no llega no sale en la lista, y no
 * porque esta consulta lo excluya, sino porque para esa sesión no existe. Eso
 * hace la portada **honesta por construcción**: enseña la organización tal y
 * como la ve quien la está mirando, no un resumen que incluye cosas que luego
 * no puede abrir.
 *
 * LA PRESENCIA ES UNA ELECCIÓN, NO UNA DEDUCCIÓN, y esta ruta no la cambia.
 * La 0022 lo dejó escrito y merece repetirse aquí porque la tentación de una
 * portada con puntitos verdes es justo la contraria: deducir «en línea» de si
 * hay una pestaña abierta. Un estado adivinado miente —dice «disponible» de
 * quien salió a comer con el portátil abierto— y enseña a no fiarse de él, que
 * es peor que no tenerlo. Aquí se lee lo que cada cual eligió, y quien no
 * eligió nada sale como lo que es: sin decir.
 *
 * EL OFICIO SE PREFIERE EL DE AQUÍ (0048). Una persona no hace lo mismo en
 * todas sus organizaciones, y cuando ha dicho a qué se dedica en esta, se
 * enseña eso; si no, el suyo general. Y **nunca el `role`**: `member` es un
 * permiso, no un oficio, y enseñarlo donde se pregunta «¿a qué se dedica?» es
 * la respuesta equivocada a la pregunta correcta.
 */
export type Panorama = {
  espacios: Record<string, unknown>[];
  gente: Record<string, unknown>[];
  enMarcha: Record<string, unknown>[];
  atascadas: Record<string, unknown>[];
};

/**
 * VIVE AQUÍ Y NO EN LA RUTA por lo mismo que `diarioPorSemanas`: para poder
 * probarlo sin levantar el servidor, y sobre todo para que la prueba no tenga
 * que llevar su propia copia del SQL. Dos copias pueden divergir y seguir las
 * dos en verde — una prueba que comprueba su propia copia no comprueba nada.
 */
export async function panoramaDeOrganizacion(
  db: Db,
  filtro: { organizationId: string; dias: number },
): Promise<Panorama> {
  const [espacios, gente, enMarcha, atascadas] = await Promise.all([
        /**
         * Los espacios, con lo que hace falta para decidir en cuál entrar.
         *
         * `pendientes` y `cerradasReciente` juntos son lo que convierte una
         * lista en información: cuatro pendientes y nada cerrado en la semana
         * no se lee igual que cuatro pendientes y once cerradas. Un solo
         * número —«12 tareas»— no distingue un proyecto vivo de uno parado.
         */
        db.query(
          `select w.id, w.name as nombre,
                  (select count(*) from tasks t
                     join task_columns c on c.id = t.column_id
                    where t.workspace_id = w.id and not c.is_terminal)::int as pendientes,
                  (select count(*) from activity a
                    where a.workspace_id = w.id and a.verb = 'cerro'
                      and a.subject_type = 'tarea'
                      and a.at > now() - ($2::int || ' days')::interval)::int as "cerradasReciente",
                  (select count(*) from workspace_members m
                    where m.workspace_id = w.id)::int as personas,
                  (select max(a.at) from activity a where a.workspace_id = w.id) as "ultimoMovimiento"
             from workspaces w
            where w.organization_id = $1
            order by w.name`,
          [filtro.organizationId, filtro.dias],
        ),

        /**
         * Quién está, con su estado y su oficio.
         *
         * `enQue` es lo que de verdad se pregunta al mirar una lista de
         * personas: no «quién hay» sino «quién está en qué». Sale de las
         * tareas sin terminar que tiene asignadas, no de a qué espacios
         * pertenece — pertenecer a cinco espacios y no estar tocando ninguno
         * es lo normal, y una portada que lo enseñara diría que todo el mundo
         * está en todo.
         */
        db.query(
          `select p.id, p.display_name as nombre, p.avatar_url as avatar,
                  p.presence as estado,
                  coalesce(nullif(btrim(m.title), ''), p.title) as oficio,
                  m.role as permiso,
                  coalesce(
                    (select json_agg(distinct w.name)
                       from tasks t
                       join task_columns c on c.id = t.column_id
                       join workspaces w on w.id = t.workspace_id
                      where t.assignee_id = p.id
                        and w.organization_id = $1
                        and not c.is_terminal),
                    '[]'::json
                  ) as "enQue"
             from organization_members m
             join profiles p on p.id = m.user_id
            where m.organization_id = $1
            order by p.display_name`,
          [filtro.organizationId],
        ),

        /**
         * Lo que se está tocando ahora: tareas en columnas que no son ni la
         * primera ni la terminal.
         *
         * «En curso» no se puede pedir por nombre de columna —cada tablero
         * llama a las suyas como quiere— así que se deduce de la posición: ni
         * en la de entrada ni en la de salida es, por construcción, «empezada
         * y sin terminar». Es la definición que no depende de que nadie haya
         * escrito la palabra correcta.
         */
        db.query(
          `select t.id, t.title as titulo, t.prioridad, t.tipo,
                  w.name as espacio, w.id as "espacioId",
                  c.name as columna,
                  p.display_name as "responsable"
             from tasks t
             join task_columns c on c.id = t.column_id
             join workspaces w on w.id = t.workspace_id
             left join profiles p on p.id = t.assignee_id
            where w.organization_id = $1
              and not c.is_terminal
              and c.position > (select min(c2.position) from task_columns c2
                                 where c2.workspace_id = w.id)
            order by t.prioridad desc, t.updated_at desc
            limit 25`,
          [filtro.organizationId],
        ),

        /**
         * Y lo que lleva parado, que es lo que una portada tiene que sacar a
         * la superficie porque nadie va a ir a buscarlo.
         *
         * Empezada —no está en la primera columna— y sin un solo movimiento en
         * la ventana. No es lo mismo que «vencida»: una tarea sin fecha no
         * vence nunca y puede llevar tres semanas quieta.
         */
        db.query(
          `select t.id, t.title as titulo, w.name as espacio,
                  p.display_name as "responsable",
                  (select max(a.at) from activity a where a.subject_id = t.id) as "ultimoToque"
             from tasks t
             join task_columns c on c.id = t.column_id
             join workspaces w on w.id = t.workspace_id
             left join profiles p on p.id = t.assignee_id
            where w.organization_id = $1
              and not c.is_terminal
              and c.position > (select min(c2.position) from task_columns c2
                                 where c2.workspace_id = w.id)
              and coalesce(
                    (select max(a.at) from activity a where a.subject_id = t.id),
                    t.created_at
                  ) < now() - ($2::int || ' days')::interval
            order by coalesce(
                       (select max(a.at) from activity a where a.subject_id = t.id),
                       t.created_at
                     ) asc
            limit 10`,
          [filtro.organizationId, filtro.dias],
        ),
      ]);


  return {
    espacios: espacios.rows,
    gente: gente.rows,
    enMarcha: enMarcha.rows,
    atascadas: atascadas.rows,
  };
}
