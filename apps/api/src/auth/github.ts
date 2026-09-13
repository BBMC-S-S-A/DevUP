import { randomBytes } from "node:crypto";
import { env } from "../env.js";

/**
 * Conectar GitHub sin pegar un token a mano.
 *
 * QUÉ ES ESTO Y QUÉ NO. Un OAuth App clásico, no una GitHub App: con el
 * alcance `repo` GitHub concede acceso a TODOS los repos públicos y privados
 * de quien conecta, en un solo click — a cambio de ser todo-o-nada, no
 * repositorio por repositorio como el token de acceso personal de alcance
 * fino que sigue existiendo al lado (ver ConectarGithub en la web). Se
 * decidió así en vez de una GitHub App con instalación selectiva porque esa
 * segunda vía es mucho más trabajo (tokens de instalación que caducan cada
 * hora, webhooks de instalación) para un problema que hoy es solo fricción,
 * no necesidad de aislar por repositorio.
 *
 * `workflow` VA SUMADO A `repo` DESDE LA 0063. Sin él, GitHub deja leer y
 * escribir el repositorio pero rechaza en concreto disparar un workflow por
 * `workflow_dispatch` — es el único permiso que pide aparte, y es lo que
 * hace falta para desplegar y migrar desde la pantalla de Infraestructura.
 *
 * POR QUÉ NO HAY PKCE AQUÍ. El flujo de autorización de un OAuth App clásico
 * de GitHub no lo soporta — a diferencia de Google (ver auth/google.ts), que
 * sí. El anti-CSRF de `estado` es el único que hace falta y el único que
 * GitHub entiende.
 *
 * EL TOKEN QUE DEVUELVE NO CADUCA POR SÍ SOLO. A diferencia de una GitHub
 * App, un OAuth App clásico da un token de acceso personal de larga duración:
 * vive en la misma bóveda de conexiones que el pegado a mano, y se revoca
 * igual, desde «Desconectar» en la pantalla o revocando el acceso desde la
 * propia cuenta de GitHub.
 */

const AUTORIZACION = "https://github.com/login/oauth/authorize";
const TOKEN = "https://github.com/login/oauth/access_token";

export const githubOauthConfigurado = (): boolean =>
  Boolean(env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET && env.GITHUB_OAUTH_REDIRECT_URI);

/**
 * El paquete que viaja en la cookie durante el viaje de ida y vuelta.
 *
 * `workspaceId` viaja aquí y no en la URL de retorno porque la URL de
 * retorno la fija GitHub al dar de alta el OAuth App, sin sitio para un
 * parámetro nuestro — así que el único lugar donde sobrevive el viaje
 * completo es la cookie, igual que el estado anti-CSRF.
 */
export type TransitoGithub = { estado: string; workspaceId: string };

export function comenzar(workspaceId: string): { url: string; transito: TransitoGithub } {
  const estado = randomBytes(24).toString("base64url");

  const url = new URL(AUTORIZACION);
  url.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.GITHUB_OAUTH_REDIRECT_URI);
  // `workflow` además de `repo` (0063): sin él, GitHub rechaza disparar un
  // workflow por `workflow_dispatch` aunque el token sí pueda leer y escribir
  // el resto del repositorio — es el único alcance que exige aparte.
  url.searchParams.set("scope", "repo workflow");
  url.searchParams.set("state", estado);

  return { url: url.toString(), transito: { estado, workspaceId } };
}

export type IdentidadGithub = { token: string; login: string };

export async function canjear(codigo: string): Promise<IdentidadGithub> {
  const respuesta = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      code: codigo,
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      redirect_uri: env.GITHUB_OAUTH_REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    throw new Error(`GitHub rechazó el canje (${respuesta.status}): ${detalle.slice(0, 200)}`);
  }

  const cuerpo = (await respuesta.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  // GitHub contesta 200 incluso cuando el código ya se usó o caducó: el
  // error viene dentro del cuerpo, no en el estado HTTP.
  if (cuerpo.error || !cuerpo.access_token) {
    throw new Error(cuerpo.error_description ?? cuerpo.error ?? "GitHub no devolvió access_token");
  }

  // El nombre de usuario es solo para que la conexión no se llame «sin
  // nombre» en la pantalla — el mismo detalle que ya resuelve `displayName`
  // en el formulario manual.
  const perfil = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${cuerpo.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "DevUP",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!perfil.ok) throw new Error(`GitHub no devolvió el perfil (${perfil.status})`);
  const datos = (await perfil.json()) as { login: string };

  return { token: cuerpo.access_token, login: datos.login };
}
