/**
 * Pruebas del código corto de invitación.
 *
 * POR QUÉ ESTO SE PRUEBA Y NO SE DA POR BUENO. Un código corto es una puerta de
 * entrada a una organización: quien lo teclea acaba dentro, con un rol y con
 * acceso a unos espacios. Es la clase de código donde un fallo no se ve —nadie
 * abre una incidencia porque entró DE MÁS— y donde el precio de equivocarse es
 * que alguien lea el tablero de un cliente que no es suyo.
 *
 * LAS DOS MITADES QUE SE COMPRUEBAN AQUÍ:
 *
 *   · La de arriba, en TypeScript: que normalizar perdone lo que tiene que
 *     perdonar (minúsculas, guiones, espacios, la O por el cero) y rechace lo
 *     que no. Si esto se relaja de más, dos códigos distintos acaban siendo el
 *     mismo; si se endurece, la mitad de la gente no consigue entrar y no sabe
 *     por qué.
 *
 *   · La de abajo, en Postgres: que solo un administrador pueda ponerle código
 *     a una invitación, que el código canjee en la organización correcta, que
 *     renovarlo mate al anterior y que uno ya usado no vuelva a valer.
 *
 * LA QUE MÁS IMPORTA es que `claim_invitation` no acepte un id. Es
 * `security definer` —se salta RLS para meter a alguien en una organización—,
 * así que pedir el hash es lo único que obliga a demostrar que se conoce el
 * secreto. Aquí se fija que la firma es esa y que rechaza los dos hashes a la
 * vez.
 *
 *   npm run test:codigo
 */
import { closePool, withUser } from "../db/pool.js";
import { formatearCodigo, hashCodigo, normalizarCodigo, nuevoCodigo } from "../lib/codigo-invitacion.js";

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

/** Devuelve el SQLSTATE del fallo, o "sin error" si no hubo. */
async function codigoDeError(accion: () => Promise<unknown>): Promise<string> {
  try {
    await accion();
    return "sin error";
  } catch (fallo) {
    return (fallo as { code?: string }).code ?? "desconocido";
  }
}

const sufijo = Date.now().toString(36);

