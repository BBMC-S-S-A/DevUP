import { createHash, randomBytes } from "node:crypto";
import { env } from "../env.js";

/**
 * Entrar con Google.
 *
 * QUÉ HACE GOOGLE Y QUÉ SEGUIMOS HACIENDO NOSOTROS. Google solo responde a una
 * pregunta: «¿este correo es de quien dice ser?». La sesión la seguimos
 * emitiendo aquí, con nuestras cookies y nuestra tabla `sessions`, y las
 * políticas siguen leyendo `app.user_id`. No entra ningún token de Google en el
 * resto del sistema.
 *
 * POR QUÉ NO VALIDAMOS LA FIRMA DEL id_token. Se recibe del endpoint de tokens
 * de Google, por TLS, en una petición de servidor a servidor autenticada con
 * nuestro secreto de cliente. La documentación de Google dice explícitamente
 * que en ese caso no hace falta validar la firma, porque el canal ya garantiza
 * el origen. Aun así se comprueban `aud`, `iss` y `exp`: son tres líneas y
 * cubren el día que alguien reutilice este código para el flujo del navegador,
 * donde el token SÍ llega por una vía que se puede manipular.
 *
 * LO QUE NO ES OPCIONAL: `email_verified`. Sin esa comprobación, cualquiera
 * puede crear una cuenta de Google declarando una dirección que no es suya y
 * entrar aquí como esa persona. Es la diferencia entre «Google dice que este
 * correo es suyo» y «alguien escribió este correo en un formulario».
 */

const AUTORIZACION = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const EMISORES = new Set(["accounts.google.com", "https://accounts.google.com"]);

export const googleConfigurado = (): boolean =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);

export type IdentidadGoogle = {
  sub: string;
  email: string;
  emailVerificado: boolean;
  nombre: string;
  avatar: string | null;
};

/**
 * El paquete que viaja en la cookie durante el viaje de ida y vuelta.
 *
 * `estado` es el anti-CSRF: lo que va en la URL tiene que coincidir con lo que
 * quedó en la cookie. Sin eso, alguien puede hacer que tu navegador complete un
 * callback con SU código de Google, y acabarías con la sesión de otra persona
 * creyendo que es la tuya.
 *
 * `verificador` es PKCE. Aquí el cliente es confidencial —tenemos secreto— así
 * que no es imprescindible, pero cierra el hueco de que un código interceptado
 * se pueda canjear sin conocer también el verificador.
 */
export type TransitoGoogle = { estado: string; verificador: string; invitacion?: string };

export function comenzar(invitacion?: string): { url: string; transito: TransitoGoogle } {
  const estado = randomBytes(24).toString("base64url");
  const verificador = randomBytes(32).toString("base64url");
  const reto = createHash("sha256").update(verificador).digest("base64url");

  const url = new URL(AUTORIZACION);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", estado);
  url.searchParams.set("code_challenge", reto);
  url.searchParams.set("code_challenge_method", "S256");
  // Sin esto, quien ya tiene sesión en Google entra sin poder elegir con qué
  // cuenta, que en un equipo con cuenta personal y de trabajo es un problema
  // diario.
  url.searchParams.set("prompt", "select_account");

  return { url: url.toString(), transito: { estado, verificador, invitacion } };
}

export async function canjear(codigo: string, verificador: string): Promise<IdentidadGoogle> {
  const respuesta = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: codigo,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: verificador,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    throw new Error(`Google rechazó el canje (${respuesta.status}): ${detalle.slice(0, 200)}`);
  }

  const cuerpo = (await respuesta.json()) as { id_token?: string };
  if (!cuerpo.id_token) throw new Error("Google no devolvió id_token");

  return leerIdToken(cuerpo.id_token);
}

/**
 * Lee el id_token y comprueba lo que tiene que comprobar.
 *
 * No verifica la firma —ver la explicación de arriba— pero sí que el token sea
 * para nosotros y no haya caducado. Un token válido emitido para OTRA
 * aplicación es un token perfectamente firmado: sin mirar `aud`, cualquier
 * desarrollador con un cliente de Google podría emitir uno y entrar aquí.
 */
export function leerIdToken(idToken: string): IdentidadGoogle {
  const partes = idToken.split(".");
  if (partes.length !== 3) throw new Error("id_token con formato inesperado");

  const carga = JSON.parse(Buffer.from(partes[1]!, "base64url").toString("utf8")) as {
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    picture?: string;
    aud?: string;
    iss?: string;
    exp?: number;
  };

  if (carga.aud !== env.GOOGLE_CLIENT_ID) {
    throw new Error("el id_token no fue emitido para esta aplicación");
  }
  if (!carga.iss || !EMISORES.has(carga.iss)) {
    throw new Error("el id_token no viene de Google");
  }
  if (!carga.exp || carga.exp * 1000 < Date.now()) {
    throw new Error("el id_token ha caducado");
  }
  if (!carga.sub || !carga.email) {
    throw new Error("el id_token no trae sub o email");
  }

  // Google lo manda como booleano, pero por el flujo del navegador puede llegar
  // como la cadena "true". Comparar con === true dejaría pasar "false" como
  // falso y "true" también, que es el peor de los dos errores posibles.
  const verificado = carga.email_verified === true || carga.email_verified === "true";

  return {
    sub: carga.sub,
    email: carga.email.toLowerCase(),
    emailVerificado: verificado,
    nombre: carga.name ?? "",
    avatar: carga.picture ?? null,
  };
}
