/**
 * Mirar el enlace de recuperación sin gastarlo, contra la base.
 *
 * LA QUE JUSTIFICA EL FICHERO ES LA SEGUNDA. Una comprobación que canjea es
 * PEOR que no comprobar nada: la pantalla se abre, el enlace se gasta al
 * pintarla, y cuando la persona envía la contraseña nueva le dicen que el
 * enlace ya se usó — se lo gastó ella misma al mirarlo. Por eso aquí se mira
 * dos veces y DESPUÉS se canjea: si el canje falla, la comprobación estaba
 * consumiendo.
 *
 * Y CUATRO MÁS QUE SE LEEN BIEN ESTANDO MAL:
 *
 *   · Caducado y usado NO son el mismo caso. Al caducado hay que decirle que
 *     pida otro correo; al usado, que ya cambió la contraseña y entre con ella.
 *     Si la función los junta en un «no vale», la pantalla manda a media
 *     plantilla a repetir algo que ya hicieron.
 *   · El propósito tiene que contar. Un token de verificación de correo
 *     preguntado como recuperación de contraseña no es válido: si la función
 *     buscara solo por el hash, un enlace de verificar el correo abriría el
 *     formulario de cambiar la contraseña.
 *   · Emitir uno nuevo mata el anterior (0006). El viejo tiene que dejar de
 *     decir «valido» en el mismo instante, o dos correos seguidos dejan dos
 *     puertas abiertas.
 *   · Un token que no existe no puede reventar ni devolver vacío: la pantalla
 *     necesita una palabra que pintar.
 *
 *   npm run test:recuperar --workspace apps/api
 */
import { createHash, randomBytes } from "node:crypto";
import { closePool, withUser } from "../db/pool.js";

let total = 0;
const fallos: string[] = [];

function check(nombre: string, condicion: boolean, detalle = ""): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos.push(nombre);
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

const sufijo = Date.now().toString(36);

function nuevoToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

/** Lo mismo que hace la ruta: mirar sin tocar. */
const mirar = (hash: string, proposito = "password_reset"): Promise<string> =>
  withUser(null, async (db) => {
    const { rows } = await db.query<{ check_user_token: string }>(
      "select public.check_user_token($1,$2::public.token_purpose)",
      [hash, proposito],
    );
    return rows[0]?.check_user_token ?? "(nada)";
  });

/** Lo mismo que hace POST /auth/reset-password: canjear. */
const canjear = (hash: string): Promise<string | null> =>
  withUser(null, async (db) => {
    const { rows } = await db.query<{ consume_user_token: string | null }>(
      "select public.consume_user_token($1,'password_reset')",
      [hash],
    );
    return rows[0]?.consume_user_token ?? null;
  });

const emitir = (usuario: string, hash: string, caducaEn: number, proposito = "password_reset") =>
  withUser(null, (db) =>
    db.query("select public.issue_user_token($1,$2::public.token_purpose,$3,$4)", [
      usuario,
      proposito,
      hash,
      new Date(Date.now() + caducaEn).toISOString(),
    ]),
  );

async function main(): Promise<void> {
  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  await admin.query("set search_path to public");

  const ana = (
    await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
      `ana-recuperar-${sufijo}@devup.test`,
      "no-se-usa",
      "Ana",
    ])
  ).rows[0]!.id;

  try {
    // 1 · El enlace recién llegado por correo.
    const vivo = nuevoToken();
    await emitir(ana, vivo.hash, 60 * 60 * 1000);
    check("un enlace recién emitido vale", (await mirar(vivo.hash)) === "valido");

    // 2 · La de verdad: mirar no gasta.
    await mirar(vivo.hash);
    await mirar(vivo.hash);
    check("mirarlo dos veces lo deja igual", (await mirar(vivo.hash)) === "valido");
    check("y después del vistazo el canje todavía funciona", (await canjear(vivo.hash)) === ana);

    // 3 · Ya canjeado: distinto de caducado.
    check("una vez canjeado dice «usado»", (await mirar(vivo.hash)) === "usado");

    // 4 · Caducado: se emite con la caducidad ya pasada.
    const viejo = nuevoToken();
    await emitir(ana, viejo.hash, -60 * 1000);
    check("uno caducado dice «caducado», no «usado»", (await mirar(viejo.hash)) === "caducado");

    // 5 · Emitir otro mata el anterior (0006).
    const primero = nuevoToken();
    const segundo = nuevoToken();
    await emitir(ana, primero.hash, 60 * 60 * 1000);
    await emitir(ana, segundo.hash, 60 * 60 * 1000);
    check("pedir otro correo invalida el enlace anterior", (await mirar(primero.hash)) === "usado");
    check("y el último sigue valiendo", (await mirar(segundo.hash)) === "valido");

    // 6 · El propósito cuenta.
    const correo = nuevoToken();
    await emitir(ana, correo.hash, 60 * 60 * 1000, "email_verification");
    check(
      "un token de verificar el correo no abre el cambio de contraseña",
      (await mirar(correo.hash)) === "desconocido",
    );
    check(
      "aunque como verificación de correo sí valga",
      (await mirar(correo.hash, "email_verification")) === "valido",
    );

    // 7 · Uno que no existe: recortado al copiarlo, partido por el cliente.
    check(
      "un enlace que no existe dice «desconocido»",
      (await mirar(nuevoToken().hash)) === "desconocido",
    );
  } finally {
    await admin.query("delete from public.users where id = $1", [ana]);
    await admin.end();
    await closePool();
  }

  console.log(`\n${total - fallos.length}/${total} comprobaciones`);
  if (fallos.length) process.exit(1);
}

await main();
