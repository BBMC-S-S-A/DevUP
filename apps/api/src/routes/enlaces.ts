/**
 * Enlaces de invitación reutilizables (0071).
 *
 * EL GESTO ES EL DE DISCORD: se pega un enlace en un grupo y entra quien
 * quiera. Las otras dos formas de entrar empiezan por el correo de alguien —una
 * invitación por persona, o un código corto que se dicta— y ninguna sirve para
 * meter a cinco de golpe.
 *
 * DOS ALCANCES, UN MECANISMO. Un enlace es de la organización o de UN espacio.
 * Lo segundo es lo que se pidió: «cada proyecto trabaja por separado, quiero
 * pasarle a mi grupo el enlace de este».
 *
 * ENTRAR A UN ESPACIO ES ENTRAR TAMBIÉN A SU ORGANIZACIÓN, y no es una decisión
 * de este archivo: `can_access_workspace` exige pertenecer a la organización
 * antes de mirar nada del espacio. Lo que sí se acota es cuánto se ve — quien
 * entra por un enlace de espacio queda con `all_workspaces = false`, o sea ese
 * espacio y ninguno más. Está contado entero en la migración.
 *
 * LA AUTORIZACIÓN LA LLEVAN LAS POLÍTICAS, no las rutas de aquí: crear, listar
 * y revocar chocan con `invite_links` si quien lo pide no manda donde
 * corresponde. Lo único que no pueden llevar es el CANJE, porque quien canjea
 * todavía no pertenece a nada — eso lo hace `invite_link_redeem`, que es
 * `security definer` por ese motivo y solo por ese.
 */
import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { env } from "../env.js";
import { badRequest, notFound, parseBody, parseParams, requireUser } from "../lib/http.js";

const uuid = z.string().uuid();

