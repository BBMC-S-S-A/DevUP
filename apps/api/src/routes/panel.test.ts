/**
 * El panel por espacio, contra la base.
 *
 * POR QUÉ EXISTE ESTE FICHERO. La 0049 juntó dos funciones que hacían lo mismo
 * —el Panel (0019) y la Mesa (0025)— dándole al Panel alcance de espacio. Eso
 * significó **soltar la clave primaria** de `user_dashboard_prefs`, y ahí hay
 * dos cosas que se rompen sin que TypeScript diga nada:
 *
 *   1. **El destino del `on conflict`.** Era `(user_id)`, que ya no es un índice
 *      único. Compila igual; falla en el primer guardado, en producción, con un
 *      500 que dice algo sobre restricciones que nadie va a saber leer.
 *
 *   2. **El de partida multiplicado.** El índice es `nulls not distinct` a
 *      propósito: sin esa cláusula, dos filas con `workspace_id` nulo del mismo
 *      usuario serían distintas para Postgres —NULL nunca es igual a NULL— y
 *      una persona acabaría con catorce paneles de partida sin que nada se
 *      quejara. Se vería como un panel que «a veces sale distinto».
 *
 * Y la promesa que esta migración hizo y hay que poder demostrar: **nadie pierde
 * su panel**. La fila que cada cual tenía sigue valiendo, ahora como la de
 * partida.
 *
 *   npm run test:panel --workspace apps/api
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

type Panel = { widgets: string[]; layout: Record<string, unknown>; es_de_partida: boolean };

async function main(): Promise<void> {
  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  await admin.query("set search_path to public");

  const ana = (
    await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
      `ana-panel-${sufijo}@devup.test`,
      "no-se-usa",
      "Ana",
    ])
  ).rows[0]!.id;

  try {
    const { uno, dos } = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          `Acme ${sufijo}`,
          `acme-panel-${sufijo}`,
        ])
      ).rows[0]!.id;
      const espacio = async (nombre: string) =>
        (
          await db.query<{ id: string }>(
            "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
            [org, nombre, ana],
          )
        ).rows[0]!.id;
      return { uno: await espacio("Producto"), dos: await espacio("Cliente") };
    });

    /** Guardar, exactamente como lo hace `PUT /me/dashboard`. */
    const guardar = (espacio: string | null, widgets: string[]) =>
      withUser(ana, (db) =>
        db.query(
          `insert into user_dashboard_prefs (user_id, workspace_id, widgets, spotify_mode, layout)
           values ($1, $2::uuid, $3::jsonb, 'boton', '{}'::jsonb)
           on conflict (user_id, workspace_id) do update
             set widgets = excluded.widgets, updated_at = now()`,
          [ana, espacio, JSON.stringify(widgets)],
        ),
      );

    const panelDe = (espacio: string): Promise<Panel | undefined> =>
      withUser(ana, async (db) => {
        const { rows } = await db.query<Panel>("select * from public.panel_de($1)", [espacio]);
        return rows[0];
      });

    console.log("\nEl de partida, que es el que ya había");

    // La fila «de siempre»: la que tenía cada persona antes de la 0049.
    await guardar(null, ["spotify", "notificaciones"]);

    const sinPropio = await panelDe(uno);
    check("un espacio sin panel propio usa el de partida", sinPropio?.widgets.length === 2);
    check("y se dice que es el de partida", sinPropio?.es_de_partida === true);
    check("el otro espacio, igual", (await panelDe(dos))?.es_de_partida === true);

    console.log("\nY en cuanto uno se monta el suyo");

    await guardar(uno, ["tablero", "actividad", "atascadas"]);

    const propio = await panelDe(uno);
    check("ese espacio pasa a tener el suyo", propio?.widgets.length === 3);
    check("y ya no dice que sea el de partida", propio?.es_de_partida === false);

    // LA QUE JUSTIFICA EL `nulls last` DE `panel_de`: montarse uno en un espacio
    // no puede cambiar lo que ven los demás. Si el orden estuviera al revés, el
    // de partida ganaría siempre y montarse uno no serviría de nada — sin fallar.
    check("el otro espacio sigue con el de partida", (await panelDe(dos))?.es_de_partida === true);
    check("y el de partida no se tocó", (await panelDe(dos))?.widgets.length === 2);

    console.log("\nGuardar dos veces");

    // LA 1 DE LA CABECERA. Con el destino viejo —`on conflict (user_id)`— esto
    // es lo que reventaba: no en el primer guardado, sino en el segundo.
    await guardar(uno, ["tablero"]);
    check("volver a guardar el mismo panel no revienta", (await panelDe(uno))?.widgets.length === 1);

    console.log("\nY el de partida es UNO");

    // LA 2. Sin `nulls not distinct` en el índice, esto crearía una segunda fila
    // de partida en vez de actualizar la que hay — y nada se quejaría.
    await guardar(null, ["spotify"]);
    const cuantosDePartida = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ n: string }>(
        "select count(*) as n from user_dashboard_prefs where user_id = $1 and workspace_id is null",
        [ana],
      );
      return Number(rows[0]!.n);
    });
    check("por mucho que se guarde, el de partida sigue siendo uno", cuantosDePartida === 1);

    console.log("\nCuando el espacio se va");

    await admin.query("delete from workspaces where id = $1", [uno]);
    const huerfanos = await admin.query(
      "select 1 from user_dashboard_prefs where workspace_id = $1",
      [uno],
    );
    // Un panel montado para un espacio que ya no existe es basura apuntando a un
    // sitio que no está. `on delete cascade` se lo lleva.
    check("borrado el espacio, su panel se va con él", huerfanos.rowCount === 0);
    check(
      "y el de partida sigue en pie",
      (
        await admin.query("select 1 from user_dashboard_prefs where user_id = $1 and workspace_id is null", [ana])
      ).rowCount === 1,
    );
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [`%-panel-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [
      `%-panel-${sufijo}@devup.test`,
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
