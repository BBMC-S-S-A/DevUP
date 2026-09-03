// Rota VAULT_MASTER_KEY: descifra con la vieja, vuelve a cifrar con la nueva.
//
// POR QUÉ EXISTE. Hasta ahora la documentación decía que esto «no puede
// hacerlo un script» y que, mientras no existiera, la clave no se cambia nunca.
// Eso convertía una credencial normal en una que no se puede rotar aunque se
// filtre, que es la peor propiedad que puede tener una clave maestra. Esto lo
// arregla.
//
//   node scripts/rotar-clave-boveda.mjs --generar                 # ensayo
//   node scripts/rotar-clave-boveda.mjs --generar --aplicar
//   node scripts/rotar-clave-boveda.mjs --nueva <base64> --aplicar .env.production
//
// SIN --aplicar NO ESCRIBE NADA. Hace el trabajo entero, comprueba que todo
// cuadra y deshace la transacción. Un ensayo que pasa significa que la rotación
// de verdad va a funcionar, y cuesta lo mismo que no hacerlo.
//
// ─── Las tres cosas que hacen esto seguro ──────────────────────────────────
//
// UNA SOLA TRANSACCIÓN. A medias es el peor sitio donde parar: parte de las
// filas con la clave vieja y parte con la nueva, y ninguna de las dos claves
// sirve para el conjunto. O todas o ninguna.
//
// SE DESCIFRA LO QUE SE ACABA DE CIFRAR, con la clave nueva, y se compara con
// el original antes de confirmar. Es barato y es lo único que distingue «he
// cifrado bien» de «he escrito ruido que ya nadie puede leer» — con AES-GCM el
// cifrado no falla nunca por su cuenta, así que sin esta comprobación un error
// en la clave nueva se descubriría el día que hiciera falta el token.
//
// SE CUENTAN LAS FILAS AL EMPEZAR Y AL TERMINAR. `FOR UPDATE` bloquea las que
// hay, pero no impide que alguien conecte una cuenta nueva mientras esto corre:
// esa fila nacería cifrada con la clave VIEJA —la API todavía la tiene en
// memoria— y se quedaría fuera. Si el número cambió, se deshace todo.
//
// Aun así, lo correcto es PARAR LA API antes de rotar. La cuenta de filas
// convierte esa carrera en un fallo ruidoso, que es lo segundo mejor.

import { existsSync, readFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { config as cargarEnv } from "dotenv";
import pg from "pg";

// Tiene que coincidir con apps/api/src/security/vault.ts. Se repite en vez de
// importarse porque aquello es TypeScript y arrastra env.ts entero, que exige
// veinte variables para arrancar. Si allí cambia el empaquetado, aquí también.
const IV = 12;
const TAG = 16;

const cifrar = (texto, clave) => {
  const iv = randomBytes(IV);
  const c = createCipheriv("aes-256-gcm", clave, iv);
  const cuerpo = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), cuerpo]);
};

const descifrar = (paquete, clave) => {
  const d = createDecipheriv("aes-256-gcm", clave, paquete.subarray(0, IV));
  d.setAuthTag(paquete.subarray(IV, IV + TAG));
  return Buffer.concat([d.update(paquete.subarray(IV + TAG)), d.final()]).toString("utf8");
};

// ─── Argumentos ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const generar = args.includes("--generar");
const indiceNueva = args.indexOf("--nueva");
const nuevaDada = indiceNueva >= 0 ? args[indiceNueva + 1] : null;
const ficheroEnv = args.find((a) => !a.startsWith("--") && a !== nuevaDada) ?? ".env";

const salir = (mensaje) => {
  console.error(mensaje);
  process.exit(1);
};

if (!generar && !nuevaDada) {
  salir(
    [
      "uso: node scripts/rotar-clave-boveda.mjs (--generar | --nueva <base64>) [--aplicar] [fichero-env]",
      "",
      "  --generar   inventa una clave nueva y la enseña una sola vez",
      "  --nueva     usa la que le des (32 bytes en base64)",
      "  --aplicar   confirma de verdad; sin esto es un ensayo que no escribe nada",
    ].join("\n"),
  );
}
if (!existsSync(ficheroEnv)) salir(`no encuentro ${ficheroEnv}`);

cargarEnv({ path: ficheroEnv, quiet: true });

const claveDe = (valor, nombre) => {
  const buffer = Buffer.from(valor ?? "", "base64");
  if (buffer.length !== 32) {
    salir(`${nombre} no son 32 bytes en base64 (decodifica a ${buffer.length})`);
  }
  return buffer;
};

const vieja = claveDe(process.env.VAULT_MASTER_KEY, `VAULT_MASTER_KEY de ${ficheroEnv}`);
const nuevaB64 = generar ? randomBytes(32).toString("base64") : nuevaDada;
const nueva = claveDe(nuevaB64, "la clave nueva");

