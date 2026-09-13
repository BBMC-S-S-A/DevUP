/**
 * Las carpetas de la biblioteca, contra la base.
 *
 * LA QUE JUSTIFICA EL FICHERO ES EL CICLO. Sin el disparador de la 0053 basta
 * con mover A dentro de B y luego B dentro de A —dos gestos normales, cada uno
 * válido por separado— para que la biblioteca tenga un anillo. Y entonces
 * cualquier recorrido hacia la raíz, como el de unas migas de pan, **no falla:
 * se cuelga**. Una petición colgada es más cara de diagnosticar que uno que
 * revienta, porque no deja ni un error que buscar.
 *
 * Y TRES MÁS QUE SE LEEN BIEN ESTANDO MAL:
 *
 *   · Borrar una carpeta NO puede llevarse sus archivos. Reorganizar la
 *     biblioteca no es motivo para perder lo que alguien subió (0053, igual que
 *     la 0044 con las categorías).
 *   · Mover un archivo A LA RAÍZ tiene que poder distinguirse de «no toques la
 *     carpeta». Las dos se escriben igual si se mira solo si el valor es falsy,
 *     y entonces mover algo a la raíz es imposible — sin ningún error.
 *   · Dos carpetas con el mismo nombre en el mismo sitio son un error de dedo.
 *     En la RAÍZ también, que es donde el índice se olvida: `nulls not
 *     distinct`, porque NULL nunca es igual a NULL.
 *
 *   npm run test:carpetas --workspace apps/api
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

async function main(): Promise<void> {
  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  await admin.query("set search_path to public");

  const alta = async (nombre: string): Promise<string> =>
    (
      await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
        `${nombre}-carp-${sufijo}@devup.test`,
        "no-se-usa",
        nombre,
      ])
    ).rows[0]!.id;

  const ana = await alta("Ana");
  const fuera = await alta("Fuera");

  try {
    const { org, ws } = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          `Acme ${sufijo}`,
          `acme-carp-${sufijo}`,
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

    const carpeta = (nombre: string, padre: string | null) =>
      withUser(ana, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `insert into file_folders (workspace_id, parent_id, name, created_by)
           values ($1,$2,$3,$4) returning id`,
          [ws, padre, nombre, ana],
        );
        return rows[0]!.id;
      });

    console.log("\nAnidar");

    const diseno = await carpeta("Diseño", null);
    const logos = await carpeta("Logos", diseno);
    check("una carpeta dentro de otra", typeof logos === "string");

    // Mismo nombre en sitios distintos: legítimo.
    const otrosLogos = await carpeta("Logos", null);
    check("el mismo nombre en otro sitio sí vale", typeof otrosLogos === "string");

    check(
      "pero repetido en el mismo sitio, no",
      (await codigoDeError(() => carpeta("Logos", diseno))) === "23505",
    );
    // Y EN LA RAÍZ TAMBIÉN, que es donde el índice se olvida: sin
    // `nulls not distinct` se podrían crear cuatro «Logos» sueltas.
    check(
      "ni repetido en la raíz",
      (await codigoDeError(() => carpeta("Logos", null))) === "23505",
    );

    console.log("\nEl anillo, que no falla: cuelga");

    check(
      "una carpeta no puede ser su propio padre",
      (await codigoDeError(() =>
        withUser(ana, (db) =>
          db.query("update file_folders set parent_id = id where id = $1", [diseno]),
        ),
      )) === "23514",
    );

    // LA DE VERDAD. «Diseño» dentro de «Logos», que ya está dentro de «Diseño».
    // Cada gesto por separado es normal; juntos son un anillo.
    check(
      "ni meterse dentro de su propia hija",
      (await codigoDeError(() =>
        withUser(ana, (db) =>
          db.query("update file_folders set parent_id = $2 where id = $1", [diseno, logos]),
        ),
      )) === "23514",
    );

    // Tres de hondo, para que no sea solo el caso directo.
    const iconos = await carpeta("Iconos", logos);
    check(
      "ni a través de una nieta",
      (await codigoDeError(() =>
        withUser(ana, (db) =>
          db.query("update file_folders set parent_id = $2 where id = $1", [diseno, iconos]),
        ),
      )) === "23514",
    );

    console.log("\nLos archivos");

    const archivo = (nombre: string, carpetaId: string | null) =>
      withUser(ana, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `insert into files
             (organization_id, workspace_id, folder_id, storage_key, name, mime_type,
              size_bytes, uploaded_by, status)
           values ($1,$2,$3,$4,$5,'image/png',10,$6,'ready') returning id`,
          [org, ws, carpetaId, `acme/${sufijo}/${nombre}`, nombre, ana],
        );
        return rows[0]!.id;
      });

    const dentro = await archivo("logo.png", logos);

    // Mover a la raíz. Si el código mirara solo si el valor es falsy, esto
    // sería indistinguible de «no toques la carpeta» y no pasaría nada.
    const aLaRaiz = await withUser(ana, async (db) => {
      await db.query("update files set folder_id = null where id = $1", [dentro]);
      const { rows } = await db.query<{ folder_id: string | null }>(
        "select folder_id from files where id = $1",
        [dentro],
      );
      return rows[0]?.folder_id;
    });
    check("un archivo se puede mover a la raíz", aLaRaiz === null);

    const enLogos = await archivo("otro.png", logos);

    // LA QUE MÁS IMPORTA DE ESTE BLOQUE. Borrar «Diseño» se lleva «Logos» e
    // «Iconos», pero NO los archivos: suben a la raíz. Reorganizar la
    // biblioteca no puede borrar lo que alguien subió.
    await withUser(ana, (db) =>
      db.query("delete from file_folders where id = $1", [diseno]),
    );

    const traselBorrado = await withUser(ana, async (db) => {
      const { rows: sub } = await db.query("select 1 from file_folders where id = $1", [logos]);
      const { rows: arch } = await db.query<{ folder_id: string | null }>(
        "select folder_id from files where id = $1",
        [enLogos],
      );
      return { subcarpetas: sub.length, archivo: arch[0] };
    });

    check("borrar una carpeta se lleva sus subcarpetas", traselBorrado.subcarpetas === 0);
    check("pero NO sus archivos", traselBorrado.archivo !== undefined);
    check("que suben a la raíz", traselBorrado.archivo?.folder_id === null);

    console.log("\nY el aislamiento");

    const loQueVe = await withUser(fuera, async (db) => {
      const { rows } = await db.query("select id from file_folders where workspace_id = $1", [ws]);
      return rows.length;
    });
    check("quien no llega al espacio no ve ninguna carpeta", loQueVe === 0);

    check(
      "ni puede crear una dentro",
      (await codigoDeError(() =>
        withUser(fuera, (db) =>
          db.query(
            `insert into file_folders (workspace_id, name, created_by) values ($1,'colada',$2)`,
            [ws, fuera],
          ),
        ),
      )) === "42501",
    );
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [`%-carp-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [
      `%-carp-${sufijo}@devup.test`,
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
