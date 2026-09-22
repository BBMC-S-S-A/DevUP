import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { alojarBase, desalojarBase } from "../connectors/alojar.js";
import { ejecutarSQL, listarTablas } from "../connectors/basedatos.js";
import { esConfigRailway, variablesDeRailway } from "../connectors/proveedores.js";
import { type Db, withUser } from "../db/pool.js";
import { badGateway, badRequest, forbidden, parseBody, parseParams, requireUser } from "../lib/http.js";
import { encryptSecret } from "../security/vault.js";
import { conexionVigente, getDecryptedSecret } from "./connections.js";

const uuid = z.string().uuid();

/** Los nombres bajo los que Railway suele guardar la cadena de una Postgres. */
const VARIABLES_DE_CONEXION = ["DATABASE_URL", "DATABASE_PUBLIC_URL", "POSTGRES_URL"];

/**
 * La consola SQL pide MANDO sobre el espacio, no solo pertenecer (BD-06).
 *
 * POR QUÉ HACE FALTA ESCRIBIRLO AQUÍ, si en este archivo el argumento repetido
 * es el contrario —que la autorización la lleven las políticas—. Porque aquí
 * NO hay ninguna política que la lleve: la consola no consulta una tabla de
 * DevUP, abre una conexión a la base de OTRO servidor. Lo único que RLS decide
 * es si esta persona puede descifrar la credencial, y eso lo puede cualquier
 * miembro del espacio. O sea que sin esta línea, cualquiera que entre al
 * proyecto podía lanzar un `drop` contra la base de producción del cliente.
 *
 * Va aparte de la lectura de tablas a propósito: mirar qué tablas hay es parte
 * de entender el proyecto y lo puede hacer cualquiera del equipo. Escribir
 * SQL a mano contra la base de un cliente, no.
 */
async function exigirMando(db: Db, workspaceId: string): Promise<void> {
  const { rows } = await db.query<{ puede: boolean }>(
    "select public.can_manage_workspace($1) as puede",
    [workspaceId],
  );
  if (!rows[0]?.puede) {
    throw forbidden(
      "la consola SQL es de quien administra el espacio: habla con quien lo creó o con un administrador de la organización",
    );
  }
}

/**
 * Administrar la base de datos propia de un workspace: tablas y SQL de
 * verdad, no solo el criterio de las migraciones (esa pantalla se queda,
 * vive en `github.ts`, ruta `/migraciones`).
 *
 * DOS FORMAS DE LLEGAR A LA CADENA DE CONEXIÓN, EN ESTE ORDEN:
 *
 * 1. Un secreto `postgres` pegado a mano — sigue existiendo para quien no
 *    despliega en Railway, o quiere apuntar a una base distinta de la que
 *    usa su propio servicio.
 * 2. SI NO HAY UNO, se busca sola: un entorno de este workspace que ya tiene
 *    configurado un servicio de Railway (0063, para desplegar) es también el
 *    servicio que ya tiene su propia `DATABASE_URL` puesta por Railway. Pedir
 *    que se pegue otra vez a mano, cuando Railway ya la tiene, es pedir un
 *    paso que no hace falta — y es exactamente lo que se pidió arreglar.
 */
async function conexionDeBase(
  db: Db,
  workspaceId: string,
): Promise<{ connectionString: string }> {
  // La VIGENTE, no la primera que hubo: si a alguien le rotan la contraseña de
  // su Postgres y la vuelve a pegar, tiene que valer la nueva. Ver
  // `conexionVigente`, que es donde está contado el fallo que esto arregla.
  const connectionId = await conexionVigente(db, workspaceId, "postgres");
  if (connectionId) {
    return { connectionString: await getDecryptedSecret(db, connectionId) };
  }

  const { rows: entornos } = await db.query<{
    provider_config: { railway?: unknown };
    connection_id: string;
  }>(
    `select e.provider_config, c.id as connection_id
       from environments e
       join connections c on c.id = e.connection_id and c.provider = 'railway'
      where e.workspace_id = $1 and e.provider_config ? 'railway'
      order by e.created_at limit 1`,
    [workspaceId],
  );
  const entorno = entornos[0];
  const configRailway = entorno?.provider_config.railway;
  if (!entorno || !esConfigRailway(configRailway)) {
    throw badRequest(
      "este workspace no tiene ninguna base de datos conectada todavía — conecta una en " +
        "Base de datos, o configura Railway en un entorno de Infraestructura",
    );
  }

  const token = await getDecryptedSecret(db, entorno.connection_id);
  let variables: Record<string, string>;
  try {
    variables = await variablesDeRailway(token, configRailway);
  } catch (error) {
    throw badGateway(
      error instanceof Error
        ? `no se pudo leer las variables de Railway: ${error.message}`
        : "no se pudo leer las variables de Railway",
    );
  }

  const nombreEncontrado = VARIABLES_DE_CONEXION.find((n) => variables[n]);
  const connectionString = nombreEncontrado ? variables[nombreEncontrado] : undefined;
  if (!connectionString) {
    throw badRequest(
      "el servicio de Railway conectado a este workspace no tiene una DATABASE_URL — " +
        "revisa las variables de ese servicio en Railway, o conecta una base a mano en Base de datos",
    );
  }
  return { connectionString };
}

