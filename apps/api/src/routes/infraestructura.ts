import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { fetchDespliegues } from "../connectors/despliegues.js";
import { type Db, withUser } from "../db/pool.js";
import { notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
import { getDecryptedSecret } from "./connections.js";

/**
 * Entornos y despliegues: la vista unificada de infraestructura.
 *
 * QUÉ HACE Y QUÉ NO. No despliega nada y no guarda cómo se despliega: pregunta
 * al proveedor, traduce lo que cuenta y lo enseña. Es la decisión cerrada de la
 * propuesta —orquestar en vez de competir con los proveedores en su terreno— y
 * también lo que mantiene esta ruta pequeña.
 *
 * UN ENTORNO PUEDE NO TENER PROVEEDOR. Alguien que despliega por SSH tiene
 * derecho a que producción salga en la pantalla igual, aunque su estado lo
 * escriba a mano nadie. Por eso `connectionId` y `externalId` son opcionales, y
 * sincronizar un entorno sin ellos no es un error: es que no hay a quién
 * preguntar.
 */

const uuid = z.string().uuid();
const FULL_NAME = /^[\w.-]+\/[\w.-]+$/;

const COLUMNAS = `
  e.id, e.name, e.kind, e.url, e.external_id as "externalId",
  e.connection_id as "connectionId", e.synced_at as "syncedAt",
  e.last_error as "lastError", e.created_at as "createdAt"`;

/** El último despliegue de cada entorno, que es lo que se enseña en la tarjeta. */
const ULTIMO = `
  (select json_build_object(
            'id', d.id, 'state', d.state, 'commitSha', d.commit_sha,
            'commitMessage', d.commit_message, 'author', d.author,
            'logUrl', d.log_url, 'startedAt', d.started_at, 'finishedAt', d.finished_at)
     from deployments d
    where d.environment_id = e.id
    order by d.started_at desc nulls last
    limit 1) as "ultimo"`;

/**
 * El identificador externo es «owner/repo:entorno-de-github».
 *
 * Dos partes y no una porque un mismo repositorio publica a varios entornos, y
 * un mismo entorno nuestro tiene que saber a cuál de ellos mirar. Se guarda
 * junto en una columna, en vez de en dos, porque la mitad de los proveedores
 * que vengan después no tendrán esta forma y una columna de texto opaca envejece
 * mejor que dos columnas que solo valen para GitHub.
 */
function partirExternalId(externalId: string): { fullName: string; entorno: string } | null {
  const corte = externalId.lastIndexOf(":");
  if (corte <= 0) return null;
  const fullName = externalId.slice(0, corte);
  const entorno = externalId.slice(corte + 1);
  if (!FULL_NAME.test(fullName) || !entorno) return null;
  return { fullName, entorno };
}

/**
 * Pregunta al proveedor y guarda lo que diga.
 *
 * Anota el fallo en el propio entorno en vez de tirar la petición, por el mismo
 * motivo que en el conector de GitHub: una pantalla que lleva vacía desde que
 * se conectó algo y no dice por qué es peor que una que enseña el error.
 */
export async function sincronizarEntorno(
  db: Db,
  entorno: { id: string; externalId: string | null; connectionId: string | null },
): Promise<void> {
  if (!entorno.externalId || !entorno.connectionId) {
    await db.query("select public.mark_environment_synced($1, null)", [entorno.id]);
    return;
  }

  const partes = partirExternalId(entorno.externalId);
  if (!partes) {
    await db.query("select public.mark_environment_synced($1, $2)", [
      entorno.id,
      "El identificador del proveedor no tiene la forma «organización/repositorio:entorno».",
    ]);
    return;
  }

  try {
    const token = await getDecryptedSecret(db, entorno.connectionId);
    const remotos = await fetchDespliegues(token, partes.fullName);
    // Solo los del entorno que pide esta fila: un repositorio publica a
    // producción y a staging por el mismo sitio, y mezclarlos haría que
    // «producción» enseñara el despliegue de otra cosa.
    const suyos = remotos.filter((d) => d.entorno === partes.entorno);

    for (const d of suyos) {
      await db.query(
        `select public.upsert_deployment($1,$2,$3::deployment_state,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz)`,
        [
          entorno.id,
          d.externalId,
          d.estado,
          d.commitSha,
          d.commitMessage,
          d.author,
          d.logUrl,
          d.startedAt,
          d.finishedAt,
        ],
      );
    }

    // La dirección publicada la dice el propio despliegue, así que si el
    // entorno no la tenía puesta a mano se aprende sola.
    const conUrl = suyos.find((d) => d.url);
    if (conUrl?.url) {
      await db.query("update environments set url = coalesce(url, $2) where id = $1", [
        entorno.id,
        conUrl.url,
      ]);
    }

    await db.query("select public.mark_environment_synced($1, null)", [entorno.id]);
  } catch (error) {
    await db.query("select public.mark_environment_synced($1, $2)", [
      entorno.id,
      error instanceof Error ? error.message : "fallo desconocido al sincronizar",
    ]);
  }
}

export async function infraestructuraRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/organizations/:orgId/environments", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS}, ${ULTIMO}
           from environments e
          where e.organization_id = $1
          order by
            -- Producción primero siempre. Es lo que se viene a mirar, y
            -- ordenar por nombre la escondería detrás de «desarrollo».
            case e.kind when 'production' then 0 when 'staging' then 1 else 2 end,
            e.name`,
        [orgId],
      );
      return { environments: rows };
    });
  });

  app.get("/environments/:envId/deployments", async (request) => {
    const userId = requireUser(request);
    const { envId } = parseParams(z.object({ envId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select id, state, commit_sha as "commitSha", commit_message as "commitMessage",
                author, log_url as "logUrl", started_at as "startedAt",
                finished_at as "finishedAt"
           from deployments
          where environment_id = $1
          order by started_at desc nulls last
          limit 30`,
        [envId],
      );
      return { deployments: rows };
    });
  });

  /**
   * Crear un entorno sincroniza en la misma petición, igual que añadir un
   * repositorio hace su primera lectura: esperar al siguiente ciclo dejaría la
   * tarjeta vacía justo cuando más se está mirando.
   */
  app.post("/organizations/:orgId/environments", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(60),
        kind: z.enum(["production", "staging", "preview"]).default("production"),
        url: z.string().url().optional(),
        connectionId: uuid.optional(),
        externalId: z.string().trim().min(3).max(260).optional(),
      }),
      request.body,
    );

    const creado = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into environments (organization_id, name, kind, url, connection_id, external_id, created_by)
         values ($1,$2,$3::environment_kind,$4,$5,$6,$7) returning id`,
        [
          orgId,
          body.name,
          body.kind,
          body.url ?? null,
          body.connectionId ?? null,
          body.externalId ?? null,
          userId,
        ],
      );
      return rows[0]!.id;
    });

    await withUser(userId, (db) =>
      sincronizarEntorno(db, {
        id: creado,
        externalId: body.externalId ?? null,
        connectionId: body.connectionId ?? null,
      }),
    );

    const entorno = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS}, ${ULTIMO} from environments e where e.id = $1`,
        [creado],
      );
      return rows[0];
    });

    return reply.status(201).send({ environment: entorno });
  });

  app.post("/environments/:envId/sync", async (request) => {
    const userId = requireUser(request);
    const { envId } = parseParams(z.object({ envId: uuid }), request.params);

    await withUser(userId, async (db) => {
      const { rows } = await db.query<{
        id: string;
        external_id: string | null;
        connection_id: string | null;
      }>("select id, external_id, connection_id from environments where id = $1", [envId]);
      const fila = rows[0];
      if (!fila) throw notFound("entorno no encontrado");
      await sincronizarEntorno(db, {
        id: fila.id,
        externalId: fila.external_id,
        connectionId: fila.connection_id,
      });
    });

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS}, ${ULTIMO} from environments e where e.id = $1`,
        [envId],
      );
      return { environment: rows[0] };
    });
  });

  app.delete("/environments/:envId", async (request, reply) => {
    const userId = requireUser(request);
    const { envId } = parseParams(z.object({ envId: uuid }), request.params);
    await withUser(userId, async (db) => {
      const { rowCount } = await db.query("delete from environments where id = $1", [envId]);
      // Cero filas con RLS no es «no existe», es «no te deja». Se responde lo
      // mismo a propósito: distinguirlos le diría a quien prueba identificadores
      // cuáles existen en organizaciones ajenas.
      if (!rowCount) throw notFound("entorno no encontrado");
    });
    return reply.status(204).send();
  });
}
