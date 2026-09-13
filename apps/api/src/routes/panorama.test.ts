/**
 * El panorama de una organización, contra la base.
 *
 * LO QUE MÁS IMPORTA AQUÍ ES LO QUE **NO** SALE. Es una portada: enseña de un
 * vistazo los espacios, la gente y lo que se está tocando. Si colara un espacio
 * al que quien mira no llega, la fuga no sería un error visible sino una lista
 * con una línea de más — y esa línea lleva el nombre de un proyecto de un
 * cliente que no es suyo. Desde 0035 cada espacio se aísla por sí mismo, así
 * que pertenecer a la organización NO es pertenecer a todos sus espacios, y
 * esta portada es exactamente donde esa diferencia se puede perder.
 *
 * Y TRES COSAS QUE SE ROMPEN SIN FALLAR:
 *
 *   · «En curso» se deduce de la posición de la columna, no de su nombre: cada
 *     tablero llama a las suyas como quiere. Si se colara la primera columna,
 *     la portada diría que está empezado todo lo que solo está apuntado.
 *
 *   · «Atascada» es distinto de «vencida». Una tarea sin fecha no vence nunca y
 *     puede llevar tres semanas quieta, que es justo la que hay que sacar a la
 *     superficie porque nadie va a ir a buscarla.
 *
 *   · El oficio de alguien es el de ESTA organización (0048) y nunca su
 *     `role`. `member` es un permiso; enseñarlo donde se pregunta «¿a qué se
 *     dedica?» es la respuesta equivocada a la pregunta correcta.
 *
 *   npm run test:panorama --workspace apps/api
 */
