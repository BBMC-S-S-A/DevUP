/**
 * Que una organización que falla no borre a las demás.
 *
 * LA QUE JUSTIFICA EL FICHERO ES LA PRIMERA. Con `Promise.all` a pelo, una
 * sola petición rechazada tira el conjunto entero: el `setWorkspaces` de la
 * pantalla no llega a ejecutarse y TODAS las organizaciones se pintan con cero
 * espacios. Y eso no se ve como una avería —se ve como una pantalla normal
 * diciendo que el equipo no tiene nada, con el botón de crear el primero
 * invitando a duplicar lo que sí existe—. Por eso se prueba el caso mixto, que
 * es el que se rompe en silencio, y no solo el de todo bien.
 *
 * Y DOS MÁS QUE SE LEEN BIEN ESTANDO MAL:
 *
 *   · «No llegó» no puede quedarse como lista vacía. Si la que falla apareciera
 *     con `[]`, la pantalla no tendría forma de distinguirla de una que de
 *     verdad no tiene espacios, y volveríamos a la misma mentira, ya en un solo
 *     sitio en vez de en todos.
 *   · Las peticiones van a la vez. Encadenarlas multiplica la espera por el
 *     número de organizaciones sin que nada lo delate en la pantalla.
 *
 *   npm run test:espacios --workspace apps/web
 */
import { cargarEspaciosPorOrganizacion } from "./espacios-por-organizacion.js";

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

const orgs = [{ id: "acme" }, { id: "rota" }, { id: "hytrex" }];

async function main(): Promise<void> {
  // 1 · La de verdad: una falla, las otras dos llegan enteras.
  const mixto = await cargarEspaciosPorOrganizacion(
    orgs,
    async (id) => {
      if (id === "rota") throw new Error("403");
      return [`${id}-uno`, `${id}-dos`];
    },
    (fallo) => (fallo as Error).message,
  );
  check("las que contestaron traen sus espacios", mixto.espacios.acme?.length === 2);
  check("la tercera tampoco se pierde", mixto.espacios.hytrex?.length === 2);
  check("y la que falló queda anotada con su motivo", mixto.fallaron.rota === "403");

  // 2 · «No llegó» no es «no tiene».
  check("la que falló NO aparece con lista vacía", !("rota" in mixto.espacios));
  const vacia = await cargarEspaciosPorOrganizacion([{ id: "nueva" }], async () => []);
  check("una que de verdad no tiene espacios sí aparece, con cero", vacia.espacios.nueva?.length === 0);
  check("y sin fallo anotado", Object.keys(vacia.fallaron).length === 0);

  // 3 · Todo bien y todo mal, los dos extremos.
  const todoMal = await cargarEspaciosPorOrganizacion(orgs, async () => {
    throw new Error("la red");
  });
  check("si fallan todas no revienta", Object.keys(todoMal.fallaron).length === 3);
  check("y sin lector de motivo cae uno genérico", todoMal.fallaron.acme === "sin respuesta del servidor");

  // 4 · A la vez, no en fila.
  let vivas = 0;
  let maximoALaVez = 0;
  await cargarEspaciosPorOrganizacion(orgs, async () => {
    vivas += 1;
    maximoALaVez = Math.max(maximoALaVez, vivas);
    await new Promise((sigue) => setTimeout(sigue, 5));
    vivas -= 1;
    return [];
  });
  check("las peticiones salen a la vez, no encadenadas", maximoALaVez === orgs.length);

  console.log(`\n${total - fallos.length}/${total} comprobaciones`);
  if (fallos.length) process.exit(1);
}

main().catch((fallo) => {
  console.error(fallo);
  process.exit(1);
});