export async function basedatosRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/workspaces/:workspaceId/database/tables", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);

    return withUser(userId, async (db) => {
      const { connectionString } = await conexionDeBase(db, workspaceId);
      try {
        return { tables: await listarTablas(connectionString) };
      } catch (error) {
        throw badGateway(
          error instanceof Error ? `no se pudo leer la base: ${error.message}` : "no se pudo leer la base",
        );
      }
    });
  });

  /**
   * La consola SQL. DOS CERROJOS, y están en dos sitios distintos a propósito:
   * quién puede abrirla se decide aquí (`exigirMando`), y qué puede hacer
   * dentro lo decide el conector, que la corre en una transacción de solo
   * lectura. Ver el porqué de cada uno en su sitio.
   *
   * SIN LÍMITE DE PETICIONES PROPIO A PROPÓSITO: ya hay que administrar el
   * espacio para llegar hasta aquí, y una consola que además recorta por
   * frecuencia sorprendería a quien está en medio de depurar algo de verdad.
   * El otro límite que importa es el `statement_timeout` del conector.
   */
  app.post("/workspaces/:workspaceId/database/query", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const { sql } = parseBody(z.object({ sql: z.string().trim().min(1).max(20_000) }), request.body);

    return withUser(userId, async (db) => {
      await exigirMando(db, workspaceId);
      const { connectionString } = await conexionDeBase(db, workspaceId);
      try {
        return await ejecutarSQL(connectionString, sql);
      } catch (error) {
        // El mensaje de Postgres se devuelve tal cual — "syntax error at or
        // near…", "relation … does not exist" — es exactamente lo que
        // alguien necesita leer para corregir su propia consulta.
        throw badGateway(error instanceof Error ? error.message : "la consulta falló");
      }
    });
  });

  /** Si este espacio tiene una base alojada por DevUP, y cuál. */
  app.get("/workspaces/:workspaceId/database/alojada", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ dbName: string; creadaEn: string }>(
        `select db_name as "dbName", created_at as "creadaEn"
           from hosted_databases where workspace_id = $1`,
        [workspaceId],
      );
      return { alojada: rows[0] ?? null };
    });
  });

  /**
   * Alojar una base de datos de verdad para este espacio (0066).
   *
   * EL ORDEN ES A PROPÓSITO: primero se crea en Postgres y después se anota.
   * Al revés —anotar y luego crear— dejaría una fila diciendo que existe una
   * base que no existe, y la pantalla mandaría a la gente a una conexión
   * muerta. Así el peor caso es el contrario: una base creada y sin anotar,
   * que se arregla sola porque `alojarBase` reutiliza lo que ya está y vuelve
   * a dar una contraseña que funciona.
   *
   * QUIÉN PUEDE es cosa de la política de `hosted_databases`, que pide mando
   * sobre el espacio: el `insert` de abajo falla solo si no lo tiene. No se
   * comprueba aquí además, porque dos comprobaciones del mismo permiso en dos
   * sitios distintos acaban discrepando.
   */
  app.post("/workspaces/:workspaceId/database/alojar", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);

    const yaHay = await withUser(userId, async (db) => {
      const { rows } = await db.query("select 1 from hosted_databases where workspace_id = $1", [
        workspaceId,
      ]);
      return rows.length > 0;
    });
    if (yaHay) throw badRequest("este espacio ya tiene una base alojada");

    let alojamiento;
    try {
      alojamiento = await alojarBase(workspaceId);
    } catch (error) {
      throw badGateway(
        error instanceof Error ? `no se pudo alojar: ${error.message}` : "no se pudo alojar",
      );
    }

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into connections (provider, workspace_id, display_name, created_by)
         values ('postgres', $1, 'Base alojada en DevUP', $2) returning id`,
        [workspaceId, userId],
      );
      const connectionId = rows[0]!.id;
      await db.query(
        "insert into connection_secrets (connection_id, encrypted_secret) values ($1,$2)",
        [connectionId, encryptSecret(alojamiento.connectionString)],
      );
      await db.query(
        `insert into hosted_databases
           (workspace_id, organization_id, db_name, role_name, connection_id, created_by)
         values ($1,(select organization_id from workspaces where id = $1),$2,$3,$4,$5)`,
        [workspaceId, alojamiento.dbName, alojamiento.roleName, connectionId, userId],
      );
      // La cadena se devuelve UNA vez, al crearla, y no se vuelve a servir
      // nunca: a partir de aquí vive cifrada en la bóveda como cualquier otra
      // credencial, y ninguna ruta la devuelve.
      return { dbName: alojamiento.dbName, connectionString: alojamiento.connectionString };
    });
  });

  /**
   * Desalojar: borra la base y su rol, de verdad y sin vuelta atrás.
   *
   * SE BORRA LA FILA PRIMERO, DENTRO DE LA TRANSACCIÓN, y solo si esa parte
   * sale bien se tira la base. Así quien no tiene mando sobre el espacio choca
   * con la política de RLS ANTES de que nada se haya destruido — la política
   * es la única autorización, y tiene que correr antes del destrozo, no
   * después.
   */
  app.delete("/workspaces/:workspaceId/database/alojada", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);

    const borrada = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ connectionId: string | null }>(
        `delete from hosted_databases where workspace_id = $1
          returning connection_id as "connectionId"`,
        [workspaceId],
      );
      const fila = rows[0];
      if (!fila) return false;
      if (fila.connectionId) {
        await db.query("delete from connections where id = $1", [fila.connectionId]);
      }
      return true;
    });

    if (!borrada) throw badRequest("este espacio no tiene ninguna base alojada");

    try {
      await desalojarBase(workspaceId);
    } catch (error) {
      throw badGateway(
        error instanceof Error ? `no se pudo desalojar: ${error.message}` : "no se pudo desalojar",
      );
    }
    return { desalojada: true };
  });
}
