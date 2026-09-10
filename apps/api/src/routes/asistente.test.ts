/**
 * Pruebas de las herramientas del asistente de dentro de DevUP.
 *
 * QUÉ SE PRUEBA, Y POR QUÉ SIN MODELO. Que el modelo elija bien la herramienta
 * es cosa de su descripción y se ve usándolo; lo que se puede —y hay que—
 * probar aquí es lo que pasa cuando la elige: que la tarea acabe en la columna
 * correcta, con su responsable, con la etiqueta de procedencia, y que un
 * identificador de otro espacio se rechace. Nada de esto necesita gastar la
 * clave de nadie.
 *
 * Lo que más importa de esta tanda es la última comprobación: RLS no puede
 * proteger contra mover una tarea de un espacio a la columna de otro cuando la
 * persona tiene acceso a los dos. Esa la pone el código, así que si alguien la
 * borra, esto tiene que ponerse rojo.
 *
 *   npm run test:asistente
 */
import { closePool, withUser } from "../db/pool.js";
import { ejecutar } from "./asistente.js";

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
  // Se monta todo con el propietario del esquema y luego se ACTÚA como la
  // persona: así lo que se prueba es lo que ve y puede hacer ella.
  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  await admin.query("set search_path to public");

  const ana = (
    await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
      `ana-asistente-${sufijo}@devup.test`,
      "no-se-usa",
      "Ana Asistente",
    ])
  ).rows[0]!.id;

  await admin.query("select set_config('app.user_id', $1, false)", [ana]);
  const org = (
    await admin.query<{ id: string }>("select public.create_organization($1,$2) as id", [
      `Acme ${sufijo}`,
      `acme-${sufijo}`,
    ])
  ).rows[0]!.id;

  const espacio = async (nombre: string) =>
    (
      await admin.query<{ id: string }>(
        "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
        [org, nombre, ana],
      )
    ).rows[0]!.id;

  const uno = await espacio(`Producto ${sufijo}`);
  const otro = await espacio(`Otro ${sufijo}`);

  try {
    console.log("\nCrear");
    const creada = await withUser(ana, (db) =>
      ejecutar(db, uno, ana, "crear_columna", { nombre: "Por hacer" }),
    );
    check("crea la columna cuando el tablero está vacío", creada.texto.includes("creada"));

    // Un espacio nuevo NO nace vacio: `handle_new_workspace` le pone tres
    // columnas. Asi que para probar esa rama hay que vaciarlo a mano — pero la
    // rama vale, porque alguien puede borrar todas las columnas del tablero.
    await withUser(ana, (db) =>
      db.query("delete from task_columns where workspace_id = $1", [otro]),
    );
    const sinColumna = await withUser(ana, (db) =>
      ejecutar(db, otro, ana, "crear_tarea", { titulo: "algo" }),
    );
    check(
      "con el tablero vaciado, manda a crear una columna en vez de fallar",
      sinColumna.texto.includes("crear_columna"),
    );

    const tarea = await withUser(ana, (db) =>
      ejecutar(db, uno, ana, "crear_tarea", {
        titulo: "Desarrollo agéntico",
        detalle: "La puerta MCP y las herramientas de escritura.",
        responsable: "Ana",
        vence: "2026-09-15",
      }),
    );
    check("crea la tarea con responsable y fecha", tarea.texto.includes("Creada"));
    check("y dice que queda marcada", tarea.texto.includes("agente"));

    const fila = await withUser(ana, async (db) => {
      const { rows } = await db.query<{
        title: string;
        columna: string;
        responsable: string | null;
        vence: string | null;
        etiquetas: string | null;
      }>(
        `select t.title, k.name as columna, p.display_name as responsable,
                t.due_date::text as vence,
                (select string_agg(g.name, ',') from task_tags tt join tags g on g.id = tt.tag_id
                  where tt.task_id = t.id) as etiquetas
           from tasks t
           join task_columns k on k.id = t.column_id
           left join profiles p on p.id = t.assignee_id
          where t.workspace_id = $1`,
        [uno],
      );
      return rows[0];
    });

    check("la tarea existe de verdad en la base", fila?.title === "Desarrollo agéntico");
    check("en la columna correcta", fila?.columna === "Por hacer");
    check("con su responsable", fila?.responsable === "Ana Asistente");
    check("con su fecha", fila?.vence === "2026-09-15");
    // La procedencia es la promesa que hace aceptable que un modelo escriba en
    // el tablero de un equipo. Si esto falla, la promesa está rota.
    check("y con la etiqueta de procedencia", fila?.etiquetas === "agente");

    console.log("\nCuando el nombre no basta");
    const nadie = await withUser(ana, (db) =>
      ejecutar(db, uno, ana, "crear_tarea", { titulo: "x", responsable: "Rodrigo" }),
    );
    check(
      "con un responsable que no existe, dice quién hay",
      nadie.texto.includes("No hay nadie") && nadie.texto.includes("Ana Asistente"),
    );

    const columnaMala = await withUser(ana, (db) =>
      ejecutar(db, uno, ana, "crear_tarea", { titulo: "x", columna: "Backlog" }),
    );
    check(
      "con una columna que no existe, dice cuáles hay",
      columnaMala.texto.includes("Por hacer"),
    );

    console.log("\nMover, y la frontera que RLS no puede poner");
    const idTarea = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "select id from tasks where workspace_id = $1 limit 1",
        [uno],
      );
      return rows[0]!.id;
    });

    await withUser(ana, (db) => ejecutar(db, uno, ana, "crear_columna", { nombre: "En curso" }));
    const movida = await withUser(ana, (db) =>
      ejecutar(db, uno, ana, "mover_tarea", { id: idTarea, columna: "En curso" }),
    );
    check("mueve la tarea a otra columna", movida.texto.includes("movida a En curso"));

    // Ana tiene acceso a los DOS espacios, asi que RLS ve la tarea y ve la
    // columna: nada en la base impide cruzarlas. La comprobación es del código.
    await withUser(ana, (db) => ejecutar(db, otro, ana, "crear_columna", { nombre: "Ajena" }));
    const cruzada = await withUser(ana, (db) =>
      ejecutar(db, otro, ana, "mover_tarea", { id: idTarea, columna: "Ajena" }),
    );
    check(
      "NO mueve una tarea a la columna de otro espacio, aunque tenga acceso a los dos",
      cruzada.texto.includes("no está en este espacio"),
    );

    const sigueDonde = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ columna: string }>(
        "select k.name as columna from tasks t join task_columns k on k.id = t.column_id where t.id = $1",
        [idTarea],
      );
      return rows[0]?.columna;
    });
    check("y sigue donde estaba", sigueDonde === "En curso");

    console.log("\nActualizar");
    const actualizada = await withUser(ana, (db) =>
      ejecutar(db, uno, ana, "actualizar_tarea", { id: idTarea, vence: "", responsable: "" }),
    );
    check("quita fecha y responsable con cadena vacía", actualizada.texto.includes("actualizada"));

    const limpia = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ vence: string | null; assignee: string | null }>(
        "select due_date::text as vence, assignee_id as assignee from tasks where id = $1",
        [idTarea],
      );
      return rows[0];
    });
    check("y de verdad quedan vacíos", limpia?.vence === null && limpia?.assignee === null);

    const nada = await withUser(ana, (db) =>
      ejecutar(db, uno, ana, "actualizar_tarea", { id: idTarea }),
    );
    check("sin nada que cambiar, lo dice", nada.texto.includes("qué cambiar"));

    console.log("\nLo que no existe");
    const inventada = await withUser(ana, (db) =>
      ejecutar(db, uno, ana, "borrar_tarea", {}),
    );
    check(
      "no hay herramienta de borrar, y se dice",
      inventada.texto.includes("No tengo ninguna herramienta"),
    );
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [`%-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [`%-${sufijo}@devup.test`]);
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
