/**
 * Lo que se acepta como invitación.
 *
 * Se prueba aquí porque es lo que recibe **texto pegado por una persona**, que
 * es la entrada menos predecible que hay: un enlace entero, el enlace con
 * espacios de un chat, el código suelto, o una frase con el enlace dentro. Si
 * esto se equivoca, el síntoma es «me dice que mi invitación no vale» y la
 * causa está a tres capas de distancia.
 *
 *   npm run test:invitacion
 */
import { tokenDe } from "@/components/ui/EntrarConCodigo";

let total = 0;
let fallos = 0;

function check(nombre: string, real: string | null, esperado: string | null): void {
  total += 1;
  if (real === esperado) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
    console.log(`      esperaba  ${String(esperado)}`);
    console.log(`      y llegó   ${String(real)}`);
  }
}

const TOKEN = "a1b2c3d4e5f6g7h8";

console.log("\nDe un enlace se saca el token");

check(
  "el enlace tal como lo reparte la aplicación",
  tokenDe(`https://devup.hytrex.co/invitacion?token=${TOKEN}`),
  TOKEN,
);
check("con más parámetros detrás", tokenDe(`https://x.co/invitacion?token=${TOKEN}&de=ana`), TOKEN);
check("y delante", tokenDe(`https://x.co/invitacion?de=ana&token=${TOKEN}`), TOKEN);
check("una ruta relativa también vale", tokenDe(`/invitacion?token=${TOKEN}`), TOKEN);

console.log("\nEl código suelto");

check("pegado tal cual", tokenDe(TOKEN), TOKEN);
check("con los espacios que arrastra un chat", tokenDe(`  ${TOKEN}\n`), TOKEN);

console.log("\nLo que no vale, y por qué importa que no cuele");

check("vacío", tokenDe(""), null);
check("solo espacios", tokenDe("   "), null);
// Un token corto que colara daría un error del servidor en vez de un mensaje
// útil aquí, y el servidor exige diez caracteres.
check("demasiado corto", tokenDe("abc"), null);
check("una frase con espacios", tokenDe("hola te paso la invitacion"), null);
// El enlace sin token es el error real de quien copia solo media URL.
check("un enlace sin token", tokenDe("https://devup.hytrex.co/invitacion"), null);
check("un enlace con el token vacío", tokenDe("https://x.co/invitacion?token="), null);

console.log(`\n${total} comprobaciones, ${fallos} fallida${fallos === 1 ? "" : "s"}`);
process.exit(fallos === 0 ? 0 : 1);
