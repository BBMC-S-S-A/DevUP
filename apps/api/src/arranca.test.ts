/**
 * ¿Arranca el servidor?
 *
 * POR QUÉ HACÍA FALTA ESTO. La API llevaba registrado `actividadRoutes` dos
 * veces —una línea duplicada al fusionar dos caminos—, y Fastify rechaza
 * declarar dos veces la misma ruta: el proceso se caía nada más empezar. No
 * estaba en verde por suerte, estaba en verde porque **nada arrancaba el
 * servidor**. Compilar no lo toca: `app.register` es una llamada en tiempo de
 * ejecución, y para TypeScript registrar dos veces el mismo módulo es tan
 * correcto como registrarlo una. Las pruebas tampoco: todas hablan con Postgres
 * directamente, que es lo que las hace rápidas, y ninguna levanta el HTTP.
 *
 * O sea que el único sitio donde se veía era al desplegar.
 *
 * LO QUE COMPRUEBA, QUE ES POCO Y A PROPÓSITO: que el servidor se construye
 * entero y se queda escuchando. Ni una petición. Todo lo que puede salir mal en
 * ese trecho —una ruta repetida, un plugin que falta, una variable de entorno
 * que se valida al arrancar, un `import` que no resuelve dentro de la imagen—
 * es de la clase que no tiene ninguna otra red debajo.
 *
 * SE ARRANCA EN UN PUERTO CUALQUIERA (`API_PORT=0`) para no chocar con nada que
 * esté escuchando, y se mata en cuanto contesta que está en pie.
 *
 *   npm run arranca --workspace apps/api
 */
const arranque = Date.now();

/**
 * Un puerto alto al azar, para no chocar con nada que esté escuchando.
 *
 * Y no el 0 —que es como se pide «el que sea»— porque la configuración se
 * valida al arrancar y exige un puerto mayor que cero. Esa validación es
 * correcta: un 0 en el fichero de un entorno sería una errata, no una
 * petición.
 */
process.env["API_PORT"] = String(40000 + Math.floor(Math.random() * 20000));
process.env["API_HOST"] = "127.0.0.1";

/**
 * Un plazo, porque la forma de fallar de esto no es siempre una excepción.
 *
 * Si el servidor se queda colgado esperando algo que en CI no existe, sin plazo
 * el paso se quedaría ahí hasta que el trabajo entero caducara — quince minutos
 * para decir lo mismo que se puede decir en veinte segundos.
 */
const PLAZO_MS = 30_000;
const plazo = setTimeout(() => {
  console.error(`\n✗ el servidor no llegó a arrancar en ${PLAZO_MS / 1000}s`);
  process.exit(1);
}, PLAZO_MS);

try {
  // El módulo arranca solo al importarse: no exporta nada que se pueda llamar.
  // Es lo que hace que esta comprobación sea honesta — ejecuta exactamente el
  // mismo camino que el contenedor, no una versión de mentira para pruebas.
  await import("./server.js");
  clearTimeout(plazo);
  console.log(`\n  ✓ el servidor arranca y se queda escuchando (${Date.now() - arranque}ms)`);
  console.log("\n1 comprobación correcta, 0 fallidas\n");
  process.exit(0);
} catch (fallo) {
  clearTimeout(plazo);
  console.error("\n  ✗ el servidor NO arranca");
  console.error(`\n    ${(fallo as Error).message}\n`);
  process.exit(1);
}

// Para que TypeScript trate esto como módulo y deje el `await` de arriba: el
// fichero no importa nada al principio a propósito —el `import` del servidor va
// dentro del `try` para poder cazar lo que falle al construirlo—.
export {};