async function main(): Promise<void> {
  console.log("\nGenerar y normalizar");

  const generados = Array.from({ length: 200 }, () => nuevoCodigo());
  check(
    "un código nuevo siempre es canónico",
    generados.every((c) => normalizarCodigo(c) === c),
  );
  check(
    "y no usa ninguna de las cuatro letras que Crockford deja fuera",
    generados.every((c) => !/[ILOU]/.test(c)),
  );
  check("200 códigos seguidos no repiten ninguno", new Set(generados).size === 200);

  const canonico = "0123456G";
  check("como se enseña lleva guion en medio", formatearCodigo(canonico) === "0123-456G");
  check("y lo que se enseña vuelve a entrar tal cual", normalizarCodigo("0123-456G") === canonico);
  check("en minúsculas también", normalizarCodigo("0123-456g") === canonico);
  check("con espacios de quien lo escribe al dictado", normalizarCodigo("01 23 45 6G") === canonico);

  // La mitad del valor del alfabeto: perdonar la confusión de quien lo oyó.
  check("la O se lee como el cero", normalizarCodigo("O123456G") === "0123456G");
  check("la I y la L se leen como el uno", normalizarCodigo("IL23456G") === "1123456G");

  check("un código corto no cuela", normalizarCodigo("0123") === null);
  check("uno largo tampoco", normalizarCodigo("0123456GH") === null);
  // La U no se mapea a nada: no se parece a ningún símbolo del alfabeto, así
  // que una U es un error de verdad y conviene que lo parezca.
  check("la U se rechaza en vez de adivinarse", normalizarCodigo("U123456G") === null);
  check("y lo vacío también", normalizarCodigo("") === null && normalizarCodigo("----") === null);

  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  await admin.query("set search_path to public");

  const nuevoUsuario = async (nombre: string): Promise<string> =>
    (
      await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
        `${nombre}-codigo-${sufijo}@devup.test`,
        "no-se-usa",
        nombre,
      ])
    ).rows[0]!.id;

  const ana = await nuevoUsuario("ana");
  const beto = await nuevoUsuario("beto");
  const carla = await nuevoUsuario("carla");

  try {
    const { org, ws } = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          `Acme ${sufijo}`,
          `acme-codigo-${sufijo}`,
        ])
      ).rows[0]!.id;
      const ws = (
        await db.query<{ id: string }>(
          "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
          [org, "Producto", ana],
        )
      ).rows[0]!.id;
      return { org, ws };
    });

    const invitar = (correo: string, workspace: string | null): Promise<string> =>
      withUser(ana, async (db) => {
        const { rows } = await db.query<{ create_invitation: string }>(
          "select public.create_invitation($1,$2,$3,$4,$5,$6)",
          [
            org,
            correo,
            "member",
            `hash-${correo}-${workspace ?? "org"}-${sufijo}`,
            new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
            workspace,
          ],
        );
        return rows[0]!.create_invitation;
      });

    const ponerCodigo = (quien: string, invitacion: string, codigo: string): Promise<unknown> =>
      withUser(quien, (db) =>
        db.query("select public.set_invitation_code($1,$2)", [invitacion, hashCodigo(codigo)]),
      );

    console.log("\nQuién puede ponerle código a una invitación");

    const paraBeto = await invitar(`beto-codigo-${sufijo}@devup.test`, null);
    const codigoDeBeto = nuevoCodigo();

    check(
      "quien no es de la organización no puede darle código a una invitación suya",
      (await codigoDeError(() => ponerCodigo(carla, paraBeto, nuevoCodigo()))) === "42501",
    );
    check(
      "el administrador sí",
      (await codigoDeError(() => ponerCodigo(ana, paraBeto, codigoDeBeto))) === "sin error",
    );
    check(
      "y una invitación que no existe se dice, no se ignora",
      (await codigoDeError(() =>
        ponerCodigo(ana, "00000000-0000-0000-0000-000000000000", nuevoCodigo()),
      )) === "P0002",
    );

    console.log("\nMirar la invitación por el código, sin sesión");

    const vista = await withUser(null, async (db) => {
      const { rows } = await db.query<{ organization_id: string; email: string }>(
        "select organization_id, email::text as email from public.invitation_by_code($1)",
        [hashCodigo(codigoDeBeto)],
      );
      return rows[0] ?? null;
    });
    check("el código lleva a su invitación", vista?.organization_id === org);
    check("y dice para quién era", vista?.email === `beto-codigo-${sufijo}@devup.test`);

    const inventado = await withUser(null, async (db) => {
      const { rows } = await db.query("select id from public.invitation_by_code($1)", [
        hashCodigo(nuevoCodigo()),
      ]);
      return rows.length;
    });
    check("un código inventado no lleva a ninguna", inventado === 0);

    console.log("\nRenovar mata al anterior");

    const segundoCodigo = nuevoCodigo();
    await ponerCodigo(ana, paraBeto, segundoCodigo);

    const viejoSirve = await withUser(null, async (db) => {
      const { rows } = await db.query("select id from public.invitation_by_code($1)", [
        hashCodigo(codigoDeBeto),
      ]);
      return rows.length > 0;
    });
    // Si esto se rompiera, cada renovación dejaría una llave más rodando por
    // ahí, y nadie tendría forma de saber cuántas hay vivas.
    check("el código anterior deja de servir al renovarlo", !viejoSirve);

    console.log("\nCanjear");

    const dondeEntro = await withUser(beto, async (db) => {
      const { rows } = await db.query<{ accept_invitation_by_code: string }>(
        "select public.accept_invitation_by_code($1,$2)",
        [hashCodigo(segundoCodigo), beto],
      );
      return rows[0]!.accept_invitation_by_code;
    });
    check("canjear el código mete a la persona en la organización", dondeEntro === org);

    const acceso = await admin.query<{ all_workspaces: boolean }>(
      "select all_workspaces from organization_members where organization_id = $1 and user_id = $2",
      [org, beto],
    );
    check(
      "y una invitación a toda la organización da acceso general, como por enlace",
      acceso.rows[0]?.all_workspaces === true,
    );

    check(
      "el mismo código no vale dos veces",
      (await codigoDeError(() =>
        withUser(beto, (db) =>
          db.query("select public.accept_invitation_by_code($1,$2)", [
            hashCodigo(segundoCodigo),
            beto,
          ]),
        ),
      )) === "P0002",
    );
    check(
      "y a una invitación ya aceptada no se le da código nuevo",
      (await codigoDeError(() => ponerCodigo(ana, paraBeto, nuevoCodigo()))) === "22023",
    );

    console.log("\nInvitación a un espacio concreto");

    const paraCarla = await invitar(`carla-codigo-${sufijo}@devup.test`, ws);
    const codigoDeCarla = nuevoCodigo();
    await ponerCodigo(ana, paraCarla, codigoDeCarla);
    await withUser(carla, (db) =>
      db.query("select public.accept_invitation_by_code($1,$2)", [hashCodigo(codigoDeCarla), carla]),
    );

    const deCarla = await admin.query<{ all_workspaces: boolean }>(
      "select all_workspaces from organization_members where organization_id = $1 and user_id = $2",
      [org, carla],
    );
    const enEspacio = await admin.query(
      "select 1 from workspace_members where workspace_id = $1 and user_id = $2",
      [ws, carla],
    );
    // El código no puede ser una puerta más ancha que el enlace. Si por aquí
    // se entrara con acceso general, invitar a un solo espacio dejaría de
    // significar nada en cuanto alguien usara el código en vez del correo.
    check("por código se entra al espacio invitado", enEspacio.rowCount === 1);
    check("y sin acceso general al resto, igual que por enlace", deCarla.rows[0]?.all_workspaces === false);

    console.log("\nLa puerta de atrás que no existe");

    // `claim_invitation` recibe hashes, no ids, justo para que conocer el id de
    // una invitación ajena no sirva de nada. Que la firma por id no exista es
    // parte del contrato: si alguien la añadiera «por comodidad», esto avisa.
    check(
      "no hay forma de canjear una invitación sabiendo solo su id",
      (await codigoDeError(() =>
        withUser(carla, (db) =>
          db.query("select public.claim_invitation($1::uuid,$2::uuid)", [paraBeto, carla]),
        ),
      )) !== "sin error",
    );
    check(
      "y pasar los dos hashes a la vez se rechaza en vez de elegir uno",
      (await codigoDeError(() =>
        withUser(carla, (db) =>
          db.query("select public.claim_invitation($1,$2,$3)", ["algo", "otra-cosa", carla]),
        ),
      )) === "22023",
    );
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [`%-codigo-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [
      `%-codigo-${sufijo}@devup.test`,
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
