/**
 * Pruebas del registro de actividad.
 *
 * QUÉ SE PRUEBA AQUÍ, Y QUÉ NO. Que nadie vea la actividad de un espacio al
 * que no tiene acceso lo cubre `isolation.test.ts`, que es donde vive el
 * aislamiento. Lo de aquí es lo otro: el CAMINO DE ESCRITURA. Que mover una
 * tarjeta a una columna terminal se anote como «cerró» y no como «movió», que
 * reordenar dentro de una columna no ensucie la historia, y que lo que hace el
 * asistente quede marcado como suyo.
 *
 * POR QUÉ MERECE PRUEBA PROPIA. Tres cosas del producto —la auditoría del
 * tablero, la tarjeta de una persona y el «¿qué me he perdido?» del MCP— leen
 * de esta tabla. Si el verbo se escribe mal, las tres mienten a la vez y
 * ninguna falla: enseñan un número, y un número siempre parece verdad. Este es
 * justo el patrón que el repositorio ya se encontró con RLS —afecta cero filas
 * y sigue— y la respuesta es la misma: fijarlo con una prueba.
 *
 * LA QUE MÁS IMPORTA es la del origen. Si el trabajo del asistente se anotara
 * como `persona`, la auditoría le atribuiría a alguien diez tareas que no
 * tecleó, y esa es una cifra que la gente se toma en serio.
 *
 *   npm run test:actividad
 */
import { closePool, withUser } from "../db/pool.js";
import { crearTareaEnDb, moverTareaEnDb } from "./tasks.js";

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

type Fila = { verbo: string; origen: string; resumen: string };

async function main(): Promise<void> {
  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  await admin.query("set search_path to public");

  const ana = (
    await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
      `ana-actividad-${sufijo}@devup.test`,
      "no-se-usa",
      "Ana Actividad",
    ])
  ).rows[0]!.id;

  try {
    const { org, ws, pendiente, hecho } = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          `Acme ${sufijo}`,
          `acme-actividad-${sufijo}`,
        ])
      ).rows[0]!.id;

      const ws = (
        await db.query<{ id: string }>(
          "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
          [org, "Producto", ana],
        )
      ).rows[0]!.id;

      // Un tablero nuevo trae columnas; la terminal puede existir o no según
      // cómo se llamen, así que se asegura en vez de darla por hecha.
      const { rows: columnas } = await db.query<{
        id: string;
        is_terminal: boolean;
      }>("select id, is_terminal from task_columns where workspace_id = $1 order by position", [ws]);

      const pendiente = columnas.find((c) => !c.is_terminal)!.id;
      const hecho =
        columnas.find((c) => c.is_terminal)?.id ??
        (
          await db.query<{ id: string }>(
            `insert into task_columns (workspace_id, name, position, is_terminal)
             values ($1,'Hecho',9000,true) returning id`,
            [ws],
          )
        ).rows[0]!.id;

      return { org, ws, pendiente, hecho };
    });

    const leer = (): Promise<Fila[]> =>
      withUser(ana, async (db) => {
        const { rows } = await db.query<Fila>(
          `select verbo, origen, resumen from activity
            where organization_id = $1 order by ocurrido_en, verbo`,
          [org],
        );
        return rows;
      });

    console.log("\nCrear una tarea");

    const tarea = await withUser(ana, (db) =>
      crearTareaEnDb(db, {
        workspaceId: ws,
        columnId: pendiente,
        title: "Arreglar el 415 del túnel",
        description: "",
        assigneeId: ana,
        dueDate: null,
        tagIds: [],
        autor: ana,
      }),
    );
    const taskId = tarea.id as string;

    let filas = await leer();
    check(
      "crear anota `tarea.creada`",
      filas.some((f) => f.verbo === "tarea.creada"),
    );
    check(
      "asignar al crear anota también `tarea.asignada`",
      filas.some((f) => f.verbo === "tarea.asignada"),
    );
    check(
      "el resumen guarda el título que la tarea tenía entonces",
      filas.some((f) => f.resumen.includes("Arreglar el 415 del túnel")),
    );

    console.log("\nMover, cerrar y reabrir");

    // Reordenar no es un hecho que nadie vaya a querer recordar. Si esto se
    // rompe, la historia se llena de ruido hasta esconder lo que importa.
    const antes = filas.length;
    await withUser(ana, (db) => moverTareaEnDb(db, taskId, pendiente, null, { actorId: ana }));
    check("reordenar dentro de la misma columna no anota nada", (await leer()).length === antes);

    await withUser(ana, (db) => moverTareaEnDb(db, taskId, hecho, null, { actorId: ana }));
    filas = await leer();
    const cerrada = filas.find((f) => f.verbo === "tarea.cerrada");
    check("mover a una columna terminal anota `tarea.cerrada`, no `tarea.movida`", Boolean(cerrada));
    check("y el resumen lo dice en castellano", cerrada?.resumen.startsWith("cerró") === true);

    await withUser(ana, (db) => moverTareaEnDb(db, taskId, pendiente, null, { actorId: ana }));
    check(
      "sacarla de la columna terminal anota `tarea.reabierta`",
      (await leer()).some((f) => f.verbo === "tarea.reabierta"),
    );

    console.log("\nQuién lo hizo de verdad");

    await withUser(ana, (db) =>
      crearTareaEnDb(db, {
        workspaceId: ws,
        columnId: pendiente,
        title: "La que pidió el asistente",
        description: "",
        assigneeId: null,
        dueDate: null,
        tagIds: [],
        autor: ana,
        origen: "agente",
      }),
    );
    filas = await leer();
    check(
      "lo que hace el asistente queda marcado como `agente`",
      filas.some((f) => f.origen === "agente" && f.resumen.includes("La que pidió el asistente")),
    );
    check(
      "y lo que teclea la persona sigue siendo `persona`",
      filas.some((f) => f.origen === "persona"),
    );

    console.log("\nLa pregunta que antes no se podía contestar");

    const cerradas = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ veces: number }>(
        `select count(*)::int as veces from activity
          where organization_id = $1 and actor_id = $2 and verbo = 'tarea.cerrada'`,
        [org, ana],
      );
      return rows[0]!.veces;
    });
    check("«¿cuántas cerró Ana esta semana?» ya tiene respuesta", cerradas === 1);
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [
      `%-actividad-${sufijo}`,
    ]);
    await admin.query("delete from public.users where email like $1", [
      `%-actividad-${sufijo}@devup.test`,
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
