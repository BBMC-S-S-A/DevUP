// Comprueba que la base de Supabase quedó bien, y dice en castellano qué falla.
//
// POR QUÉ HACE FALTA, Y POR QUÉ NO BASTA CON QUE LAS MIGRACIONES PASEN. El
// aislamiento entre organizaciones no vive en el código de la API: vive en que
// `devup_app` sea un rol corriente sobre unas tablas que no son suyas. Postgres
// se salta las políticas para el propietario de la tabla, y también para un rol
// con BYPASSRLS. Si al montar la base nueva la API acaba conectándose con el rol
// que ejecutó las migraciones, todo sigue funcionando —las pantallas cargan, no
// hay ningún error— y cada organización ve los datos de todas las demás.
//
// Eso no lo detecta un despliegue que «pasó». Por eso esto se ejecuta después de
// migrar y antes de dar la base por buena.
//
//   npm run supabase:comprobar
//   npm run supabase:comprobar -- .env.production
//
// Nunca imprime contraseñas ni cadenas de conexión: solo el nombre de máquina.

import { existsSync } from "node:fs";
import { config as cargarEnv } from "dotenv";
import pg from "pg";

const ficheroEnv = process.argv[2] ?? ".env";

if (!existsSync(ficheroEnv)) {
  console.error(`no encuentro ${ficheroEnv}`);
  process.exit(1);
}
cargarEnv({ path: ficheroEnv, quiet: true });

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;

if (!APP) {
  console.error(
    `Falta DATABASE_URL en ${ficheroEnv}: es la conexión de la aplicación, con el\n` +
      "rol devup_app. Sin ella no hay nada que comprobar.",
  );
  process.exit(1);
}

/**
 * La conexión de administrador es opcional, y no por pereza.
 *
 * Sirve para leer el catálogo —quién es dueño de qué, qué políticas hay— y para
 * contar filas. Pero lo que de verdad importa, si el aislamiento funciona, se
 * comprueba con el rol de la aplicación. Exigir la clave de `postgres` para
 * poder ejecutar esto obligaría a tenerla a mano más veces de las necesarias, y
 * es la clave que se salta todas las políticas.
 */
const sinAdmin =
  !ADMIN || /PON_AQUI|YOUR-PASSWORD|\[[^\]]*\]/.test(ADMIN) || ADMIN.includes("@postgres:");

const LOCALES = new Set(["localhost", "127.0.0.1", "::1", "postgres", "db"]);

