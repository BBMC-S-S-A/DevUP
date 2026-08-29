// Comprueba que el correo saliente funciona, y dice en castellano qué falla.
//
// POR QUÉ HACE FALTA. El mailer lleva escrito desde el principio y hasta hoy no
// se había hablado SMTP con nadie: sin `SMTP_URL` escribe el mensaje en el
// registro, que es cómodo para desarrollar y no prueba nada. No se autentica,
// no negocia TLS, no descubre que el remitente no está autorizado. Poner
// credenciales de verdad y esperar a la primera invitación significa estrenar
// todo eso en producción, contra un proveedor que muchas veces rechaza en
// silencio.
//
// Este script hace las dos mitades por separado, que es la parte útil:
// `verify()` prueba conexión y autenticación, y solo después se envía. Así un
// fallo dice si no se llegó al servidor, si no te dejó entrar, o si te dejó
// entrar y luego no aceptó el mensaje — tres averías distintas con tres
// arreglos distintos, que desde fuera se parecen mucho.
//
//   npm run correo:probar -- juan.bonilla@hytrex.co
//   npm run correo:probar -- juan@ejemplo.com .env.production
//
// El fichero de entorno por defecto es `.env`. Con Mailpit levantado
// (`docker compose up -d mailpit`) y `SMTP_URL=smtp://localhost:1025`, el
// mensaje aparece en http://localhost:8025 y se puede leer entero.

import { existsSync } from "node:fs";
import { config as cargarEnv } from "dotenv";
import { createTransport } from "nodemailer";

const destinatario = process.argv[2];
const ficheroEnv = process.argv[3] ?? ".env";

if (!destinatario) {
  console.error("uso: npm run correo:probar -- <destinatario> [fichero-env]");
  process.exit(1);
}

if (!existsSync(ficheroEnv)) {
  console.error(`no encuentro ${ficheroEnv}`);
  process.exit(1);
}

cargarEnv({ path: ficheroEnv, quiet: true });

const SMTP_URL = process.env.SMTP_URL;
const MAIL_FROM = process.env.MAIL_FROM ?? "DevUP <no-reply@devup.local>";

if (!SMTP_URL) {
  console.error(
    [
      `SMTP_URL no está puesta en ${ficheroEnv}.`,
      "",
      "Sin ella la aplicación no falla: escribe los correos en el registro del",
      "servidor con su enlace. Sirve para desarrollar y no sirve para tener",
      "usuarios — una invitación que nadie recibe es una invitación que no",
      "existe.",
      "",
      "Para probar en local sin credenciales de nadie:",
      "  docker compose up -d mailpit",
      "  SMTP_URL=smtp://localhost:1025   (en .env)",
    ].join("\n"),
  );
  process.exit(1);
}

// El host y el usuario ayudan a ver que apuntas donde crees. La contraseña no
// se imprime nunca: este script acabará ejecutándose con alguien mirando la
// pantalla, o pegado en un chat.
function describir(url) {
  try {
    const u = new URL(url);
    const puerto = u.port || (u.protocol === "smtps:" ? "465" : "587");
    return `${u.protocol}//${u.username ? `${u.username}:···@` : ""}${u.hostname}:${puerto}`;
  } catch {
    return "(SMTP_URL no parece una URL válida)";
  }
}

console.log(`servidor:      ${describir(SMTP_URL)}`);
console.log(`remitente:     ${MAIL_FROM}`);
console.log(`destinatario:  ${destinatario}`);
console.log("");

const transporte = createTransport(SMTP_URL);

/**
 * Traduce el fallo a lo que hay que hacer.
 *
 * Los códigos de nodemailer son razonablemente estables y cada uno tiene un
 * arreglo distinto; el mensaje crudo casi nunca lo sugiere.
 */
