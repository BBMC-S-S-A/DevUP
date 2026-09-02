import pg from "pg";
import { env } from "../env.js";
import { CAMINO_BUSQUEDA, opcionesTls } from "./conexion.js";

/**
 * Acceso a Postgres.
 *
 * Toda consulta que actúe en nombre de un usuario pasa por `withUser`, que la
 * envuelve en una transacción y fija `app.user_id` como variable LOCAL. Las
 * políticas RLS leen esa variable a través de `public.current_user_id()`.
 *
 * LOCAL es la parte importante: la variable muere con la transacción. Si se
 * fijara con alcance de sesión, la conexión volvería al pool arrastrando la
 * identidad del último usuario y la siguiente petición —de otra persona—
 * heredaría sus permisos. Ese es el fallo que convierte un pool de conexiones
 * en una fuga de datos entre clientes.
 */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: opcionesTls(env.DATABASE_URL),
  max: 10,
  idleTimeoutMillis: 30_000,
  // Diez segundos y no cinco: con la base en la misma máquina, cinco sobraban.
  // Contra una gestionada gratuita hay arranques en frío —Supabase despierta el
  // proyecto tras una semana parado— y cinco segundos convierten ese despertar
  // en un error de conexión que parece que la base no existe.
  connectionTimeoutMillis: 10_000,
});

// El camino de búsqueda se fija por conexión, no por consulta: en un Postgres
// gestionado las extensiones no están en `public`, y `citext` —el tipo de la
// columna de correo— deja de resolverse. Aquí, y no en `withUser`, porque es
// propiedad de la conexión y no de la transacción.
pool.on("connect", (client) => {
  void client.query(`set search_path to ${CAMINO_BUSQUEDA}`);
});

pool.on("error", (error) => {
  // Un cliente ocioso que se cae no debe tumbar el proceso.
  console.error("[db] cliente inactivo con error:", error.message);
});

export type Db = pg.PoolClient;

/**
 * Ejecuta `fn` en una transacción con la identidad indicada.
 *
 * Con `userId` a null la transacción corre sin identidad: las políticas
 * deniegan todo. Es lo correcto para rutas públicas que aun así necesitan
 * hablar con la base (alta y acceso, que van por funciones SECURITY DEFINER).
 */
export async function withUser<T>(
  userId: string | null,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Parametrizado, no interpolado: `app.user_id` acaba en el cuerpo de cada
    // política y aquí es donde entraría una inyección si se concatenara.
    await client.query("select set_config('app.user_id', $1, true)", [userId ?? ""]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
