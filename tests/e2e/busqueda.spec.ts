import { expect, test } from "@playwright/test";
import { altaInvitada, crearOrganizacion, crearWorkspace, marca } from "./ayudantes";

/**
 * Búsqueda global.
 *
 * Lo que de verdad hay que comprobar no es que encuentre —eso lo dice el
 * `tsvector`— sino que **no** encuentre lo que no toca. La función de búsqueda
 * es la única del esquema que recorre varias tablas a la vez para alguien que
 * puede no tener acceso a ninguna de ellas, así que es el sitio más barato
 * para filtrar una organización entera por accidente.
 *
 * PORTADO Y ADAPTADO desde `claude/inicio-desarrollo-nu1ftu` — ver la cabecera
 * de `ayudantes.ts`. Cuatro cambios reales en este archivo, todos verificados
 * contra `app/o/[orgId]/buscar/page.tsx`:
 *
 *   - «Buscar» es un enlace a `/buscar`, no un botón que abre un panel — se
 *     navega con `getByRole("link", ...)`.
 *   - El campo dice «Buscar mensajes, archivos, tareas, clientes, ventas…»,
 *     no «Buscar en mensajes, archivos y tareas».
 *   - Sin resultados dice «Nada para «‹término›»», no «Nada coincide.».
 *   - Ya no existe un mínimo de dos caracteres: la búsqueda solo espera a que
 *     el campo no esté vacío. Esa comprobación se quitó de la prueba en vez de
 *     adivinar un mensaje que no está en ningún sitio del código.
 */
test.describe("Búsqueda", () => {
  test("encuentra mensajes y tareas, y no cruza organizaciones", async ({ browser }) => {
    const id = marca();
    const palabra = `pangolin${id.replace(/\D/g, "")}`;

    const ana = await altaInvitada(browser, "Ana Prueba", `busca-a-${id}@devup.test`);
    await crearOrganizacion(ana, `Buscadora ${id}`);
    await crearWorkspace(ana, "Producto");
    // Ya está dentro de «general».

    await ana.getByPlaceholder("Escribe un mensaje").fill(`el informe del ${palabra}`);
    await ana.keyboard.press("Enter");
    await expect(ana.getByText(`el informe del ${palabra}`)).toBeVisible();

    await ana.getByRole("link", { name: "Tablero" }).click();
    await ana.getByRole("button", { name: "Crear la primera columna" }).click();
    await ana.getByPlaceholder("Nombre de la columna").fill("Por hacer");
    await ana.keyboard.press("Enter");
    await ana.getByRole("button", { name: "Nueva tarea" }).first().click();
    await ana.getByPlaceholder("Qué hay que hacer").fill(`revisar ${palabra}`);
    await ana.keyboard.press("Enter");
    await expect(ana.getByText(`revisar ${palabra}`)).toBeVisible();

    // --- Encuentra ------------------------------------------------------------
    await ana.getByRole("link", { name: "Buscar" }).click();
    const caja = ana.getByPlaceholder("Buscar mensajes, archivos, tareas, clientes, ventas…");
    await caja.fill(palabra);

    await expect(ana.getByText("Mensaje ·", { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(ana.getByText("Tarea ·", { exact: false })).toBeVisible();

    // Ir a un resultado lleva al sitio.
    await ana.getByRole("button", { name: new RegExp(`el informe del ${palabra}`) }).click();
    await expect(ana.getByText(`el informe del ${palabra}`)).toBeVisible();

    // --- Y no cruza -----------------------------------------------------------
    // Bruno tiene su propia organización y busca la misma palabra, que solo
    // existe en la de Ana. Si la función fuese SECURITY DEFINER —la tentación
    // cuando una búsqueda «no devuelve nada»— aquí saldrían las dos cosas.
    const bruno = await altaInvitada(browser, "Bruno Prueba", `busca-b-${id}@devup.test`);
    await crearOrganizacion(bruno, `Ajena ${id}`);
    await crearWorkspace(bruno, "Suyo");

    await bruno.getByRole("link", { name: "Buscar" }).click();
    await bruno
      .getByPlaceholder("Buscar mensajes, archivos, tareas, clientes, ventas…")
      .fill(palabra);
    await expect(bruno.getByText(`Nada para «${palabra}»`)).toBeVisible({ timeout: 15_000 });

    await bruno.context().close();
    await ana.context().close();
  });
});
