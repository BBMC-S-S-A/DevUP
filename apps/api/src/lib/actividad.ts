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
] as const;

export type Verbo = (typeof VERBOS)[number];

export const SUJETOS = ["tarea", "columna", "categoria", "nodo", "entorno", "repositorio"] as const;

export type Sujeto = (typeof SUJETOS)[number];

/** De dónde salió: una persona, una regla del producto, o un agente por MCP. */
export type Procedencia = "persona" | "regla" | "agente";

export type Renglon = {
  workspaceId: string;
  organizationId: string;
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
       values ($1,$2,$3,$4::activity_source,$5,$6,$7,$8,$9::jsonb)`,
      [
        renglon.workspaceId,
        renglon.organizationId,
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
