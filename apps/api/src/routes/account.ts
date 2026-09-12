import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { hashPassword } from "../auth/password.js";
import { type Db, withUser } from "../db/pool.js";
import { googleConfigurado } from "../auth/google.js";
import { normalizarCodigo, nuevoCodigo } from "../lib/codigo.js";
import { env } from "../env.js";
import {
  badRequest,
  limiteEstricto,
  notFound,
  parseBody,
  parseParams,
  requireUser,
} from "../lib/http.js";
import { enviarCorreo, plantillas } from "../mail/mailer.js";

const uuid = z.string().uuid();
const correo = z.string().trim().toLowerCase().email().max(254);

const HORA = 3600_000;
const CADUCIDAD = {
  invitacion: 7 * 24 * HORA,
  /**
   * El código corto vive MUCHO menos que el enlace, y no es una manía.
   *
   * Ocho caracteres se prueban a lo bruto de una forma que un token de 32
   * bytes no. Se dicta en el momento —por teléfono, en una reunión— y se usa
   * en el momento, así que un día es de sobra para su trabajo y recorta la
   * ventana a la centésima parte de la del enlace. Quien lo pierda, que
   * vuelva a invitar: el nuevo sustituye al anterior.
   */
  codigo: 24 * HORA,
  verificacion: 24 * HORA,
  recuperacion: 1 * HORA,
} as const;

/**
 * Un token opaco de 32 bytes y su hash.
 *
 * En la base se guarda solo el hash, igual que con los tokens de refresco:
 * quien lea la tabla de invitaciones no puede usar ninguna. El token en claro
 * existe solo el tiempo de componer el correo.
 */
function nuevoToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

/**
 * El hash con el que se busca una invitación, venga como venga.
 *
 * Quien recibe una invitación pega lo que le pasaron: la URL entera, el
 * token suelto, o el código corto dictado por teléfono —con guion o sin él,
 * en minúsculas—. Las tres cosas acaban aquí, y esta función decide si lo
 * que llega es un código (y entonces se normaliza antes de resumir) o un
 * token (que va tal cual).
 *
 * Vive en un solo sitio porque lo usan la ruta de mirar y la de canjear, y
 * si divergieran se podría CONSULTAR una invitación que luego no se puede
 * aceptar, que es la peor forma de fallar: la pantalla enseña la
 * organización correcta y el botón no funciona.
 */
