import { PASOS, porDondeEmpezar } from "./recorrido.js";

/**
 * El recorrido de bienvenida.
 *
 * LA QUE JUSTIFICA EL FICHERO ES LA DEL ROL SIN MAPEAR. La lista de roles vive
 * en la base (0052) y aquí se reparte en tres familias a mano. El día que
 * alguien añada «devrel» al enumerado y no lo apunte aquí, `porDondeEmpezar`
 * devolvería `undefined` y el recorrido terminaría con una pantalla en blanco
 * justo en el último paso — el único que le dice a la persona qué hacer
 * después. Por eso hay un valor por defecto, y por eso se comprueba que exista
 * para cualquier cosa que llegue.
 *
 * Y DOS MÁS QUE SE LEEN BIEN ESTANDO MAL:
 *
 *   · **Los trece roles tienen que estar repartidos.** Si uno se queda fuera,
 *     cae al valor por defecto sin que nada lo diga, y su gente recibe el
 *     consejo de otra familia con toda seguridad.
 *   · **Ningún paso puede quedarse sin cuerpo.** Un paso con título y nada
 *     debajo no se lee como un error: se lee como un recorrido pobre.
 *
 *   npm run test:recorrido --workspace apps/web
 */

let total = 0;
let fallos = 0;

function check(nombre: string, condicion: boolean): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
  }
}

/** Los trece de la 0052, escritos aquí para que discrepar se note. */
const ROLES = [
  "producto",
  "gestion",
  "direccion",
  "frontend",
  "backend",
  "fullstack",
  "movil",
  "diseno",
  "qa",
  "datos",
  "ia",
  "plataforma",
  "seguridad",
];

console.log("\nPor dónde empezar");

for (const rol of ROLES) {
  const destino = porDondeEmpezar(rol);
  check(`«${rol}» tiene destino`, Boolean(destino?.destino) && destino.etiqueta.length > 0);
}

// Las tres familias existen de verdad: si todos acabaran en el mismo sitio, el
// rol no estaría sirviendo para nada y habría que quitarlo, no fingirlo.
const destinos = new Set(ROLES.map((r) => porDondeEmpezar(r).destino));
check("y no todos van al mismo sitio, que haría inútil el rol", destinos.size === 3);
check("quien reparte va a las ramas", porDondeEmpezar("producto").destino === "categorias");
check("quien diseña va a la biblioteca", porDondeEmpezar("diseno").destino === "archivos");
check("y quien programa, al tablero", porDondeEmpezar("backend").destino === "board");

console.log("\nY lo que llega sin rol o con uno que no conocemos");

check("sin rol hay destino igualmente", Boolean(porDondeEmpezar(null)?.destino));
check("con cadena vacía, también", Boolean(porDondeEmpezar("")?.destino));
// LA DE VERDAD: un rol nuevo en la base y sin apuntar aquí.
check("y con un rol que aún no está repartido, también", Boolean(porDondeEmpezar("devrel")?.destino));

console.log("\nLos pasos");

check("hay pasos que contar", PASOS.length >= 4);
check(
  "ninguno se queda sin título ni sin cuerpo",
  PASOS.every((p) => p.titulo.trim().length > 0 && p.cuerpo.trim().length > 20),
);
check(
  "y el que avisa de algo lo dice, no lo insinúa",
  PASOS.every((p) => p.ojo === undefined || p.ojo.trim().length > 20),
);

console.log(`\n${total - fallos} de ${total} comprobaciones`);
if (fallos > 0) process.exit(1);