function explicar(error) {
  const codigo = error?.code ?? "";
  const respuesta = error?.response ?? "";
  const texto = `${error?.message ?? error}`;

  if (codigo === "EAUTH" || /535|534|password|authentic/i.test(respuesta + texto)) {
    return [
      "El servidor contestó, pero no aceptó el usuario o la contraseña.",
      "",
      "Con Gmail y con Microsoft 365 la contraseña de la cuenta NO vale: hay que",
      "generar una contraseña de aplicación. Y si la contraseña lleva @, : o /,",
      "tiene que ir codificada dentro de la URL o rompe el análisis de SMTP_URL.",
    ];
  }
  if (codigo === "ENOTFOUND" || codigo === "EDNS") {
    return ["El nombre del servidor no resuelve. Suele ser una errata en el host."];
  }
  // ECONNREFUSED llega dentro del mensaje, no como código: nodemailer envuelve
  // los errores de socket en ESOCKET. Se mira el texto a propósito, porque
  // «nadie escucha ahí» y «algo bloquea el paso» piden cosas distintas y el
  // código no las distingue.
  if (codigo === "ECONNECTION" || /ECONNREFUSED/.test(texto)) {
    return [
      "Se llegó a la máquina y no hay nadie escuchando en ese puerto.",
      "",
      "Si es local, comprueba que el contenedor está arriba:",
      "  docker compose up -d mailpit",
      "",
      "Si es un proveedor, suele ser el puerto: muchas redes cierran el 25",
      "saliente. 587 con STARTTLS o 465 con TLS directo suelen pasar.",
    ];
  }
  if (codigo === "ETIMEDOUT" || codigo === "ESOCKET") {
    if (/wrong version|SSL|TLS/i.test(texto)) {
      return [
        "Fallo de TLS: casi siempre es el esquema cruzado con el puerto.",
        "",
        "  smtp://…:587   STARTTLS, empieza en claro y sube",
        "  smtps://…:465  TLS desde el primer byte",
        "",
        "Cruzarlos da exactamente este error.",
      ];
    }
    return ["Se agotó el tiempo. El puerto está filtrado o el servidor no responde."];
  }
  if (/550|551|553|relay|not permitted|sender/i.test(respuesta + texto)) {
    return [
      "Entró bien y luego rechazó el mensaje.",
      "",
      "Casi siempre es MAIL_FROM: el proveedor solo deja enviar desde un dominio",
      "verificado por él. La dirección de MAIL_FROM tiene que ser una que esa",
      "cuenta tenga permitida, no una inventada.",
    ];
  }
  return [texto];
}

function fallar(fase, error) {
  console.error(`✗ ${fase}`);
  console.error("");
  for (const linea of explicar(error)) console.error(`  ${linea}`);
  if (error?.response) console.error(`\n  respuesta del servidor: ${error.response}`);
  process.exit(1);
}

// Primera mitad: llegar y entrar.
try {
  await transporte.verify();
  console.log("✓ conexión y autenticación");
} catch (error) {
  fallar("no se pudo conectar o autenticar", error);
}

// Segunda mitad: que además acepte el mensaje. Son cosas distintas y fallan por
// motivos distintos — el rechazo del remitente ocurre aquí, no arriba.
const sello = new Date().toISOString();
try {
  const info = await transporte.sendMail({
    from: MAIL_FROM,
    to: destinatario,
    subject: "DevUP · prueba de correo saliente",
    text:
      `Si estás leyendo esto, el correo saliente de DevUP funciona.\n\n` +
      `Enviado desde ${ficheroEnv} el ${sello}.\n\n` +
      `Con esto ya salen las invitaciones, la verificación de correo y la\n` +
      `recuperación de contraseña.\n\n—\nDevUP`,
  });
  console.log("✓ mensaje aceptado por el servidor");
  if (info.messageId) console.log(`  identificador: ${info.messageId}`);
  if (info.rejected?.length) {
    console.warn(`  ojo: rechazó ${info.rejected.join(", ")}`);
  }
} catch (error) {
  fallar("conectó y autenticó, pero no aceptó el mensaje", error);
}

console.log("");
console.log(`Mira el buzón de ${destinatario}.`);
console.log(
  "Que el servidor lo acepte no garantiza que llegue a la bandeja de entrada:",
);
console.log(
  "sin SPF y DKIM del dominio, muchos proveedores lo mandan a spam o lo tiran.",
);