/** Igual que el token de refresco: en la base solo vive el hash. */
function hashDeEnlace(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Cuánto puede durar como mucho.
 *
 * TREINTA DÍAS ES EL TECHO, no una sugerencia. Un enlace reutilizable es una
 * puerta abierta: el que dura un año lo reenvía alguien a un grupo que ya no es
 * este, y nadie se acuerda de que existía. Siete días por defecto porque para
 * meter al equipo de un proyecto sobra con una semana.
 */
const DIAS_MAX = 30;
const DIAS_POR_DEFECTO = 7;

const COLUMNAS = `
  id, workspace_id as "workspaceId", role, expires_at as "expiresAt",
  max_uses as "maxUses", uses, revoked_at as "revokedAt", created_at as "createdAt"`;

/**
 * La dirección que se comparte.
 *
 * Sale de `APP_BASE_URL` —la web, no la API— porque quien la abre es una
 * persona en un navegador, no un programa. Componerla con el host de ESTA
 * petición daría la dirección de la API, que no sabe enseñar una pantalla.
 */
function urlDelEnlace(token: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/entrar/${token}`;
}

export async function enlacesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * SIN HOOK GLOBAL DE SESIÓN, y es a propósito: una de estas rutas tiene que
   * ser pública.
   *
   * Quien abre un enlace puede no tener cuenta todavía — es el caso normal,
   * porque el enlace se pega en un grupo de WhatsApp. Si mirar a dónde lleva
   * pidiera sesión, esa persona vería una pantalla de acceso sin saber a qué
   * la están invitando, que es exactamente el formulario a ciegas que estas
   * pantallas existen para no ser.
   *
   * Lo que enseña es lo justo para decidir —organización y espacio— y hace
   * falta tener el enlace, que son veinticuatro bytes al azar. Entrar de verdad
   * sí pide cuenta.
   */
  const conSesion = { onRequest: requireSession };

  const cuerpoDeAlta = z.object({
    dias: z.number().int().min(1).max(DIAS_MAX).default(DIAS_POR_DEFECTO),
    usos: z.number().int().min(1).max(500).default(25),
  });

  /**
   * Crear uno para un espacio. LA DIRECCIÓN SE ENSEÑA UNA VEZ: en la base solo
   * queda su hash, así que ninguna ruta puede volver a servirla ni queriendo.
   * Mismo trato que el código corto y que la cadena de una base alojada.
   */
  app.post("/workspaces/:workspaceId/invite-links", conSesion, async (request, reply) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const { dias, usos } = parseBody(cuerpoDeAlta, request.body);

    const token = randomBytes(24).toString("base64url");
    const expira = new Date(Date.now() + dias * 86_400_000).toISOString();

    const fila = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into invite_links
           (organization_id, workspace_id, token_hash, expires_at, max_uses, created_by)
         values ((select organization_id from workspaces where id = $1),$1,$2,$3,$4,$5)
         returning ${COLUMNAS}`,
        [workspaceId, hashDeEnlace(token), expira, usos, userId],
      );
      return rows[0];
    });

    return reply.status(201).send({ enlace: { ...(fila as object), url: urlDelEnlace(token) } });
  });

  app.get("/workspaces/:workspaceId/invite-links", conSesion, async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS} from invite_links
          where workspace_id = $1 and revoked_at is null
          order by created_at desc`,
        [workspaceId],
      );
      return { enlaces: rows };
    });
  });

  /**
   * Revocar. SE MARCA, NO SE BORRA: un enlace que se usó es el rastro de por
   * dónde entró alguien, y borrarlo dejaría a esa gente dentro sin nada que
   * explique cómo llegó. La política de `invite_links` ni siquiera permite
   * borrar.
   */
  app.delete("/invite-links/:id", conSesion, async (request) => {
    const userId = requireUser(request);
    const { id } = parseParams(z.object({ id: uuid }), request.params);
    const habia = await withUser(userId, async (db) => {
      const { rowCount } = await db.query(
        "update invite_links set revoked_at = now() where id = $1 and revoked_at is null",
        [id],
      );
      return (rowCount ?? 0) > 0;
    });
    if (!habia) throw notFound("ese enlace ya no está activo");
    return { revocado: true };
  });

  /**
   * Mirar a dónde lleva un enlace ANTES de usarlo.
   *
   * Para que la pantalla pueda decir «te están invitando a Producto, de Acme»
   * en vez de un botón a ciegas. No gasta uso y no mete a nadie: eso solo pasa
   * al aceptar.
   */
  app.get("/invite-links/:token/destino", async (request) => {
    const { token } = parseParams(z.object({ token: z.string().min(10).max(200) }), request.params);

    return withUser(null, async (db) => {
      // Por la función y no por una consulta: quien abre el enlace no pertenece
      // a nada todavía, y la política de `invite_links` no le deja ver ni que
      // existe. Se probó con una consulta normal y contestaba «ese enlace no
      // existe» a un enlace perfectamente válido. Ver la migración.
      const { rows } = await db.query<{
        organizacion: string;
        espacio: string | null;
        expirado: boolean;
        agotado: boolean;
        revocado: boolean;
      }>("select * from public.invite_link_destino($1)", [hashDeEnlace(token)]);
      const d = rows[0];
      if (!d) throw notFound("ese enlace no existe");
      return d;
    });
  });

  /**
   * Aceptarlo. Aquí sí se entra, y aquí sí se gasta un uso.
   *
   * PIDE SESIÓN, como todo este archivo: hay que tener cuenta antes de entrar a
   * una organización. Quien llegue sin ella se registra primero y vuelve — eso
   * lo encadena la pantalla, que sabe a dónde volver.
   */
  app.post("/invite-links/:token/aceptar", conSesion, async (request) => {
    const userId = requireUser(request);
    const { token } = parseParams(z.object({ token: z.string().min(10).max(200) }), request.params);

    const resultado = await withUser(null, async (db) => {
      const { rows } = await db.query<{ motivo: string; org: string | null; espacio: string | null }>(
        "select motivo, org, espacio from public.invite_link_redeem($1,$2)",
        [hashDeEnlace(token), userId],
      );
      return rows[0];
    });

    // Cada «no» dice cuál, porque son consejos distintos para quien está
    // delante: pedir otro enlace, o hablar con quien te lo pasó.
    const explicacion: Record<string, string> = {
      "no-existe": "ese enlace no existe",
      revocado: "ese enlace se cerró — pídele otro a quien te lo pasó",
      caducado: "ese enlace caducó — pídele otro a quien te lo pasó",
      agotado: "ese enlace ya llegó a su tope de personas — pídele otro a quien te lo pasó",
    };
    if (!resultado || explicacion[resultado.motivo]) {
      throw badRequest(explicacion[resultado?.motivo ?? "no-existe"]!);
    }

    return {
      // `ya-dentro` no es un error: volver a pulsar el enlace que te pasaron
      // por el chat tiene que llevarte al sitio, no darte un fallo.
      yaEstaba: resultado.motivo === "ya-dentro",
      organizationId: resultado.org,
      workspaceId: resultado.espacio,
    };
  });
}
