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
import { anotarEvidencia, crearTareaEnDb, evidenciaZ, moverTareaEnDb } from "./tasks.js";
import { cierresPorPersona } from "../lib/actividad.js";

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

type Fila = { verbo: string; procedencia: string; resumen: string };

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
      // Desde la 0043 un tablero nuevo nace con su «Hecho» marcada. Que esto
      // sea una comprobación y no un `??` con un inserto de respaldo es lo que
      // convierte el arreglo en algo que no se puede volver a romper: antes,
      // el respaldo tapaba justo el fallo que la 0043 corrige.
      const hecho = columnas.find((c) => c.is_terminal)?.id;
      if (!hecho) throw new Error("un tablero nuevo tiene que nacer con una columna terminal");

      return { org, ws, pendiente, hecho };
    });

    const leer = (): Promise<Fila[]> =>
      withUser(ana, async (db) => {
        const { rows } = await db.query<Fila>(
          `select verb as verbo, source as procedencia, subject_label as resumen
             from activity
            where organization_id = $1 order by at, verb`,
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
      "crear anota `creo`",
      filas.some((f) => f.verbo === "creo"),
    );
    check(
      "asignar al crear anota también `asigno`",
      filas.some((f) => f.verbo === "asigno"),
    );
    check(
      "el resumen guarda el título que la tarea tenía entonces",
      filas.some((f) => f.resumen.includes("Arreglar el 415 del túnel")),
    );

    console.log("\nMover, cerrar y reabrir");

    // Reordenar no es un hecho que nadie vaya a querer recordar. Si esto se
    // rompe, la historia se llena de ruido hasta esconder lo que importa.
    const antes = filas.length;
    await withUser(ana, (db) => moverTareaEnDb(db, taskId, pendiente, null, { userId: ana }));
    check("reordenar dentro de la misma columna no anota nada", (await leer()).length === antes);

    await withUser(ana, (db) => moverTareaEnDb(db, taskId, hecho, null, { userId: ana }));
    filas = await leer();
    const cerrada = filas.find((f) => f.verbo === "cerro");
    check("mover a una columna terminal anota `cerro`, no `movio`", Boolean(cerrada));
    // Antes esta comprobación miraba que el renglón empezara por «cerró»: allí
    // la columna guardaba una frase compuesta. En el esquema que se queda,
    // `subject_label` guarda el TÍTULO que la tarea tenía al cerrarla, y la
    // frase se compone al pintarla. Lo que hay que fijar es lo que de verdad
    // importaba: que ese título queda congelado y el renglón se puede leer
    // aunque la tarea se renombre o se borre después.
    check(
      "y guarda el título que la tarea tenía en ese momento",
      cerrada?.resumen === "Arreglar el 415 del túnel",
    );

    await withUser(ana, (db) => moverTareaEnDb(db, taskId, pendiente, null, { userId: ana }));
    check(
      "sacarla de la columna terminal anota `reabrio`",
      (await leer()).some((f) => f.verbo === "reabrio"),
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
        procedencia: "agente",
      }),
    );
    filas = await leer();
    check(
      "lo que hace el asistente queda marcado como `agente`",
      filas.some((f) => f.procedencia === "agente" && f.resumen.includes("La que pidió el asistente")),
    );
    check(
      "y lo que teclea la persona sigue siendo `persona`",
      filas.some((f) => f.procedencia === "persona"),
    );

    console.log("\nÁreas: archivar en vez de repartir");

    const area = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into task_categories (workspace_id, name, owner_id, position, created_by)
         values ($1, 'DevVerse', $2, 1000, $2) returning id`,
        [ws, ana],
      );
      return rows[0]!.id;
    });

    // Lo que hace útiles las áreas: sin decir a quién, la tarea cae en quien
    // lleva el área. Si esto se rompe, la función pierde su motivo de existir.
    const heredada = await withUser(ana, (db) =>
      crearTareaEnDb(db, {
        workspaceId: ws,
        columnId: pendiente,
        title: "Personalización de personajes",
        description: "",
        assigneeId: null,
        dueDate: null,
        tagIds: [],
        categoryId: area,
        autor: ana,
      }),
    );
    check("una tarea archivada en un área hereda a quien la lleva", heredada.assigneeId === ana);
    check("y queda clasificada en esa área", heredada.categoryId === area);

    // Sin área no hay a quién heredar: la tarea se queda sin responsable, que
    // es el comportamiento de siempre y no debe cambiar por añadir esto.
    const sinArea = await withUser(ana, (db) =>
      crearTareaEnDb(db, {
        workspaceId: ws,
        columnId: pendiente,
        title: "Sin clasificar",
        description: "",
        assigneeId: null,
        dueDate: null,
        tagIds: [],
        autor: ana,
      }),
    );
    check("sin área, la tarea sigue sin responsable", sinArea.assigneeId === null);
    check("y sin clasificar", sinArea.categoryId === null);

    // La trampa que RLS no puede cerrar: clasificar una tarea en el área de
    // otro espacio al que la persona también tiene acceso. Lo para el
    // disparador de la 0039, en la base y no en un `if` de una ruta.
    const otroEspacio = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
        [org, "Otro tablero", ana],
      );
      return rows[0]!.id;
    });
    const cruzada = await withUser(ana, async (db) => {
      const { rows: col } = await db.query<{ id: string }>(
        "select id from task_columns where workspace_id = $1 order by position limit 1",
        [otroEspacio],
      );
      try {
        await db.query(
          `insert into tasks (workspace_id, column_id, title, position, created_by, category_id)
           values ($1,$2,'intrusa',1000,$3,$4)`,
          [otroEspacio, col[0]!.id, ana, area],
        );
        return "coló";
      } catch {
        return "rechazado";
      }
    });
    check("una tarea no puede clasificarse en un área de otro espacio", cruzada === "rechazado");

    console.log("\nLa pregunta que antes no se podía contestar");

    const cerradas = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ veces: number }>(
        `select count(*)::int as veces from activity
          where organization_id = $1 and actor_id = $2 and verb = 'cerro'`,
        [org, ana],
      );
      return rows[0]!.veces;
    });
    check("«¿cuántas cerró Ana esta semana?» ya tiene respuesta", cerradas === 1);

    console.log("\nLa evidencia");

    // Que una evidencia sea un hecho con autor y fecha es lo que la distingue
    // de un adjunto, y por eso deja rastro en el registro: sin la anotación,
    // «¿quién dijo que esto estaba probado?» vuelve a no tener respuesta.
    const conPrueba = await withUser(ana, async (db) => {
      const t = await crearTareaEnDb(db, {
        workspaceId: ws,
        columnId: pendiente,
        title: "Pasarela de pagos",
        description: "",
        assigneeId: null,
        dueDate: null,
        tagIds: [],
        autor: ana,
        tipo: "funcionalidad",
        prioridad: 3,
        criterio: "un pago de prueba llega a la cuenta",
      });
      await anotarEvidencia(db, {
        taskId: t.id as string,
        workspaceId: ws,
        titulo: t.title as string,
        autor: ana,
        evidencia: { tipo: "pr", url: "https://github.com/acme/x/pull/9", titulo: "", nota: "" },
      });
      return t.id as string;
    });

    filas = await leer();
    check(
      "adjuntar una prueba se anota en el registro",
      filas.some((f) => f.verbo === "evidencio"),
    );
    check(
      "y el renglón de la prueba apunta a la tarea por su título",
      filas.some((f) => f.verbo === "evidencio" && f.resumen.length > 0),
    );

    const ficha = await withUser(ana, async (db) => {
      const { rows } = await db.query<{
        tipo: string | null;
        prioridad: number;
        criterio: string;
      }>("select tipo, prioridad, criterio from tasks where id = $1", [conPrueba]);
      return rows[0]!;
    });
    check("la tarea guarda su tipo", ficha.tipo === "funcionalidad");
    check("su prioridad", ficha.prioridad === 3);
    check("y el criterio de cuándo está hecha", ficha.criterio.includes("un pago de prueba"));

    // Las dos capas dicen lo mismo, y no por duplicar: arriba para poder
    // explicar QUÉ falta, abajo para que siga siendo verdad si algún día se
    // escribe por otra puerta.
    check(
      "un PR sin enlace no prueba nada, y se dice arriba",
      evidenciaZ.safeParse({ tipo: "pr", titulo: "", nota: "" }).success === false,
    );
    check(
      "una nota sin texto tampoco",
      evidenciaZ.safeParse({ tipo: "nota", titulo: "", nota: "" }).success === false,
    );
    const enLaBase = await withUser(ana, async (db) => {
      try {
        await db.query(
          "insert into task_evidence (task_id, tipo, created_by) values ($1,'pr',$2)",
          [conPrueba, ana],
        );
        return "coló";
      } catch {
        return "rechazado";
      }
    });
    check("y también abajo, en la base", enLaBase === "rechazado");

    console.log("\nCuánto tarda en cerrarse lo que cierra cada uno");

    // Es la única consulta del registro que CALCULA algo en vez de contarlo, y
    // por eso es la única que puede estar mal sin devolver un error: una
    // mediana equivocada sigue siendo un número, y un número parece verdad.
    //
    // Se fabrican tres cierres con duraciones conocidas —1, 3 y 10 días—
    // escribiendo en el registro directamente, que es lo que permite fijar las
    // fechas. La mediana de esas tres es 3.
    const medido = await withUser(ana, async (db) => {
      for (const [dias, n] of [
        [1, "a"],
        [3, "b"],
        [10, "c"],
      ] as const) {
        const objeto = (
          await db.query<{ id: string }>("select gen_random_uuid() as id")
        ).rows[0]!.id;
        await db.query(
          `insert into activity
             (organization_id, workspace_id, actor_id, verb, subject_type, subject_id,
              subject_label, at)
           values ($1,$2,$3,'creo','tarea',$4,$5, now() - ($6::int || ' days')::interval),
                  ($1,$2,$3,'cerro','tarea',$4,$5, now())`,
          [org, ws, ana, objeto, `medida ${n}`, dias],
        );
      }
      return cierresPorPersona(db, { organizationId: org, dias: 30, workspaceId: ws });
    });

    const deAna = medido.find((c) => c.actorId === ana);
    // Las tres fabricadas más la que se cerró de verdad más arriba, que se
    // creó y se cerró en el mismo segundo.
    check("cuenta los cierres que tienen creación en el registro", deAna?.cerradas === 4);
    // Con 0, 1, 3 y 10 días, la mediana es el punto medio entre 1 y 3.
    check("y la mediana es la mediana, no la media", deAna?.diasMediana === 2);

    // Lo que no tiene `creo` en el registro no se puede medir, y eso
    // incluye todo lo anterior a la 0038. Queda fuera en vez de estimarse: un
    // número honesto y parcial se puede interpretar; uno inventado, no.
    const huerfana = await withUser(ana, async (db) => {
      await db.query(
        `insert into activity
           (organization_id, workspace_id, actor_id, verb, subject_type, subject_id, subject_label)
         values ($1,$2,$3,'cerro','tarea',gen_random_uuid(),'sin creación')`,
        [org, ws, ana],
      );
      return cierresPorPersona(db, { organizationId: org, dias: 30, workspaceId: ws });
    });
    check(
      "una tarea cerrada sin creación anotada no se mide ni se estima",
      huerfana.find((c) => c.actorId === ana)?.cerradas === 4,
    );
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
