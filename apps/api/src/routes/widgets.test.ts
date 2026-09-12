/**
 * Los datos de los widgets del panel, contra la base.
 *
 * QUÉ SE VIGILA AQUÍ. Un panel es la primera pantalla de un espacio y está
 * hecho de trozos independientes, así que las formas de estar mal son las de
 * siempre —salen en pantalla como un panel perfectamente normal—:
 *
 *   1. **Que un canal privado ajeno aparezca en los no leídos.** Sería una
 *      tarjeta que dice que hay tres mensajes sin leer en una conversación a la
 *      que quien mira no pertenece. No es un error visible: es una línea de más.
 *
 *   2. **Que «atascada» acabe significando «vencida».** Una tarea sin fecha no
 *      vence nunca y puede llevar un mes quieta, y es exactamente la que el
 *      widget existe para sacar a la superficie.
 *
 *   3. **Que se calcule lo que no se pidió.** El sentido de pedir los widgets en
 *      la URL es no hacer ocho consultas para pintar dos. Si el filtro se
 *      ignorara, el panel seguiría bien y la mejora habría desaparecido.
 *
 *   4. **Que un widget vacío se distinga de uno que no llegó.** Por eso un
 *      fallo en una consulta tumba la petición entera en vez de devolver ese
 *      trozo en blanco: en blanco se lee como «aquí no hay nada».
 *
 *   npm run test:widgets --workspace apps/api
 */
