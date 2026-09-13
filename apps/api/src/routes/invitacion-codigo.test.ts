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

    /* =======================================================================
     * Dar otro código a una invitación que ya existe (0047)
     *
     * Es una puerta de entrada a una organización, así que lo que se comprueba
     * no es que funcione —eso se ve en cuanto se usa— sino las cuatro formas
     * que tiene de estar mal sin hacer ruido: que el código viejo siga
     * abriendo, que el enlace se rompa de paso, que lo pueda hacer quien no es
     * administrador, y que decir «esa invitación no existe» y «no es tuya» con
     * frases distintas convierta la ruta en un detector de invitaciones ajenas.
     * ==================================================================== */

    console.log("\nDar otro código");

    // Una persona que está en la organización pero NO manda: es el caso que
    // más se parece a alguien legítimo, y el que más importa que falle.
    const raso = await alta("raso");
    await admin.query(
      `insert into organization_members (organization_id, user_id, role, all_workspaces)
       values ($1,$2,'member',true) on conflict do nothing`,
      [org, raso],
    );

    const conCodigo = `renueva-invit-${sufijo}@devup.test`;
    const { codigo: viejo, token: suToken } = await invitar(conCodigo, null);
    const invitacionId = (
      await admin.query<{ id: string }>(
        "select id from invitations where organization_id = $1 and email = $2",
        [org, conCodigo],
      )
    ).rows[0]!.id;

    const darCodigo = (quien: string, invitacion: string, codigo: string) =>
      withUser(quien, (db) =>
        db.query("select public.set_invitation_code($1,$2,$3)", [
          invitacion,
          hashDeInvitacion(codigo),
          new Date(Date.now() + UN_DIA).toISOString(),
        ]),
      );

    const nuevo = nuevoCodigo();
    check(
      "quien manda en la organización puede dar otro código",
      (await codigoDeError(() => darCodigo(ana, invitacionId, nuevo))) === "sin error",
    );

    // La que justifica que exista la función: renovar NO puede romper el
    // enlace, porque puede estar ya abierto en el móvil de la otra persona. Es
    // toda la diferencia con reinvitar, que era la salida de mientras.
    const mirarPorToken = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ expired: boolean }>(
        "select expired from public.invitation_by_token($1)",
        [hashDeInvitacion(suToken)],
      );
      return rows[0]?.expired;
    });
    check("y el enlace de esa invitación sigue vivo", mirarPorToken === false);

    const fulano = await alta("fulano");
    check(
      "el código viejo ya no abre nada",
      (await codigoDeError(() => canjear(fulano, viejo))) === "P0002",
    );
    check(
      "y el nuevo sí",
      (await codigoDeError(() => canjear(fulano, nuevo))) === "sin error",
    );

    console.log("\nY quién no puede");

    const otra = `otra-invit-${sufijo}@devup.test`;
    await invitar(otra, null);
    const otraId = (
      await admin.query<{ id: string }>(
        "select id from invitations where organization_id = $1 and email = $2",
        [org, otra],
      )
    ).rows[0]!.id;

    // Lo que estaría en juego si esto pasara: quien pueda dar código a una
    // invitación de administrador se pone a sí mismo de administrador.
    check(
      "un miembro raso no puede dar código",
      (await codigoDeError(() => darCodigo(raso, otraId, nuevoCodigo()))) === "42501",
    );
    check(
      "y alguien de fuera tampoco",
      (await codigoDeError(() => darCodigo(carla, otraId, nuevoCodigo()))) === "42501",
    );

    // Y las dos negativas tienen que ser INDISTINGUIBLES de la de una
    // invitación inventada. Si «no existe» contestara distinto de «no es
    // tuya», se podrían probar identificadores hasta averiguar qué
    // invitaciones tiene abiertas otra organización.
    const inventada = "00000000-0000-0000-0000-000000000000";
    check(
      "y una invitación inventada contesta lo mismo que una ajena",
      (await codigoDeError(() => darCodigo(carla, inventada, nuevoCodigo()))) ===
        (await codigoDeError(() => darCodigo(carla, otraId, nuevoCodigo()))),
    );

    // Sobre una ya aceptada se dice que no en vez de escribir en silencio: el
    // código quedaría vivo para quien lo dicta y muerto para `accept_invitation`,
    // que exige `accepted_at is null`. Nadie ataría los dos cabos.
    check(
      "sobre una invitación ya aceptada, no",
      (await codigoDeError(() => darCodigo(ana, invitacionId, nuevoCodigo()))) === "23505",
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
