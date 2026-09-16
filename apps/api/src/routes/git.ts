/**
 * Servir git por HTTP: `git clone`, `git fetch` y `git push` contra DevUP.
 *
 * ESTAS RUTAS NO LAS ABRE UN NAVEGADOR, LAS ABRE EL PROGRAMA `git`. Eso cambia
 * todo lo que normalmente se da por supuesto en este archivo de rutas:
 *
 *   · NO HAY SESIÓN NI COOKIES. `git` manda usuario y contraseña por
 *     `Authorization: Basic`, que es lo único que sabe hacer. Por eso este
 *     archivo NO registra `requireSession` y resuelve la identidad él mismo, a
 *     partir de una contraseña de git (0068).
 *   · NO HAY JSON. El cuerpo es binario, a veces comprimido con gzip, y hay que
 *     pasárselo a git sin tocarlo. De ahí el analizador de contenido de abajo.
 *   · LOS ERRORES SE DAN EN EL IDIOMA DE GIT. Un 401 tiene que traer
 *     `WWW-Authenticate`, o el cliente no pide credenciales: se rinde diciendo
 *     «authentication failed» sin haber preguntado nada.
 *
 * LA AUTORIZACIÓN LA DECIDE RLS, NO ESTE ARCHIVO. La contraseña se traduce a
 * persona con `git_token_owner`, y a partir de ahí se consulta `hosted_repos`
 * con esa identidad puesta: si las políticas no la dejan ver la fila, el
 * repositorio «no existe». Escribir aquí otra comprobación de pertenencia sería
 * tener el permiso en dos sitios, y dos sitios acaban discrepando.
 *
 * UNA COSA QUE NO HACE: distinguir leer de escribir. En DevUP, quien llega a un
 * espacio puede crear tareas, subir archivos y mover el tablero; que además
 * pueda empujar al repositorio es la misma frontera, no una más ancha. Crear y
 * borrar repositorios sí piden mando, y eso está en las políticas de 0068.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withUser } from "../db/pool.js";
import {
  esServicio,
  escribe,
  anunciarRefs,
  atenderServicio,
  protocoloPedido,
  type Servicio,
} from "../git/protocolo.js";
import { existeRepo, rutaDelRepo, tamanoDelRepo } from "../git/almacen.js";
import { parseParams } from "../lib/http.js";

const uuid = z.string().uuid();

/** Mismo hash que usa la creación de la contraseña. Ver `repos.ts`. */
export function hashDeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Pide credenciales como las pide un servidor de git.
 *
 * SIN `WWW-Authenticate` NO HAY DIÁLOGO. El cliente de git solo pregunta por
 * usuario y contraseña cuando el 401 las pide explícitamente; sin esa cabecera
 * aborta con «authentication failed» sin haber preguntado, y quien lo sufre
 * cree que su contraseña está mal cuando en realidad nunca llegó a escribirla.
 */
function pedirCredenciales(reply: FastifyReply): FastifyReply {
  return reply
    .header("WWW-Authenticate", 'Basic realm="DevUP"')
    .header("content-type", "text/plain; charset=utf-8")
    .status(401)
    .send("hace falta una contraseña de git de DevUP\n");
}

type Identidad = { userId: string; repoId: string; ruta: string; slug: string; workspaceId: string };

/**
 * Traduce lo que trae la petición a «quién eres y a qué repositorio».
 *
 * Devuelve null si falta la credencial (hay que pedirla) y `false` si el
 * repositorio no existe PARA ESA PERSONA — que es lo mismo que no existir. Se
 * contesta 404 y no 403 a propósito: decir «existe pero no es tuyo» delata que
 * un equipo tiene un repositorio con ese nombre.
 */
async function identificar(
  request: FastifyRequest,
  workspaceId: string,
  slug: string,
): Promise<Identidad | null | false> {
  const cabecera = request.headers.authorization;
  if (!cabecera?.toLowerCase().startsWith("basic ")) return null;

  const descifrado = Buffer.from(cabecera.slice(6), "base64").toString("utf8");
  // El usuario se ignora: git siempre manda uno, y obligar a que coincida con
  // el correo solo añade una forma más de que falle sin decir por qué. Lo que
  // autentica es la contraseña.
  const separador = descifrado.indexOf(":");
  const contrasena = separador === -1 ? descifrado : descifrado.slice(separador + 1);
  if (!contrasena) return null;

  const hash = hashDeToken(contrasena);
  const userId = await withUser(null, async (db) => {
    const { rows } = await db.query<{ git_token_owner: string | null }>(
      "select public.git_token_owner($1)",
      [hash],
    );
    return rows[0]?.git_token_owner ?? null;
  });
  if (!userId) return null;

  // Con la identidad puesta: si RLS no deja ver la fila, no existe.
  const repo = await withUser(userId, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      "select id from hosted_repos where workspace_id = $1 and slug = $2",
      [workspaceId, slug],
    );
    return rows[0] ?? null;
  });
  if (!repo) return false;

  // Se marca aquí, cuando la contraseña acaba de demostrar que vale.
  await withUser(null, (db) => db.query("select public.git_token_usada($1)", [hash]));

  return { userId, repoId: repo.id, ruta: rutaDelRepo(workspaceId, slug), slug, workspaceId };
}

