import type { Db } from "../db/pool.js";

/**
 * El vocabulario del registro de actividad, y cómo se escribe un renglón.
 *
 * POR QUÉ VIVE AQUÍ Y NO EN LA BASE. El verbo es una columna de texto a
 * propósito (ver la cabecera de `0038_registro_de_actividad.sql`): con un enum,
 * cada palabra nueva sería una migración, y `alter type ... add value` ni
 * siquiera corre siempre dentro de una transacción, que es como corren. La
 * lista vive aquí, donde se lee y se amplía sin tocar el esquema.
 *
 * LOS VERBOS ESTÁN EN PASADO Y SIN TILDE. En pasado porque un registro cuenta
 * lo que YA pasó —«movió», no «mover»— y sin tilde porque es un valor guardado
 * que se compara, no un texto que se enseña: lo que lee la persona se compone
 * en la pantalla a partir del verbo, el sujeto y quién fue.
 *
 * ESTO NO ES UNA AUDITORÍA DE SEGURIDAD y conviene no confundirlo. Guarda lo
 * que el producto hace con el trabajo del equipo —tareas que se mueven, se
 * cierran, se asignan— para poder contestar «qué ha pasado aquí». No guarda
 * inicios de sesión, ni lecturas, ni intentos denegados.
 */

export const VERBOS = [
  "creo",
  "movio",
  "cerro",
  "reabrio",
  "asigno",
  "desasigno",
  "renombro",
  "comento",
  "adjunto",
  "etiqueto",
  "borro",
  // Del camino B: cambiar de área es mover trabajo de un frente a otro. El
  // verbo es texto y no un enum justo para poder añadir uno sin migración.
  "reclasifico",
  // Los tres de la ficha de tarea, también del camino B. `priorizo` es el
  // único cambio de campo que se anota: subir algo a urgente es una decisión
  // que alguien tomó y que otro va a querer entender después. Cambiar el tipo
  // o el contexto es corregir la ficha, no decidir nada.
  "priorizo",
  "enlazo",
  "evidencio",
] as const;

export type Verbo = (typeof VERBOS)[number];

export const SUJETOS = ["tarea", "columna", "categoria", "nodo", "entorno", "repositorio"] as const;

export type Sujeto = (typeof SUJETOS)[number];

/** De dónde salió: una persona, una regla del producto, o un agente por MCP. */
export type Procedencia = "persona" | "regla" | "agente";

export type Renglon = {
  workspaceId: string;
  /**
   * De qué organización es. OPCIONAL DESDE LA FUSIÓN DE LOS DOS CAMINOS: casi
   * siempre se anota algo de un espacio, y el espacio ya sabe de qué
   * organización es. Pedírsela a quien llama era una consulta más en cada sitio
   * y una ocasión más de pasarla mal; `org_of_workspace` la resuelve dentro del
   * mismo `insert`. Se sigue admitiendo cuando quien llama ya la tiene a mano,
   * para no ir a buscar lo que ya está.
   */
  organizationId?: string | null;
  /** Null solo para lo que escribe el producto solo, sin nadie detrás. */
  actorId: string | null;
  verbo: Verbo;
  sujeto: Sujeto;
  sujetoId?: string | null;
  /**
   * Cómo se llamaba la cosa en ese momento.
   *
   * Se copia y no se busca por `join` a propósito: si la tarea se borra, el
   * renglón tiene que seguir leyéndose. Un historial de «movió algo» no es un
   * historial.
   */
  sujetoNombre: string;
  detalle?: Record<string, unknown>;
  procedencia?: Procedencia;
};

/**
 * Escribe un renglón del registro.
 *
 * NUNCA TIRA LA OPERACIÓN QUE LO PROVOCÓ. Anotar que una tarea se movió es
 * menos importante que moverla: si esto fallara y se propagara, mover una
 * tarjeta empezaría a dar error por culpa del cuaderno que lleva la cuenta.
 *
 * Y POR ESO VA CON `SAVEPOINT`, que es la parte que no es evidente. `withUser`
 * abre una transacción de verdad, así que un `insert` que falla la deja
 * ABORTADA: a partir de ahí todo lo que venga detrás falla igual, y un
 * `try/catch` a secas no salva a nadie — daría la sensación de tragarse el
 * fallo mientras tumba la operación de todos modos. El punto de retorno
 * deshace solo este `insert` y deja la transacción utilizable.
 *
 * Va con la MISMA conexión que hizo el cambio, y por tanto dentro de su
 * transacción: si el cambio se deshace, el renglón que lo contaba se deshace
 * con él. Un registro que cuenta cosas que no llegaron a pasar es peor que no
 * tener registro.
 */
