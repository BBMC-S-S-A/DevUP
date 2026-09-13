/**
 * Los puntos, contra la base.
 *
 * LA QUE JUSTIFICA EL FICHERO ES EL BUCLE. Sin el índice único por (tarea,
 * motivo), cerrar una tarea, reabrirla y volver a cerrarla la convierte en una
 * máquina de puntos infinita — y no hace falta mala fe para dar con ello: basta
 * arrastrar una tarjeta de vuelta porque faltaba algo. El farmeo más caro de
 * detectar es el que parece trabajo normal.
 *
 * Y ESTAS OTRAS, QUE SE LEEN BIEN ESTANDO MAL:
 *
 *   · **Reabrir no puede desandar el punto.** El trabajo se hizo. Quitar puntos
 *     ya cobrados duele mucho más de lo que vale el punto de más, y la primera
 *     vez que le pase a alguien deja de creerse el marcador entero.
 *   · **Gana el delegado, no quien arrastró la tarjeta.** Un gerente ordenando
 *     su tablero el viernes no está haciendo el trabajo de nadie. Si se
 *     premiara al que mueve, el tablero pasaría a medir quién lo ordena.
 *   · **La prueba que llega tarde cuenta.** El widget `sin_justificar` prometió
 *     que justificar el martes lo que se cerró el viernes salda la deuda. Si el
 *     punto solo se ganara en el instante del cierre, esa promesa sería media.
 *   · **`a_solas` no puede depender de cuándo se mire.** Se guarda al ganarlo,
 *     no se deduce al leer: si se recalculara, un comentario de mañana cambiaría
 *     lo que pasó ayer.
 *   · **Nadie escribe puntos a mano.** No hay política de insert: un punto que
 *     se pueda escribir no mide nada.
 *
 *   npm run test:puntos --workspace apps/api
 */
