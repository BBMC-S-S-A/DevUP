/**
 * Que dos organizaciones no se vean iguales en el riel.
 *
 * ES EL FALLO QUE SE REPORTÓ TRES VECES: «no se puede seleccionar entre
 * organizaciones». Con «Develovers», «DevUp» y «Hytrex», una sola inicial pinta
 * «D», «D» y «H» — dos chapas idénticas para dos empresas distintas, y la única
 * forma de distinguirlas era pasar el ratón y esperar al `title` del navegador.
 *
 * Se prueba con los nombres de verdad a propósito: un caso inventado habría
 * pasado con la implementación anterior.
 *
 *   npm run test:riel
 */
import { distinguir } from "@/components/ui/RielOrganizaciones";

let total = 0;
let fallos = 0;

function check(nombre: string, real: string, esperado: string): void {
  total += 1;
  if (real === esperado) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
    console.log(`      esperaba  ${esperado}`);
    console.log(`      y llegó   ${real}`);
  }
}

console.log("\nLos tres nombres reales, que es donde fallaba");

const TRES = ["Develovers", "DevUp", "Hytrex"];
const de = (n: string) => distinguir(n, TRES.filter((o) => o !== n));

check("Develovers se separa en la tercera letra", de("Develovers"), "DE");
check("DevUp también, y no coinciden", de("DevUp"), "DU");
check("Hytrex no comparte inicial: le basta una", de("Hytrex"), "H");

// Lo que importa de verdad: que no haya dos iguales.
const abreviaturas = TRES.map(de);
check("y las tres son distintas", String(new Set(abreviaturas).size), "3");

console.log("\nCasos que no deben romperlo");

check("sin hermanas, una letra basta", distinguir("Acme", []), "A");
check("iniciales distintas, una letra", distinguir("Acme", ["Beta"]), "A");
check("nombre de una letra", distinguir("X", ["Y"]), "X");
check("vacío no rompe", distinguir("   ", ["Otra"]), "?");
check("espacios de más no cuentan", distinguir("  Acme  ", ["Beta"]), "A");
// Dos con el mismo nombre: la base lo permite, porque su unicidad es por slug.
check("dos iguales caen a las dos primeras", distinguir("Acme", ["Acme"]), "AC");
// Uno que es prefijo de otro: al acabarse las letras, no hay dónde separar.
check("un nombre que es prefijo del otro", distinguir("Dev", ["Develovers"]), "DE");
check("y el largo sí se separa", distinguir("Develovers", ["Dev"]), "DE");

console.log(`\n${total} comprobaciones, ${fallos} fallida${fallos === 1 ? "" : "s"}`);
process.exit(fallos === 0 ? 0 : 1);
