import { expect, test } from "@playwright/test";
import {
  PNG,
  abrirWorkspace,
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
 */
test.describe("Espacios de trabajo", () => {
  test("un workspace personal se marca como tal y lo dice dentro", async ({ browser }) => {
    const id = marca();
    const page = await altaInvitada(browser, "Ana Prueba", `esp-${id}@devup.test`);
    await crearOrganizacion(page, `Espacios ${id}`);

    await crearWorkspace(page, "Producto");
    await crearWorkspace(page, "Cuaderno", "personal");

    const fila = page.getByRole("link", { name: /Cuaderno/ });
    await expect(fila).toContainText("personal");

    await abrirWorkspace(page, "Cuaderno");
    await expect(page.getByText("Solo tú ves este workspace")).toBeVisible();
  });

  test("el tablero nace con tres columnas y la tarjeta sobrevive a recargar", async ({ browser }) => {
    const id = marca();
    const page = await altaInvitada(browser, "Ana Prueba", `tablero-${id}@devup.test`);
    await crearOrganizacion(page, `Tablero ${id}`);
    await crearWorkspace(page, "Producto");
    await abrirWorkspace(page, "Producto");

    await page.getByRole("link", { name: "Tablero" }).click();
    for (const columna of ["Por hacer", "En curso", "Hecho"]) {
      await expect(page.getByRole("heading", { name: columna })).toBeVisible();
    }

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

    // Mover a otra columna y comprobar que la posición se guardó de verdad.
    const enCurso = page.locator("section").filter({ hasText: "En curso" }).first();
    await page.getByText("Configurar TURN en producción").dragTo(enCurso);
    await expect(enCurso).toContainText("Configurar TURN");

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
    await abrirWorkspace(page, "Producto");

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
    await abrirWorkspace(page, "Producto");

    await crearCanal(page, "general", "Texto");
    await crearCanal(page, "reunion", "Voz");

    // En minúscula: las mayúsculas de la barra las pone `text-transform`, y eso
    // no toca el texto del DOM, que es lo que lee `toContainText`.
    const barra = page.locator("aside");
    await expect(barra.getByRole("heading", { name: "Texto" })).toBeVisible();
    await expect(barra.getByRole("heading", { name: "Voz" })).toBeVisible();
  });
});
