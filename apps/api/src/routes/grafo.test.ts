/**
 * Los enlaces del grafo, contra la base.
 *
 * POR QUÉ ESTO MERECE PRUEBA PROPIA Y NO UN BLOQUE MÁS EN `isolation.test.ts`.
 * Allí ya está lo que protege la tabla: que un enlace del que no se ven los dos
 * extremos no existe para quien mira. Lo de aquí es la capa de encima —`tejer`
 * y `vecinosDe`— y tiene tres formas de estar mal que las políticas no pueden
 * cazar:
 *
 *   1. **La dirección.** «La tarea menciona al mensaje» y «el mensaje menciona
 *      a la tarea» son la misma fila leída desde cada punta. Si `vecinosDe` se
 *      equivocara de lado, el grafo se dibujaría con las flechas al revés y
 *      nadie lo notaría: seguiría siendo un grafo plausible.
 *
 *   2. **Las dos direcciones.** Un nodo tiene vecinos por donde sale y por
 *      donde entra. Devolver solo los de salida deja la mitad del grafo
 *      invisible según por dónde se entre, y eso tampoco falla: contesta menos.
 *
 *   3. **La idempotencia.** Las reglas que tejen se ejecutan cada vez que pasa
 *      el hecho, no una sola. Sin `on conflict do nothing`, adjuntar dos veces
 *      el mismo archivo reventaría la petición entera por una restricción que
 *      en realidad decía «esto ya estaba bien».
 *
 * Y la cuarta, que es de seguridad y sí se comprueba aquí porque es de la capa:
 * que tejer hacia algo que no se ve **falle**, y no que se guarde a medias.
 *
 *   npm run test:grafo --workspace apps/api
 */
