/**
 * Pruebas del dinero.
 *
 * Se prueba lo que de verdad se puede romper sin que nadie lo note: que los
 * céntimos aparezcan solo cuando los hay, que cero no se pinte raro, y que una
 * cifra grande no pierda un separador por el camino. En una pantalla de ventas,
 * una cifra mal formateada no se lee como un fallo: se lee como otra cifra.
 *
 *   npm run test:dinero
 */
import { dinero, dineroRedondo, MONEDA } from "./dinero.js";

let total = 0;
let fallos = 0;

function check(nombre: string, real: string, esperado: string): void {
  total += 1;
  // Se compara sin espacios porque `Intl` usa el espacio fino irrompible
  // (U+202F) entre la cifra y el símbolo, y eso es correcto: fijarlo en la
  // prueba sería fijar un detalle del motor, no del comportamiento.
  const limpia = (t: string) => t.replace(/\s/g, " ");
  if (limpia(real) === limpia(esperado)) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
    console.log(`      esperaba  ${esperado}`);
    console.log(`      y llegó   ${real}`);
  }
}

console.log(`\nCéntimos a texto (moneda: ${MONEDA})`);

check("una cifra redonda no enseña decimales", dinero(120_000), "1200 €");
// Los dos decimales y no uno: para moneda, `Intl` mantiene el mínimo de la
// divisa aunque el máximo lo permita cortar. Es lo correcto —«1200,50 €» es
// una cantidad y «1200,5 €» parece un número suelto— y conviene dejarlo fijado
// aquí, porque es justo el detalle que alguien «arreglaría» sin querer.
check("una que no lo es enseña los dos decimales", dinero(120_050), "1200,50 €");
check("y con los dos decimales", dinero(120_099), "1200,99 €");
check("cero es cero, no vacío", dinero(0), "0 €");
check("un solo céntimo se ve", dinero(1), "0,01 €");
check("los miles llevan su separador", dinero(1_234_567_00), "1.234.567 €");

console.log("\nLa versión de cabecera nunca enseña céntimos");

check("redondea hacia abajo", dineroRedondo(120_049), "1200 €");
check("y hacia arriba", dineroRedondo(120_051), "1201 €");
check("una redonda se ve igual que con la otra regla", dineroRedondo(120_000), dinero(120_000));

console.log("\nLas dos reglas coinciden donde tienen que coincidir");

check("en cero", dineroRedondo(0), dinero(0));

console.log(`\n${total} comprobaciones, ${fallos} fallida${fallos === 1 ? "" : "s"}`);
process.exit(fallos === 0 ? 0 : 1);
