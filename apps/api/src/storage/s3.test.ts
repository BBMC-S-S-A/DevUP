/**
 * Pruebas del almacén de archivos: que nada se sirva por una URL pública (SEG-03).
 *
 * QUÉ PROTEGE ESTO Y DE QUÉ. Los archivos de la biblioteca, las grabaciones de
 * las llamadas y las fotos de perfil viven en un bucket. Ese bucket ESTÁ
 * configurado como privado —comprobado el 22-sep pidiéndole una clave
 * inexistente sin credenciales: contesta 403 `AccessDenied`, no 404
 * `NoSuchKey`, que es lo que contestaría uno público—, y todo lo que sale hacia
 * un navegador va firmado y caduca.
 *
 * LO QUE ESTA PRUEBA IMPIDE ES EL CAMBIO DE UNA LÍNEA. Componer
 * `${endpoint}/${bucket}/${clave}` es más corto que firmar, funciona el día que
 * se escribe si el bucket estuviera abierto, y convierte cada archivo del
 * equipo en un enlace eterno que no caduca ni se revoca. Nada lo delataría:
 * la pantalla se vería igual. Por eso se fija aquí y no se confía en que nadie
 * lo haga.
 *
 * NO HACE FALTA RED. Firmar es un cálculo local con la clave de acceso; lo que
 * se mira es la URL que sale, no que el almacén conteste. Así esto corre en CI
 * sin levantar MinIO.
 *
 *   npm run test:almacen
 */
import "../env.js";
import { env } from "../env.js";
import { buildStorageKey, signDownload, signUpload } from "./s3.js";

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

/** Lo que convierte una URL en «firmada y con caducidad». */
function firmada(url: string): boolean {
  const u = new URL(url);
  return (
    u.searchParams.has("X-Amz-Signature") &&
    u.searchParams.has("X-Amz-Credential") &&
    u.searchParams.has("X-Amz-Expires") &&
    u.searchParams.has("X-Amz-Date")
  );
}

async function main(): Promise<void> {
  const clave = buildStorageKey("org-de-prueba", "ws-de-prueba", "informe.pdf");

  console.log("\nDescargar va firmado y caduca");
  const bajada = await signDownload(clave, "informe.pdf");
  check("la URL de descarga va firmada", firmada(bajada));
  check(
    "y no es el objeto a pelo, que sería un enlace eterno",
    new URL(bajada).search.length > 0,
  );

  const caducaEn = Number(new URL(bajada).searchParams.get("X-Amz-Expires"));
  check("declara su caducidad", Number.isFinite(caducaEn) && caducaEn > 0);
  check("y es la configurada, no una inventada", caducaEn === env.S3_SIGNED_URL_TTL);
  // Un día de validez ya no es «temporal»: es un enlace que alguien reenvía y
  // sigue abriendo mañana. El valor por defecto son 900 s.
  check("que no pasa de una hora", caducaEn <= 3600);

  console.log("\nSubir, igual");
  const subida = await signUpload(clave, "application/pdf");
  check("la URL de subida va firmada", firmada(subida));
  check(
    "con la misma caducidad",
    Number(new URL(subida).searchParams.get("X-Amz-Expires")) === env.S3_SIGNED_URL_TTL,
  );

  console.log("\nLa clave no deja salirse de su sitio");
  // La clave la compone el servidor a partir de la organización y el espacio,
  // y lleva un identificador aleatorio: dos personas que suban «informe.pdf»
  // no se pisan, y nadie puede adivinar la clave de otro.
  const otra = buildStorageKey("org-de-prueba", "ws-de-prueba", "informe.pdf");
  check("dos subidas del mismo nombre dan claves distintas", clave !== otra);
  check("la clave cuelga de la organización y el espacio", clave.includes("ws-de-prueba"));
  check("y no empieza por barra ni sube de carpeta", !clave.startsWith("/") && !clave.includes(".."));

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