function maquina(url) {
  try {
    return new URL(url.replace(/^postgres(ql)?:\/\//, "http://")).hostname;
  } catch {
    return "(ilegible)";
  }
}

function tls(url) {
  if (LOCALES.has(maquina(url))) return undefined;
  if (process.env.DATABASE_SSL_INSECURE === "true") return { rejectUnauthorized: false };
  const ca = process.env.DATABASE_SSL_CA;
  if (ca?.includes("BEGIN CERTIFICATE")) return { rejectUnauthorized: true, ca };
  return { rejectUnauthorized: true };
}

let fallos = 0;
let avisos = 0;
const bien = (t) => console.log(`  ✓ ${t}`);
const mal = (t, arreglo) => {
  fallos++;
  console.log(`  ✗ ${t}`);
  if (arreglo) console.log(`      ${arreglo}`);
};
const ojo = (t) => {
  avisos++;
  console.log(`  ! ${t}`);
};

async function conectar(url, quien) {
  const cliente = new pg.Client({
    connectionString: url,
    ssl: tls(url),
    connectionTimeoutMillis: 15_000,
  });
  try {
    await cliente.connect();
    return cliente;
  } catch (error) {
    console.error(`\nNo se pudo conectar como ${quien} a ${maquina(url)}:`);
    console.error(`  ${error.message}`);
    if (/self.signed|unable to verify|certificate/i.test(error.message)) {
      console.error(
        "\n  Es el certificado, no la contraseña. Pon la CA de tu proveedor en\n" +
          "  DATABASE_SSL_CA (el PEM entero vale). DATABASE_SSL_INSECURE=true lo\n" +
          "  salta, pero entonces el cifrado ya no garantiza con quién hablas.",
      );
    }
    if (/password|authentication/i.test(error.message)) {
      console.error(
        "\n  Es la autenticación. Si es el rol de la aplicación, comprueba que\n" +
          "  APP_DB_PASSWORD y la contraseña dentro de DATABASE_URL son la misma:\n" +
          "  el runner de migraciones fija la del rol a partir de APP_DB_PASSWORD.",
      );
    }
    process.exit(1);
  }
}

console.log(`\nComprobando la base de ${maquina(APP)} · entorno ${ficheroEnv}\n`);

const admin = sinAdmin ? null : await conectar(ADMIN, "administrador");

/** Las del catálogo. Sin administrador quedan vacías y se dice por qué. */
let tablas = [];

if (!admin) {
  console.log(
    "Sin DATABASE_ADMIN_URL utilizable. Se omiten las comprobaciones de catálogo\n" +
      "—propiedad de las tablas, políticas, recuento de filas—. La prueba del\n" +
      "aislamiento no la necesita, y es la que decide.\n",
  );
} else {
  await revisarCatalogo();
}

async function revisarCatalogo() {
// --- 1. El servidor ---------------------------------------------------------
console.log("El servidor");
const { rows: [ver] } = await admin.query("select version(), current_user, current_database()");
console.log(`  · ${ver.version.split(" ").slice(0, 2).join(" ")} · rol ${ver.current_user} · base ${ver.current_database}`);

const { rows: ext } = await admin.query(
  `select e.extname, n.nspname as esquema
     from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname in ('citext','pgcrypto')`,
);
const citext = ext.find((e) => e.extname === "citext");
if (!citext) {
  mal("falta la extensión citext", "la crea la migración 0001; ejecuta npm run db:migrate");
} else {
  bien(`citext instalada en el esquema ${citext.esquema}`);
  if (citext.esquema !== "public") {
    // No es un fallo: es exactamente lo que hace Supabase. Pero sin el camino
    // de búsqueda ajustado, el tipo de la columna de correo no se resuelve.
    const { rows: [ruta] } = await admin.query(
      `select coalesce(
                (select array_to_string(rolconfig,' ') from pg_roles where rolname='devup_app'),
                '') as conf`,
    );
    if (ruta.conf.includes(citext.esquema)) {
      bien(`el rol devup_app lleva ${citext.esquema} en su search_path`);
    } else {
      mal(
        `devup_app no tiene ${citext.esquema} en su search_path`,
        "lo pone db/grants.sql; vuelve a ejecutar npm run db:migrate",
      );
    }
  }
}

// --- 2. El rol de la aplicación ---------------------------------------------
console.log("\nEl rol de la aplicación");
const { rows: [rol] } = await admin.query(
  `select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'devup_app'`,
);
if (!rol) {
  mal("no existe el rol devup_app", "lo crea npm run db:migrate a partir de APP_DB_PASSWORD");
} else {
  rol.rolcanlogin ? bien("puede iniciar sesión") : mal("no puede iniciar sesión");
  rol.rolsuper
    ? mal("es SUPERUSER — se salta TODAS las políticas", "alter role devup_app nosuperuser")
    : bien("no es superusuario");
  rol.rolbypassrls
    ? mal("tiene BYPASSRLS — se salta TODAS las políticas", "alter role devup_app nobypassrls")
    : bien("no tiene BYPASSRLS");
}

const { rows: propias } = await admin.query(
  `select tablename from pg_tables
    where schemaname = 'public' and tableowner = 'devup_app'`,
);
if (propias.length > 0) {
  mal(
    `es propietario de ${propias.length} tabla(s): ${propias.slice(0, 5).map((t) => t.tablename).join(", ")}`,
    "Postgres NO aplica RLS al propietario. Esas tablas están abiertas de par en par.",
  );
} else {
  bien("no es propietario de ninguna tabla");
}

// --- 3. Las políticas -------------------------------------------------------
console.log("\nLas tablas y sus políticas");
({ rows: tablas } = await admin.query(
  `select c.relname as tabla, c.relrowsecurity as rls,
          (select count(*) from pg_policies p
            where p.schemaname='public' and p.tablename=c.relname) as politicas
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname <> 'schema_migrations'
    order by c.relname`,
));
console.log(`  · ${tablas.length} tablas`);

const sinRls = tablas.filter((t) => !t.rls);
const sinPolitica = tablas.filter((t) => t.rls && Number(t.politicas) === 0);

sinRls.length === 0
  ? bien("todas tienen el aislamiento por filas encendido")
  : mal(
      `${sinRls.length} sin RLS: ${sinRls.map((t) => t.tabla).join(", ")}`,
      "sin RLS, cualquiera con el rol de la aplicación lee la tabla entera",
    );

// Una tabla con RLS y sin política no filtra datos: los esconde. Falla cerrada,
// así que no es un agujero — pero es la avería que más tiempo cuesta, porque
// devuelve cero filas sin un solo error y parece que no hay datos.
sinPolitica.length === 0
  ? bien("todas las que tienen RLS tienen al menos una política")
  : ojo(
      `${sinPolitica.length} con RLS y sin política (devolverán CERO filas, sin error): ` +
        sinPolitica.map((t) => t.tabla).join(", "),
    );

} // fin de revisarCatalogo

// --- 4. La prueba de verdad -------------------------------------------------
// Todo lo anterior lee metadatos. Esto pregunta a la base, con el rol real de
// la aplicación y sin identidad puesta: si devuelve algo, el aislamiento no
// está funcionando, dé lo que dé el catálogo.
console.log("\nLa prueba en caliente (rol real, sin identidad)");
const app = await conectar(APP, "la aplicación");

const { rows: [quien] } = await app.query("select current_user");
quien.current_user === "devup_app"
  ? bien("DATABASE_URL entra como devup_app")
  : mal(
      `DATABASE_URL entra como ${quien.current_user}, no como devup_app`,
      "si es el rol que creó las tablas, no se le aplica ninguna política",
    );

// `organizations` siempre existe desde la 0001; el catálogo solo se usa como
// respaldo por si algún día se renombra.
const objetivo =
  tablas.length === 0 || tablas.some((t) => t.tabla === "organizations")
    ? "organizations"
    : tablas[0].tabla;
if (objetivo) {
  await app.query("begin");
  try {
    const { rows: [c] } = await app.query(`select count(*)::int as n from public.${objetivo}`);
    c.n === 0
      ? bien(`sin identidad, ${objetivo} devuelve 0 filas`)
      : mal(
          `sin identidad, ${objetivo} devuelve ${c.n} filas`,
          "cualquier petición sin sesión estaría leyendo datos de todas las organizaciones",
        );
  } catch (error) {
    // Que deniegue el permiso también es una respuesta correcta, y más estricta.
    /permission denied/i.test(error.message)
      ? bien(`sin identidad, ${objetivo} deniega el permiso`)
      : mal(`la consulta de prueba falló: ${error.message}`);
  } finally {
    await app.query("rollback").catch(() => {});
  }
}

// --- 5. Cuántas filas hay ---------------------------------------------------
// Para poder comparar después de restaurar un respaldo: «arrancó» no es
// «están los datos». Necesita administrador: con el rol de la aplicación y sin
// identidad, todos los recuentos darían cero y no significarían nada.
if (admin) {
console.log("\nFilas por tabla (las no vacías)");
const conFilas = [];
for (const t of tablas) {
  const { rows: [c] } = await admin.query(`select count(*)::int as n from public.${t.tabla}`);
  if (c.n > 0) conFilas.push([t.tabla, c.n]);
}
if (conFilas.length === 0) {
  console.log("  · la base está vacía");
} else {
  for (const [tabla, n] of conFilas.sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(7)}  ${tabla}`);
  }
}

}

await admin?.end();
await app.end();

console.log(
  `\n${fallos === 0 ? "Todo correcto" : `${fallos} fallo(s)`}` +
    `${avisos ? ` · ${avisos} aviso(s)` : ""}\n`,
);
process.exit(fallos === 0 ? 0 : 1);