/** Después de un push, apuntar cuánto ocupa y cuándo fue. */
async function anotarPush(id: Identidad): Promise<void> {
  try {
    const bytes = await tamanoDelRepo(id.workspaceId, id.slug);
    await withUser(id.userId, (db) =>
      db.query("update hosted_repos set size_bytes = $1, pushed_at = now() where id = $2", [
        bytes,
        id.repoId,
      ]),
    );
  } catch {
    // El push ya funcionó y los objetos están en disco. Que la contabilidad
    // falle no puede convertir eso en un error para quien empujó.
  }
}

export async function gitRoutes(app: FastifyInstance): Promise<void> {
  /**
   * El cuerpo, tal cual. Sin esto Fastify intenta interpretarlo —y no es
   * JSON—, o lo consume antes de que podamos dárselo a git. Se le pasa el
   * flujo sin leerlo: los paquetes de un `push` grande no tienen por qué caber
   * en memoria.
   */
  for (const tipo of [
    "application/x-git-upload-pack-request",
    "application/x-git-receive-pack-request",
  ]) {
    app.addContentTypeParser(tipo, (_request, payload, done) => done(null, payload));
  }

  const rutaParams = z.object({
    workspaceId: uuid,
    // El nombre se valida aquí y otra vez en `rutaDelRepo`. Ver el porqué en
    // la cabecera de `almacen.ts`.
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/),
  });

  /**
   * El anuncio: qué tiene el servidor. Primera petición de todo clon o empuje.
   */
  app.get("/git/:workspaceId/:slug.git/info/refs", async (request, reply) => {
    const { workspaceId, slug } = parseParams(rutaParams, request.params);
    const servicio = (request.query as { service?: string }).service;
    if (!servicio || !esServicio(servicio)) {
      // El protocolo «tonto» (sin `service`) serviría los archivos a pelo. No
      // se implementa: diría que existe algo que no sabemos servir.
      return reply.status(400).header("content-type", "text/plain").send("falta el servicio\n");
    }

    const id = await identificar(request, workspaceId, slug);
    if (id === null) return pedirCredenciales(reply);
    if (id === false || !(await existeRepo(workspaceId, slug))) {
      return reply.status(404).header("content-type", "text/plain").send("no existe ese repositorio\n");
    }

    // ANTES DE ESCRIBIR NADA, y ese orden importa: `hijack` le dice a Fastify
    // que la respuesta la manda este código. Llamarlo después de haber escrito
    // deja a Fastify intentando mandar la suya encima de la que ya salió.
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": `application/x-${servicio}-advertisement`,
      // Sin esto, un proxy puede servir el anuncio de hace un rato y el cliente
      // negocia contra un estado que ya no existe.
      "cache-control": "no-cache, max-age=0, must-revalidate",
    });
    try {
      await anunciarRefs(servicio, id.ruta, reply.raw, protocoloPedido(request.headers["git-protocol"] as string | undefined));
    } catch (error) {
      request.log.warn({ err: error, slug }, "falló el anuncio de referencias");
    } finally {
      reply.raw.end();
    }
  });

  /** El turno de verdad, uno por servicio. */
  for (const servicio of ["git-upload-pack", "git-receive-pack"] as Servicio[]) {
    app.post(`/git/:workspaceId/:slug.git/${servicio}`, async (request, reply) => {
      const { workspaceId, slug } = parseParams(rutaParams, request.params);

      const id = await identificar(request, workspaceId, slug);
      if (id === null) return pedirCredenciales(reply);
      if (id === false || !(await existeRepo(workspaceId, slug))) {
        return reply
          .status(404)
          .header("content-type", "text/plain")
          .send("no existe ese repositorio\n");
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": `application/x-${servicio}-result`,
        "cache-control": "no-cache, max-age=0, must-revalidate",
      });
      let fue = true;
      try {
        await atenderServicio(
          servicio,
          id.ruta,
          request.raw,
          request.headers["content-encoding"] === "gzip",
          reply.raw,
          protocoloPedido(request.headers["git-protocol"] as string | undefined),
        );
      } catch (error) {
        fue = false;
        request.log.warn({ err: error, slug }, `falló ${servicio}`);
      } finally {
        reply.raw.end();
      }

      if (fue && escribe(servicio)) await anotarPush(id);
    });
  }
}
