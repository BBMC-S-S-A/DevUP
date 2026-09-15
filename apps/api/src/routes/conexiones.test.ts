/**
 * Pruebas de la credencial VIGENTE de un espacio.
 *
 * QUÉ FALLO FIJA ESTO. Conectar GitHub insertaba una fila nueva y las
 * consultas que buscaban el token pedían `order by created_at limit 1` — la
 * más VIEJA. O sea que la primera credencial que un espacio tuvo en su vida se
 * quedaba elegida para siempre: cuando caducaba, la integración se rompía y
 * volver a pulsar «Conectar» no arreglaba nada, porque creaba una fila más
 * nueva que nadie iba a mirar. En los registros de producción se veía como «el
 * token no vale: caducado, revocado o mal pegado» una y otra vez, con el botón
 * de reconectar aparentemente sin efecto.
 *
 * LA COMPROBACIÓN QUE MÁS IMPORTA es la de los repositorios. La clave ajena de
 * `github_repos.connection_id` es `on delete set null` (0034), así que retirar
 * la conexión vieja sin reapuntar antes convertiría cada repositorio privado
 * en uno «público sin token» — seguirían en la lista y dejarían de leerse, que
 * es la forma silenciosa de romperlo. El orden (reapuntar, luego borrar) es lo
 * único que lo impide, y por eso se prueba el resultado y no la intención.
 *
 *   npm run test:conexiones
 */
import { closePool, withUser } from "../db/pool.js";
import { conexionVigente, reemplazarConexionGithub } from "./connections.js";
import { encryptSecret } from "../security/vault.js";

let total = 0;
const fallos: string[] = [];

function check(nombre: string, condicion: boolean): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos.push(nombre);
    console.log(`  ✗ ${nombre}`);
  }
}

const sufijo = Date.now().toString(36);