import { closePool, withUser } from "../db/pool.js";
import { panoramaDeOrganizacion } from "../lib/panorama.js";

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
        `${nombre}-pano-${sufijo}@devup.test`,
        "no-se-usa",
        nombre,
      ])
    ).rows[0]!.id;

  const ana = await alta("Ana");
  const carla = await alta("Carla");

  try {
    // Ana monta la organización con DOS espacios. Carla entra a la
    // organización pero solo a uno: es la diferencia que la portada no puede
    // perder.
    const { org, abierto, cerrado } = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          `Acme ${sufijo}`,
          `acme-pano-${sufijo}`,
        ])
      ).rows[0]!.id;
      const espacio = async (nombre: string) =>
        (
          await db.query<{ id: string }>(
            "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
            [org, nombre, ana],
          )
        ).rows[0]!.id;
      return { org, abierto: await espacio("Compartido"), cerrado: await espacio("Solo de Ana") };
    });

    await admin.query(
      `insert into organization_members (organization_id, user_id, role, all_workspaces)
       values ($1,$2,'member',false) on conflict do nothing`,
      [org, carla],
    );
    await admin.query(
      "insert into workspace_members (workspace_id, user_id) values ($1,$2) on conflict do nothing",
      [abierto, carla],
    );

    /** Las columnas del tablero, que las crea el disparador al nacer. */
    const columnas = async (ws: string) =>
      (
        await admin.query<{ id: string; position: number; is_terminal: boolean }>(
          "select id, position, is_terminal from task_columns where workspace_id = $1 order by position",
          [ws],
        )
      ).rows;

    const colsAbierto = await columnas(abierto);
    const primera = colsAbierto[0]!;
    const enMedio = colsAbierto.find((c) => !c.is_terminal && c.position > primera.position)!;

    const tarea = async (ws: string, col: string, titulo: string, quien: string | null) =>
      (
        await admin.query<{ id: string }>(
          `insert into tasks (workspace_id, column_id, title, position, created_by, assignee_id)
           values ($1,$2,$3,1000,$4,$5) returning id`,
          [ws, col, titulo, ana, quien],
        )
      ).rows[0]!.id;

    await tarea(abierto, primera.id, "Solo apuntada", ana);
    await tarea(abierto, enMedio.id, "Empezada de verdad", carla);
    const vieja = await tarea(abierto, enMedio.id, "Lleva un mes quieta", ana);
    await admin.query("update tasks set created_at = now() - interval '30 days' where id = $1", [
      vieja,
    ]);

    // Y una en el espacio al que Carla no llega, para ver si se le cuela.
    const colsCerrado = await columnas(cerrado);
    const enMedioCerrado = colsCerrado.find(
      (c) => !c.is_terminal && c.position > colsCerrado[0]!.position,
    )!;
    await tarea(cerrado, enMedioCerrado.id, "El secreto de Ana", ana);

    // La MISMA función que usa la ruta, no una copia del SQL.
    type Respuesta = {
      espacios: { id: string; nombre: string; pendientes: number }[];
      gente: { nombre: string; oficio: string | null; permiso: string; enQue: string[] }[];
      enMarcha: { titulo: string; espacio: string }[];
      atascadas: { titulo: string }[];
    };

    const pedir = (quien: string): Promise<Respuesta> =>
      withUser(quien, (db) =>
        panoramaDeOrganizacion(db, { organizationId: org, dias: 7 }),
      ) as Promise<Respuesta>;

    console.log("\nLo que ve quien montó la organización");

    const deAna = await pedir(ana);
    check("ve sus dos espacios", deAna.espacios.length === 2);
    check("con lo que queda pendiente en cada uno", deAna.espacios.every((e) => e.pendientes >= 0));
    check("y las dos personas", deAna.gente.length === 2);

    console.log("\nLo que NO ve quien solo está en uno");

    const deCarla = await pedir(carla);
    // LA QUE JUSTIFICA LA PRUEBA. Carla es miembro de la organización, así que
    // sale en «gente»; pero el espacio al que no pertenece no existe para ella.
    check("solo ve el espacio al que pertenece", deCarla.espacios.length === 1);
    check("y es el suyo", deCarla.espacios[0]?.nombre === "Compartido");
    check(
      "no se le cuela ninguna tarea del espacio ajeno",
      !deCarla.enMarcha.some((t) => t.titulo === "El secreto de Ana"),
    );
    check(
      "ni por la vía de las atascadas",
      !deCarla.atascadas.some((t) => t.titulo === "El secreto de Ana"),
    );

    console.log("\nQué cuenta como «en curso» y como «atascada»");

    // Ni la primera columna ni la terminal: se deduce de la posición porque
    // cada tablero llama a las suyas como quiere.
    check(
      "lo que solo está apuntado NO está en curso",
      !deAna.enMarcha.some((t) => t.titulo === "Solo apuntada"),
    );
    check(
      "lo empezado sí",
      deAna.enMarcha.some((t) => t.titulo === "Empezada de verdad"),
    );

    // Sin fecha de vencimiento: no vence nunca, y lleva un mes quieta. Es la
    // que hay que sacar a la superficie porque nadie va a ir a buscarla.
    check(
      "una tarea sin fecha pero parada sale como atascada",
      deAna.atascadas.some((t) => t.titulo === "Lleva un mes quieta"),
    );
    check(
      "y la recién tocada no",
      !deAna.atascadas.some((t) => t.titulo === "Empezada de verdad"),
    );

    console.log("\nEl oficio, que no es el permiso");

    await withUser(carla, (db) =>
      db.query("select public.set_my_title($1,$2)", [org, "diseño"]),
    );

    const conOficio = await pedir(ana);
    const laCarla = conOficio.gente.find((p) => p.nombre === "Carla")!;
    check("el oficio que se puso en ESTA organización", laCarla.oficio === "diseño");
    check("y no su permiso", laCarla.permiso === "member" && laCarla.oficio !== "member");

    // Y no se puede poner el oficio donde no se está.
    const fuera = await withUser(ana, async (db) => {
      try {
        await db.query("select public.set_my_title($1,$2)", [
          "00000000-0000-0000-0000-000000000000",
          "lo que sea",
        ]);
        return "coló";
      } catch (fallo) {
        return (fallo as { code?: string }).code ?? "?";
      }
    });
    check("no se puede poner oficio en una organización ajena", fuera === "42501");

    console.log("\nEl rol, que no es el oficio ni el permiso");

    // Tres cosas que se llaman parecido y no son la misma: `role` es el
    // permiso, `title` es el oficio en texto libre que se le ensena a los
    // demas, y `rol` es una lista cerrada que solo elige que tutorial se
    // ofrece. Lo que hay que fijar es que elegir tutorial no toque las otras
    // dos — un valor que aterrizara en `role` repartiria permisos.
    await withUser(carla, (db) =>
      db.query("select public.set_my_rol($1,$2::public.rol_de_equipo)", [org, "diseno"]),
    );
    const trasElRol = await withUser(carla, async (db) => {
      const { rows } = await db.query<{ role: string; title: string | null; rol: string | null }>(
        `select role, title, rol::text as rol from organization_members
          where organization_id = $1 and user_id = $2`,
        [org, carla],
      );
      return rows[0]!;
    });
    check("se guarda el rol elegido", trasElRol.rol === "diseno");
    check("sin tocar el permiso", trasElRol.role === "member");
    check("ni el oficio escrito a mano", trasElRol.title === "diseño");

    const rolInventado = await withUser(carla, async (db) => {
      try {
        await db.query("select public.set_my_rol($1,$2::public.rol_de_equipo)", [org, "pirata"]);
        return "coló";
      } catch (fallo) {
        return (fallo as { code?: string }).code ?? "?";
      }
    });
    // La lista es cerrada de verdad: la rechaza el tipo, no una comprobacion
    // que alguien pueda olvidarse de repetir en la siguiente ruta.
    check("un rol que no está en la lista no entra", rolInventado === "22P02");

    const rolFuera = await withUser(ana, async (db) => {
      try {
        await db.query("select public.set_my_rol($1,$2::public.rol_de_equipo)", [
          "00000000-0000-0000-0000-000000000000",
          "backend",
        ]);
        return "coló";
      } catch (fallo) {
        return (fallo as { code?: string }).code ?? "?";
      }
    });
    check("ni se elige tutorial en una organización ajena", rolFuera === "42501");

    console.log("\nEn qué anda cada quien");

    // Sale de las tareas sin terminar que tiene asignadas, no de a qué espacios
    // pertenece: pertenecer a cinco y no tocar ninguno es lo normal.
    check("quien tiene algo empezado dice dónde", laCarla.enQue.includes("Compartido"));

  } finally {
    await admin.query("delete from public.organizations where slug like $1", [`%-pano-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [
      `%-pano-${sufijo}@devup.test`,
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
