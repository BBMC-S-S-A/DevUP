/**
 * Pruebas de la consola SQL (BD-06).
 *
 * QUÉ ESTABA MAL. `ejecutarSQL` corría lo que llegara —escrituras incluidas,
 * y varias sentencias de golpe— contra la base de producción del proyecto. Y
 * la ruta no pedía mando sobre el espacio: lo único que decidía RLS era si se
 * podía descifrar la credencial, y eso lo puede cualquier miembro. O sea que
 * cualquiera que entrara al proyecto podía lanzar un `delete` o un `drop`
 * contra la base de un cliente.
 *
 * LO QUE SE PRUEBA AQUÍ es la mitad de abajo: que la consola corre en solo
 * lectura de verdad. La de arriba —que hay que administrar el espacio— vive en
 * `isolation.test.ts`, que es donde están las preguntas de permisos, y se mira
 * contra las políticas en vez de contra una ruta.
 *
 * SE PRUEBA CONTRA POSTGRES, NO CONTRA UN DOBLE. Todo lo que hay que fijar
 * aquí son reglas del propio Postgres —qué deja y qué no dentro de una
 * transacción de solo lectura— y un doble solo probaría que el doble se
 * comporta como yo creo que se comporta. Que es justo el error que esta prueba
 * existe para no repetir: al escribirla se descubrió que `set transaction read
 * write` SÍ funciona como primera sentencia, al revés de lo que se había
 * dado por hecho.
 *
 *   npm run test:consola
 */
// Primero el módulo de entorno: es quien carga el `.env`, y sin él
// `DATABASE_ADMIN_URL` llega vacía y la prueba se planta antes de empezar.
import "../env.js";
import pg from "pg";
import { ejecutarSQL } from "./basedatos.js";

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

const urlLeida = process.env.DATABASE_ADMIN_URL;
if (!urlLeida) {
  console.error("Falta DATABASE_ADMIN_URL: la prueba corre contra Postgres de verdad.");
  process.exit(1);
}
// Se copia a una constante ya tipada en vez de usar `!` en cada llamada: el
// compilador no arrastra el estrechamiento hasta dentro de las funciones de
// abajo, y sembrar `!` por el archivo es la costumbre que un día tapa un nulo
// de verdad.
const url: string = urlLeida;

const TABLA = `consola_prueba_${Date.now().toString(36)}`;

/** Corre algo y dice si reventó, y con qué. */
async function intentar(sql: string): Promise<{ ok: boolean; error: string }> {
  try {
    await ejecutarSQL(url, sql);
    return { ok: true, error: "" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`create table ${TABLA} (id int)`);
  await admin.query(`insert into ${TABLA} values (1),(2),(3)`);

  const cuantas = async (): Promise<number> => {
    const { rows } = await admin.query<{ n: string }>(`select count(*)::text as n from ${TABLA}`);
    return Number(rows[0]!.n);
  };

  try {
    console.log("\nLeer sigue funcionando");
    const leido = await ejecutarSQL(url, `select id from ${TABLA} order by id`);
    check("un select devuelve sus filas", leido.filas.length === 3);
    check("y sus columnas", leido.columnas.includes("id"));

    console.log("\nEscribir no");
    const borrado = await intentar(`delete from ${TABLA}`);
    check("un delete falla", !borrado.ok);
    // El mensaje importa tanto como el fallo: es lo que va a leer quien esté
    // en la pantalla, y «error de la base» no le dice qué hacer.
    check(
      "y lo dice con el motivo, no con un error genérico",
      /read-only transaction/i.test(borrado.error),
    );
    check("las filas siguen ahí", (await cuantas()) === 3);

    const insertado = await intentar(`insert into ${TABLA} values (4)`);
    check("un insert falla", !insertado.ok);

    const soltado = await intentar(`drop table ${TABLA}`);
    check("un drop falla", !soltado.ok);
    check("y la tabla sigue existiendo", (await cuantas()) === 3);

    const alterado = await intentar(`alter table ${TABLA} add column nuevo int`);
    check("un alter table falla", !alterado.ok);

    console.log("\nLa consola admite varias sentencias, y eso no abre la puerta");
    // Esta es la forma natural de colarla: una lectura inocente delante.
    const mezcla = await intentar(`select 1; delete from ${TABLA}`);
    check("select seguido de delete falla", !mezcla.ok);
    check("y no borró nada", (await cuantas()) === 3);

    console.log("\nLa salida que Postgres deja abierta, cerrada");
    /**
     * `set transaction read write` es legal como PRIMERA sentencia de una
     * transacción, y ahí el modo de solo lectura se cae entero. Por eso el
     * conector corre un `select 1` antes del SQL de quien llama: con una
     * consulta ya corrida, Postgres lo rechaza.
     *
     * Esta comprobación es la que justifica esa línea. Si alguien la quita por
     * parecer inútil, esto se pone rojo.
     */
    const colado = await intentar(`set transaction read write; delete from ${TABLA}`);
    check("set transaction read write ya no cuela", !colado.ok);
    check(
      "y Postgres explica por qué",
      /must be set before any query/i.test(colado.error) || /read-only transaction/i.test(colado.error),
    );
    check("tampoco borró nada", (await cuantas()) === 3);

    // Cerrar la transacción no ayuda: el ajuste es de la SESIÓN entera.
    const trasCommit = await intentar(`commit; delete from ${TABLA}`);
    check("cerrar la transacción y escribir fuera tampoco", !trasCommit.ok);
    check("y las filas siguen", (await cuantas()) === 3);
  } finally {
    await admin.query(`drop table if exists ${TABLA}`);
    await admin.end();
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
