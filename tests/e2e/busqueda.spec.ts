import { expect, test } from "@playwright/test";
import {
  abrirWorkspace,
  altaInvitada,
  crearCanal,
  crearOrganizacion,
  crearWorkspace,
  marca,
} from "./ayudantes";

/**
 * Búsqueda global.
 *
 * Lo que de verdad hay que comprobar no es que encuentre —eso lo dice el
 * `tsvector`— sino que **no** encuentre lo que no toca. La función de búsqueda
 * es la única del esquema que recorre tres tablas a la vez para alguien que
 * puede no tener acceso a ninguna de las tres, así que es el sitio más barato
 * para filtrar una organización entera por accidente.
 */
test.describe("Búsqueda", () => {
  test("encuentra mensajes y tareas, y no cruza organizaciones", async ({ browser }) => {
    const id = marca();
    const palabra = `pangolin${id.replace(/\D/g, "")}`;

    const ana = await altaInvitada(browser, "Ana Prueba", `busca-a-${id}@devup.test`);
    await crearOrganizacion(ana, `Buscadora ${id}`);
    await crearWorkspace(ana, "Producto");
    await abrirWorkspace(ana, "Producto");

    await crearCanal(ana, "general", "Texto");
    await ana.getByRole("link", { name: "general" }).click();
    await ana.getByPlaceholder("Escribe un mensaje").fill(`el informe del ${palabra}`);
    await ana.keyboard.press("Enter");
    await expect(ana.getByText(`el informe del ${palabra}`)).toBeVisible();

    await ana.getByRole("link", { name: "Tablero" }).click();
    await ana.getByRole("button", { name: "Nueva tarea" }).first().click();
    await ana.getByPlaceholder("Qué hay que hacer").fill(`revisar ${palabra}`);
    await ana.keyboard.press("Enter");
    await expect(ana.getByText(`revisar ${palabra}`)).toBeVisible();

    // --- Encuentra ------------------------------------------------------------
    await ana.getByRole("button", { name: /Buscar/ }).click();
    const caja = ana.getByPlaceholder("Buscar en mensajes, archivos y tareas");
    await caja.fill(palabra);

    await expect(ana.getByText("Mensaje ·", { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(ana.getByText("Tarea ·", { exact: false })).toBeVisible();

    // Con una letra no se busca: devolvería media base de datos.
    await caja.fill("a");
    await expect(ana.getByText("Escribe al menos dos caracteres.")).toBeVisible();

    // Ir a un resultado lleva al sitio.
    await caja.fill(palabra);
    await ana.getByRole("button", { name: new RegExp(`el informe del ${palabra}`) }).click();
    await expect(ana.getByText(`el informe del ${palabra}`)).toBeVisible();

    // --- Y no cruza -----------------------------------------------------------
    // Bruno tiene su propia organización y busca la misma palabra, que solo
    // existe en la de Ana. Si la función fuese SECURITY DEFINER —la tentación
    // cuando una búsqueda «no devuelve nada»— aquí saldrían las dos cosas.
    const bruno = await altaInvitada(browser, "Bruno Prueba", `busca-b-${id}@devup.test`);
    await crearOrganizacion(bruno, `Ajena ${id}`);
    await crearWorkspace(bruno, "Suyo");
    await abrirWorkspace(bruno, "Suyo");

    await bruno.getByRole("button", { name: /Buscar/ }).click();
    await bruno.getByPlaceholder("Buscar en mensajes, archivos y tareas").fill(palabra);
    await expect(bruno.getByText("Nada coincide.")).toBeVisible({ timeout: 15_000 });

    await bruno.context().close();
    await ana.context().close();
  });
});