export function hashDeInvitacion(entrada: string): string {
  const codigo = normalizarCodigo(entrada);
  return hashToken(codigo ?? entrada);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Envía la verificación de correo. Sin SMTP acaba en el registro. */
export async function enviarVerificacion(db: Db, userId: string, email: string): Promise<void> {
  const { token, hash } = nuevoToken();
  await db.query("select public.issue_user_token($1,'email_verification',$2,$3)", [
    userId,
    hash,
    new Date(Date.now() + CADUCIDAD.verificacion).toISOString(),
  ]);
  await enviarCorreo({
    to: email,
    ...plantillas.verificacion(`${env.APP_BASE_URL}/verificar?token=${token}`),
  });
}

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Qué pide esta instancia para darse de alta.
   *
   * La pantalla de registro la consulta para saber si enseñar el formulario
   * abierto o exigir una invitación. Es pública a propósito: no revela nada
   * que no se descubra intentando registrarse.
   */
  app.get("/auth/signup-policy", async () => {
    const primera = await withUser(null, async (db) => {
      const { rows } = await db.query<{ user_count: string }>("select public.user_count()");
      return Number(rows[0]!.user_count) === 0;
    });

    return {
      mode: env.SIGNUP_MODE,
      // La primera cuenta de la instancia siempre puede crearse: si no, no
      // habría nadie que pudiera invitar a nadie.
      bootstrap: primera,
      requiresEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
      // Para que la web sepa si enseñar el botón de Google. Un botón que lleva
      // a una ruta que no existe es peor que no tener botón: la persona sale a
      // Google y vuelve a un 404 que no puede interpretar.
      google: googleConfigurado(),
    };
  });

  /** Vista previa de una invitación, antes de que haya sesión. */
  app.get("/invitations/:token", async (request) => {
    // Ocho y no diez: es lo que mide un código corto. Un token largo pasa
    // igual, y lo que no es ni una cosa ni otra no encuentra nada.
    const { token } = parseParams(z.object({ token: z.string().min(8) }), request.params);

    const invitacion = await withUser(null, async (db) => {
      const { rows } = await db.query(
        `select organization_name as "organizationName", workspace_name as "workspaceName",
                email, role, invited_by_name as "invitedByName", expired, accepted
           from public.invitation_by_token($1)`,
        [hashDeInvitacion(token)],
      );
      return rows[0] ?? null;
    });

    if (!invitacion) throw notFound("esa invitación no existe");
    return { invitation: invitacion };
  });

  // --- Invitar --------------------------------------------------------------
  app.post(
    "/organizations/:orgId/invitations",
    { onRequest: requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
      const body = parseBody(
        z.object({
          email: correo,
          role: z.enum(["admin", "member"]).default("member"),
          // Ausente o null: invitación a toda la organización, como siempre.
          // Con un id, la persona solo entra a ese workspace (y a la
          // organización, que un workspace no existe sin ella).
          workspaceId: uuid.nullish(),
        }),
        request.body,
      );

      const { token, hash } = nuevoToken();
      // El código se guarda igual que el token: solo su hash. Desde que hay
      // respaldos automáticos, uno en claro viajaría dentro de cada volcado.
      const codigo = nuevoCodigo();
      const codigoHash = hashToken(normalizarCodigo(codigo)!);

      const contexto = await withUser(userId, async (db) => {
        // create_invitation comprueba dentro que quien llama es administrador.
        await db.query("select public.create_invitation($1,$2,$3,$4,$5,$6,$7,$8)", [
          orgId,
          body.email,
          body.role,
          hash,
          new Date(Date.now() + CADUCIDAD.invitacion).toISOString(),
          body.workspaceId ?? null,
          codigoHash,
          new Date(Date.now() + CADUCIDAD.codigo).toISOString(),
        ]);

        const { rows } = await db.query<{ org: string; quien: string; workspace: string | null }>(
          `select o.name as org, coalesce(p.display_name, 'alguien') as quien,
                  w.name as workspace
             from organizations o, profiles p
             left join workspaces w on w.id = $3
            where o.id = $1 and p.id = $2`,
          [orgId, userId, body.workspaceId ?? null],
        );
        return rows[0]!;
      });

      const url = `${env.APP_BASE_URL}/invitacion?token=${token}`;

      await enviarCorreo({
        to: body.email,
        ...plantillas.invitacion(contexto.org, contexto.quien, url, contexto.workspace),
      });

      // Si la persona ya tiene cuenta, además le suena la campana dentro.
      await withUser(userId, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          "select id from public.users where email = $1",
          [body.email],
        );
        const destinatario = rows[0]?.id;
        if (!destinatario) return;
        await db
          .query("select public.notify($1,'invitation',$2,$3,$4)", [
            destinatario,
            `Te han invitado a ${contexto.org}`,
            `${contexto.quien} te ha invitado a unirte.`,
            "/app",
          ])
          // El correo ya salió y la invitación ya existe: que la campana no
          // suene no deshace nada. Pero queda anotado, porque «no me llegó
          // nada» es una queja que hay que poder rastrear.
          .catch((fallo: unknown) => {
            request.log.warn({ err: fallo, destinatario }, "no se pudo avisar de una invitación");
          });
      });

      // El enlace va también en la respuesta, no solo en el correo: mientras
      // el dominio de envío no esté verificado, es la única vía fiable para
      // que quien invita se lo pueda mandar por su cuenta.
      // El código va en la respuesta y NO en la base ni en el correo: se
      // enseña una vez a quien invita, que es cuando lo va a dictar. Si se
      // pierde, se vuelve a invitar y el anterior se sustituye.
      return reply.status(201).send({ sent: true, url, codigo });
    },
  );

  app.get(
    "/organizations/:orgId/invitations",
    { onRequest: requireSession },
    async (request) => {
      const userId = requireUser(request);
      const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
      return withUser(userId, async (db) => {
        const { rows } = await db.query(
          `select i.id, i.email, i.role, i.workspace_id as "workspaceId", w.name as "workspaceName",
                  i.created_at as "createdAt", i.expires_at as "expiresAt",
                  i.accepted_at as "acceptedAt"
             from invitations i
             left join workspaces w on w.id = i.workspace_id
            where i.organization_id = $1
            order by i.created_at desc`,
          [orgId],
        );
        return { invitations: rows };
      });
    },
  );

  app.delete("/invitations/:id", { onRequest: requireSession }, async (request, reply) => {
    const userId = requireUser(request);
    const { id } = parseParams(z.object({ id: uuid }), request.params);
    await withUser(userId, (db) => db.query("delete from invitations where id = $1", [id]));
    return reply.status(204).send();
  });

  /** Aceptar una invitación teniendo ya sesión abierta. */
  /**
   * Aceptar una invitación teniendo ya sesión abierta.
   *
   * CON LÍMITE DE INTENTOS desde que existe el código corto. Un token de 32
   * bytes no se adivina; ocho caracteres, con paciencia y sin límite, sí. El
   * límite es lo que convierte «850.000 millones de combinaciones» en una
   * cifra que signifique algo.
   */
  app.post(
    "/invitations/accept",
    { onRequest: requireSession, ...limiteEstricto },
    async (request) => {
    const userId = requireUser(request);
    const { token } = parseBody(z.object({ token: z.string().min(8) }), request.body);

    const organizationId = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ accept_invitation: string }>(
        "select public.accept_invitation($1,$2)",
        [hashDeInvitacion(token), userId],
      );
      return rows[0]!.accept_invitation;
    });

    return { organizationId };
    },
  );

  // --- Verificación de correo ----------------------------------------------
  app.post("/auth/verify-email/resend", { onRequest: requireSession }, async (request, reply) => {
    const userId = requireUser(request);
    await withUser(userId, async (db) => {
      const { rows } = await db.query<{ email: string; verificado: string | null }>(
        `select email::text as email, email_verified_at as verificado from users where id = $1`,
        [userId],
      );
      const cuenta = rows[0];
      if (!cuenta || cuenta.verificado) return;
      await enviarVerificacion(db, userId, cuenta.email);
    });
    return reply.status(202).send({ sent: true });
  });

  app.post("/auth/verify-email", limiteEstricto, async (request) => {
    const { token } = parseBody(z.object({ token: z.string().min(10) }), request.body);

    const verificado = await withUser(null, async (db) => {
      const { rows } = await db.query<{ consume_user_token: string | null }>(
        "select public.consume_user_token($1,'email_verification')",
        [hashToken(token)],
      );
      const userId = rows[0]?.consume_user_token;
      if (!userId) return false;
      await db.query("select public.mark_email_verified($1)", [userId]);
      return true;
    });

    if (!verificado) throw badRequest("el enlace no es válido o ha caducado");
    return { verified: true };
  });

  // --- Recuperar contraseña -------------------------------------------------
  /**
   * Siempre responde lo mismo, exista o no la cuenta.
   *
   * Contestar «ese correo no está registrado» convierte este endpoint en un
   * comprobador de qué direcciones tienen cuenta, que es media filtración de
   * la lista de clientes.
   */
  app.post("/auth/forgot-password", limiteEstricto, async (request, reply) => {
    const { email } = parseBody(z.object({ email: correo }), request.body);

    await withUser(null, async (db) => {
      const { rows } = await db.query<{ user_id: string }>(
        "select user_id from public.auth_credentials($1)",
        [email],
      );
      const userId = rows[0]?.user_id;
      if (!userId) return;

      const { token, hash } = nuevoToken();
      await db.query("select public.issue_user_token($1,'password_reset',$2,$3)", [
        userId,
        hash,
        new Date(Date.now() + CADUCIDAD.recuperacion).toISOString(),
      ]);
      await enviarCorreo({
        to: email,
        ...plantillas.recuperacion(`${env.APP_BASE_URL}/recuperar?token=${token}`),
      });
    });

    return reply.status(202).send({ sent: true });
  });

  app.post("/auth/reset-password", limiteEstricto, async (request) => {
    const body = parseBody(
      z.object({
        token: z.string().min(10),
        password: z.string().min(10, "la contraseña necesita al menos 10 caracteres").max(200),
      }),
      request.body,
    );

    const hash = await hashPassword(body.password);

    const cambiado = await withUser(null, async (db) => {
      const { rows } = await db.query<{ consume_user_token: string | null }>(
        "select public.consume_user_token($1,'password_reset')",
        [hashToken(body.token)],
      );
      const userId = rows[0]?.consume_user_token;
      if (!userId) return false;
      // set_password revoca también todas las sesiones abiertas.
      await db.query("select public.set_password($1,$2)", [userId, hash]);
      return true;
    });

    if (!cambiado) throw badRequest("el enlace no es válido o ha caducado");
    return { reset: true };
  });
}
