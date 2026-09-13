/**
 * Las ramas de trabajo, contra la base.
 *
 * TRES COSAS, Y LAS TRES SE LEEN BIEN CUANDO ESTÁN MAL:
 *
 *   1. **«Por repartir» tiene que ser lo que NO tiene a nadie**, no lo que no
 *      está hecho. La 0050 prometió esa lista al decidir que archivar en una
 *      rama no asigna; si además colara lo que ya tiene dueño, el gerente vería
 *      una bandeja llena de trabajo que no le toca repartir y dejaría de
 *      mirarla — que es lo mismo que no tenerla.
 *
 *   2. **Los gerentes van en plural** desde la 0050. Devolver uno solo no falla:
 *      enseña a una persona de verdad, la que estuviera primera, y el resto
 *      desaparece sin ruido.
 *
 *   3. **«Quién ha trabajado» cuenta las tareas que HOY están en la rama.** Se
 *      comprueba a propósito, porque es el matiz que la frase corta esconde: si
 *      una tarea cambia de rama, su historia se va con ella. Está bien que sea
 *      así para «¿quién sabe de esto?» y está mal para «¿cuánto se trabajó aquí
 *      en septiembre?» — y esta función solo contesta la primera.
 *
 *   npm run test:ramas-api --workspace apps/api
 */
