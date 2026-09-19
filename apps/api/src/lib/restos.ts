import type { FastifyBaseLogger } from "fastify";
import { desalojarBase } from "../connectors/alojar.js";
import type { Db } from "../db/pool.js";
import { borrarReposDelEspacio } from "../git/almacen.js";
import { prefijoDeEspacio, prefijoDeOrganizacion } from "../storage/prefijos.js";
import { borrarPorPrefijo } from "../storage/s3.js";

/**
 * Lo que un espacio o una organización deja fuera de la base al borrarse.
 *
 * QUÉ PASABA. Borrar un espacio o una organización borra sus filas y la base
 * arrastra el resto en cascada. Pero tres cosas no viven en la base, y ninguna
 * cascada las alcanza:
 *
 *   · los **archivos** del almacén (`{org}/{espacio}/…` y `{org}/org-assets/…`);
 *   · la **base alojada** del espacio (0066): una base Postgres de verdad, con
 *     su rol y su contraseña, y los datos del cliente dentro;
 *   · los **repositorios alojados** (0068): carpetas en el disco del servidor,
 *     con el código entero.
 *
 * Las tres se quedaban vivas y sin ninguna fila que las nombrara. Se encontró
 * al escribir la política de datos, que tiene que poder decir qué se borra.
 *
 * EL ORDEN ES LA MITAD DEL ARREGLO:
 *
 *   1. `restosDe` se llama DENTRO de la transacción, ANTES del `delete`:
 *      después no queda ninguna fila de la que sacar qué había.
 *   2. `barrerRestos` se llama DESPUÉS de que la transacción confirme. Borrar
 *      el almacén dentro de ella no se puede deshacer: si la transacción
 *      fallara después, quedaría un espacio vivo sin sus archivos.
 *
 * Y `barrerRestos` NO LANZA. Cuando se llama, el borrado ya ocurrió; si lo que
 * falla es limpiar, contestar con un error haría creer que el espacio sigue ahí.
 * Lo que falle se escribe en el registro con lo necesario para repetirlo a mano.
 *
 * LO QUE NO ALCANZA, Y HAY QUE SABERLO. Las bases y repositorios alojados se
 * leen con la identidad de quien borra, y sus políticas piden
 * `can_access_workspace`. Al borrar una ORGANIZACIÓN, quien la borra no ve los
 * espacios personales de otras personas, así que sus bases y repositorios
 * alojados no se encuentran y se quedan. Los archivos sí se borran todos,
 * porque van por prefijo de organización. Cerrarlo del todo necesita una
 * función `security definer` que liste los restos de una organización para su
 * propietario: es una migración, y está pedida.
 */
export type Restos = {
  /** Prefijo del almacén que se borra entero. */
  prefijo: string;
  /** Espacios con una base alojada que desalojar. */
  espaciosConBase: string[];
  /** Espacios con repositorios alojados en disco. */
  espaciosConRepos: string[];
};

export async function restosDeEspacio(db: Db, workspaceId: string): Promise<Restos | null> {
  const { rows } = await db.query<{ organization_id: string }>(
    "select organization_id from workspaces where id = $1",
    [workspaceId],
  );
  const org = rows[0]?.organization_id;
  if (!org) return null;

  return {
    prefijo: prefijoDeEspacio(org, workspaceId),
    ...(await alojados(db, "workspace_id", workspaceId)),
  };
}

export async function restosDeOrganizacion(db: Db, organizationId: string): Promise<Restos> {
  return {
    prefijo: prefijoDeOrganizacion(organizationId),
    ...(await alojados(db, "organization_id", organizationId)),
  };
}

async function alojados(
  db: Db,
  columna: "workspace_id" | "organization_id",
  id: string,
): Promise<Pick<Restos, "espaciosConBase" | "espaciosConRepos">> {
  // `columna` no viene de fuera: son los dos literales del tipo de arriba.
  const [bases, repos] = await Promise.all([
    db.query<{ workspace_id: string }>(
      `select distinct workspace_id from hosted_databases where ${columna} = $1`,
      [id],
    ),
    db.query<{ workspace_id: string }>(
      `select distinct workspace_id from hosted_repos where ${columna} = $1`,
      [id],
    ),
  ]);
  return {
    espaciosConBase: bases.rows.map((r) => r.workspace_id),
    espaciosConRepos: repos.rows.map((r) => r.workspace_id),
  };
}

export async function barrerRestos(restos: Restos, log: FastifyBaseLogger): Promise<void> {
  try {
    const cuantos = await borrarPorPrefijo(restos.prefijo);
    if (cuantos > 0) log.info(`[restos] ${cuantos} archivo(s) de ${restos.prefijo} borrados`);
  } catch (error) {
    log.warn({ error, prefijo: restos.prefijo }, "[restos] no se pudieron borrar los archivos");
  }

  for (const espacio of restos.espaciosConBase) {
    try {
      await desalojarBase(espacio);
    } catch (error) {
      log.warn({ error, espacio }, "[restos] no se pudo desalojar la base alojada");
    }
  }

  for (const espacio of restos.espaciosConRepos) {
    try {
      await borrarReposDelEspacio(espacio);
    } catch (error) {
      log.warn({ error, espacio }, "[restos] no se pudieron borrar los repositorios alojados");
    }
  }
}
