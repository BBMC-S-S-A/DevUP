/**
 * Silenciar avisos, contra la base.
 *
 * LA QUE JUSTIFICA EL FICHERO ES LA INVITACIÓN. Las otras cuatro clases avisan
 * de algo que ya puedes ver por tu cuenta —la mención está en el canal, la
 * tarea en tu tablero, la grabación en su llamada—, así que silenciarlas es
 * menos ruido. La invitación no: si no te avisan, no hay ninguna pantalla donde
 * descubrirla, porque todavía no eres de esa organización. Silenciarla no es
 * menos ruido: es quedarte fuera sin enterarte. Por eso la lista es cerrada y
 * la función RECHAZA esa clase en vez de aceptarla.
 *
 * Y ESTAS OTRAS, QUE SE LEEN BIEN ESTANDO MAL:
 *
 *   · **Silenciar no crea la fila.** Si se creara y se escondiera al leer, el
 *     contador de no leídos contaría cosas que nadie va a ver, y «tienes 14»
 *     sobre una bandeja vacía es peor que no tener contador.
 *   · **Silenciar lo mío no silencia lo de nadie más.** La función no admite un
 *     `_user`, así que esto no es una comprobación de permisos: es que no hay
 *     forma de pedirlo. Se comprueba el otro lado, el de la tabla.
 *   · **Una clase inventada se rechaza, no se ignora.** Aceptar «menciones» en
 *     vez de «mention» dejaría a esa persona creyendo que silenció algo que le
 *     sigue llegando.
 *   · **Y lo que NO está silenciado sigue llegando**, que es lo que convierte
 *     esto en un filtro y no en un apagón.
 *
 *   npm run test:avisos --workspace apps/api
 */
import { closePool, withUser } from "../db/pool.js";

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

  const alta = async (nombre: string): Promise<string> =>
    (
      await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
        `${nombre}-avisos-${sufijo}@devup.test`,
        "no-se-usa",
        nombre,
      ])
    ).rows[0]!.id;

  const ana = await alta("Ana");
  const beto = await alta("Beto");

  try {
    const org = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "select public.create_organization($1,$2) as id",
        [`Acme ${sufijo}`, `acme-avisos-${sufijo}`],
      );
      return rows[0]!.id;
    });
    await admin.query(
      `insert into organization_members (organization_id, user_id, role, all_workspaces)
       values ($1,$2,'member',true) on conflict do nothing`,
      [org, beto],
    );

    /** Lo que hace cualquier sitio que avisa: `notify()` y nada más. */
    const avisar = (de: string, a: string, clase: string): Promise<string | null> =>
      withUser(de, async (db) => {
        const { rows } = await db.query<{ notify: string | null }>(
          "select public.notify($1,$2,$3,'','') as notify",
          [a, clase, `un ${clase}`],
        );
        return rows[0]!.notify;
      });

    const silenciar = (quien: string, clases: string[]) =>
      withUser(quien, (db) =>
        db.query("select public.set_my_avisos_silenciados($1::text[])", [clases]),
      );

    const bandejaDe = async (quien: string): Promise<number> =>
      Number(
        (
          await admin.query<{ n: string }>(
            "select count(*) as n from notifications where user_id = $1",
            [quien],
          )
        ).rows[0]!.n,
      );

    console.log("\nSin silenciar nada");

    check("un aviso llega", (await avisar(ana, beto, "mention")) !== null);
    check("y deja su fila", (await bandejaDe(beto)) === 1);

    console.log("\nSilenciado");

    await silenciar(beto, ["mention"]);
    check("el aviso silenciado no llega", (await avisar(ana, beto, "mention")) === null);
    // LO QUE IMPORTA: ni siquiera se escribe.
    check("y NO deja fila: la bandeja sigue igual", (await bandejaDe(beto)) === 1);

    check("lo que no silenció sigue llegando", (await avisar(ana, beto, "recording")) !== null);
    check("y esa sí deja fila", (await bandejaDe(beto)) === 2);

    console.log("\nLa invitación, que no se puede silenciar");

    const codigoDe = async (accion: () => Promise<unknown>): Promise<string> => {
      try {
        await accion();
        return "colo";
      } catch (fallo) {
        return (fallo as { code?: string }).code ?? "?";
      }
    };

    check(
      "silenciar invitaciones se rechaza",
      (await codigoDe(() => silenciar(beto, ["invitation"]))) === "22023",
    );
    check(
      "y una clase inventada también, en vez de ignorarse",
      (await codigoDe(() => silenciar(beto, ["menciones"]))) === "22023",
    );
    // Lo de antes sigue en pie: un rechazo no puede dejar el ajuste a medias.
    check("un rechazo no cambia lo que ya estaba", (await avisar(ana, beto, "mention")) === null);

    console.log("\nVolver a encenderlo");

    await silenciar(beto, []);
    check("quitar el silencio devuelve los avisos", (await avisar(ana, beto, "mention")) !== null);

    console.log("\nY cada quien el suyo");

    await silenciar(beto, ["mention"]);
    check("silenciar lo mío no toca lo de otro", (await avisar(beto, ana, "mention")) !== null);

    // Escribir el ajuste de otro a mano: la política de UPDATE de profiles no
    // afecta a ninguna fila, así que no revienta — no encuentra nada. Por eso
    // se comprueba contando después, que es como RLS se rompe sin ruido.
    await withUser(ana, (db) =>
      db.query("update profiles set avisos_silenciados = '{}' where id = $1", [beto]),
    );
    check("y nadie le quita el silencio a otro", (await avisar(ana, beto, "mention")) === null);
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [`%-avisos-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [
      `%-avisos-${sufijo}@devup.test`,
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
