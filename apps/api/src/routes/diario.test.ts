/**
 * El diario del proyecto, contra la base.
 *
 * POR QUÉ NECESITA PRUEBA PROPIA. Todo lo que puede estar mal aquí sale en
 * pantalla como un diario perfectamente creíble. No hay una forma de romperlo
 * que se vea rota:
 *
 *   1. **Las semanas vacías.** Si se devolvieran solo las que tienen algo,
 *      dos entradas seguidas parecerían consecutivas con un mes de silencio
 *      entre ellas. El diario contaría un ritmo que no existió, y lo contaría
 *      ordenadito.
 *
 *   2. **El huso horario.** Truncar en UTC mete lo que se cerró un domingo por
 *      la tarde en Bogotá en la semana siguiente, porque allí ya es lunes. El
 *      hito aparece — en la casilla equivocada.
 *
 *   3. **Qué cuenta como hito.** Un diario que contara movimientos daría sus
 *      semanas más llenas a quien más arrastra tarjetas. Cierres, y de tareas:
 *      `cerro` a secas acabaría contando el cierre de cualquier otra cosa que
 *      se anote mañana con ese verbo.
 *
 * Y la de siempre, que aquí no se comprueba porque es de `isolation.test.ts`:
 * el aislamiento lo ponen las políticas, no esta consulta.
 *
 *   npm run test:diario --workspace apps/api
 */
import { closePool, withUser } from "../db/pool.js";
import { diarioPorSemanas, type SemanaDelDiario } from "../lib/actividad.js";

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

type Semana = SemanaDelDiario;

