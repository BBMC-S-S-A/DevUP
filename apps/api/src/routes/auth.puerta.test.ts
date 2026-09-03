import { randomBytes, randomUUID, createHash } from "node:crypto";
import pg from "pg";

/**
 * Prueba de la puerta de las altas con el registro abierto.
 *
 * QUÉ FALLO CUBRE. `SIGNUP_MODE=open` y una invitación no son excluyentes: son
 * dos preguntas distintas —«¿puede darse de alta?» y «¿a qué organización
 * entra?»—. La primera versión de `puertaDeAlta()` las confundía: con el modo
 * abierto, devolvía `null` sin mirar siquiera si venía un token, así que
 * alguien invitado a una organización concreta se registraba igual pero SIN
 * entrar a ella — la invitación quedaba escrita para nada, y la persona
 * invitada aterrizaba como un desconocido más, a crear su propia empresa.
 *
 * Se arma contra la base local de verdad: una organización, un administrador
 * que invita, y luego `puertaDeAlta()` con el registro abierto de por medio.
 *
 *   npm run test:puerta
 */
process.env.SIGNUP_MODE = "open";

// Importar env.js primero es lo que carga `.env` — es un efecto secundario de
// su import, no algo que este archivo dispare por sí solo. `isolation.test.ts`
// depende del mismo orden.
await import("../env.js");

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error("Falta DATABASE_ADMIN_URL: la prueba necesita crear la organización y limpiar.");
  process.exit(1);
}

const { withUser, closePool } = await import("../db/pool.js");
const { puertaDeAlta } = await import("./auth.js");

let fallos = 0;
let total = 0;
function check(nombre: string, ok: boolean, detalle = ""): void {
  total += 1;
  if (ok) console.log(`  ✓ ${nombre}`);
  else {
    fallos += 1;
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function main(): Promise<void> {
  const sufijo = randomUUID().slice(0, 8);
  const correoAdmin = `puerta-admin-${sufijo}@devup.test`;
  const correoInvitado = `puerta-invitado-${sufijo}@devup.test`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();

  try {
    const adminId = await withUser(null, async (db) => {
      const { rows } = await db.query<{ register_user: string }>(
        "select public.register_user($1,$2,$3)",
        [correoAdmin, "x", "Admin de prueba"],
      );
      return rows[0]!.register_user;
    });

    const orgId = await withUser(adminId, async (db) => {
      const { rows } = await db.query<{ create_organization: string }>(
        "select public.create_organization($1,$2)",
        [`Puerta ${sufijo}`, `puerta-${sufijo}`],
      );
      return rows[0]!.create_organization;
    });

    const tokenBueno = randomBytes(24).toString("base64url");
    await withUser(adminId, async (db) => {
      await db.query("select public.create_invitation($1,$2,$3,$4,$5)", [
        orgId,
        correoInvitado,
        "member",
        hashToken(tokenBueno),
        new Date(Date.now() + 3_600_000).toISOString(),
      ]);
    });

    console.log("\nCon el registro abierto, la invitación no se salta\n");

    // 1. Sin token, registro abierto: entra sin organización.
    await withUser(null, async (db) => {
      const resultado = await puertaDeAlta(db, `puerta-suelto-${sufijo}@devup.test`, undefined);
      check("sin token y SIGNUP_MODE=open, no exige nada (devuelve null)", resultado === null);
    });

    // 2. Con token válido, registro abierto: SIGUE canjeándose. Este es el
    //    caso que estaba roto: antes del arreglo devolvía null y la
    //    invitación se ignoraba por completo.
    await withUser(null, async (db) => {
      const resultado = await puertaDeAlta(db, correoInvitado, tokenBueno);
      check(
        "con token válido y SIGNUP_MODE=open, SÍ se valida y se canjea",
        resultado === hashToken(tokenBueno),
        `devolvió ${JSON.stringify(resultado)}`,
      );
    });

    // 3. El token es para otro correo: sigue rechazándolo.
    await withUser(null, async (db) => {
      let lanzo = false;
      try {
        await puertaDeAlta(db, `otra-persona-${sufijo}@devup.test`, tokenBueno);
      } catch {
        lanzo = true;
      }
      check("un token para otro correo se rechaza igual con el registro abierto", lanzo);
    });

    // 4. Token inventado: sigue rechazándolo, el registro abierto no lo perdona.
    await withUser(null, async (db) => {
      let lanzo = false;
      try {
        await puertaDeAlta(db, correoInvitado, randomBytes(24).toString("base64url"));
      } catch {
        lanzo = true;
      }
      check("un token que no existe se rechaza igual", lanzo);
    });
  } finally {
    // Las organizaciones primero: `created_by` es ON DELETE RESTRICT a
    // propósito, y eso obliga a este orden (mismo patrón que isolation.test.ts).
    await admin.query("delete from public.organizations where slug like $1", [`%-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [`%-${sufijo}@devup.test`]);
    await admin.end();
    await closePool();
  }

  console.log(`\n${total - fallos} comprobaciones correctas, ${fallos} fallidas\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

await main();
