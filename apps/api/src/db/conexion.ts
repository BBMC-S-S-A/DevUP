/**
 * Opciones de conexión a Postgres, con TLS cuando la base no es local.
 *
 * POR QUÉ ESTO EXISTE. Hasta ahora la base vivía en el mismo `docker compose`
 * que la API: la conexión no salía de la máquina y el TLS sobraba. Con la base
 * en Supabase la conexión cruza internet, y va **la cadena de conexión con la
 * contraseña dentro** — sin cifrar, cualquiera en el camino la lee.
 *
 * Y NO DESACTIVAMOS LA VERIFICACIÓN DEL CERTIFICADO, que es lo que casi todo el
 * mundo copia y pega. `rejectUnauthorized: false` cifra el tráfico pero deja de
 * comprobar con quién está hablando: alguien que pueda responder por ese nombre
 * de máquina recibe la contraseña y reenvía las consultas sin que nada falle.
 * Cifrar sin verificar protege del que mira, no del que se interpone.
 *
 * Si el certificado no valida, es preferible que el arranque falle diciendo por
 * qué. Para los casos legítimos —una CA propia— está `DATABASE_SSL_CA`; y para
 * salir del paso a sabiendas, `DATABASE_SSL_INSECURE`, que avisa por el registro
 * cada vez.
 */
import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";

const LOCALES = new Set(["localhost", "127.0.0.1", "::1", "postgres", "db"]);

function esLocal(url: string): boolean {
  try {
    // `postgresql://` no lo entiende `new URL` en todas las versiones; se
    // normaliza a http solo para leer el nombre de máquina.
    const host = new URL(url.replace(/^postgres(ql)?:\/\//, "http://")).hostname;
    return LOCALES.has(host);
  } catch {
    // Si no se puede leer, se trata como remota: equivocarse hacia cifrar es
    // gratis, y hacia no cifrar no lo es.
    return false;
  }
}

/** Si la base está en esta misma máquina. Lo usa también el guardia de --reset. */
export function esBaseLocal(url: string): boolean {
  return esLocal(url);
}

export function opcionesTls(url: string): ConnectionOptions | undefined {
  if (esLocal(url)) return undefined;

  if (process.env.DATABASE_SSL_INSECURE === "true") {
    console.warn(
      "[db] TLS SIN VERIFICAR el certificado (DATABASE_SSL_INSECURE=true). El " +
        "tráfico va cifrado, pero nada garantiza que la base al otro lado sea la " +
        "tuya. No dejes esto puesto en producción.",
    );
    return { rejectUnauthorized: false };
  }

  const ca = process.env.DATABASE_SSL_CA;
  if (ca) {
    // Sirve tanto la ruta a un archivo como el PEM pegado en la variable, que
    // es la forma cómoda de pasarlo en un panel donde no hay disco.
    const contenido = ca.includes("BEGIN CERTIFICATE") ? ca : readFileSync(ca, "utf8");
    return { rejectUnauthorized: true, ca: contenido };
  }

  return { rejectUnauthorized: true };
}

/**
 * `search_path` para todo lo que hable con la base.
 *
 * En un Postgres nuestro las extensiones caen en `public` y esto sobra. En
 * Supabase viven en el esquema `extensions`, y `citext` —que es el tipo de la
 * columna de correo en ocho sitios— deja de resolverse: la migración 0001 falla
 * con «type citext does not exist», que no sugiere en absoluto que el problema
 * sea el camino de búsqueda.
 */
export const CAMINO_BUSQUEDA = "public, extensions";
