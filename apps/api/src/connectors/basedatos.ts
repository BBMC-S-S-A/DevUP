/**
 * Administrador de la base de datos propia de un workspace.
 *
 * QUÉ ES Y QUÉ NO. Cada workspace conecta SU PROPIA cadena de conexión de
 * Postgres — la misma que ya usan con psql o con un cliente de escritorio,
 * guardada en la bóveda de conexiones (0015) como cualquier otra credencial
 * ajena. Esto NO es un acceso de superusuario a la base compartida de DevUP:
 * no toca `DATABASE_ADMIN_URL` ni el pool de la aplicación en ningún
 * momento. Es un cliente de Postgres genérico, apuntado a lo que cada quien
 * conectó — el mismo riesgo que ya tienen abriendo psql ellos mismos, ni uno
 * más.
 *
 * UNA CONEXIÓN POR PETICIÓN, Y SE CIERRA SIEMPRE. No hay un pool para esto:
 * cada workspace puede tener una base distinta, y mantener un pool por
 * conexión ajena es un problema de recursos que no hace falta resolver para
 * un panel que se abre de vez en cuando.
 */
import pg from "pg";
import { opcionesTls } from "../db/conexion.js";

export type ColumnaTabla = { nombre: string; tipo: string; nulable: boolean };
export type Tabla = {
  esquema: string;
  nombre: string;
  filasEstimadas: number;
  columnas: ColumnaTabla[];
};

export type ResultadoSQL = {
  columnas: string[];
  filas: Record<string, unknown>[];
  filasAfectadas: number;
  /** Cuando la sentencia no devuelve filas (un `insert` o `update` a secas). */
  comando: string;
};

async function conectar(connectionString: string): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString,
    ssl: opcionesTls(connectionString),
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  await client.connect();
  return client;
}

/**
 * Las tablas del esquema `public` y el que declare el propio usuario, con su
 * conteo estimado (`pg_class.reltuples`) y no `count(*)` — contar de verdad
 * una tabla de millones de filas colgaría el panel por algo que es solo
 * orientativo.
 */
export async function listarTablas(connectionString: string): Promise<Tabla[]> {
  const client = await conectar(connectionString);
  try {
    const { rows: tablas } = await client.query<{
      esquema: string;
      nombre: string;
      filasEstimadas: string;
    }>(
      `select n.nspname as esquema, c.relname as nombre,
              greatest(c.reltuples, 0)::bigint as "filasEstimadas"
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r'
          and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
        order by n.nspname, c.relname`,
    );

    const { rows: columnas } = await client.query<{
      esquema: string;
      tabla: string;
      nombre: string;
      tipo: string;
      nulable: boolean;
    }>(
      `select table_schema as esquema, table_name as tabla, column_name as nombre,
              data_type as tipo, (is_nullable = 'YES') as nulable
         from information_schema.columns
        where table_schema not in ('pg_catalog', 'information_schema', 'pg_toast')
        order by table_schema, table_name, ordinal_position`,
    );

    return tablas.map((t) => ({
      esquema: t.esquema,
      nombre: t.nombre,
      filasEstimadas: Number(t.filasEstimadas),
      columnas: columnas
        .filter((c) => c.esquema === t.esquema && c.tabla === t.nombre)
        .map((c) => ({ nombre: c.nombre, tipo: c.tipo, nulable: c.nulable })),
    }));
  } finally {
    await client.end();
  }
}

/**
 * Corre lo que sea, tal cual. Sin `params`: es la protocolo simple de
 * Postgres, que a cambio de no admitir parámetros preparados sí admite
 * VARIAS sentencias separadas por `;` en una sola llamada — lo que hace
 * falta para que esto sea una consola SQL y no un formulario de una sola
 * fila.
 *
 * `statement_timeout` (puesto al conectar) es la única red: una consulta que
 * se cuelga no se queda colgando esta petición para siempre.
 */
export async function ejecutarSQL(connectionString: string, sql: string): Promise<ResultadoSQL> {
  const client = await conectar(connectionString);
  try {
    const resultado = await client.query(sql);
    // `client.query` con varias sentencias devuelve un array de resultados;
    // con una sola, el resultado a secas. Se toma siempre el ÚLTIMO: es el
    // que alguien está mirando cuando corre "borra esto; y ahora enséñame
    // aquello".
    const ultimo = Array.isArray(resultado) ? resultado[resultado.length - 1] : resultado;
    if (!ultimo) {
      return { columnas: [], filas: [], filasAfectadas: 0, comando: "" };
    }
    return {
      columnas: ultimo.fields?.map((f: { name: string }) => f.name) ?? [],
      filas: ultimo.rows ?? [],
      filasAfectadas: ultimo.rowCount ?? 0,
      comando: ultimo.command ?? "",
    };
  } finally {
    await client.end();
  }
}
