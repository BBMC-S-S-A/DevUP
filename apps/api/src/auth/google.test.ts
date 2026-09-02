import { createHash } from "node:crypto";

/**
 * Pruebas de entrar con Google.
 *
 * QUÉ SE PRUEBA AQUÍ Y POR QUÉ NO EL VIAJE ENTERO. El ida y vuelta de OAuth
 * necesita a Google al otro lado, y una prueba que sale a internet no es una
 * prueba: falla los días que falla la red y pasa por casualidad los demás. Lo
 * que sí se puede probar es la parte que decide si alguien entra o no —qué
 * tokens se aceptan y cuáles se rechazan—, que es donde de verdad se cometen
 * los errores caros.
 *
 * Cada caso de rechazo es un ataque concreto, no una comprobación de esquema:
 * un token emitido para otra aplicación, uno caducado, uno con el correo sin
 * verificar. Los tres son tokens perfectamente formados y perfectamente
 * firmados por Google. Lo único que impide que valgan para entrar aquí es que
 * se miren estos tres campos.
 *
 *   npm run test:google
 */

// Se fija antes de importar el módulo: `env` se evalúa al cargarse.
process.env.GOOGLE_CLIENT_ID = "id-de-prueba.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "secreto-de-prueba";
process.env.GOOGLE_REDIRECT_URI = "https://api.ejemplo.test/auth/google/callback";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x";
process.env.AUTH_SECRET ??= "0123456789abcdef0123456789abcdef";
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_BUCKET ??= "x";
process.env.S3_ACCESS_KEY_ID ??= "x";
process.env.S3_SECRET_ACCESS_KEY ??= "x";

const { comenzar, leerIdToken, googleConfigurado } = await import("./google.js");

let fallos = 0;
let total = 0;

function check(nombre: string, ok: boolean, detalle = ""): void {
  total += 1;
  if (ok) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

/** Fabrica un id_token con la carga que se le pida. Sin firmar: no se valida. */
function token(carga: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(carga)}.firma-no-usada`;
}

const valida = {
  sub: "1234567890",
  email: "Juan@Ejemplo.test",
  email_verified: true,
  name: "Juan",
  picture: "https://ejemplo.test/foto.png",
  aud: "id-de-prueba.apps.googleusercontent.com",
  iss: "https://accounts.google.com",
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function rechaza(nombre: string, carga: Record<string, unknown>, esperado: RegExp): void {
  try {
    leerIdToken(token(carga));
    check(nombre, false, "lo aceptó, y no debía");
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    check(nombre, esperado.test(mensaje), `falló, pero por otro motivo: ${mensaje}`);
  }
}

console.log("\nLa salida hacia Google");

const { url, transito } = comenzar("una-invitacion");
const salida = new URL(url);

check("apunta al endpoint de Google", salida.origin === "https://accounts.google.com");
check("pide openid, email y perfil", salida.searchParams.get("scope") === "openid email profile");
check("manda el estado que guarda", salida.searchParams.get("state") === transito.estado);
check(
  "el reto PKCE es el SHA-256 del verificador",
  salida.searchParams.get("code_challenge") ===
    createHash("sha256").update(transito.verificador).digest("base64url"),
);
check("el método PKCE es S256, no plano", salida.searchParams.get("code_challenge_method") === "S256");
check("el verificador no viaja en la URL", !url.includes(transito.verificador));
check("lleva la invitación en el tránsito", transito.invitacion === "una-invitacion");
check(
  "deja elegir cuenta",
  salida.searchParams.get("prompt") === "select_account",
);
check("dos salidas no comparten estado", comenzar().transito.estado !== transito.estado);

console.log("\nLo que se acepta");

const identidad = leerIdToken(token(valida));
check("acepta un token correcto", identidad.sub === "1234567890");
check(
  "normaliza el correo a minúsculas",
  identidad.email === "juan@ejemplo.test",
  `salió ${identidad.email}`,
);
check("marca el correo como verificado", identidad.emailVerificado === true);
check("trae el nombre y la foto", identidad.nombre === "Juan" && identidad.avatar !== null);

console.log("\nLo que se rechaza, y cada uno es un ataque distinto");

rechaza(
  "un token emitido para OTRA aplicación",
  { ...valida, aud: "otra-app.apps.googleusercontent.com" },
  /esta aplicación/i,
);
rechaza("un token que no viene de Google", { ...valida, iss: "https://malo.test" }, /de Google/i);
rechaza(
  "un token caducado",
  { ...valida, exp: Math.floor(Date.now() / 1000) - 60 },
  /caducado/i,
);
rechaza("un token sin exp", { ...valida, exp: undefined }, /caducado/i);
rechaza("un token sin sub", { ...valida, sub: undefined }, /sub o email/i);
rechaza("un token sin email", { ...valida, email: undefined }, /sub o email/i);

console.log("\nEl correo sin verificar");

// No se rechaza aquí sino en la ruta, pero tiene que llegar como `false` para
// que allí se pueda rechazar. Si esto devolviera `true` por un descuido de
// tipos, la comprobación de la ruta sería decorativa.
check(
  "email_verified false llega como false",
  leerIdToken(token({ ...valida, email_verified: false })).emailVerificado === false,
);
check(
  "email_verified ausente llega como false",
  leerIdToken(token({ ...valida, email_verified: undefined })).emailVerificado === false,
);
check(
  'la cadena "false" llega como false, no como cierto por ser una cadena no vacía',
  leerIdToken(token({ ...valida, email_verified: "false" })).emailVerificado === false,
);
check(
  'la cadena "true" llega como true',
  leerIdToken(token({ ...valida, email_verified: "true" })).emailVerificado === true,
);

console.log("\nLa configuración");
check("con las tres variables, está configurado", googleConfigurado());

console.log(`\n${total - fallos} comprobaciones correctas, ${fallos} fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
