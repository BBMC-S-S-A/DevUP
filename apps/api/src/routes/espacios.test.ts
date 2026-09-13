/**
 * Renombrar y borrar un espacio de trabajo, contra la base.
 *
 * LA QUE JUSTIFICA EL FICHERO ES LA VISIBILIDAD. La política de la 0035 mira la
 * fila VIEJA con `using` y la NUEVA con `with check`, y esas dos mitades dicen
 * cosas distintas: en un espacio compartido manda quien administra, y en uno
 * personal manda quien lo creó. O sea que pasar de compartido a personal exige
 * las dos cosas a la vez.
 *
 * Eso es lo que impide que quien administra la organización convierta en SUYO
 * un espacio del equipo — un movimiento que no rompe nada, no deja error, y
 * deja a todo el mundo fuera de su propio proyecto. Una sola de las dos mitades
 * lo permitiría, y leyendo la política parece que está bien.
 *
 * Y ESTAS OTRAS, QUE SE LEEN BIEN ESTANDO MAL:
 *
 *   · **Cero filas al actualizar NO es «no existe».** Es «RLS lo rechazó». Si
 *     la ruta lo tradujera a un 404, quien administra pediría el cambio, vería
 *     «no encontrado» sobre un espacio que tiene delante, y no habría forma de
 *     saber que el problema era de permisos.
 *   · **Borrar pide el nombre, y sin distinguir mayúsculas.** Lo que se
 *     comprueba es que la persona haya leído CUÁL borra, no que sepa teclear.
 *     Pedir el identificador se resuelve copiándolo de la barra de direcciones
 *     sin leer nada, que es no comprobar.
 *   · **El borrado se lleva lo que cuelga.** Es lo esperado, y hay que fijarlo:
 *     si un día una tabla nueva no cayera en cascada, quedarían filas
 *     inalcanzables apuntando a un espacio que ya no existe.
 *   · **Un PATCH vacío se rechaza.** Devolver 200 sin cambiar nada es
 *     indistinguible de haber funcionado.
 *
 *   npm run test:espacios --workspace apps/api
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

/** Lo que hace la ruta: actualizar y contar filas. Cero = RLS dijo que no. */
const renombrar = (quien: string, ws: string, nombre: string): Promise<number> =>
  withUser(quien, async (db) => {
    const { rowCount } = await db.query("update workspaces set name = $2 where id = $1", [
      ws,
      nombre,
    ]);
    return rowCount ?? 0;
  });

/**
 * Cambiar la visibilidad, devolviendo qué pasó.
 *
 * LAS DOS MITADES DE LA POLÍTICA FALLAN DE MANERAS DISTINTAS, y confundirlas es
 * el error que esta prueba encontró:
 *
 *   · `using` decide qué filas se pueden tocar. Si no pasa, la fila no existe
 *     para la actualización: CERO filas, en silencio.
 *   · `with check` decide si el valor NUEVO vale. Si no pasa, la actualización
 *     ya había ocurrido y Postgres la aborta: REVIENTA con 42501.
 *
 * Las dos son «no puedes», pero solo una llega como error. Una ruta que solo
 * mirara el recuento dejaría pasar la segunda como si hubiera funcionado.
 */
const cambiarVisibilidad = (quien: string, ws: string, visibilidad: string): Promise<string> =>
  withUser(quien, async (db) => {
    try {
      const { rowCount } = await db.query(
        "update workspaces set visibility = $2::workspace_visibility where id = $1",
        [ws, visibilidad],
      );
      return rowCount === 1 ? "cambiado" : "cero filas";
    } catch (fallo) {
      return (fallo as { code?: string }).code ?? "?";
    }
  });

const borrar = (quien: string, ws: string): Promise<number> =>
  withUser(quien, async (db) => {
    const { rowCount } = await db.query("delete from workspaces where id = $1", [ws]);
    return rowCount ?? 0;
  });

