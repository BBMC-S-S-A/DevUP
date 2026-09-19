/**
 * Pruebas del almacén de repositorios y del formato del protocolo.
 *
 * LO QUE SE PRUEBA AQUÍ ES LO QUE NO AVISA CUANDO FALLA. Un nombre de
 * repositorio acaba siendo una CARPETA en el disco del servidor: si la
 * validación se despista, alguien escribe fuera del almacén y nada protesta —
 * el repositorio se crea, la pantalla lo enseña, y el fallo se descubre el día
 * que se descubre. Por eso la mitad de este archivo son nombres raros.
 *
 * NO HACE FALTA BASE DE DATOS NI SERVIDOR: son funciones puras y unas pocas
 * carpetas temporales. Lo que sí hace falta es que `rutaDelRepo` diga que no,
 * y eso se puede comprobar en un milisegundo tantas veces como se quiera.
 *
 *   npm run test:git
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

process.env.GIT_ROOT = await mkdtemp(join(tmpdir(), "devup-git-"));

const {
  nombreValido,
  rutaDelRepo,
  rutaDelEspacio,
  RutaInsegura,
  crearRepo,
  existeRepo,
  borrarRepo,
  borrarReposDelEspacio,
  ramasDelRepo,
} = await import("./almacen.js");
const { pktLine, cabeceraDeAnuncio, protocoloPedido, esServicio, escribe } = await import(
  "./protocolo.js"
);

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

const ESPACIO = "f2719672-88cf-4c62-af8d-ed93299296fe";

/** ¿Revienta al construir la ruta? Es la respuesta correcta a lo sospechoso. */
function rechaza(workspaceId: string, slug: string): boolean {
  try {
    rutaDelRepo(workspaceId, slug);
    return false;
  } catch (error) {
    return error instanceof RutaInsegura;
  }
}

