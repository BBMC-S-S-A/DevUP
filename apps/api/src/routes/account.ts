import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { hashPassword } from "../auth/password.js";
import { type Db, withUser } from "../db/pool.js";
import { googleConfigurado } from "../auth/google.js";
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
import {
  formatearCodigo,
  hashCodigo,
  normalizarCodigo,
  nuevoCodigo,
} from "../lib/codigo-invitacion.js";

const uuid = z.string().uuid();
const correo = z.string().trim().toLowerCase().email().max(254);

const HORA = 3600_000;
const CADUCIDAD = {
  invitacion: 7 * 24 * HORA,
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

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Le pone código corto a una invitación, reintentando si choca.
 *
 * CADA INTENTO VA EN SU PROPIA TRANSACCIÓN, y no es un detalle: en Postgres una
 * violación de unicidad aborta la transacción entera, así que reintentar dentro
 * de la misma no vuelve a intentar nada —falla todo lo que venga detrás—. Si
 * esto compartiera transacción con la creación de la invitación, un choque de
 * códigos se llevaría por delante la invitación misma.
 *
 * TRES INTENTOS SON DE SOBRA. Con 32^8 y unas pocas invitaciones abiertas a la
 * vez, la probabilidad de un choque es del orden de una entre mil millones; la
 * de tres seguidos no tiene nombre. El bucle está para que un imposible sea un
 * imposible y no un 500.
 */
async function ponerCodigo(userId: string, invitacion: string): Promise<string | null> {
  for (let intento = 0; intento < 3; intento += 1) {
    const codigo = nuevoCodigo();
    try {
      await withUser(userId, (db) =>
        db.query("select public.set_invitation_code($1,$2)", [invitacion, hashCodigo(codigo)]),
      );
      return codigo;
    } catch (fallo) {
      if ((fallo as { code?: string }).code !== "23505") throw fallo;
    }
  }
  return null;
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
    const { token } = parseParams(z.object({ token: z.string().min(10) }), request.params);

    const invitacion = await withUser(null, async (db) => {
      const { rows } = await db.query(
        `select organization_name as "organizationName", workspace_name as "workspaceName",
                email, role, invited_by_name as "invitedByName", expired, accepted
           from public.invitation_by_token($1)`,
        [hashToken(token)],
      );
      return rows[0] ?? null;
    });

    if (!invitacion) throw notFound("esa invitación no existe");
    return { invitation: invitacion };
  });

  /**
   * La misma vista previa, pero llegando por el código dictado.
   *
   * CON LÍMITE ESTRICTO, y aquí no es rutina: un código de ocho símbolos es lo
   * bastante corto como para que probar a ciegas sea una idea que se le pueda
   * ocurrir a alguien. El espacio es de 32^8 y las invitaciones caducan en
   * siete días, así que con el límite puesto no hay ataque posible; sin él,
   * esta ruta sería el único sitio del producto donde se puede adivinar una
   * credencial a base de insistir.
   */
  app.get("/invitations/code/:code", limiteEstricto, async (request) => {
    const { code } = parseParams(z.object({ code: z.string().min(1).max(40) }), request.params);

    const codigo = normalizarCodigo(code);
    // Se contesta lo mismo que a un código bien formado que no existe. Decir
    // «ese código no tiene la forma correcta» es gratis para quien se equivocó
    // tecleando y es una pista para quien prueba.
    if (!codigo) throw notFound("ese código no corresponde a ninguna invitación");

    const invitacion = await withUser(null, async (db) => {
      const { rows } = await db.query(
        `select organization_name as "organizationName", workspace_name as "workspaceName",
                email, role, invited_by_name as "invitedByName", expired, accepted
           from public.invitation_by_code($1)`,
        [hashCodigo(codigo)],
      );
      return rows[0] ?? null;
    });

    if (!invitacion) throw notFound("ese código no corresponde a ninguna invitación");
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

      const contexto = await withUser(userId, async (db) => {
        // create_invitation comprueba dentro que quien llama es administrador.
        const creada = await db.query<{ create_invitation: string }>(
          "select public.create_invitation($1,$2,$3,$4,$5,$6)",
          [
            orgId,
            body.email,
            body.role,
            hash,
            new Date(Date.now() + CADUCIDAD.invitacion).toISOString(),
            body.workspaceId ?? null,
          ],
        );
        const invitacionId = creada.rows[0]!.create_invitation;

        const { rows } = await db.query<{ org: string; quien: string; workspace: string | null }>(
          `select o.name as org, coalesce(p.display_name, 'alguien') as quien,
                  w.name as workspace
             from organizations o, profiles p
             left join workspaces w on w.id = $3
            where o.id = $1 and p.id = $2`,
          [orgId, userId, body.workspaceId ?? null],
        );
        return { ...rows[0]!, invitacionId };
      });

      // El código va DESPUÉS y en su propia transacción: ver `ponerCodigo`. Si
      // no sale, la invitación sigue siendo perfectamente válida por su enlace,
      // así que no se tumba la petición por esto.
      const codigo = await ponerCodigo(userId, contexto.invitacionId);
      if (!codigo) {
        request.log.warn(
          { invitacion: contexto.invitacionId },
          "no se pudo asignar código corto a una invitación",
        );
      }

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
      //
      // EL CÓDIGO, EN CAMBIO, VA SOLO AQUÍ Y NO EN EL CORREO. Quien recibe el
      // correo ya tiene el enlace, que es mejor —se pincha—; meterle además el
      // código sería una segunda llave viajando por el mismo sitio sin que
      // sirva para nada. El código es para quien INVITA: es lo que dice en voz
      // alta cuando tiene delante a la persona. Por eso se devuelve aquí, que
      // es donde está mirando en ese momento.
      return reply.status(201).send({
        sent: true,
        url,
        code: codigo ? formatearCodigo(codigo) : null,
      });
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
          // `hasCode` y no el código: en la base solo está su hash, así que no
          // hay nada que enseñar aquí aunque se quisiera. Lo que la lista sí
          // puede decir es si tiene uno vivo, que es lo que necesita el botón
          // de «dame otro».
          `select i.id, i.email, i.role, i.workspace_id as "workspaceId", w.name as "workspaceName",
                  i.created_at as "createdAt", i.expires_at as "expiresAt",
                  i.accepted_at as "acceptedAt",
                  (i.code_hash is not null) as "hasCode"
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

  /**
   * Pedir un código nuevo para una invitación que ya existe.
   *
   * ES LA CONSECUENCIA DE GUARDAR EL CÓDIGO CIFRADO. Como en la base solo vive
   * su hash, nadie —ni nosotros— puede volver a leer el que se generó al
   * invitar. Si quien invitó cerró la pestaña sin apuntarlo, esta es la salida.
   *
   * Y ES MEJOR SALIDA QUE LA ALTERNATIVA OBVIA, que sería borrar la invitación
   * y crearla otra vez: eso invalidaría también su enlace, que a esas alturas
   * ya está en el correo de la otra persona y quizá abierto en su móvil.
   * Renovar el código no toca el token.
   */
  app.post("/invitations/:id/code", { onRequest: requireSession }, async (request) => {
    const userId = requireUser(request);
    const { id } = parseParams(z.object({ id: uuid }), request.params);

    const codigo = await ponerCodigo(userId, id);
    if (!codigo) throw badRequest("no se pudo generar un código para esa invitación");
    return { code: formatearCodigo(codigo) };
  });

  /** Aceptar una invitación teniendo ya sesión abierta. */
  app.post("/invitations/accept", { onRequest: requireSession }, async (request) => {
    const userId = requireUser(request);
    const { token } = parseBody(z.object({ token: z.string().min(10) }), request.body);

    const organizationId = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ accept_invitation: string }>(
        "select public.accept_invitation($1,$2)",
        [hashToken(token), userId],
      );
      return rows[0]!.accept_invitation;
    });

    return { organizationId };
  });

  /**
   * Lo mismo, tecleando el código.
   *
   * CON LÍMITE ESTRICTO TAMBIÉN, aunque exija sesión. La vista previa de arriba
   * es anónima y esta no, pero el que prueba códigos a ciegas puede registrarse
   * primero: pedir sesión sube el coste del ataque, no lo cierra. Lo que lo
   * cierra es el límite.
   */
  app.post(
    "/invitations/accept-code",
    { onRequest: requireSession, ...limiteEstricto },
    async (request) => {
      const userId = requireUser(request);
      const { code } = parseBody(z.object({ code: z.string().min(1).max(40) }), request.body);

      const codigo = normalizarCodigo(code);
      if (!codigo) throw badRequest("ese código no es válido");

      const organizationId = await withUser(userId, async (db) => {
        const { rows } = await db.query<{ accept_invitation_by_code: string }>(
          "select public.accept_invitation_by_code($1,$2)",
          [hashCodigo(codigo), userId],
        );
        return rows[0]!.accept_invitation_by_code;
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
