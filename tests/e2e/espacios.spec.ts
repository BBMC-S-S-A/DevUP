import { expect, test } from "@playwright/test";
import {
  PNG,
  altaInvitada,
  crearCanal,
  crearOrganizacion,
  crearWorkspace,
  hayAlmacen,
  marca,
} from "./ayudantes";

/**
 * Workspaces, tablero y biblioteca.
 *
 * La prueba que más importa aquí es la del workspace personal: su aislamiento
 * no lo da una columna, lo dan tres funciones de acceso que ya se olvidaron una
 * vez de mirar el workspace en vez de la organización.
 *
 * PORTADO Y ADAPTADO desde `claude/inicio-desarrollo-nu1ftu` — ver la cabecera
 * de `ayudantes.ts`. Tres cambios reales de este archivo, no solo de forma:
 *
 *   1. `crearWorkspace` ya entra directo al canal general — los `abrirWorkspace`
 *      que antes iban justo detrás sobraban, y la primera prueba necesita
 *      volver a `/app` a propósito para poder mirar la ficha en la lista.
 *   2. El tablero YA NO NACE CON TRES COLUMNAS. Hoy empieza vacío y cada
 *      columna se crea a mano (`components/tasks/TaskBoard.tsx`) — es un
 *      cambio de producto real, confirmado leyendo el componente, no un
 *      selector desactualizado. La prueba se reescribió para crear su propia
 *      columna en vez de dar las tres por hechas.
 *   3. El workspace nuevo ya trae un canal «general» sembrado (ver
 *      `workspaces.ts`, la corrección del 5 de septiembre de 2026), así que
 *      la última prueba no necesita crearlo — solo añade uno de voz para
 *      comprobar que los dos grupos aparecen.
 */
test.describe("Espacios de trabajo", () => {
  test("un workspace personal se marca como tal y lo dice dentro", async ({ browser }) => {
    const id = marca();
    const page = await altaInvitada(browser, "Ana Prueba", `esp-${id}@devup.test`);
    await crearOrganizacion(page, `Espacios ${id}`);

    await crearWorkspace(page, "Producto");
    await crearWorkspace(page, "Cuaderno", "personal");

    // `crearWorkspace` ya deja dentro de «Cuaderno» — para ver cómo se marca en
    // la lista de la organización hay que volver ahí a propósito, como haría
    // alguien que entra y sale de sus workspaces.
    await page.goto("/app");
    const fila = page.getByRole("link", { name: /Cuaderno/ });
    await expect(fila).toContainText("Personal");

    await fila.click();
    await expect(page.getByText("Solo tú ves este workspace")).toBeVisible();
  });

  test("una columna nueva recibe tareas y la posición sobrevive a recargar", async ({
    browser,
  }) => {
    const id = marca();
    const page = await altaInvitada(browser, "Ana Prueba", `tablero-${id}@devup.test`);
    await crearOrganizacion(page, `Tablero ${id}`);
    await crearWorkspace(page, "Producto");

    await page.getByRole("link", { name: "Tablero" }).click();
    // El tablero nace vacío — «El tablero está vacío», dice su propio estado
    // inicial — así que la primera columna hay que crearla. El botón del
    // tablero vacío dice «Crear la primera columna»; solo en un tablero que ya
    // tiene alguna, el siguiente se llama «Nueva columna».
    await expect(page.getByText("El tablero está vacío")).toBeVisible();
    await page.getByRole("button", { name: "Crear la primera columna" }).click();
    await page.getByPlaceholder("Nombre de la columna").fill("En curso");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "En curso" })).toBeVisible();

    await page.getByRole("button", { name: "Nueva tarea" }).first().click();
    await page.getByPlaceholder("Qué hay que hacer").fill("Configurar TURN en producción");
    await page.getByRole("button", { name: "Añadir" }).click();
    await expect(page.getByText("Configurar TURN en producción")).toBeVisible();

    // Asignar y guardar.
    await page.getByText("Configurar TURN en producción").click();
    const dialogo = page.locator("form").filter({ hasText: "Responsable" });
    await dialogo.locator("select").selectOption({ label: "Ana Prueba" });
    await dialogo.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Ana Prueba").first()).toBeVisible();

    await page.reload();
    const trasRecargar = page.locator("section").filter({ hasText: "En curso" }).first();
    await expect(trasRecargar).toContainText("Configurar TURN");
  });

  test("subir un archivo y abrirlo con URL firmada", async ({ browser }) => {
    test.skip(!(await hayAlmacen()), "no hay almacén compatible con S3 escuchando");

    const id = marca();
    const page = await altaInvitada(browser, "Ana Prueba", `archivo-${id}@devup.test`);
    await crearOrganizacion(page, `Archivos ${id}`);
    await crearWorkspace(page, "Producto");

    // La biblioteca se movió a su propia ruta el 5 de septiembre de 2026 — la
    // raíz del workspace ya no es el almacén, es el canal general.
    await page.getByRole("link", { name: "Biblioteca" }).click();

    await page.setInputFiles("input[type=file]", {
      name: "captura.png",
      mimeType: "image/png",
      buffer: PNG,
    });

    // La tarjeta de la rejilla, no la fila de progreso: la fila también lleva
    // el nombre y aparece igual cuando la subida falla. Este matiz convirtió
    // una vez un fallo real en una prueba verde.
    const tarjeta = page.locator("ul li button", { hasText: "captura.png" });
    await expect(tarjeta).toBeVisible({ timeout: 30_000 });

    await tarjeta.click();
    const imagen = page.getByRole("dialog").locator("img");
    await expect(imagen).toBeVisible();
    // Nunca un bucket público: el acceso va siempre por enlace firmado.
    await expect(imagen).toHaveAttribute("src", /X-Amz-Signature/);
  });

  test("los canales de texto y de voz aparecen separados", async ({ browser }) => {
    const id = marca();
    const page = await altaInvitada(browser, "Ana Prueba", `canales-${id}@devup.test`);
    await crearOrganizacion(page, `Canales ${id}`);
    await crearWorkspace(page, "Producto");

    // «general» (texto) ya existe — lo siembra la propia creación del
    // workspace. Solo hace falta uno de voz para comprobar que las dos listas
    // se muestran separadas.
    await crearCanal(page, "reunion", "Voz");

    // Los rótulos de grupo («Texto», «Voz») son un `<span>` de `Rotulo`, no un
    // encabezado — `exact` para no confundir «Voz» con un canal que se llame
    // parecido.
    const barra = page.locator("aside");
    await expect(barra.getByText("Texto", { exact: true })).toBeVisible();
    await expect(barra.getByText("Voz", { exact: true })).toBeVisible();
  });
});
