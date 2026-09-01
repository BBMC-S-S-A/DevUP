/**
 * Runner de migraciones.
 *
 * Se conecta como propietario del esquema (DATABASE_ADMIN_URL), no como la
 * aplicación. Cada archivo se aplica una sola vez, dentro de su propia
 * transacción, y queda anotado con su checksum: si alguien edita una migración
 * ya aplicada, el runner lo detecta y para en vez de dejar dos entornos con
 * esquemas distintos y el mismo número de versión.
 *
 *   npm run db:migrate
 *   npm run db:reset     # borra el esquema y lo reconstruye (solo desarrollo)
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import { CAMINO_BUSQUEDA, esBaseLocal, opcionesTls } from "./conexion.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
loadEnv({ path: join(repoRoot, ".env") });

const MIGRATIONS_DIR = join(repoRoot, "db", "migrations");
const GRANTS_FILE = join(repoRoot, "db", "grants.sql");

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Falta ${name}: ${hint}`);
    process.exit(1);
  }
  return value;
}

const adminUrl = required(
  "DATABASE_ADMIN_URL",
  "es la conexión del propietario del esquema. Copia .env.example a .env.",
);
const appPassword = required(
  "APP_DB_PASSWORD",
  "es la contraseña del rol devup_app, con el que se conecta la API.",
);

const reset = process.argv.includes("--reset");

/**
 * Cita un literal para Postgres duplicando las comillas simples, que es el
 * escape correcto con standard_conforming_strings activado (el valor por
 * defecto desde 9.1). Se rechaza el byte nulo porque Postgres no lo admite
 * dentro de un texto y el error que da es de los que no se entienden.
 */
function quoteLiteral(value: string): string {
  if (value.includes("\0")) {
    throw new Error("APP_DB_PASSWORD no puede contener un byte nulo");
  }
  return `'${value.replace(/'/g, "''")}'`;
}

async function main(): Promise<void> {
  const client = new pg.Client({
    connectionString: adminUrl,
    ssl: opcionesTls(adminUrl),
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();

  try {
    // Antes de nada, el camino de búsqueda. En Supabase las extensiones viven en
    // el esquema `extensions`, y sin esto la 0001 se cae en la primera columna
    // `citext` con «type citext does not exist» — un error que no menciona en
    // ningún momento que el problema sea dónde está mirando.
    await client.query(`set search_path to ${CAMINO_BUSQUEDA}`);
    if (reset) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("--reset está desactivado con NODE_ENV=production");
      }
      // Y además, nunca contra una base que no sea local. `NODE_ENV` es una
      // variable de entorno que se olvida de poner; la dirección de la base no
      // se olvida, porque es la que decide a quién le estás borrando el
      // esquema. En Supabase, `drop schema public cascade` no solo se lleva
      // nuestras 45 tablas: se lleva lo que el propio Supabase tenga ahí.
      if (!esBaseLocal(adminUrl)) {
        throw new Error(
          "--reset solo funciona contra una base local. DATABASE_ADMIN_URL " +
            "apunta a una máquina remota, y esto borraría el esquema entero.",
        );
      }
      console.log("· Borrando el esquema public y reconstruyéndolo");
      await client.query("drop schema if exists public cascade");
      await client.query("create schema public");
    }

    // El rol de la aplicación tiene que existir antes de los grants.
    //
    // CREATE ROLE es una sentencia de utilidad: no admite parámetros de
    // consulta, y un bloque DO tampoco. La contraseña hay que citarla a mano,
    // que es justo donde se cuela una inyección si uno se confía.
    const { rows: roleRows } = await client.query<{ exists: boolean }>(
      "select exists (select 1 from pg_roles where rolname = 'devup_app') as exists",
    );
    const verb = roleRows[0]?.exists ? "alter" : "create";
    await client.query(
      `${verb} role devup_app login password ${quoteLiteral(appPassword)}`,
    );

    await client.query(`
      create table if not exists public.schema_migrations (
        name       text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows: applied } = await client.query<{ name: string; checksum: string }>(
      "select name, checksum from public.schema_migrations",
    );
    const appliedByName = new Map(applied.map((r) => [r.name, r.checksum]));

    let ran = 0;
    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16);
      const previous = appliedByName.get(file);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `La migración ${file} ya se aplicó pero su contenido ha cambiado ` +
              `(${previous} → ${checksum}). Escribe una migración nueva en vez ` +
              `de editar una aplicada.`,
          );
        }
        continue;
      }

      process.stdout.write(`· ${file} `);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into public.schema_migrations (name, checksum) values ($1, $2)",
          [file, checksum],
        );
        await client.query("commit");
        console.log("✓");
        ran += 1;
      } catch (error) {
        await client.query("rollback");
        console.log("✗");
        throw error;
      }
    }

    // Los grants se reaplican siempre: son idempotentes y así una migración
    // que añade tablas no obliga a acordarse de nada.
    await client.query(await readFile(GRANTS_FILE, "utf8"));

    console.log(
      ran === 0
        ? "Sin migraciones pendientes; privilegios reaplicados."
        : `${ran} migración(es) aplicada(s); privilegios reaplicados.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("\nLa migración falló:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