import { closePool, withUser } from "../db/pool.js";
import { marcadorDeOrganizacion } from "../lib/puntos.js";

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
        `${nombre}-puntos-${sufijo}@devup.test`,
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
          `acme-puntos-${sufijo}`,
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
    const abierta = cols.find((c) => !c.is_terminal)!;
    const enMedio = cols.filter((c) => !c.is_terminal)[1] ?? abierta;
    const final = cols.find((c) => c.is_terminal)!;

    const tarea = async (titulo: string, delegado: string | null, creador = ana) =>
      (
        await admin.query<{ id: string }>(
          `insert into tasks (workspace_id, column_id, title, position, created_by, assignee_id)
           values ($1,$2,$3,1000,$4,$5) returning id`,
          [ws, abierta.id, titulo, creador, delegado],
        )
      ).rows[0]!.id;

    /** Mover como lo hace la API: con la sesión puesta, para que el disparador sepa quién es. */
    const mover = (quien: string, id: string, columna: string) =>
      withUser(quien, (db) => db.query("update tasks set column_id = $2 where id = $1", [id, columna]));

    const puntosDe = async (id: string): Promise<{ motivo: string; cantidad: number; a_solas: boolean }[]> =>
      (
        await admin.query<{ motivo: string; cantidad: number; a_solas: boolean }>(
          "select motivo::text as motivo, cantidad, a_solas from puntos where task_id = $1 order by motivo",
          [id],
        )
      ).rows;

    console.log("\nGanar un punto al cerrar");

    const suya = await tarea("La hace Ana", ana);
    await mover(ana, suya, final.id);
    check("cerrar una tarea da puntos", (await puntosDe(suya)).length === 1);
    check("y son los del cierre, sin prueba", (await puntosDe(suya))[0]?.cantidad === 10);

    const sinCerrar = await tarea("Solo se mueve", ana);
    await mover(ana, sinCerrar, enMedio.id);
    check("moverla a una columna que no termina nada no da nada", (await puntosDe(sinCerrar)).length === 0);

    console.log("\nEl bucle de cerrar y reabrir");

    await mover(ana, suya, abierta.id);
    check("reabrir NO desanda el punto", (await puntosDe(suya)).length === 1);
    await mover(ana, suya, final.id);
    await mover(ana, suya, abierta.id);
    await mover(ana, suya, final.id);
    check("y cerrarla tres veces no la cobra tres veces", (await puntosDe(suya)).length === 1);

    console.log("\nQuién gana");

    const deBeto = await tarea("La hace Beto", beto);
    await mover(ana, deBeto, final.id);
    const ganador = (
      await admin.query<{ user_id: string }>("select user_id from puntos where task_id = $1", [deBeto])
    ).rows[0]?.user_id;
    check("gana el delegado, no quien arrastró la tarjeta", ganador === beto);

    const deNadie = await tarea("Sin delegado", null);
    await mover(beto, deNadie, final.id);
    const cerrador = (
      await admin.query<{ user_id: string }>("select user_id from puntos where task_id = $1", [deNadie])
    ).rows[0]?.user_id;
    check("si no hay delegado, gana quien la cerró", cerrador === beto);

    console.log("\nLa prueba de cómo se hizo");

    const conPrueba = await tarea("Con prueba desde el principio", ana);
    await admin.query(
      `insert into task_evidence (task_id, tipo, nota, created_by) values ($1,'nota',$2,$3)`,
      [conPrueba, "se hizo así", ana],
    );
    await mover(ana, conPrueba, final.id);
    const dos = await puntosDe(conPrueba);
    check("cerrar con prueba gana los dos puntos de una vez", dos.length === 2);
    check("y suman quince", dos.reduce((s, p) => s + p.cantidad, 0) === 15);

    const tardia = await tarea("La prueba llega el martes", ana);
    await mover(ana, tardia, final.id);
    check("al cerrarla sin prueba solo gana el cierre", (await puntosDe(tardia)).length === 1);
    await admin.query(
      `insert into task_evidence (task_id, tipo, nota, created_by) values ($1,'nota',$2,$3)`,
      [tardia, "así se hizo, con retraso", ana],
    );
    check("justificar después también cuenta", (await puntosDe(tardia)).length === 2);
    await admin.query(
      `insert into task_evidence (task_id, tipo, nota, created_by) values ($1,'nota',$2,$3)`,
      [tardia, "y otra prueba más", ana],
    );
    check("pero dos pruebas no son dos puntos", (await puntosDe(tardia)).length === 2);

    const pruebaAntesSinCerrar = await tarea("Prueba antes, y sigue abierta", ana);
    await admin.query(
      `insert into task_evidence (task_id, tipo, nota, created_by) values ($1,'nota',$2,$3)`,
      [pruebaAntesSinCerrar, "todavía no acabo", ana],
    );
    check(
      "dejar prueba en una tarea abierta no gana nada por sí solo",
      (await puntosDe(pruebaAntesSinCerrar)).length === 0,
    );

    console.log("\nA solas, que se dice y no se castiga");

    const aSolas = await tarea("Nadie más la tocó", ana);
    await mover(ana, aSolas, final.id);
    const filaSola = (await puntosDe(aSolas))[0]!;
    check("quien trabaja solo gana igual", filaSola.cantidad === 10);
    check("y queda marcado que fue a solas", filaSola.a_solas === true);

    const acompanada = await tarea("Beto también anduvo por aquí", ana);
    await admin.query(
      `insert into activity (workspace_id, organization_id, actor_id, verb, subject_type, subject_id, subject_label)
       values ($1,$2,$3,'movio','tarea',$4,'Beto también anduvo por aquí')`,
      [ws, org, beto, acompanada],
    );
    await mover(ana, acompanada, final.id);
    check("si pasó otra persona, no es a solas", (await puntosDe(acompanada))[0]?.a_solas === false);

    console.log("\nEl marcador");

    const marcador = await withUser(ana, (db) =>
      marcadorDeOrganizacion(db, { organizationId: org, dias: 30 }),
    );
    const deAna = marcador.find((p) => p.id === ana)!;
    check("el marcador reparte por persona", marcador.length === 2);
    check("y trae el nombre, no solo el identificador", deAna.nombre === "Ana");
    check("suma los dos motivos por separado", Object.keys(deAna.porMotivo).length === 2);
    check(
      "el total cuadra con la suma de los motivos",
      deAna.total === Object.values(deAna.porMotivo).reduce((s, n) => s + Number(n), 0),
    );
    check("y «a solas» viene al lado del total, no en otra pantalla", deAna.aSolas > 0);
    check("«a solas» nunca puede pasar del total", deAna.aSolas <= deAna.total);

    console.log("\nY que nadie los escriba a mano");

    const aMano = async (quien: string): Promise<string> => {
      try {
        await withUser(quien, (db) =>
          db.query(
            `insert into puntos (organization_id, workspace_id, user_id, motivo, cantidad, a_solas)
             values ($1,$2,$3,'cerro_tarea',9999,false)`,
            [org, ws, quien],
          ),
        );
        return "entró";
      } catch (fallo) {
        return (fallo as { code?: string }).code ?? "desconocido";
      }
    };
    check("ni siquiera un administrador puede apuntarse puntos", (await aMano(ana)) === "42501");

    const borrar = async (): Promise<string> => {
      try {
        await withUser(ana, (db) => db.query("delete from puntos where task_id = $1", [suya]));
        return "borró";
      } catch (fallo) {
        return (fallo as { code?: string }).code ?? "desconocido";
      }
    };
    // Sin política de DELETE, RLS no revienta: no encuentra filas que borrar.
    await borrar();
    check("ni borrar los de otro", (await puntosDe(suya)).length === 1);

    console.log("\nY el aislamiento");

    const deFuera = await alta("Fuera");
    const loQueVe = await withUser(deFuera, (db) =>
      marcadorDeOrganizacion(db, { organizationId: org, dias: 30 }),
    );
    check("quien no es de la organización no ve ni un punto", loQueVe.length === 0);
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [`%-puntos-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [
      `%-puntos-${sufijo}@devup.test`,
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
