import type { Db } from "../db/pool.js";

/**
 * Anotar en el registro de actividad.
 *
 * UNA SOLA PUERTA, A PROPÓSITO. Todo lo que quiera dejar rastro pasa por aquí
 * en vez de escribir su propio `insert`. Así el vocabulario de verbos vive en
 * un sitio —abajo— y no repartido por diez rutas que acaban escribiendo
 * `tarea.movida` y `task.moved` según quién lo tocara.
 *
 * NO LLEVA `try/catch`, Y ESO ES LA DECISIÓN. La tentación es envolverlo para
 * que un fallo al anotar no tumbe la acción; sería un error. `withUser` abre
 * una transacción, así que la anotación y el cambio que la provoca caen o se
 * confirman juntos: **o pasó y quedó anotado, o no pasó**. Tragarse el fallo
 * daría lo contrario —tareas movidas sin rastro— y un registro con agujeros es
 * peor que no tenerlo, porque nadie sabe cuáles faltan y las cifras de
 * participación se leen igual de confiadas.
 *
 * LA ORGANIZACIÓN SE DEDUCE. Casi siempre se anota algo de un espacio, y el
 * espacio ya sabe de qué organización es; pedirla al llamante sería una
 * consulta más y una oportunidad de pasarla mal. `org_of_workspace` lo resuelve
 * dentro del mismo `insert`.
 */

/** De dónde viene el hecho. Ver la 0038: el origen decide si una cifra de
 *  participación suma a una persona o a su agente. */
export type Origen = "persona" | "regla" | "agente";

/**
 * El vocabulario. Con espacio de nombres para que se pueda filtrar por familia
 * —«todo lo de tareas»— sin listar cada verbo.
 */
export type Verbo =
  | "tarea.creada"
  | "tarea.movida"
  | "tarea.cerrada"
  | "tarea.reabierta"
  | "tarea.asignada"
  | "tarea.reclasificada"
  | "tarea.borrada";

export type Anotacion = {
  /** Nulo para hechos de la organización que no cuelgan de un espacio. */
  workspaceId: string | null;
  /** Si se conoce, evita la deducción. Obligatoria cuando no hay espacio. */
  organizationId?: string | null;
  actorId: string | null;
  origen?: Origen;
  verbo: Verbo;
  objetoTipo: string;
  objetoId: string | null;
  /** La línea legible, con el nombre que la cosa tenía EN ESE MOMENTO. */
  resumen: string;
  datos?: Record<string, unknown>;
};

export async function anotar(db: Db, a: Anotacion): Promise<void> {
  await db.query(
    `insert into activity
       (organization_id, workspace_id, actor_id, origen,
        verbo, objeto_tipo, objeto_id, resumen, datos)
     values (
       coalesce($1::uuid, public.org_of_workspace($2)),
       $2, $3, $4::public.activity_origin, $5, $6, $7, $8, $9::jsonb
     )`,
    [
      a.organizationId ?? null,
      a.workspaceId,
      a.actorId,
      a.origen ?? "persona",
      a.verbo,
      a.objetoTipo,
      a.objetoId,
      // Se recorta en vez de fallar: perder el final de un resumen largo es
      // mucho menos grave que abortar la acción que lo generó.
      a.resumen.slice(0, 300),
      JSON.stringify(a.datos ?? {}),
    ],
  );
}

/**
 * Cuánto tarda en cerrarse lo que cierra cada uno, contado del registro.
 *
 * ESTO ES LO QUE `auditoria.ts` NO PODÍA CONTESTAR, y lo dice en su cabecera:
 * allí lo más cercano a «cuándo se terminó» es `updated_at`, que es cuándo se
 * tocó por última vez. Para una tarea movida a «hecho» y no tocada más
 * coinciden; para una editada después, no. Aquí las dos fechas son hechos con
 * su hora: cuándo se creó y cuándo se cerró.
 *
 * LA MEDIANA Y NO LA MEDIA. Una tarea que se quedó abierta cuatro meses —las
 * hay siempre— arrastra una media hasta volverla inútil; la mediana contesta
 * «lo normal», que es lo que se pregunta. Y viaja con su recuento al lado: una
 * mediana de dos casos no es un dato, es una anécdota, y sin el número nadie
 * puede saberlo.
 *
 * LO QUE DEJA FUERA, Y HAY QUE DECIRLO EN LA PANTALLA: una tarea sin
 * `tarea.creada` en el registro no se puede medir. Eso incluye todas las
 * anteriores a la 0038, así que durante las primeras semanas este número habla
 * solo de lo nuevo. Es preferible a estimarlo: un número honesto y parcial se
 * puede interpretar; uno inventado, no.
 *
 * REABRIR Y VOLVER A CERRAR CUENTA DOS VECES, y las dos se miden desde que se
 * creó. Es lo correcto: la segunda vez la tarea llevaba abierta todo ese
 * tiempo de verdad.
 *
 * VIVE AQUÍ Y NO EN LA RUTA para poder probarla sin levantar el servidor. Es
 * la única consulta del registro que CALCULA algo en vez de contarlo, así que
 * es también la única que puede estar mal sin devolver un error.
 */
export type Cierre = { actorId: string; cerradas: number; diasMediana: number | null };

export async function cierresPorPersona(
  db: Db,
  filtro: { organizationId: string; dias: number; workspaceId?: string | null },
): Promise<Cierre[]> {
  const { rows } = await db.query<Cierre>(
    `with cerradas as (
       select c.actor_id,
              extract(epoch from (c.ocurrido_en - cr.creada)) / 86400 as dias
         from activity c
         join lateral (
           select min(a2.ocurrido_en) as creada
             from activity a2
            where a2.objeto_id = c.objeto_id
              and a2.verbo = 'tarea.creada'
         ) cr on cr.creada is not null
        where c.organization_id = $1
          and c.verbo = 'tarea.cerrada'
          and c.ocurrido_en > now() - ($2::int || ' days')::interval
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
 * Recorta un título para meterlo en un resumen sin que se coma la línea.
 *
 * Los títulos llegan hasta 200 caracteres y el resumen cabe en 300; sin esto,
 * un título largo dejaría fuera el resto de la frase —«movió … de X a Y»— que
 * es justo la parte que explica qué pasó.
 */
export function recorta(texto: string, maximo = 60): string {
  const limpio = texto.trim();
  return limpio.length <= maximo ? limpio : `${limpio.slice(0, maximo - 1)}…`;
}
