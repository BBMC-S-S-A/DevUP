/**
 * El código corto de invitación, contra la base.
 *
 * QUÉ CUBRE ESTO Y QUÉ NO. `lib/codigo.test.ts` prueba la mitad de arriba —cómo
 * se genera, qué formas se perdonan al teclearlo, qué se rechaza— y es lógica
 * pura. Lo de aquí es la otra mitad, la que solo se puede comprobar contra
 * Postgres: que el código **no abra más puertas que el enlace**.
 *
 * PORQUE ES UNA PUERTA DE ENTRADA A UNA ORGANIZACIÓN. Quien teclea ocho
 * caracteres acaba dentro, con un rol y con acceso a unos espacios. Los fallos
 * de esta clase no los reporta nadie —nadie abre una incidencia porque entró de
 * más— y el precio de equivocarse es que alguien lea el tablero de un cliente
 * que no es suyo.
 *
 * LAS CUATRO QUE IMPORTAN:
 *
 *   · Un código solo vale una vez. Es lo que separa una invitación de una
 *     contraseña compartida.
 *   · Reinvitar mata el código anterior. Si no, cada reinvitación dejaría una
 *     llave más rodando y nadie sabría cuántas hay vivas.
 *   · El código caduca ANTES que el enlace —un día contra siete—, porque ocho
 *     caracteres se prueban a lo bruto de una forma que un token de 32 bytes
 *     no. Una caducidad que no se aplicara dejaría esa ventana abierta la
 *     semana entera.
 *   · Entrar por código da exactamente el mismo acceso que entrar por enlace.
 *     Si diera acceso general donde el enlace daba solo un espacio, invitar a
 *     un espacio concreto dejaría de significar nada en cuanto alguien usara
 *     el código.
 *
 *   npm run test:invitacion --workspace apps/api
 */
import { closePool, withUser } from "../db/pool.js";
import { hashDeInvitacion } from "./account.js";
import { nuevoCodigo } from "../lib/codigo.js";

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

/** El SQLSTATE del fallo, o "sin error". */
async function codigoDeError(accion: () => Promise<unknown>): Promise<string> {
  try {
    await accion();
    return "sin error";
  } catch (fallo) {
    return (fallo as { code?: string }).code ?? "desconocido";
  }
}

const sufijo = Date.now().toString(36);
const UN_DIA = 24 * 3600_000;