async function main(): Promise<void> {
  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  await admin.query("set search_path to public");

  const ana = (
    await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
      `ana-conexiones-${sufijo}@devup.test`,
      "no-se-usa",
      "Ana Conexiones",
    ])
  ).rows[0]!.id;

  try {
    const ws = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          `Acme ${sufijo}`,
          `acme-conexiones-${sufijo}`,
        ])
      ).rows[0]!.id;
      const { rows } = await db.query<{ id: string }>(
        "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
        [org, "Producto", ana],
      );
      return rows[0]!.id;
    });

    /** Conecta GitHub como lo hace la ruta: fila, secreto y reemplazo. */
    const conectarGithub = (nombre: string, secreto: string): Promise<string> =>
      withUser(ana, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `insert into connections (provider, workspace_id, display_name, created_by)
           values ('github',$1,$2,$3) returning id`,
          [ws, nombre, ana],
        );
        const id = rows[0]!.id;
        await db.query(
          "insert into connection_secrets (connection_id, encrypted_secret) values ($1,$2)",
          [id, encryptSecret(secreto)],
        );
        await reemplazarConexionGithub(db, ws, id);
        return id;
      });

    const githubDelEspacio = (): Promise<string[]> =>
      withUser(ana, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          "select id from connections where workspace_id = $1 and provider = 'github'",
          [ws],
        );
        return rows.map((r) => r.id);
      });

    console.log("\nLa credencial vigente es la última, no la primera");

    const vieja = await conectarGithub("token-viejo", "ghp_caducado");
    check(
      "recién conectada, la vigente es esa",
      (await withUser(ana, (db) => conexionVigente(db, ws, "github"))) === vieja,
    );

    // Un repositorio privado añadido con la credencial vieja, que es el que
    // deja de leerse si el reemplazo se hace en el orden equivocado.
    const repo = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into github_repos (connection_id, workspace_id, organization_id, full_name, added_by)
         values ($1,$2,(select organization_id from workspaces where id = $2),$3,$4) returning id`,
        [vieja, ws, `acme-${sufijo}/privado`, ana],
      );
      return rows[0]!.id;
    });

    const nueva = await conectarGithub("token-nuevo", "ghp_bueno");

    check("reconectar cambia la vigente", nueva !== vieja);
    check(
      "y la vigente es la nueva, que es lo que el botón promete",
      (await withUser(ana, (db) => conexionVigente(db, ws, "github"))) === nueva,
    );
    check("la vieja ya no está: reconectar reemplaza, no acumula", (await githubDelEspacio()).length === 1);

    const apunta = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ connection_id: string | null }>(
        "select connection_id from github_repos where id = $1",
        [repo],
      );
      return rows[0]!.connection_id;
    });
    check("el repositorio privado pasa a leerse con la credencial nueva", apunta === nueva);
    check("y sobre todo NO se quedó sin ninguna, que es el 404 silencioso", apunta !== null);

    const secretosVivos = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from connection_secrets s
           join connections c on c.id = s.connection_id
          where c.workspace_id = $1 and c.provider = 'github'`,
        [ws],
      );
      return Number(rows[0]!.n);
    });
    check("el secreto de la credencial jubilada se va con ella", secretosVivos === 1);

    console.log("\nLo que ya está acumulado en producción se cura solo");

    /**
     * ESTE ES EL CASO QUE HABÍA QUE ARREGLAR SIN PEDIRLE NADA A NADIE. En
     * producción ya hay espacios con VARIAS conexiones de GitHub apiladas, de
     * cuando reconectar insertaba sin reemplazar. Esas filas no las limpia el
     * reemplazo hasta que alguien vuelva a pulsar el botón, así que el orden
     * tiene que bastar por sí solo: gana la última, y la integración revive en
     * el despliegue.
     *
     * Por eso aquí se insertan A MANO, sin llamar a `reemplazarConexionGithub`:
     * es la única forma de reproducir el estado que ya existe ahí fuera.
     *
     * Y CADA UNA EN SU PROPIA TRANSACCIÓN, que no es un detalle de estilo. El
     * `created_at` por defecto es `now()`, que en Postgres es la hora de la
     * TRANSACCIÓN, no de la sentencia: metidas las dos de golpe salen con el
     * mismo instante y entonces «la última» no significa nada. Cada reconexión
     * de verdad es una petición HTTP aparte, así que así es como hay que
     * reproducirlo — la primera versión de esta prueba las insertaba juntas y
     * fallaba por eso, no por el código.
     */
    const apiladas: string[] = [];
    for (const nombre of ["apilada-1", "apilada-2"]) {
      apiladas.push(
        await withUser(ana, async (db) => {
          const { rows } = await db.query<{ id: string }>(
            `insert into connections (provider, workspace_id, display_name, created_by)
             values ('github',$1,$2,$3) returning id`,
            [ws, nombre, ana],
          );
          return rows[0]!.id;
        }),
      );
    }
    check("quedan tres apiladas, como en producción", (await githubDelEspacio()).length === 3);
    check(
      "y la vigente es la última, no la primera que hubo",
      (await withUser(ana, (db) => conexionVigente(db, ws, "github"))) === apiladas[1],
    );

    // Se deja el espacio con una sola otra vez, para que lo de abajo se lea
    // sobre un estado limpio.
    await withUser(ana, (db) => reemplazarConexionGithub(db, ws, apiladas[1]!));

    console.log("\nCada proveedor va por su cuenta");

    const pgVieja = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into connections (provider, workspace_id, display_name, created_by)
         values ('postgres',$1,'base vieja',$2) returning id`,
        [ws, ana],
      );
      return rows[0]!.id;
    });
    check(
      "una conexión de Postgres no la toca el reemplazo de GitHub",
      (await withUser(ana, (db) => conexionVigente(db, ws, "postgres"))) === pgVieja,
    );

    const pgNueva = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into connections (provider, workspace_id, display_name, created_by)
         values ('postgres',$1,'base nueva',$2) returning id`,
        [ws, ana],
      );
      return rows[0]!.id;
    });
    check(
      "y volver a pegar una cadena de Postgres hace que valga la nueva",
      (await withUser(ana, (db) => conexionVigente(db, ws, "postgres"))) === pgNueva,
    );
    check(
      "la de GitHub sigue siendo la suya",
      (await withUser(ana, (db) => conexionVigente(db, ws, "github"))) === apiladas[1],
    );

    console.log("\nSin conexión no se inventa ninguna");
    check(
      "un proveedor que este espacio no ha conectado devuelve null",
      (await withUser(ana, (db) => conexionVigente(db, ws, "railway"))) === null,
    );
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [
      `%-conexiones-${sufijo}`,
    ]);
    await admin.query("delete from public.users where email like $1", [
      `%-conexiones-${sufijo}@devup.test`,
    ]);
    await admin.end();
    await closePool();
  }

  console.log(`\n${total - fallos.length} comprobaciones correctas, ${fallos.length} fallidas`);
  if (fallos.length > 0) {
    console.error("\nFallaron:\n" + fallos.map((f) => `  · ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