if (timingSafeEqual(vieja, nueva)) salir("la clave nueva es idéntica a la vieja");

// La conexión de administración y no la de la aplicación: RLS le escondería
// filas al rol normal, y rotar «las que se ven» es exactamente la forma de
// perder media bóveda sin que salte ningún error.
const conexion = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!conexion) salir(`ni DATABASE_ADMIN_URL ni DATABASE_URL en ${ficheroEnv}`);

console.log(`entorno:   ${ficheroEnv}`);
console.log(`modo:      ${aplicar ? "APLICAR (escribe)" : "ensayo (no escribe nada)"}`);
console.log("");

// ─── La rotación ───────────────────────────────────────────────────────────

const cliente = new pg.Client({ connectionString: conexion });
await cliente.connect();

let confirmada = false;
try {
  await cliente.query("begin");

  const { rows } = await cliente.query(
    "select connection_id, encrypted_secret from public.connection_secrets order by connection_id for update",
  );
  const alEmpezar = rows.length;
  console.log(`secretos en la bóveda: ${alEmpezar}`);

  if (alEmpezar === 0) {
    console.log("");
    console.log("No hay nada que rotar. Puedes cambiar la clave sin más.");
    await cliente.query("rollback");
    process.exit(0);
  }

  const ilegibles = [];
  let rotados = 0;

  for (const fila of rows) {
    const paquete = Buffer.from(fila.encrypted_secret);

    let claro;
    try {
      claro = descifrar(paquete, vieja);
    } catch {
      // No se sigue adelante: una fila que no abre con la clave vieja significa
      // que la clave de este fichero no es la que cifró esto. Rotar «las que
      // sí abren» dejaría el resto ilegible para siempre.
      ilegibles.push(fila.connection_id);
      continue;
    }

    const recifrado = cifrar(claro, nueva);
    if (descifrar(recifrado, nueva) !== claro) {
      throw new Error(`la comprobación de ida y vuelta falló en ${fila.connection_id}`);
    }

    await cliente.query(
      "update public.connection_secrets set encrypted_secret = $2 where connection_id = $1",
      [fila.connection_id, recifrado],
    );
    rotados += 1;
  }

  if (ilegibles.length > 0) {
    throw new Error(
      `${ilegibles.length} de ${alEmpezar} secretos no abren con la VAULT_MASTER_KEY ` +
        `de ${ficheroEnv}. No es la clave con la que se cifraron, o no toda la bóveda ` +
        `se cifró con la misma. No se ha tocado nada.`,
    );
  }

  const { rows: recuento } = await cliente.query(
    "select count(*)::int as n from public.connection_secrets",
  );
  if (recuento[0].n !== alEmpezar) {
    throw new Error(
      `la bóveda pasó de ${alEmpezar} a ${recuento[0].n} secretos mientras esto corría. ` +
        `Alguien conectó o desconectó una cuenta: esa fila se cifró con la clave vieja y ` +
        `quedaría ilegible. Para la API y vuelve a intentarlo.`,
    );
  }

  console.log(`descifrados y vueltos a cifrar: ${rotados}`);

  if (aplicar) {
    await cliente.query("commit");
    confirmada = true;
  } else {
    await cliente.query("rollback");
  }
} catch (error) {
  await cliente.query("rollback").catch(() => {});
  console.error("");
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  console.error("");
  console.error("La transacción se deshizo: la bóveda está como estaba.");
  await cliente.end();
  process.exit(1);
} finally {
  if (cliente._connected !== false) await cliente.end().catch(() => {});
}

console.log("");

if (!confirmada) {
  console.log("✓ el ensayo salió bien y no se escribió nada.");
  console.log("");
  console.log("Repite el mismo comando con --aplicar para hacerlo de verdad.");
  if (generar) {
    console.log("La clave del ensayo se descarta: --aplicar genera otra.");
  }
  process.exit(0);
}

console.log("✓ bóveda rotada.");
console.log("");
console.log("Clave nueva, y esto se enseña una sola vez:");
console.log("");
console.log(`  VAULT_MASTER_KEY=${nuevaB64}`);
console.log("");
console.log(
  [
    "AHORA, Y SIN DEJARLO PARA LUEGO:",
    "",
    `  1. Pega esa línea en ${ficheroEnv}, sustituyendo la que había.`,
    "  2. Reinicia la API.",
    "  3. Abre una conexión guardada —GitHub o Spotify— y comprueba que responde.",
    "",
    "GUARDA LA CLAVE VIEJA hasta que el paso 3 salga bien. Es lo único que",
    "podría devolver la bóveda a como estaba si algo saliera mal.",
    "",
    "Y el respaldo de la base de anoche está cifrado con la VIEJA: si algún día",
    "se restaura ese volcado, hará falta aquella clave, no esta. Anota la fecha",
    "del cambio junto a las dos.",
  ].join("\n"),
);
