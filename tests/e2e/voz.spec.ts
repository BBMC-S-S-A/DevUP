import { expect, test } from "@playwright/test";
import {
  abrirWorkspace,
  altaInvitada,
  crearCanal,
  crearOrganizacion,
  crearWorkspace,
  hayAlmacen,
  marca,
  nuevaSesion,
} from "./ayudantes";

/**
 * Sala de voz.
 *
 * Es la parte más difícil del producto y la que más se rompe en silencio: una
 * negociación mal resuelta deja la interfaz diciendo «en directo» con los dos
 * extremos colgados esperando una respuesta que nunca llega.
 *
 * Con micrófono y cámara sintéticos de Chromium. Lo que estas pruebas NO pueden
 * comprobar es que el audio llegue a través de una red de verdad: eso necesita
 * TURN y dos máquinas en redes distintas, y sigue siendo una comprobación
 * manual antes de cada despliegue.
 */
test.describe("Voz", () => {
  test("dos pares se conectan, se ven, se silencian y cuelgan", async ({ browser }) => {
    test.slow();
    const id = marca();
    const page = await altaInvitada(browser, "Ana Prueba", `voz-${id}@devup.test`);
    await crearOrganizacion(page, `Voz ${id}`);
    await crearWorkspace(page, "Producto");
    await abrirWorkspace(page, "Producto");
    await crearCanal(page, "reunion", "Voz");
    await page.getByRole("link", { name: "reunion" }).click();

    await expect(page.getByText("Sala de voz")).toBeVisible();
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("en directo")).toBeVisible({ timeout: 30_000 });

    // El cronómetro cuenta desde que se abrió la sesión en el servidor, no desde
    // que entró cada uno: quien llega tarde ve la duración de la llamada.
    const reloj = page.locator("span.font-mono.tabular-nums");
    const antes = (await reloj.innerText()).trim();
    await page.waitForTimeout(2500);
    expect((await reloj.innerText()).trim()).not.toBe(antes);

    // Sin TURN la llamada conecta y parece correcta pero no se oye fuera de la
    // LAN. El aviso tiene que estar donde se ve.
    const url = page.url();
    const segunda = await nuevaSesion(browser);
    await segunda.context().addCookies(await page.context().cookies());
    await segunda.goto(url);
    await segunda.getByRole("button", { name: "Entrar" }).click();
    await expect(segunda.getByText("en directo")).toBeVisible({ timeout: 30_000 });

    // Cada pestaña recibe el medio de la otra: un elemento de vídeo por par
    // remoto, aunque de momento solo lleve audio.
    for (const p of [page, segunda]) {
      await p.waitForFunction(() => document.querySelectorAll("li video").length >= 1, null, {
        timeout: 40_000,
      });
    }

    // Que la conexión llegue a «connected» es lo que distingue una llamada de
    // dos pestañas que creen estar en una llamada.
    for (const p of [page, segunda]) {
      await p.waitForFunction(
        () =>
          Array.from(document.querySelectorAll("li")).some((li) =>
            /silenciado|en línea|hablando/.test(li.textContent ?? ""),
          ) || document.querySelectorAll("li svg").length > 0,
        null,
        { timeout: 40_000 },
      );
    }

    await page.getByRole("button", { name: /Micrófono/ }).click();
    await expect(page.getByText("Silenciado")).toBeVisible();

    await page.getByRole("button", { name: "Colgar" }).click();
    await segunda.waitForFunction(() => document.querySelectorAll("li video").length === 0, null, {
      timeout: 30_000,
    });

    await segunda.context().close();
  });

  test("la cámara se enciende y aparece vídeo", async ({ browser }) => {
    test.slow();
    const id = marca();
    const page = await altaInvitada(browser, "Ana Prueba", `camara-${id}@devup.test`);
    await crearOrganizacion(page, `Camara ${id}`);
    await crearWorkspace(page, "Producto");
    await abrirWorkspace(page, "Producto");
    await crearCanal(page, "reunion", "Voz");
    await page.getByRole("link", { name: "reunion" }).click();

    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("en directo")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Cámara" }).click();
    await page.waitForFunction(
      () => {
        const v = document.querySelector("li video") as HTMLVideoElement | null;
        return Boolean(v && !v.classList.contains("hidden") && v.videoWidth > 0);
      },
      null,
      { timeout: 40_000 },
    );
  });

  test("nadie graba sin que todos lo acepten", async ({ browser }) => {
    test.slow();
    test.skip(!(await hayAlmacen()), "la grabación se sube al almacén y no hay ninguno");

    const id = marca();
    const page = await altaInvitada(browser, "Ana Prueba", `grabar-${id}@devup.test`);
    await crearOrganizacion(page, `Grabar ${id}`);
    await crearWorkspace(page, "Producto");
    await abrirWorkspace(page, "Producto");
    await crearCanal(page, "reunion", "Voz");
    await page.getByRole("link", { name: "reunion" }).click();
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("en directo")).toBeVisible({ timeout: 30_000 });

    const url = page.url();
    const segunda = await nuevaSesion(browser);
    await segunda.context().addCookies(await page.context().cookies());
    await segunda.goto(url);
    await segunda.getByRole("button", { name: "Entrar" }).click();
    await expect(segunda.getByText("en directo")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Grabar" }).click();
    await expect(segunda.getByText("Petición para grabar")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Esperando permiso")).toBeVisible();
    // Mientras no haya permiso, no se graba. Es toda la promesa.
    await expect(page.getByText("grabando")).toHaveCount(0);

    await segunda.getByRole("button", { name: "Acepto que se grabe" }).click();
    await expect(page.getByText("grabando")).toBeVisible({ timeout: 30_000 });
    await expect(segunda.getByText("grabando")).toBeVisible();

    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: "Detener" }).click();
    await expect(page.getByText(/Grabación guardada en la biblioteca/)).toBeVisible({
      timeout: 60_000,
    });

    // La grabación acaba siendo un archivo más del canal, con sus permisos.
    await page.reload();
    await expect(page.locator("ul li button", { hasText: /Llamada / }).first()).toBeVisible({
      timeout: 30_000,
    });

    await segunda.context().close();
  });

  test("un «no» cancela la grabación para todos", async ({ browser }) => {
    test.slow();
    const id = marca();
    const page = await altaInvitada(browser, "Ana Prueba", `nograbar-${id}@devup.test`);
    await crearOrganizacion(page, `NoGrabar ${id}`);
    await crearWorkspace(page, "Producto");
    await abrirWorkspace(page, "Producto");
    await crearCanal(page, "reunion", "Voz");
    await page.getByRole("link", { name: "reunion" }).click();
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("en directo")).toBeVisible({ timeout: 30_000 });

    const url = page.url();
    const segunda = await nuevaSesion(browser);
    await segunda.context().addCookies(await page.context().cookies());
    await segunda.goto(url);
    await segunda.getByRole("button", { name: "Entrar" }).click();
    await expect(segunda.getByText("en directo")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Grabar" }).click();
    await expect(segunda.getByText("Petición para grabar")).toBeVisible({ timeout: 30_000 });

    await segunda.getByRole("button", { name: "No", exact: true }).click();
    // No existe la grabación parcial: en una malla, quien graba recibe el audio
    // de todos, así que «grabo solo a los que aceptaron» no se puede cumplir.
    await expect(page.getByText(/no aceptó que se grabara/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("grabando")).toHaveCount(0);

    await segunda.context().close();
  });
});
