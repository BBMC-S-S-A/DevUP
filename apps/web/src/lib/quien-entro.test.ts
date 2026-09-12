/**
 * Pruebas de a quién conoce este navegador.
 *
 * POR QUÉ MERECE PRUEBA ALGO TAN PEQUEÑO. Lo que decide esto es qué pantalla de
 * acceso ve cada persona: la explicación entera de qué es DevUP, o la puerta de
 * su casa con su nombre. Los dos fallos posibles son silenciosos y opuestos —
 * enseñarle la explicación cada mañana a quien lleva un año usando esto, o
 * saludar por su nombre a alguien que nunca ha entrado aquí— y ninguno de los
 * dos da un error que nadie vaya a reportar.
 *
 * Y hay una tercera: que `localStorage` LANCE. No que venga vacío —eso se
 * espera— sino que acceder a él tire una excepción, que es lo que hace un
 * navegador con el almacenamiento del sitio bloqueado o una ventana privada
 * según cuál. Si eso se propagara, la pantalla de entrada de la aplicación se
 * caería entera por no poder recordar una comodidad.
 *
 *   npm run test:quien-entro
 */
import { leerUltimoCorreo, nombreDeCorreo, olvidarCorreo, recordarCorreo } from "./quien-entro.js";

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

/** Un `localStorage` de mentira, que aquí no existe (esto corre en Node). */
function almacenFalso(): Record<string, string> {
  const datos: Record<string, string> = {};
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => datos[k] ?? null,
    setItem: (k: string, v: string) => {
      datos[k] = v;
    },
    removeItem: (k: string) => {
      delete datos[k];
    },
  };
  return datos;
}

/** Uno que lanza en cada acceso, como el de una ventana privada. */
function almacenQueLanza(): void {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => {
      throw new Error("almacenamiento bloqueado");
    },
    setItem: () => {
      throw new Error("almacenamiento bloqueado");
    },
    removeItem: () => {
      throw new Error("almacenamiento bloqueado");
    },
  };
}

console.log("\nA quién conoce este navegador");

const datos = almacenFalso();

check("sin nada guardado, no conoce a nadie", leerUltimoCorreo() === null);

recordarCorreo("Juan.Medina@Hytrex.co");
check("recuerda a quien entró", leerUltimoCorreo() === "juan.medina@hytrex.co");
// En minúsculas y sin espacios: el mismo correo escrito de dos formas es el
// mismo correo, y guardarlo tal cual haría que «Juan@x.co» y «juan@x.co»
// parecieran dos personas distintas al saludar.
check("lo guarda normalizado", datos["devup:ultimo-correo"] === "juan.medina@hytrex.co");

recordarCorreo("  ana@empresa.com  ");
check("y perdona los espacios de un pegado", leerUltimoCorreo() === "ana@empresa.com");

olvidarCorreo();
check("olvidar lo olvida de verdad", leerUltimoCorreo() === null);

// La trampa: una cadena vacía guardada por error se leería como «sí hay
// alguien» y dejaría la pantalla saludando a nadie — «Hola otra vez, ».
datos["devup:ultimo-correo"] = "";
check("una cadena vacía no cuenta como alguien", leerUltimoCorreo() === null);
datos["devup:ultimo-correo"] = "esto-no-es-un-correo";
check("ni algo que no es un correo", leerUltimoCorreo() === null);

console.log("\nCuando el almacenamiento está bloqueado");

almacenQueLanza();
// Las tres tienen que tragarse el fallo: la pantalla de entrada no puede
// caerse por no poder recordar una comodidad que nadie pidió.
check("leer no revienta, contesta que no conoce a nadie", leerUltimoCorreo() === null);
let reventó = false;
try {
  recordarCorreo("ana@empresa.com");
  olvidarCorreo();
} catch {
  reventó = true;
}
check("guardar y olvidar tampoco revientan", !reventó);

console.log("\nCómo se saluda");

check("se saluda con lo de delante del arroba", nombreDeCorreo("juan.medina@hytrex.co") === "juan.medina");
// Un correo largo no puede empujar el saludo a dos líneas y descolocar la
// tarjeta entera.
const largo = nombreDeCorreo("un.nombre.francamente.larguisimo.de.verdad@empresa.com");
check("un nombre larguísimo se recorta", largo.length <= 24 && largo.endsWith("…"));
check("y algo sin arroba no se rompe", nombreDeCorreo("ana") === "ana");

console.log(`\n${total - fallos} comprobaciones, ${fallos} fallidas`);
if (fallos > 0) process.exit(1);
