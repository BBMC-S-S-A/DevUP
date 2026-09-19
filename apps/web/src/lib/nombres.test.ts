/**
 * Cuándo dos nombres de rama son el mismo para una persona.
 *
 * LO QUE FIJA: que el aviso salte donde tiene que saltar, y —más importante—
 * que NO salte donde no. Un aviso que aparece cada vez que se crea algo se
 * aprende a cerrar sin leerlo, y entonces deja de avisar de nada.
 *
 *   npm run test:nombres --workspace apps/web
 */
import { normalizarNombre, seParecen } from "./nombres.js";

let total = 0;
let fallos = 0;

function check(nombre: string, real: unknown, esperado: unknown): void {
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

console.log("\nSon la misma, y por eso se avisa");
check("la misma con otra caja", seParecen("Frontend", "frontend"), true);
check("con un espacio de más al final", seParecen("Frontend", "Frontend "), true);
check("con espacios dobles en medio", seParecen("Base  de datos", "Base de datos"), true);
check("con tilde y sin tilde", seParecen("Diseño", "diseno"), true);
check("con guión en vez de espacio", seParecen("base-de-datos", "Base de datos"), true);
check("con barra baja", seParecen("dev_verse", "DevVerse".replace("V", " V")), true);

console.log("\nNo son la misma, y avisar sería ruido");
check("dos ramas de verdad distintas", seParecen("Frontend", "Backend"), false);
check("una es prefijo de la otra", seParecen("API", "API pública"), false);
check("el plural no es lo mismo", seParecen("Integración", "Integraciones"), false);
check("contra una vacía no se avisa", seParecen("", "Frontend"), false);
check("ni entre dos vacías", seParecen("", ""), false);
check("ni contra una que es solo espacios", seParecen("   ", "Frontend"), false);

console.log("\nLa normalización");
check("recorta y baja la caja", normalizarNombre("  Infraestructura "), "infraestructura");
check("junta los separadores", normalizarNombre("base__de--datos"), "base de datos");
check("no se guarda nada: solo compara", normalizarNombre("Diseño"), "diseno");

console.log(`\n${total - fallos} comprobaciones correctas, ${fallos} fallidas`);
process.exit(fallos === 0 ? 0 : 1);