async function main(): Promise<void> {
  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  await admin.query("set search_path to public");

  const ana = (
    await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
      `ana-diario-${sufijo}@devup.test`,
      "no-se-usa",
      "Ana",
    ])
  ).rows[0]!.id;

  try {
    const { org, ws } = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          `Acme ${sufijo}`,
          `acme-diario-${sufijo}`,
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

    /**
     * Se escribe como dueño y con la fecha puesta a mano.
     *
     * `anotar` pone `now()`, y un diario por semanas no se puede probar con
     * todo cayendo hoy: haría falta esperar siete días para ver la segunda
     * fila. Lo que se prueba aquí es el agrupado, no el camino de escritura
     * —eso es de `actividad.test.ts`—, así que la historia se fabrica.
     */
    const anotarEn = async (cuando: string, verbo: string, etiqueta: string, sujeto = "tarea") => {
      await admin.query(
        `insert into activity
           (organization_id, workspace_id, actor_id, verb, subject_type, subject_label, source, at)
         values ($1,$2,$3,$4,$5,$6,'persona',$7::timestamptz)`,
        [org, ws, ana, verbo, sujeto, etiqueta, cuando],
      );
    };

    // La MISMA función que usa la ruta, no una copia del SQL: una prueba que
    // comprueba su propia copia no comprueba nada — las dos pueden divergir y
    // seguir las dos en verde.
    const diario = (semanas: number, tz = "UTC"): Promise<Semana[]> =>
      withUser(ana, (db) => diarioPorSemanas(db, { workspaceId: ws, semanas, tz }));

    console.log("\nUn proyecto que estuvo parado");

    // Algo hace cinco semanas y algo esta semana. En medio, nada.
    const haceCinco = new Date(Date.now() - 35 * 86_400_000).toISOString();
    await anotarEn(haceCinco, "cerro", "Lo de hace un mes");
    await anotarEn(new Date().toISOString(), "cerro", "Lo de ahora");

    const seis = await diario(6);
    check("salen las seis semanas que se pidieron", seis.length === 6);
    check("la más reciente primero", seis[0]!.inicia > seis[5]!.inicia);

    // LA QUE JUSTIFICA EL `generate_series`. Sin él saldrían dos filas
    // pegadas, y el diario diría que el proyecto llevó un ritmo constante.
    const conAlgo = seis.filter((s) => s.hechos > 0);
    const enBlanco = seis.filter((s) => s.hechos === 0);
    check("solo dos semanas tienen algo dentro", conAlgo.length === 2);
    check("y el silencio de en medio también sale", enBlanco.length === 4);
    check(
      "las semanas en blanco salen vacías, no a medias",
      enBlanco.every((s) => s.cerradas.length === 0 && s.personas.length === 0),
    );

    // Las semanas son contiguas: si alguna se saltara, el hueco mentiría igual.
    const contiguas = seis
      .map((s) => s.inicia)
      .reverse()
      .every((inicia, i, todas) => {
        if (i === 0) return true;
        const anterior = new Date(`${todas[i - 1]!}T00:00:00Z`).getTime();
        return new Date(`${inicia}T00:00:00Z`).getTime() - anterior === 7 * 86_400_000;
      });
    check("y van de siete en siete días, sin saltos", contiguas);

    console.log("\nQué cuenta como hito");

    const estaSemana = () => diario(1).then((d) => d[0]!);

    await anotarEn(new Date().toISOString(), "movio", "Arrastrada de aquí para allá");
    await anotarEn(new Date().toISOString(), "movio", "Arrastrada de aquí para allá");
    await anotarEn(new Date().toISOString(), "movio", "Arrastrada de aquí para allá");

    const conArrastres = await estaSemana();
    // Los movimientos cuentan como actividad —pasaron— pero no como hito. Un
    // diario que los contara premiaría a quien más arrastra tarjetas.
    check("mover cuenta en los hechos", (conArrastres.porVerbo["movio"] ?? 0) === 3);
    check("pero no aparece entre lo terminado", !conArrastres.cerradas.includes("Arrastrada de aquí para allá"));
    check("lo cerrado sí", conArrastres.cerradas.includes("Lo de ahora"));

    // `cerro` a secas contaría el cierre de cualquier otra cosa que mañana se
    // anote con ese verbo — una campaña, un entorno, un canal.
    await anotarEn(new Date().toISOString(), "cerro", "Un canal cualquiera", "canal");
    const conOtroSujeto = await estaSemana();
    check(
      "cerrar algo que no es una tarea no entra en los hitos",
      !conOtroSujeto.cerradas.includes("Un canal cualquiera"),
    );

    check(
      "y quién estuvo esa semana va con su recuento",
      conOtroSujeto.personas[0]?.nombre === "Ana" && conOtroSujeto.personas[0]!.veces > 0,
    );

    console.log("\nEl domingo por la tarde en Bogotá");

    /**
     * LA TRAMPA DEL HUSO. Se fabrica un cierre a las 20:00 del domingo en
     * Bogotá, que en UTC es la 01:00 del lunes siguiente. Truncando en UTC cae
     * en la semana de después; truncando en Bogotá, donde de verdad pasó, cae
     * en la suya. Las dos listas se ven igual de bien.
     */
    const limpio = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "insert into workspaces (organization_id, name, created_by) values ($1,'Husos',$2) returning id",
        [org, ana],
      );
      return rows[0]!.id;
    });

    // Un domingo concreto y reciente, a las 20:00 hora de Bogotá (UTC-5).
    const hoy = new Date();
    const domingo = new Date(hoy);
    domingo.setUTCDate(hoy.getUTCDate() - ((hoy.getUTCDay() + 7) % 7 || 7));
    const instante = `${domingo.toISOString().slice(0, 10)}T20:00:00-05:00`;

    await admin.query(
      `insert into activity
         (organization_id, workspace_id, actor_id, verb, subject_type, subject_label, source, at)
       values ($1,$2,$3,'cerro','tarea','El domingo por la tarde','persona',$4::timestamptz)`,
      [org, limpio, ana, instante],
    );

    const enHusos = (tz: string) =>
      withUser(ana, async (db) => {
        const { rows } = await db.query<{ semana: string }>(
          `select to_char(date_trunc('week', (a.at at time zone $2)), 'YYYY-MM-DD') as semana
             from activity a where a.workspace_id = $1`,
          [limpio, tz],
        );
        return rows[0]!.semana;
      });

    const enUtc = await enHusos("UTC");
    const enBogota = await enHusos("America/Bogota");
    check("en UTC ese cierre cae en la semana siguiente", enUtc !== enBogota);
    check(
      "y en Bogotá, en la suya: la del domingo",
      new Date(`${enUtc}T00:00:00Z`).getTime() - new Date(`${enBogota}T00:00:00Z`).getTime() ===
        7 * 86_400_000,
    );
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [
      `%-diario-${sufijo}`,
    ]);
    await admin.query("delete from public.users where email like $1", [
      `%-diario-${sufijo}@devup.test`,
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
