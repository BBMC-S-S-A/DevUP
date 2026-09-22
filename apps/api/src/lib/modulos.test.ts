/**
 * Prueba del interruptor de módulos del menú.
 *
 * LO QUE HAY QUE FIJAR SON DOS COSAS QUE TIRAN EN SENTIDOS OPUESTOS:
 *
 *   · Un módulo apagado NO sale en `capacidades`, que es de donde la web saca
 *     el menú.
 *   · Y su ruta SIGUE VIVA. Apagar recorta la navegación; no borra el módulo.
 *     Quien tenga el enlace entra igual, y volver a encenderlo es cambiar una
 *     variable, no devolver código.
 *
 * La segunda es la que se olvida, porque nada la echa de menos hasta que
 * alguien quiere volver atrás y descubre que «apagado» significaba «quitado».
 *
 * Y LA TERCERA, QUE ES LA QUE MÁS CUESTA CAZAR: el valor por defecto. Estos
 * módulos funcionan y se están usando, así que la lista vacía tiene que
 * dejarlos TODOS encendidos. Si un día alguien invierte el sentido de la
 * variable —encender en vez de apagar— el primer despliegue borraría cinco
 * entradas del menú de todo el mundo sin que fallara nada.
 *
 *   npm run test:modulos
 */
import { MODULOS_APAGABLES } from "../env.js";

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

/**
 * Se recarga `env.js` con otra variable puesta.
 *
 * Hace falta porque `modulosApagados` se calcula UNA vez al importar —que es lo
 * correcto: leer y validar la configuración en cada petición sería trabajo por
 * nada— así que para probar otra configuración hay que volver a importarlo. El
 * sufijo en la URL es lo que evita la caché de módulos.
 */
let contador = 0;
async function conVariable(valor: string) {
  process.env.MODULOS_APAGADOS = valor;
  contador += 1;
  return (await import(`../env.js?prueba=${contador}`)) as typeof import("../env.js");
}

async function main(): Promise<void> {
  const original = process.env.MODULOS_APAGADOS;

  try {
    console.log("\nSin apagar nada, están todos");
    const todo = await conVariable("");
    const encendidos = todo.modulosEncendidos();
    check(
      "la lista vacía deja los cinco encendidos",
      MODULOS_APAGABLES.every((m) => encendidos[m] === true),
    );
    check("y no se inventa ninguno de más", Object.keys(encendidos).length === MODULOS_APAGABLES.length);

    console.log("\nApagar uno lo quita del menú, y solo a él");
    const sinDevverse = await conVariable("devverse");
    const uno = sinDevverse.modulosEncendidos();
    check("devverse deja de salir", uno.devverse === false);
    check("mesa sigue saliendo", uno.mesa === true);
    check("ventas sigue saliendo", uno.ventas === true);
    check("noticias sigue saliendo", uno.noticias === true);
    check("asistente sigue saliendo", uno.asistente === true);

    console.log("\nVarios a la vez, y escritos como los escribe una persona");
    const varios = await conVariable(" DevVerse , ventas,, NOTICIAS ");
    const v = varios.modulosEncendidos();
    check("los espacios de sobra no estorban", v.devverse === false);
    check("ni las mayúsculas", v.noticias === false);
    check("ni una coma de más", v.ventas === false);
    check("y lo que no se nombró sigue encendido", v.mesa === true && v.asistente === true);

    console.log("\nApagar no es borrar");
    // El conjunto de los que se PUEDEN apagar no cambia: es la lista cerrada
    // del código, no lo que haya en la variable. Eso es lo que sostiene que la
    // ruta siga existiendo y que volver a encenderla sea cambiar un texto.
    check(
      "la lista de apagables no depende de lo apagado",
      varios.MODULOS_APAGABLES.length === MODULOS_APAGABLES.length,
    );
    const devuelta = await conVariable("");
    check("y quitar la variable los devuelve todos", devuelta.modulosEncendidos().devverse === true);

    console.log(`\n${total - fallos.length} comprobaciones correctas, ${fallos.length} fallidas`);
    if (fallos.length > 0) {
      console.error("\nFallaron:\n" + fallos.map((f) => `  · ${f}`).join("\n"));
      process.exit(1);
    }
  } finally {
    if (original === undefined) delete process.env.MODULOS_APAGADOS;
    else process.env.MODULOS_APAGADOS = original;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
