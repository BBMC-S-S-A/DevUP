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
