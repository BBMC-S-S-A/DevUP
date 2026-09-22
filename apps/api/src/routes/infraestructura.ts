import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { fetchDespliegues } from "../connectors/despliegues.js";
import { dispararWorkflow, distanciaHastaLaRama } from "../connectors/github.js";
import { proveedorPara } from "../connectors/proveedores.js";
import { type Db, withUser } from "../db/pool.js";
import { badRequest, notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
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
  e.last_error as "lastError", e.created_at as "createdAt",
  e.provider_config as "providerConfig"`;

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

  app.get("/workspaces/:workspaceId/environments", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS}, ${ULTIMO}
           from environments e
          where e.workspace_id = $1
          order by
            -- Producción primero siempre. Es lo que se viene a mirar, y
            -- ordenar por nombre la escondería detrás de «desarrollo».
            case e.kind when 'production' then 0 when 'staging' then 1 else 2 end,
            e.name`,
        [workspaceId],
      );
      return { environments: rows };
    });
  });

  /**
   * ¿QUÉ ESTÁ CORRIENDO AHÍ, Y VA POR DETRÁS? (ARQ-04)
   *
   * Se le pregunta al entorno, no a una tabla. DevUP no despliega estos
   * entornos —esa es la decisión de este archivo— así que lo único que sabe de
   * verdad es lo que el propio servicio conteste en su `/health`. Una columna
   * en la base diría lo que DevUP CREE que se desplegó, que es exactamente el
   * dato que se queda viejo sin avisar.
   *
   * NO ES AUTOMÁTICA. Cada llamada sale a internet una vez por entorno y otra
   * a GitHub: pedirla sola en cada visita a la pantalla gastaría cupo por
   * nada. La pide quien quiere saberlo.
   *
   * CADA ENTORNO FALLA POR SU CUENTA. Uno caído, o uno cuya URL es la de la web
   * y no la de la API, no puede tumbar la respuesta de los demás: eso deja la
   * pantalla en blanco justo cuando más falta hace.
   */
  app.get("/workspaces/:workspaceId/environments/version", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);

    const { entornos, repo } = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ id: string; name: string; url: string | null }>(
        "select id, name, url from environments where workspace_id = $1 order by name",
        [workspaceId],
      );
      // Con qué rama se compara: el primer repositorio del espacio. Si no hay
      // ninguno se contesta igual con lo que corre, sin la comparación.
      const { rows: repos } = await db.query<{ full_name: string; connection_id: string | null }>(
        "select full_name, connection_id from github_repos where workspace_id = $1 order by created_at limit 1",
        [workspaceId],
      );
      const r = repos[0];
      return {
        entornos: rows,
        repo: r
          ? {
              fullName: r.full_name,
              token: r.connection_id ? await getDecryptedSecret(db, r.connection_id) : null,
            }
          : null,
      };
    });

    const versiones = await Promise.all(
      entornos.map(async (entorno) => {
        if (!entorno.url) {
          return { id: entorno.id, name: entorno.name, estado: "sin-url" as const };
        }
        let salud: { commit?: unknown; commitCorto?: unknown; entorno?: unknown; region?: unknown };
        try {
          const respuesta = await fetch(`${entorno.url.replace(/\/$/, "")}/health`, {
            signal: AbortSignal.timeout(8000),
            headers: { accept: "application/json" },
          });
          if (!respuesta.ok) throw new Error(String(respuesta.status));
          salud = (await respuesta.json()) as typeof salud;
        } catch {
          // Caído, o su URL no es la de una API de DevUP. Las dos cosas se
          // cuentan igual: no contestó.
          return { id: entorno.id, name: entorno.name, estado: "no-contesta" as const };
        }

        const commit = typeof salud.commit === "string" ? salud.commit : null;
        if (!commit) {
          // Contesta, pero es una versión anterior a esto, o no lo sabe.
          return {
            id: entorno.id,
            name: entorno.name,
            estado: "sin-commit" as const,
            region: typeof salud.region === "string" ? salud.region : null,
          };
        }

        let distancia = null;
        if (repo) {
          distancia = await distanciaHastaLaRama(repo.token, repo.fullName, commit).catch(() => null);
        }

        return {
          id: entorno.id,
          name: entorno.name,
          estado: "responde" as const,
          commit,
          commitCorto: typeof salud.commitCorto === "string" ? salud.commitCorto : commit.slice(0, 7),
          entornoQueDice: typeof salud.entorno === "string" ? salud.entorno : null,
          region: typeof salud.region === "string" ? salud.region : null,
          distancia,
        };
      }),
    );

    return { versiones, repositorio: repo?.fullName ?? null };
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
  app.post("/workspaces/:workspaceId/environments", async (request, reply) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
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
      // `organization_id` se sigue rellenando aunque ya no mande: la columna
      // no se puede borrar —una migración solo añade— y dejarla vacía haría
      // que cualquier consulta vieja devolviera menos de lo que hay.
      const { rows } = await db.query<{ id: string }>(
        `insert into environments
           (workspace_id, organization_id, name, kind, url, connection_id, external_id, created_by)
         values ($1,(select organization_id from workspaces where id = $1),
                 $2,$3::environment_kind,$4,$5,$6,$7) returning id`,
        [
          workspaceId,
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

  /**
   * Configurar CÓMO se llega a este entorno para poder actuar sobre él
   * (0063) — no solo mirarlo. `providerConfig` es de forma libre a propósito
   * (ver connectors/proveedores.ts): lo que pide Railway no se parece a lo
   * que pediría otro proveedor.
   */
  app.patch("/environments/:envId", async (request) => {
    const userId = requireUser(request);
    const { envId } = parseParams(z.object({ envId: uuid }), request.params);
    const body = parseBody(
      z.object({
        connectionId: uuid.nullable().optional(),
        providerConfig: z.record(z.string(), z.unknown()).optional(),
      }),
      request.body,
    );

    await withUser(userId, async (db) => {
      const { rowCount } = await db.query(
        `update environments set
           connection_id = coalesce($2, connection_id),
           provider_config = coalesce($3::jsonb, provider_config)
         where id = $1`,
        [envId, body.connectionId, body.providerConfig ? JSON.stringify(body.providerConfig) : null],
      );
      if (!rowCount) throw notFound("entorno no encontrado");
    });

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS}, ${ULTIMO} from environments e where e.id = $1`,
        [envId],
      );
      return { environment: rows[0] };
    });
  });

  /**
   * Desplegar de verdad, contra el proveedor que tenga conectado el entorno.
   *
   * QUÉ NO ES ESTO. No espera a que termine — Railway (y cualquier otro
   * proveedor real) tarda minutos en construir e implantar, y una petición
   * HTTP no se deja abierta ese tiempo. Dispara y devuelve; el estado se
   * entera por `sync`, igual que ya hacía antes de esto.
   */
  app.post("/environments/:envId/deploy", async (request) => {
    const userId = requireUser(request);
    const { envId } = parseParams(z.object({ envId: uuid }), request.params);

    const resultado = await withUser(userId, async (db) => {
      const { rows } = await db.query<{
        connection_id: string | null;
        provider_config: unknown;
        provider: string | null;
      }>(
        `select e.connection_id, e.provider_config, c.provider::text as provider
           from environments e
           left join connections c on c.id = e.connection_id
          where e.id = $1`,
        [envId],
      );
      const fila = rows[0];
      if (!fila) throw notFound("entorno no encontrado");
      if (!fila.connection_id || !fila.provider) {
        throw badRequest("este entorno no tiene un proveedor de despliegue conectado");
      }

      const proveedor = proveedorPara(fila.provider);
      if (!proveedor) {
        throw badRequest(`«${fila.provider}» no es un proveedor de despliegue — solo lectura`);
      }

      const token = await getDecryptedSecret(db, fila.connection_id);
      return proveedor.desplegar(fila.provider_config, token);
    });

    return resultado;
  });

  /**
   * Migrar de verdad, disparando el mismo workflow de GitHub Actions que ya
   * migra con respaldo y verificación (ver `.github/workflows/desplegar.yml`,
   * job `migrar`) — no un camino nuevo. Vive en `providerConfig.migracion`,
   * separado de la config del proveedor de despliegue: son dos conexiones
   * distintas (Railway para desplegar, GitHub para migrar) y no siempre
   * coinciden en la misma.
   */
  app.post("/environments/:envId/migrate", async (request) => {
    const userId = requireUser(request);
    const { envId } = parseParams(z.object({ envId: uuid }), request.params);

    await withUser(userId, async (db) => {
      const { rows } = await db.query<{ provider_config: unknown }>(
        "select provider_config from environments where id = $1",
        [envId],
      );
      const fila = rows[0];
      if (!fila) throw notFound("entorno no encontrado");

      const migracion = (fila.provider_config as { migracion?: Record<string, unknown> } | null)
        ?.migracion;
      const config = z
        .object({
          githubConnectionId: uuid,
          fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
          workflow: z.string().min(1).max(200),
          ref: z.string().min(1).max(200).default("claude/sales-control-workspace-platform-i99syv"),
        })
        .safeParse(migracion);

      if (!config.success) {
        throw badRequest(
          "este entorno no tiene configurada la migración — hace falta providerConfig.migracion " +
            "con githubConnectionId, fullName y workflow",
        );
      }

      const token = await getDecryptedSecret(db, config.data.githubConnectionId);
      await dispararWorkflow(token, config.data.fullName, config.data.workflow, config.data.ref);
    });

    return { ok: true, mensaje: "Migración disparada — sigue su curso en GitHub Actions." };
  });
}