export async function anotar(db: Db, renglon: Renglon): Promise<void> {
  try {
    await db.query("savepoint anotar_actividad");
  } catch {
    // Sin punto de retorno no hay red: mejor no escribir que arriesgarse a
    // abortar la transacción de quien llama.
    return;
  }

  try {
    await db.query(
      `insert into activity
         (workspace_id, organization_id, actor_id, source, verb, subject_type, subject_id, subject_label, detail)
       values (
         $1,
         coalesce($2::uuid, public.org_of_workspace($1)),
         $3,$4::activity_source,$5,$6,$7,$8,$9::jsonb
       )`,
      [
        renglon.workspaceId,
        renglon.organizationId ?? null,
        renglon.actorId,
        renglon.procedencia ?? "persona",
        renglon.verbo,
        renglon.sujeto,
        renglon.sujetoId ?? null,
        renglon.sujetoNombre.slice(0, 200),
        JSON.stringify(renglon.detalle ?? {}),
      ],
    );
    await db.query("release savepoint anotar_actividad");
  } catch {
    // A propósito, y ver la cabecera: el cuaderno no puede tumbar el trabajo.
    await db.query("rollback to savepoint anotar_actividad").catch(() => {});
  }
}

/**
 * Cuántas tareas ha cerrado cada persona, y en cuánto tiempo.
 *
 * LLEGÓ DEL CAMINO B, PORTADA AL ESQUEMA QUE SE QUEDÓ. Las dos ramas
 * escribieron el registro de actividad a la vez con esquemas distintos, y este
 * cálculo venía escrito contra el otro —`ocurrido_en`, `verbo = 'tarea.cerrada'`,
 * `objeto_id`—. Se conserva porque es la única consulta del registro que
 * CALCULA algo en vez de contarlo, y por tanto la única que puede estar mal sin
 * devolver ningún error.
 *
 * LA MEDIANA Y NO LA MEDIA, a propósito: una tarea que alguien dejó abierta seis
 * meses no debe decidir la cifra de un trimestre entero.
 *
 * REABRIR Y VOLVER A CERRAR CUENTA DOS VECES, y las dos se miden desde que se
 * creó. Es lo correcto: la segunda vez la tarea llevaba abierta todo ese tiempo
 * de verdad.
 *
 * EL FILTRO POR `subject_type` NO ESTABA EN EL ORIGINAL Y AQUÍ HACE FALTA. Allí
 * el verbo llevaba espacio de nombres —`tarea.cerrada` solo podía ser de una
 * tarea— y aquí los verbos son sueltos: `cerro` a secas acabaría contando el
 * cierre de cualquier otra cosa que se anote mañana con ese mismo verbo.
 */
export type Cierre = { actorId: string; cerradas: number; diasMediana: number | null };

export async function cierresPorPersona(
  db: Db,
  filtro: { organizationId: string; dias: number; workspaceId?: string | null },
): Promise<Cierre[]> {
  const { rows } = await db.query<Cierre>(
    `with cerradas as (
       select c.actor_id,
              extract(epoch from (c.at - cr.creada)) / 86400 as dias
         from activity c
         join lateral (
           select min(a2.at) as creada
             from activity a2
            where a2.subject_id = c.subject_id
              and a2.subject_type = 'tarea'
              and a2.verb = 'creo'
         ) cr on cr.creada is not null
        where c.organization_id = $1
          and c.subject_type = 'tarea'
          and c.verb = 'cerro'
          and c.at > now() - ($2::int || ' days')::interval
          and ($3::uuid is null or c.workspace_id = $3)
          and c.actor_id is not null
     )
     select actor_id as "actorId",
            count(*)::int as cerradas,
            round((percentile_cont(0.5) within group (order by dias))::numeric, 1)::float8
              as "diasMediana"
       from cerradas
      group by actor_id`,
    [filtro.organizationId, filtro.dias, filtro.workspaceId ?? null],
  );
  return rows;
}

/**
 * Recorta un título para que quepa en una línea sin comerse el resto.
 *
 * También del camino B. Sigue haciendo falta: `subject_label` admite 200
 * caracteres, y un título que los use todos deja fuera la parte de la frase
 * —«de Por hacer a En curso»— que es justo la que explica qué pasó.
 */
export function recorta(texto: string, maximo = 60): string {
  const limpio = texto.trim();
  return limpio.length <= maximo ? limpio : `${limpio.slice(0, maximo - 1)}…`;
}