import { closePool, withUser } from "../db/pool.js";
import { tejer, vecinosDe } from "../lib/grafo.js";

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
        `${nombre}-grafo-${sufijo}@devup.test`,
        "no-se-usa",
        nombre,
      ])
    ).rows[0]!.id;

  const ana = await alta("ana");
  const bruno = await alta("bruno");

  try {
    // Ana monta un espacio con dos tareas y un archivo. Bruno monta el suyo,
    // en otra organización: es el extremo que Ana no puede ver.
    const acme = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          `Acme ${sufijo}`,
          `acme-grafo-${sufijo}`,
        ])
      ).rows[0]!.id;
      const ws = (
        await db.query<{ id: string }>(
          "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
          [org, "Producto", ana],
        )
      ).rows[0]!.id;
      const col = (
        await db.query<{ id: string }>(
          "select id from task_columns where workspace_id = $1 order by position limit 1",
          [ws],
        )
      ).rows[0]!.id;
      const tarea = async (titulo: string) =>
        (
          await db.query<{ id: string }>(
            `insert into tasks (workspace_id, column_id, title, position, created_by)
             values ($1,$2,$3,1000,$4) returning id`,
            [ws, col, titulo, ana],
          )
        ).rows[0]!.id;
      return { org, ws, pagos: await tarea("Pasarela de pagos"), login: await tarea("Arreglar el login") };
    });

    const deBruno = await withUser(bruno, async (db) => {
      const org = (
        await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          `Bolt ${sufijo}`,
          `bolt-grafo-${sufijo}`,
        ])
      ).rows[0]!.id;
      const ws = (
        await db.query<{ id: string }>(
          "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
          [org, "Lo suyo", bruno],
        )
      ).rows[0]!.id;
      const col = (
        await db.query<{ id: string }>(
          "select id from task_columns where workspace_id = $1 order by position limit 1",
          [ws],
        )
      ).rows[0]!.id;
      return (
        await db.query<{ id: string }>(
          `insert into tasks (workspace_id, column_id, title, position, created_by)
           values ($1,$2,'Secreto de Bolt',1000,$3) returning id`,
          [ws, col, bruno],
        )
      ).rows[0]!.id;
    });

    console.log("\nTejer");

    await withUser(ana, (db) =>
      tejer(db, {
        origenTipo: "tarea",
        origenId: acme.pagos,
        destinoTipo: "espacio",
        destinoId: acme.ws,
        etiqueta: "vive en",
        procedencia: "persona",
        autorId: ana,
      }),
    );

    const desdePagos = await withUser(ana, (db) => vecinosDe(db, "tarea", acme.pagos));
    check("el enlace aparece desde el nodo por el que se preguntó", desdePagos.length === 1);
    check("con su etiqueta", desdePagos[0]?.etiqueta === "vive en");
    // Sin el nombre no se puede dibujar nada, y pedirlo nodo a nodo serían
    // treinta peticiones para treinta enlaces.
    check("y con el nombre del OTRO extremo, no el del propio", desdePagos[0]?.nombre === "Producto");
    check("y su tipo", desdePagos[0]?.tipo === "espacio");

    console.log("\nLas dos direcciones, y cuál es cuál");

    // La misma fila, mirada desde la otra punta. Si esto devolviera vacío, la
    // mitad del grafo sería invisible según por dónde se entrara.
    const desdeEspacio = await withUser(ana, (db) => vecinosDe(db, "espacio", acme.ws));
    check("la misma arista se ve desde el otro extremo", desdeEspacio.length === 1);
    check("y ahí el vecino es la tarea", desdeEspacio[0]?.nodoId === acme.pagos);

    // Lo que no se puede perder al mirar desde los dos lados: de quién sale.
    check("desde el origen, la flecha SALE", desdePagos[0]?.direccion === "sale");
    check("desde el destino, la misma flecha ENTRA", desdeEspacio[0]?.direccion === "entra");

    console.log("\nTejer dos veces no rompe nada");

    const otraVez = await withUser(ana, async (db) => {
      // Exactamente el mismo enlace: es lo que hace una regla que se dispara
      // cada vez que pasa el hecho.
      await tejer(db, {
        origenTipo: "tarea",
        origenId: acme.pagos,
        destinoTipo: "espacio",
        destinoId: acme.ws,
        etiqueta: "vive en",
      });
      return (await vecinosDe(db, "tarea", acme.pagos)).length;
    });
    check("el mismo enlace dos veces sigue siendo uno", otraVez === 1);

    // Pero la etiqueta forma parte de la identidad del enlace: «cierra» y
    // «menciona» entre las mismas dos cosas son dos relaciones distintas.
    const conOtraEtiqueta = await withUser(ana, async (db) => {
      await tejer(db, {
        origenTipo: "tarea",
        origenId: acme.pagos,
        destinoTipo: "espacio",
        destinoId: acme.ws,
        etiqueta: "se despliega en",
      });
      return (await vecinosDe(db, "tarea", acme.pagos)).length;
    });
    check("y con otra etiqueta son dos relaciones distintas", conOtraEtiqueta === 2);

    console.log("\nLos dos extremos, o nada");

    // La comprobación que justifica toda la 0043: Ana no ve la tarea de Bruno,
    // así que no puede enlazarla. Si esto pasara, el enlace revelaría que esa
    // tarea existe — y con ella, el espacio de otra organización.
    const haciaLoAjeno = await withUser(ana, async (db) => {
      try {
        await tejer(db, {
          origenTipo: "tarea",
          origenId: acme.pagos,
          destinoTipo: "tarea",
          destinoId: deBruno,
          etiqueta: "curiosidad",
        });
        return "coló";
      } catch {
        return "rechazado";
      }
    });
    check("no se puede enlazar hacia algo que no se ve", haciaLoAjeno === "rechazado");

    // Y la otra mitad: que el intento no haya dejado rastro. Un enlace a medias
    // sería la misma fuga escrita más despacio.
    const rastro = await admin.query(
      "select id from graph_links where target_id = $1 or source_id = $1",
      [deBruno],
    );
    check("y el intento no deja el enlace escrito a medias", rastro.rowCount === 0);

    console.log("\nLo que ve el otro lado");

    // Bruno no ve NINGUNO de los enlaces de Ana, porque no ve sus extremos.
    const loQueVeBruno = await withUser(bruno, (db) => vecinosDe(db, "tarea", acme.pagos));
    check("Bruno no ve los enlaces de una tarea que no puede ver", loQueVeBruno.length === 0);

    // Y preguntar por un nodo que no existe contesta lo mismo que preguntar por
    // uno ajeno: nada. Es lo que impide usar esta ruta como detector.
    const inventado = await withUser(ana, (db) =>
      vecinosDe(db, "tarea", "00000000-0000-0000-0000-000000000000"),
    );
    check(
      "y un nodo inventado contesta lo mismo que uno ajeno: nada",
      inventado.length === loQueVeBruno.length,
    );

    console.log("\nBorrar");

    const quedan = await withUser(ana, async (db) => {
      const vecinos = await vecinosDe(db, "tarea", acme.pagos);
      await db.query("delete from graph_links where id = $1", [vecinos[0]!.id]);
      return (await vecinosDe(db, "tarea", acme.pagos)).length;
    });
    check("borrar un enlace lo quita de las dos puntas", quedan === 1);

    const brunoBorro = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query("delete from graph_links where source_id = $1", [
        acme.pagos,
      ]);
      return rowCount ?? 0;
    });
    check("y Bruno no puede borrar los que no ve", brunoBorro === 0);
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [`%-grafo-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [
      `%-grafo-${sufijo}@devup.test`,
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