import { closePool, withUser } from "../db/pool.js";
import { datosDeWidgets, WIDGETS_CON_DATOS } from "../lib/widgets.js";

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
        `${nombre}-wid-${sufijo}@devup.test`,
        "no-se-usa",
        nombre,
      ])
    ).rows[0]!.id;

  const ana = await alta("Ana");
  const beto = await alta("Beto");

  try {
    const { org, ws } = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          `Acme ${sufijo}`,
          `acme-wid-${sufijo}`,
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

    // Beto entra a la organización y al espacio, pero no a todos los canales.
    await admin.query(
      `insert into organization_members (organization_id, user_id, role, all_workspaces)
       values ($1,$2,'member',true) on conflict do nothing`,
      [org, beto],
    );
    await admin.query(
      "insert into workspace_members (workspace_id, user_id) values ($1,$2) on conflict do nothing",
      [ws, beto],
    );

    const cols = (
      await admin.query<{ id: string; position: number; is_terminal: boolean }>(
        "select id, position, is_terminal from task_columns where workspace_id = $1 order by position",
        [ws],
      )
    ).rows;
    const primera = cols[0]!;
    const enMedio = cols.find((c) => !c.is_terminal && c.position > primera.position)!;

    const tarea = async (col: string, titulo: string, quien: string | null, vence: string | null) =>
      (
        await admin.query<{ id: string }>(
          `insert into tasks (workspace_id, column_id, title, position, created_by, assignee_id, due_date)
           values ($1,$2,$3,1000,$4,$5,$6::date) returning id`,
          [ws, col, titulo, ana, quien, vence],
        )
      ).rows[0]!.id;

    await tarea(primera.id, "Solo apuntada", ana, null);
    await tarea(enMedio.id, "Mía y empezada", ana, null);
    await tarea(enMedio.id, "De Beto", beto, null);
    const quieta = await tarea(enMedio.id, "Un mes sin tocar", ana, null);
    await admin.query("update tasks set created_at = now() - interval '30 days' where id = $1", [
      quieta,
    ]);

    const pedir = (quien: string, widgets: readonly string[], dias = 7) =>
      withUser(quien, (db) =>
        datosDeWidgets(db, {
          workspaceId: ws,
          widgets: widgets as (typeof WIDGETS_CON_DATOS)[number][],
          dias,
        }),
      );

    console.log("\nSolo lo que se pide");

    const dos = await pedir(ana, ["mis_tareas", "resumen"]);
    check("vienen los dos que se pidieron", Object.keys(dos).sort().join() === "mis_tareas,resumen");
    // LA 3. Si el filtro se ignorara y viniera todo, el panel seguiría bien y la
    // única razón de esta ruta —no hacer ocho consultas para pintar dos— habría
    // desaparecido sin que nada fallara.
    check("y NADA más", !("actividad" in dos) && !("no_leidos" in dos));

    const repetido = await pedir(ana, ["resumen", "resumen", "resumen"]);
    check("pedir el mismo tres veces lo consulta una", Object.keys(repetido).length === 1);

    console.log("\nLo mío y lo de los demás");

    const mias = (await pedir(ana, ["mis_tareas"]))["mis_tareas"] as { titulo: string }[];
    check("sale lo mío", mias.some((t) => t.titulo === "Mía y empezada"));
    check("y no lo de otro", !mias.some((t) => t.titulo === "De Beto"));

    const deBeto = (await pedir(beto, ["mis_tareas"]))["mis_tareas"] as { titulo: string }[];
    // `current_user_id()` dentro de la consulta: si se hubiera pasado el usuario
    // por parámetro desde fuera, aquí saldría lo de Ana.
    check("y a Beto le sale lo suyo, no lo de Ana", deBeto.every((t) => t.titulo === "De Beto"));

    console.log("\nAtascada no es vencida");

    const atascadas = (await pedir(ana, ["atascadas"]))["atascadas"] as { titulo: string }[];
    // LA 2. Sin fecha: no vence nunca, y lleva un mes quieta.
    check("una sin fecha pero parada sale", atascadas.some((t) => t.titulo === "Un mes sin tocar"));
    check("la recién creada no", !atascadas.some((t) => t.titulo === "Mía y empezada"));
    // Lo que solo está apuntado no está atascado: está esperando, que es otra cosa.
    check("y lo que solo está apuntado tampoco", !atascadas.some((t) => t.titulo === "Solo apuntada"));

    console.log("\nLos números, los tres juntos");

    const resumen = (await pedir(ana, ["resumen"]))["resumen"] as {
      pendientes: number;
      enCurso: number;
      cerradas: number;
    };
    check("cuenta lo pendiente", resumen.pendientes === 4);
    // «En curso» es un subconjunto de «pendientes», no otra cosa: las tres de en
    // medio, sin la que solo está apuntada.
    check("y lo empezado, que es menos", resumen.enCurso === 3);
    check("y lo cerrado en la ventana", resumen.cerradas === 0);

    console.log("\nEl canal al que no se pertenece");

    const privado = (
      await admin.query<{ id: string }>(
        `insert into channels (workspace_id, name, kind, is_private, created_by)
         values ($1,'secreto','text',true,$2) returning id`,
        [ws, ana],
      )
    ).rows[0]!.id;
    await admin.query(
      "insert into channel_members (channel_id, user_id) values ($1,$2) on conflict do nothing",
      [privado, ana],
    );
    await admin.query(
      "insert into messages (channel_id, author_id, body) values ($1,$2,'algo que no es de Beto')",
      [privado, ana],
    );

    // Y un canal público donde Beto sí puede leer, para tener con qué comparar:
    // si «no ve el privado» saliera de que no ve NINGUNO, la comprobación de
    // abajo pasaría por el motivo equivocado.
    const publico = (
      await admin.query<{ id: string }>(
        `insert into channels (workspace_id, name, kind, is_private, created_by)
         values ($1,'general','text',false,$2) returning id`,
        [ws, ana],
      )
    ).rows[0]!.id;
    await admin.query(
      "insert into messages (channel_id, author_id, body) values ($1,$2,'hola a todos')",
      [publico, ana],
    );

    type SinLeer = { canal: string; sinLeer: number };
    const noLeidosDeBeto = (await pedir(beto, ["no_leidos"]))["no_leidos"] as SinLeer[];

    // LA 1. La fuga no sería un error: sería una tarjeta diciendo que hay un
    // mensaje sin leer en una conversación a la que no pertenece.
    check(
      "Beto no ve el canal privado en sus no leídos",
      !noLeidosDeBeto.some((c) => c.canal === "secreto"),
    );
    // Y que eso NO sea porque no ve ninguno: el público sí tiene que estar, o
    // la comprobación de arriba estaría pasando por el motivo equivocado.
    check(
      "pero sí el público, que es donde sí puede leer",
      noLeidosDeBeto.some((c) => c.canal === "general" && c.sinLeer === 1),
    );

    // Los que no tienen nada sin leer no ocupan sitio para decir que no pasa
    // nada: un widget de no leídos lleno de ceros es peor que uno vacío.
    check(
      "y ninguno de los que salen está a cero",
      noLeidosDeBeto.length > 0 && noLeidosDeBeto.every((c) => c.sinLeer > 0),
    );
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [`%-wid-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [
      `%-wid-${sufijo}@devup.test`,
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