async function main(): Promise<void> {
  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  await admin.query("set search_path to public");

  const alta = async (nombre: string): Promise<string> =>
    (
      await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
        `${nombre}-invit-${sufijo}@devup.test`,
        "no-se-usa",
        nombre,
      ])
    ).rows[0]!.id;

  const ana = await alta("ana");
  const beto = await alta("beto");
  const carla = await alta("carla");

  try {
    const { org, ws } = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          `Acme ${sufijo}`,
          `acme-invit-${sufijo}`,
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

    /** Invita y devuelve las DOS puertas en claro, como hace la ruta. */
    const invitar = async (
      correo: string,
      workspace: string | null,
      vidaDelCodigo = UN_DIA,
    ): Promise<{ codigo: string; token: string }> => {
      const codigo = nuevoCodigo();
      const token = `token-${correo}-${Math.random()}`;
      await withUser(ana, (db) =>
        db.query("select public.create_invitation($1,$2,$3,$4,$5,$6,$7,$8)", [
          org,
          correo,
          "member",
          hashDeInvitacion(token),
          new Date(Date.now() + 7 * UN_DIA).toISOString(),
          workspace,
          hashDeInvitacion(codigo),
          new Date(Date.now() + vidaDelCodigo).toISOString(),
        ]),
      );
      return { codigo, token };
    };

    const canjear = (quien: string, loQueSePega: string) =>
      withUser(quien, (db) =>
        db.query("select public.accept_invitation($1,$2)", [
          hashDeInvitacion(loQueSePega),
          quien,
        ]),
      );

    console.log("\nUn código vale una vez");

    const { codigo: deBeto } = await invitar(`beto-invit-${sufijo}@devup.test`, null);
    check(
      "se canjea a la primera",
      (await codigoDeError(() => canjear(beto, deBeto))) === "sin error",
    );
    check(
      "y a la segunda ya no",
      (await codigoDeError(() => canjear(beto, deBeto))) !== "sin error",
    );

    // Se perdona cómo se teclea: el que lo recibe por teléfono lo escribe en
    // minúsculas o con el guion de enseñarlo. Si esto se rompiera, el código
    // sería correcto y no entraría, que es el fallo más desesperante posible.
    const { codigo: deCarla } = await invitar(`carla-invit-${sufijo}@devup.test`, ws);
    check(
      "en minúsculas y con guion entra igual",
      (await codigoDeError(() =>
        canjear(carla, `${deCarla.slice(0, 4)}-${deCarla.slice(4)}`.toLowerCase()),
      )) === "sin error",
    );

    console.log("\nEl código no abre más que el enlace");

    // Carla entró por CÓDIGO a una invitación de UN espacio. Tiene que quedar
    // igual que si hubiera pinchado el enlace: dentro de ese espacio y sin
    // acceso general al resto.
    const comoQuedo = await admin.query<{ all_workspaces: boolean }>(
      "select all_workspaces from organization_members where organization_id = $1 and user_id = $2",
      [org, carla],
    );
    const enElEspacio = await admin.query(
      "select 1 from workspace_members where workspace_id = $1 and user_id = $2",
      [ws, carla],
    );
    check("entra al espacio al que la invitaron", enElEspacio.rowCount === 1);
    check("y sin acceso general al resto", comoQuedo.rows[0]?.all_workspaces === false);

    console.log("\nReinvitar mata el código anterior");

    const correoDeDani = `dani-invit-${sufijo}@devup.test`;
    const { codigo: primero } = await invitar(correoDeDani, null);
    const { codigo: segundo } = await invitar(correoDeDani, null);
    const dani = await alta("dani");

    // Si el primero siguiera sirviendo, cada reinvitación dejaría una llave más
    // rodando por ahí y nadie sabría cuántas hay vivas.
    check(
      "el primero deja de valer",
      (await codigoDeError(() => canjear(dani, primero))) !== "sin error",
    );
    check(
      "y el segundo sí vale",
      (await codigoDeError(() => canjear(dani, segundo))) === "sin error",
    );

    console.log("\nEl código caduca antes que el enlace");

    // Un día contra siete: ocho caracteres se prueban a lo bruto de una forma
    // que un token de 32 bytes no. Se fabrica uno ya caducado.
    const elena = await alta("elena");
    const { codigo: caducado, token: suEnlace } = await invitar(
      `elena-invit-${sufijo}@devup.test`,
      null,
      -1000,
    );
    check(
      "un código caducado no entra",
      (await codigoDeError(() => canjear(elena, caducado))) !== "sin error",
    );

    /**
     * Y la otra mitad de esa decisión: el ENLACE sigue vivo.
     *
     * `invitation_by_token` contesta según POR DÓNDE se pregunte, y es lo
     * correcto: preguntando con el código dice caducada —porque para quien
     * teclea el código lo está—, y preguntando con el token dice que no. Si
     * las dos ventanas se hubieran fundido en una, acortar la vida del código
     * habría acortado la de la invitación entera sin que nadie lo pidiera.
     */
    const mirar = (loQueSePega: string) =>
      withUser(null, async (db) => {
        const { rows } = await db.query<{ expired: boolean }>(
          "select expired from public.invitation_by_token($1)",
          [hashDeInvitacion(loQueSePega)],
        );
        return rows[0]?.expired;
      });

    check("preguntando por el código, dice que caducó", (await mirar(caducado)) === true);
    check("preguntando por el enlace, dice que no", (await mirar(suEnlace)) === false);
    check(
      "y por el enlace sí se entra",
      (await codigoDeError(() => canjear(elena, suEnlace))) === "sin error",
    );
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [`%-invit-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [
      `%-invit-${sufijo}@devup.test`,
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