async function main(): Promise<void> {
  console.log("\nQué nombres valen");
  check("uno normal", nombreValido("mi-proyecto"));
  check("con números", nombreValido("api-v2"));
  check("uno de dos letras", nombreValido("ui"));
  check("no vale vacío", !nombreValido(""));
  check("no vale una sola letra", !nombreValido("a"));
  check("no empieza por guión", !nombreValido("-malo"));
  check("no acaba en guión", !nombreValido("malo-"));
  check("no vale en mayúsculas", !nombreValido("MiProyecto"));
  check("no valen los puntos", !nombreValido("mi.proyecto"));
  check("ni la barra", !nombreValido("mi/proyecto"));
  check("ni el espacio", !nombreValido("mi proyecto"));
  check("ni el nulo", !nombreValido("mi\0proyecto"));
  check("ni algo larguísimo", !nombreValido("a".repeat(60)));

  console.log("\nNadie escribe fuera del almacén");
  check("dos puntos", rechaza(ESPACIO, ".."));
  check("travesía clásica", rechaza(ESPACIO, "../../etc"));
  check("con barra invertida, que en Windows también separa", rechaza(ESPACIO, "..\\..\\windows"));
  check("ruta absoluta", rechaza(ESPACIO, "/etc/passwd"));
  check("el punto solo", rechaza(ESPACIO, "."));
  check("un nombre con nulo dentro", rechaza(ESPACIO, "bueno\0../malo"));
  check("el identificador de espacio también se mira", rechaza("../../otro", "bueno"));
  check("y tiene que ser un uuid de verdad", rechaza("no-soy-un-uuid", "bueno"));

  const dentro = rutaDelRepo(ESPACIO, "mi-proyecto");
  const raiz = resolve(process.env.GIT_ROOT!);
  check("un nombre bueno sí cuelga de la raíz", dentro.startsWith(raiz + sep));
  check("y acaba en .git, como cualquier repositorio de servidor", dentro.endsWith(".git"));
  check(
    "dos espacios distintos no comparten carpeta",
    rutaDelRepo(ESPACIO, "mismo-nombre") !==
      rutaDelRepo("11111111-2222-3333-4444-555555555555", "mismo-nombre"),
  );

  console.log("\nCrear y borrar de verdad");
  await crearRepo(ESPACIO, "mi-proyecto", "main");
  check("el repositorio existe después de crearlo", await existeRepo(ESPACIO, "mi-proyecto"));
  check("uno que no se creó no existe", !(await existeRepo(ESPACIO, "otro-mas")));
  check("recién creado no tiene ramas", (await ramasDelRepo(ESPACIO, "mi-proyecto")).length === 0);
  await borrarRepo(ESPACIO, "mi-proyecto");
  check("y después de borrarlo ya no", !(await existeRepo(ESPACIO, "mi-proyecto")));

  console.log("\nBorrar un espacio entero no se lleva a los demás");
  // Es un `rm -r`: lo que se prueba es que nunca pueda apuntar a la raíz ni
  // salirse de ella, porque la raíz son los repositorios de todos los clientes.
  const rechazaEspacio = (id: string): boolean => {
    try {
      rutaDelEspacio(id);
      return false;
    } catch (error) {
      return error instanceof RutaInsegura;
    }
  };
  check("vacío no es un espacio", rechazaEspacio(""));
  check("ni el punto", rechazaEspacio("."));
  check("ni una travesía", rechazaEspacio("../.."));
  check("ni algo que no sea un uuid", rechazaEspacio("no-soy-un-uuid"));
  check(
    "la carpeta de un espacio cuelga de la raíz y no es la raíz",
    rutaDelEspacio(ESPACIO).startsWith(raiz + sep) && rutaDelEspacio(ESPACIO) !== raiz,
  );

  const OTRO = "11111111-2222-3333-4444-555555555555";
  await crearRepo(ESPACIO, "uno", "main");
  await crearRepo(ESPACIO, "dos", "main");
  await crearRepo(OTRO, "del-vecino", "main");
  await borrarReposDelEspacio(ESPACIO);
  check(
    "se borran todos los repositorios del espacio",
    !(await existeRepo(ESPACIO, "uno")) && !(await existeRepo(ESPACIO, "dos")),
  );
  check("y el del espacio de al lado sigue ahí", await existeRepo(OTRO, "del-vecino"));
  await borrarReposDelEspacio(ESPACIO);
  check("borrar un espacio que ya no tiene nada no revienta", !(await existeRepo(ESPACIO, "uno")));
  await borrarRepo(OTRO, "del-vecino");

  console.log("\nEl formato que git espera");
  // El ejemplo canónico de la documentación de git: la línea del servicio mide
  // 0x001e. Si esto se rompe, el cliente dice «invalid server response» y no
  // hay forma de saber por qué.
  check(
    "una pkt-line lleva su longitud delante, en hexadecimal",
    pktLine("# service=git-upload-pack\n").toString("utf8") === "001e# service=git-upload-pack\n",
  );
  check("una línea vacía mide cuatro", pktLine("").toString("utf8") === "0004");
  check(
    "el anuncio acaba en el 0000 que separa",
    cabeceraDeAnuncio("git-upload-pack").toString("utf8").endsWith("0000"),
  );
  check(
    "y nombra el servicio que contesta",
    cabeceraDeAnuncio("git-receive-pack").toString("utf8").includes("# service=git-receive-pack"),
  );

  console.log("\nQué servicios se atienden");
  check("clonar", esServicio("git-upload-pack"));
  check("empujar", esServicio("git-receive-pack"));
  check("nada más", !esServicio("git-borrar-todo"));
  check("empujar escribe", escribe("git-receive-pack"));
  check("clonar no", !escribe("git-upload-pack"));

  console.log("\nLa cabecera del protocolo se filtra, no se reenvía");
  check("la versión 2, que es la que pide git hoy", protocoloPedido("version=2") === "version=2");
  check("sin cabecera, sin variable", protocoloPedido(undefined) === undefined);
  // Esta cabecera viene de fuera y acaba siendo una variable de entorno de un
  // proceso: lo que no encaje exacto no pasa.
  check("una cabecera inventada no pasa", protocoloPedido("version=2; rm -rf /") === undefined);
  check("ni una vacía", protocoloPedido("") === undefined);
  check("ni algo que no sea una versión", protocoloPedido("LD_PRELOAD=/x") === undefined);

  await rm(process.env.GIT_ROOT!, { recursive: true, force: true });

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