import { closePool, withUser } from "../db/pool.js";
import { detalleDeRama, ramasDe } from "../lib/ramas.js";

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
        `${nombre}-ramas-${sufijo}@devup.test`,
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
          `acme-ramas-${sufijo}`,
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

    await admin.query(
      `insert into organization_members (organization_id, user_id, role, all_workspaces)
       values ($1,$2,'admin',true) on conflict do nothing`,
      [org, beto],
    );

    const cols = (
      await admin.query<{ id: string; position: number; is_terminal: boolean }>(
        "select id, position, is_terminal from task_columns where workspace_id = $1 order by position",
        [ws],
      )
    ).rows;
    const enMedio = cols.find((c) => !c.is_terminal && c.position > cols[0]!.position)!;

    const rama = async (nombre: string) =>
      (
        await admin.query<{ id: string }>(
          `insert into task_categories (workspace_id, name, position, created_by)
           values ($1,$2,1000,$3) returning id`,
          [ws, nombre, ana],
        )
      ).rows[0]!.id;

    const frontend = await rama("Frontend");
    const backend = await rama("Backend");

    // Dos gerentes: es el caso que la 0050 existe para permitir.
    await withUser(ana, async (db) => {
      await db.query("select public.set_category_owner($1,$2,true)", [frontend, ana]);
      await db.query("select public.set_category_owner($1,$2,true)", [frontend, beto]);
    });

    const tarea = async (categoria: string | null, titulo: string, quien: string | null) =>
      (
        await admin.query<{ id: string }>(
          `insert into tasks (workspace_id, column_id, title, position, created_by, assignee_id, category_id)
           values ($1,$2,$3,1000,$4,$5,$6) returning id`,
          [ws, enMedio.id, titulo, ana, quien, categoria],
        )
      ).rows[0]!.id;

    const conDueno = await tarea(frontend, "Esta la lleva Ana", ana);
    await tarea(frontend, "Esta no la lleva nadie", null);
    await tarea(frontend, "Esta tampoco", null);
    const deBackend = await tarea(backend, "De la otra rama, sin dueño", null);

    console.log("\nLa lista de ramas");

    const lista = await withUser(ana, (db) => ramasDe(db, { workspaceId: ws, dias: 7 }));
    const laFront = lista.find((r) => r.nombre === "Frontend")!;

    check("salen las dos ramas", lista.length === 2);
    check("con sus dos gerentes", laFront.gerentes.length === 2);
    check("y con nombre, no solo identificador", laFront.gerentes.every((g) => g.nombre !== null));

    // LA 1. «Por repartir» es lo que no tiene a nadie, no lo que no está hecho.
    check("cuenta lo pendiente entero", laFront.pendientes === 3);
    check("y por repartir solo lo que no tiene dueño", laFront.porRepartir === 2);

    // Va en la LISTA y no solo en el detalle: si no, habría que abrir cinco
    // ramas para descubrir que hay trabajo esperando en la tercera.
    const laBack = lista.find((r) => r.nombre === "Backend")!;
    check("cada rama cuenta lo suyo y no lo de al lado", laBack.porRepartir === 1);

    console.log("\nEl detalle de una rama");

    const detalle = await withUser(ana, (db) =>
      detalleDeRama(db, { categoryId: frontend, dias: 30 }),
    );
    check("por repartir trae las dos", detalle.porRepartir.length === 2);
    check(
      "y ninguna de las que ya tienen dueño",
      !detalle.porRepartir.some((t) => t.id === conDueno),
    );
    check("ni las de otra rama", !detalle.porRepartir.some((t) => t.id === deBackend));

    console.log("\nQuién ha trabajado aquí");

    const anotar = async (tarea: string, quien: string, verbo: string) =>
      admin.query(
        `insert into activity
           (organization_id, workspace_id, actor_id, verb, subject_type, subject_id,
            subject_label, source)
         values ($1,$2,$3,$4,'tarea',$5,'lo que sea','persona')`,
        [org, ws, quien, verbo, tarea],
      );

    await anotar(conDueno, ana, "creo");
    await anotar(conDueno, ana, "movio");
    await anotar(conDueno, beto, "comento");

    const gente = (
      await withUser(ana, (db) => detalleDeRama(db, { categoryId: frontend, dias: 30 }))
    ).quienHaTrabajado;

    check("sale quien la tocó", gente.length === 2);
    const deAna = gente.find((g) => g.id === ana)!;
    // Por verbo y no en un total: lo pidió así el §6.1, y un número único
    // obligaría a decidir ya cuánto vale cerrar frente a crear.
    check("con el desglose por verbo", deAna.porVerbo["creo"] === 1 && deAna.porVerbo["movio"] === 1);
    // El tipo dice `string` porque es lo que viaja por HTTP; pg lo entrega como
    // `Date`. Lo que importa comprobar no es de qué tipo es sino que sea un
    // instante de verdad y reciente — una fecha nula o de 1970 se pintaría
    // igual de convencida.
    const cuando = new Date(deAna.ultimaVez as unknown as string).getTime();
    check(
      "y con cuándo fue la última vez, que es un instante de verdad",
      Number.isFinite(cuando) && Math.abs(Date.now() - cuando) < 60_000,
    );

    /**
     * LA 3, Y ES EL MATIZ QUE LA FRASE CORTA ESCONDE.
     *
     * La tarea se muda a Backend. Su historia se va con ella: lo que se le hizo
     * en Frontend aparece ahora bajo Backend. Es lo correcto para «¿quién sabe
     * de esto?» y lo incorrecto para «¿cuánto se trabajó en Frontend?» — y esta
     * función solo contesta la primera. Se fija aquí para que quien la cambie
     * sepa que lo está cambiando.
     */
    await admin.query("update tasks set category_id = $2 where id = $1", [conDueno, backend]);

    const trasMudarse = await withUser(ana, async (db) => ({
      front: (await detalleDeRama(db, { categoryId: frontend, dias: 30 })).quienHaTrabajado,
      back: (await detalleDeRama(db, { categoryId: backend, dias: 30 })).quienHaTrabajado,
    }));

    check("mudada la tarea, su historia deja de contar en la rama vieja", trasMudarse.front.length === 0);
    check("y cuenta en la nueva", trasMudarse.back.length === 2);

    console.log("\nNombrar y quitar gerentes");

    /** Lo mismo que hacen PUT/DELETE /categories/:id/gerentes/:userId. */
    const gerente = (quienLlama: string, categoria: string, persona: string, esGerente: boolean) =>
      withUser(quienLlama, (db) =>
        db.query("select public.set_category_owner($1,$2,$3)", [categoria, persona, esGerente]),
      );
    const gerentesDe = async (categoria: string): Promise<number> =>
      Number(
        (
          await admin.query<{ n: string }>(
            "select count(*) as n from task_category_owners where category_id = $1",
            [categoria],
          )
        ).rows[0]!.n,
      );

    await gerente(ana, backend, beto, true);
    check("se puede nombrar gerente de una rama que no tenía", (await gerentesDe(backend)) === 1);

    // Idempotente: el gesto es «que esté», no «añade una fila».
    await gerente(ana, backend, beto, true);
    check("nombrar dos veces a la misma persona no la duplica", (await gerentesDe(backend)) === 1);

    await gerente(ana, backend, beto, false);
    check("y se puede quitar", (await gerentesDe(backend)) === 0);
    await gerente(ana, backend, beto, false);
    check("quitar a quien ya no está tampoco es un error", (await gerentesDe(backend)) === 0);

    // Quitar al gerente NO puede llevarse la rama ni sus tareas: nombrar a
    // quien responde es repartir poder, no clasificar trabajo.
    check(
      "quitar al gerente deja la rama y sus tareas donde estaban",
      (
        await admin.query("select 1 from task_categories where id = $1", [backend])
      ).rowCount === 1 &&
        (await admin.query("select 1 from tasks where id = $1 and category_id = $2", [
          deBackend,
          backend,
        ])).rowCount === 1,
    );

    console.log("\nY quién puede nombrarlos");

    const mirona = await alta("Mirona");
    await admin.query(
      `insert into organization_members (organization_id, user_id, role, all_workspaces)
       values ($1,$2,'member',true) on conflict do nothing`,
      [org, mirona],
    );

    /** El SQLSTATE del fallo, o "sin error" si dejó pasar. */
    const codigoDe = async (accion: () => Promise<unknown>): Promise<string> => {
      try {
        await accion();
        return "sin error";
      } catch (fallo) {
        return (fallo as { code?: string }).code ?? "desconocido";
      }
    };

    // LOS DOS RECHAZOS SON DISTINTOS A PROPÓSITO, y por eso se comprueba el
    // código y no solo que falle. «No puedes nombrar aquí» es 42501 y la API lo
    // traduce a un 403; «esa persona no está en este espacio» es 23503 y sale
    // como un 400 — es un error de quien lo pide, no una puerta cerrada.
    // Juntarlos en un único «no» haría que nombrar a un compañero recién
    // invitado se leyera como falta de permisos propios.
    check(
      "quien solo puede VER el espacio no nombra gerentes",
      (await codigoDe(() => gerente(mirona, backend, mirona, true))) === "42501",
    );
    const extrania = await alta("Extrania");
    check(
      "y quien no es de la organización tampoco",
      (await codigoDe(() => gerente(extrania, backend, extrania, true))) === "42501",
    );
    check(
      "nombrar a alguien ajeno al espacio se rechaza como dato malo, no como permiso",
      (await codigoDe(() => gerente(ana, backend, extrania, true))) === "23503",
    );
    check("después de todo eso la rama sigue sin gerentes", (await gerentesDe(backend)) === 0);

    console.log("\nY el aislamiento");

    const deFuera = await alta("Fuera");
    const loQueVe = await withUser(deFuera, (db) => ramasDe(db, { workspaceId: ws, dias: 7 }));
    check("quien no llega al espacio no ve ninguna rama", loQueVe.length === 0);
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [`%-ramas-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [
      `%-ramas-${sufijo}@devup.test`,
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