async function main(): Promise<void> {
  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  await admin.query("set search_path to public");

  const alta = async (nombre: string): Promise<string> =>
    (
      await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
        `${nombre}-esp-${sufijo}@devup.test`,
        "no-se-usa",
        nombre,
      ])
    ).rows[0]!.id;

  // Ana crea la organización, así que la administra. Beto también administra,
  // pero no ha creado nada. Carla es miembro raso.
  const ana = await alta("Ana");
  const beto = await alta("Beto");
  const carla = await alta("Carla");

  try {
    const org = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "select public.create_organization($1,$2) as id",
        [`Acme ${sufijo}`, `acme-esp-${sufijo}`],
      );
      return rows[0]!.id;
    });

    for (const [quien, rol] of [
      [beto, "admin"],
      [carla, "member"],
    ] as const) {
      await admin.query(
        `insert into organization_members (organization_id, user_id, role, all_workspaces)
         values ($1,$2,$3,true) on conflict do nothing`,
        [org, quien, rol],
      );
    }

    const crear = async (quien: string, nombre: string, visibilidad: string): Promise<string> =>
      withUser(quien, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `insert into workspaces (organization_id, name, created_by, visibility)
           values ($1,$2,$3,$4::workspace_visibility) returning id`,
          [org, nombre, quien, visibilidad],
        );
        return rows[0]!.id;
      });

    console.log("\nRenombrar");

    const compartido = await crear(ana, "Producto", "shared");
    check("quien administra renombra un espacio compartido", (await renombrar(beto, compartido, "Producto 2")) === 1);
    check("un miembro raso, no", (await renombrar(carla, compartido, "mío")) === 0);

    const personal = await crear(carla, "Mis cosas", "personal");
    check("y su dueño renombra el suyo personal", (await renombrar(carla, personal, "Mis cosas 2")) === 1);
    check(
      "mientras que quien administra NO toca el personal de otro",
      (await renombrar(beto, personal, "cosas de Carla")) === 0,
    );

    console.log("\nLa visibilidad, que se comprueba por los dos lados");

    // LA DE VERDAD. `using` mira la fila vieja (compartida → administra) y
    // `with check` la nueva (personal → la creó). Beto administra pero no lo
    // creó, así que no puede quedárselo.
    check(
      "quien administra no puede quedarse un espacio del equipo",
      (await cambiarVisibilidad(beto, compartido, "personal")) === "42501",
    );
    check(
      "y el espacio sigue siendo del equipo después del intento",
      (
        await admin.query<{ visibility: string }>(
          "select visibility from workspaces where id = $1",
          [compartido],
        )
      ).rows[0]!.visibility === "shared",
    );

    // Y en el otro sentido: Carla lo creó, pero publicarlo al equipo es un acto
    // de administración y ella no administra.
    check(
      "ni un miembro raso publica su espacio personal al equipo",
      (await cambiarVisibilidad(carla, personal, "shared")) === "42501",
    );

    // Y la otra mitad, la que SÍ se calla: Beto ni siquiera ve el personal de
    // Carla para tocarlo, así que ahí no hay error — hay cero filas.
    check(
      "y tocar el personal de otro no revienta: simplemente no hay fila",
      (await cambiarVisibilidad(beto, personal, "shared")) === "cero filas",
    );

    // Ana sí: administra Y lo creó.
    const suyo = await crear(ana, "Prueba de Ana", "shared");
    check(
      "quien administra Y lo creó sí puede cambiarlo de los dos lados",
      (await cambiarVisibilidad(ana, suyo, "personal")) === "cambiado",
    );

    console.log("\nBorrar, y lo que se lleva por delante");

    const conCosas = await crear(ana, "Con cosas dentro", "shared");
    // Por `create_channel` y no con un insert a pelo: es el camino que usa la
    // API, y hacerlo a mano se salta lo que esa función deja montado alrededor
    // —empezando por quién queda dentro del canal—. Una prueba que construye el
    // mundo por una puerta que el producto no usa comprueba otro producto.
    const canal = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ create_channel: string }>(
        "select public.create_channel($1,$2,$3,$4)",
        [conCosas, "general", "text", false],
      );
      return rows[0]!.create_channel;
    });
    const columna = (
      await admin.query<{ id: string }>(
        "select id from task_columns where workspace_id = $1 order by position limit 1",
        [conCosas],
      )
    ).rows[0]!.id;
    const tarea = (
      await admin.query<{ id: string }>(
        `insert into tasks (workspace_id, column_id, title, position, created_by)
         values ($1,$2,'algo',1000,$3) returning id`,
        [conCosas, columna, ana],
      )
    ).rows[0]!.id;

    check("un miembro raso no borra un espacio compartido", (await borrar(carla, conCosas)) === 0);
    check("quien administra sí", (await borrar(beto, conCosas)) === 1);

    const cuentaDe = async (tabla: string, columnaId: string, valor: string): Promise<number> =>
      Number(
        (
          await admin.query<{ n: string }>(
            `select count(*) as n from ${tabla} where ${columnaId} = $1`,
            [valor],
          )
        ).rows[0]!.n,
      );

    check("y se lleva sus canales", (await cuentaDe("channels", "id", canal)) === 0);
    check("sus tareas", (await cuentaDe("tasks", "id", tarea)) === 0);
    check("y sus columnas", (await cuentaDe("task_columns", "id", columna)) === 0);

    console.log("\nY el aislamiento");

    const deFuera = await alta("Fuera");
    const ajeno = await crear(ana, "No es tuyo", "shared");
    check("quien no es de la organización no lo ve", (await renombrar(deFuera, ajeno, "mío")) === 0);
    check("ni lo borra", (await borrar(deFuera, ajeno)) === 0);
    check(
      "y sigue ahí, con su nombre",
      (
        await admin.query<{ name: string }>("select name from workspaces where id = $1", [ajeno])
      ).rows[0]!.name === "No es tuyo",
    );
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [`%-esp-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [`%-esp-${sufijo}@devup.test`]);
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
