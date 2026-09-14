/**
 * Alojar una base de datos de verdad, dentro del mismo Postgres de DevUP.
 *
 * NO ES UN SIMULACRO, Y ESA FUE LA DECISIÓN. Se pidió poder «alojar una base
 * de datos» desde DevUP y se planteó dejarlo como un mock creíble. Fingirlo
 * bien —un catálogo de tablas inventado, un motor de SQL de mentira— es más
 * trabajo que hacerlo: DevUP ya corre sobre Postgres, así que crea una base
 * real, con su rol, su contraseña y su cadena de conexión, y la pantalla de
 * administración que ya existe (0065) la navega sin enterarse de que es nueva.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE ESTÁ EL PELIGRO, QUE ES TODO EL ARCHIVO
 * ────────────────────────────────────────────────────────────────────────────
 *
 * La base alojada vive en el MISMO servidor que la de DevUP, y su contraseña
 * se la queda quien la pidió. O sea: se le está dando a alguien un usuario de
 * Postgres en el servidor donde están los datos de todos los demás. Tres cosas
 * lo sostienen, y las tres están probadas:
 *
 * 1. **El rol no puede crear nada** — `nosuperuser nocreatedb nocreaterole`.
 *    Sin esto podría fabricarse otros roles o llenar el disco de bases.
 * 2. **El rol no puede ni ABRIR una conexión contra la base de DevUP** —
 *    `revoke connect ... from public` en `db/grants.sql`. Postgres deja
 *    conectarse a cualquier base por defecto, y aunque las políticas RLS
 *    negarían las filas, el catálogo (qué tablas hay, qué columnas, qué roles)
 *    es un plano del sistema que no tiene por qué ver.
 * 3. **Cada base alojada solo admite a su propio rol** — también con un
 *    `revoke connect from public`, para que un inquilino no entre en la base
 *    de otro inquilino.
 *
 * LOS NOMBRES NO SE PARAMETRIZAN, Y POR ESO NO VIENEN DE FUERA. Postgres no
 * admite `$1` donde va un nombre de objeto: hay que interpolarlo. Así que el
 * nombre se DERIVA del identificador del espacio de trabajo —doce dígitos
 * hexadecimales de un uuid que puso la base, no una persona— y además se cita
 * con `escapeIdentifier`. Nada que alguien escriba llega a una sentencia.
 *
 * NO PASA POR `withUser`. `create database` no puede correr dentro de una
 * transacción, y `withUser` abre una para fijar la identidad de RLS. Estas
 * sentencias van por el pool en autocommit; el rastro en `hosted_databases`
 * —eso sí con identidad y con RLS— lo escribe la ruta aparte.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { env } from "../env.js";
import { pool } from "../db/pool.js";

/** `ws_` y doce hexadecimales del uuid del espacio. Ver la cabecera. */
export function nombreDeAlojamiento(workspaceId: string): string {
  const limpio = workspaceId.replace(/-/g, "").slice(0, 12).toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(limpio)) {
    throw new Error("identificador de espacio inesperado");
  }
  return `ws_${limpio}`;
}

/**
 * La cadena que se le entrega a quien pidió la base.
 *
 * SALE DE LA DE DEVUP, cambiándole usuario, contraseña y nombre de base: el
 * servidor es el mismo, así que el anfitrión y el puerto correctos son los que
 * ya usa la API para hablar con Postgres. Inventarlos —«localhost», el nombre
 * del contenedor— daría una cadena que no conecta desde ningún sitio.
 */
function cadenaDeConexion(usuario: string, contrasena: string, base: string): string {
  const url = new URL(env.DATABASE_URL);
  url.username = usuario;
  url.password = contrasena;
  url.pathname = `/${base}`;
  return url.toString();
}

export type Alojamiento = { dbName: string; roleName: string; connectionString: string };

/**
 * Crea la base y su rol. Si ya existían, los reutiliza cambiando la
 * contraseña: alojar dos veces tiene que dejar el mismo sitio y una
 * credencial que funcione, no un error a medias.
 */
export async function alojarBase(workspaceId: string): Promise<Alojamiento> {
  const nombre = nombreDeAlojamiento(workspaceId);
  // base64url y no hex: misma entropía en menos caracteres, y sin símbolos que
  // haya que escapar al meterla en una URL de conexión.
  const contrasena = randomBytes(24).toString("base64url");

  const id = (valor: string) => pg.escapeIdentifier(valor);
  const literal = (valor: string) => pg.escapeLiteral(valor);

  const cliente = await pool.connect();
  try {
    const { rows } = await cliente.query<{ existe: boolean }>(
      "select exists (select 1 from pg_roles where rolname = $1) as existe",
      [nombre],
    );
    if (rows[0]?.existe) {
      await cliente.query(`alter role ${id(nombre)} with password ${literal(contrasena)}`);
    } else {
      await cliente.query(
        `create role ${id(nombre)} login password ${literal(contrasena)}
           nosuperuser nocreatedb nocreaterole
           connection limit 20`,
      );
    }

    /**
     * Y HACERSE MIEMBRO DEL ROL RECIÉN CREADO, que no es una formalidad: sin
     * esto la línea siguiente falla con «must be able to SET ROLE».
     *
     * Desde Postgres 16, crear un rol ya no te deja actuar como él. Para dar
     * una base EN PROPIEDAD a alguien hay que poder ser ese alguien, y para
     * borrarla después hay que tener sus privilegios —la comprobación de
     * propiedad mira los permisos heredados—. Se descubrió con la ruta
     * montada: el rol se creaba bien y `create database ... owner` reventaba
     * justo detrás.
     *
     * Es idempotente: conceder dos veces la misma pertenencia no molesta.
     */
    await cliente.query(`grant ${id(nombre)} to current_user`);

    const { rows: bases } = await cliente.query<{ existe: boolean }>(
      "select exists (select 1 from pg_database where datname = $1) as existe",
      [nombre],
    );
    if (!bases[0]?.existe) {
      // Sin transacción: `create database` no la admite. Por eso este archivo
      // usa el pool en crudo y no `withUser`.
      await cliente.query(`create database ${id(nombre)} owner ${id(nombre)}`);
    }

    // Que solo entre su dueño, ni siquiera otro inquilino.
    await cliente.query(`revoke connect on database ${id(nombre)} from public`);
    await cliente.query(`grant connect on database ${id(nombre)} to ${id(nombre)}`);

    return {
      dbName: nombre,
      roleName: nombre,
      connectionString: cadenaDeConexion(nombre, contrasena, nombre),
    };
  } finally {
    cliente.release();
  }
}

/**
 * Tira la base y su rol.
 *
 * `with (force)` CIERRA LAS CONEXIONES ABIERTAS en vez de fallar. Sin eso,
 * una pestaña que alguien dejó abierta en la pantalla de administración
 * bastaría para que desalojar no funcione nunca, con un error que no explica
 * que el problema es una conexión viva.
 */
export async function desalojarBase(workspaceId: string): Promise<void> {
  const nombre = nombreDeAlojamiento(workspaceId);
  const id = (valor: string) => pg.escapeIdentifier(valor);

  const cliente = await pool.connect();
  try {
    await cliente.query(`drop database if exists ${id(nombre)} with (force)`);
    await cliente.query(`drop role if exists ${id(nombre)}`);
  } finally {
    cliente.release();
  }
}
