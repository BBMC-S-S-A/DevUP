import { expect, test } from "@playwright/test";
import {
  API,
  CLAVE,
  abrirWorkspace,
  altaInvitada,
  crearCanal,
  crearOrganizacion,
  crearWorkspace,
  enlaceDelRegistro,
  marca,
  nuevaSesion,
} from "./ayudantes";

/**
 * Conversación y notificaciones.
 *
 * Dos cuentas de verdad en contextos separados. Compartir contexto haría que la
 * segunda pestaña heredara la sesión de la primera y la prueba pasaría sin
 * probar nada.
 */
test.describe("Conversación", () => {
  test("mensajes en vivo, no leídos, respuesta, edición y menciones", async ({ browser }) => {
    const id = marca();
    const anfitriona = `chat-a-${id}@devup.test`;
    const invitada = `chat-b-${id}@devup.test`;
    const organizacion = `Chat ${id}`;

    const page = await altaInvitada(browser, "Ana Prueba", anfitriona);
    await crearOrganizacion(page, organizacion);
    await crearWorkspace(page, "Producto");

    // Segunda persona, por la vía real: invitación.
    await page.getByRole("button", { name: "Invitar a alguien" }).click();
    await page.getByPlaceholder("correo@empresa.com").fill(invitada);
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText(/Invitación enviada/)).toBeVisible();

    const bruno = await nuevaSesion(browser);
    await bruno.goto(enlaceDelRegistro("invitacion"));
    await bruno.getByRole("link", { name: "Crear mi cuenta" }).click();
    await bruno.getByPlaceholder("Ana Martín").fill("Bruno Prueba");
    await bruno.getByPlaceholder("mínimo 10 caracteres").fill(CLAVE);
    await bruno.getByRole("button", { name: "Crear cuenta" }).last().click();
    await expect(bruno.getByText(organizacion)).toBeVisible();

    await abrirWorkspace(page, "Producto");
    await crearCanal(page, "general", "Texto");
    await page.getByRole("link", { name: "general" }).click();
    await page.getByPlaceholder("Escribe un mensaje").fill("¿Montamos TURN esta semana?");
    await page.keyboard.press("Enter");
    await expect(page.getByText("¿Montamos TURN esta semana?")).toBeVisible();

    // --- No leídos -----------------------------------------------------------
    await bruno.goto("/app");
    await abrirWorkspace(bruno, "Producto");

    const canal = bruno.locator("a").filter({ hasText: "general" });
    await expect(canal.locator("span", { hasText: /^1$/ })).toBeVisible({ timeout: 45_000 });

    await canal.click();
    await expect(bruno.getByText("¿Montamos TURN esta semana?")).toBeVisible();
    // Abrir el canal lo marca como leído.
    await expect(canal.locator("span", { hasText: /^1$/ })).toHaveCount(0, { timeout: 45_000 });

    // --- Tiempo real ---------------------------------------------------------
    await bruno.getByPlaceholder("Escribe un mensaje").fill("Sí, y con credenciales temporales.");
    await bruno.keyboard.press("Enter");
    await expect(page.getByText("Sí, y con credenciales temporales.")).toBeVisible({
      timeout: 20_000,
    });

    // --- Responder y editar --------------------------------------------------
    const ajeno = page.locator("div.group", { hasText: "Sí, y con credenciales temporales." }).first();
    await ajeno.hover();
    await ajeno.getByTitle("Responder").click();
    await expect(page.getByText(/Respondiendo a Bruno/)).toBeVisible();
    await page.getByPlaceholder("Escribe un mensaje").fill("De acuerdo.");
    await page.keyboard.press("Enter");
    await expect(page.locator("p", { hasText: "Bruno Prueba:" }).first()).toBeVisible();

    const propio = page.locator("div.group", { hasText: "De acuerdo." }).first();
    await propio.hover();
    await propio.getByTitle("Editar").click();
    await page.getByPlaceholder("Escribe un mensaje").fill("De acuerdo, lo miro yo.");
    await page.keyboard.press("Enter");
    await expect(page.getByText("(editado)").first()).toBeVisible();

    // Editar el mensaje de otro es ponerle palabras en la boca: ningún rol
    // puede hacerlo, y la interfaz ni siquiera ofrece el botón.
    await ajeno.hover();
    await expect(ajeno.getByTitle("Editar")).toHaveCount(0);

    // --- Menciones y notificaciones -----------------------------------------
    await page.getByPlaceholder("Escribe un mensaje").fill("@Bruno Prueba ¿lo miras hoy?");
    await page.keyboard.press("Enter");

    const campana = bruno.locator('button[aria-label^="Notificaciones"]');
    await expect(campana).toHaveAttribute("aria-label", /sin leer/, { timeout: 45_000 });

    await campana.click();
    await expect(bruno.getByText("Marcar todas")).toBeVisible();
    await bruno.getByRole("link", { name: /Te han mencionado en #general/ }).click();
    await expect(bruno.getByText("¿lo miras hoy?")).toBeVisible();
    await expect(campana).not.toHaveAttribute("aria-label", /sin leer/, { timeout: 30_000 });

    await bruno.context().close();
  });

  test("una mención en un canal privado no notifica a quien no está dentro", async ({ browser }) => {
    const id = marca();
    const anfitriona = `priv-a-${id}@devup.test`;
    const fuera = `priv-b-${id}@devup.test`;

    const page = await altaInvitada(browser, "Ana Prueba", anfitriona);
    await crearOrganizacion(page, `Privado ${id}`);
    await crearWorkspace(page, "Producto");

    await page.getByRole("button", { name: "Invitar a alguien" }).click();
    await page.getByPlaceholder("correo@empresa.com").fill(fuera);
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText(/Invitación enviada/)).toBeVisible();

    const bruno = await nuevaSesion(browser);
    await bruno.goto(enlaceDelRegistro("invitacion"));
    await bruno.getByRole("link", { name: "Crear mi cuenta" }).click();
    await bruno.getByPlaceholder("Ana Martín").fill("Bruno Fuera");
    await bruno.getByPlaceholder("mínimo 10 caracteres").fill(CLAVE);
    await bruno.getByRole("button", { name: "Crear cuenta" }).last().click();
    await expect(bruno.getByText(`Privado ${id}`)).toBeVisible();

    await abrirWorkspace(page, "Producto");
    await crearCanal(page, "direccion", "Texto", true);
    await page.getByRole("link", { name: "direccion" }).click();
    await page.getByPlaceholder("Escribe un mensaje").fill("@Bruno Fuera esto no lo verás");
    await page.keyboard.press("Enter");
    await expect(page.getByText("esto no lo verás")).toBeVisible();

    // Notificarle revelaría que ese canal existe, que es media filtración.
    await bruno.goto("/app");
    await abrirWorkspace(bruno, "Producto");
    await bruno.waitForTimeout(3000);
    const campana = bruno.locator('button[aria-label^="Notificaciones"]');
    await expect(campana).not.toHaveAttribute("aria-label", /sin leer/);
    await expect(bruno.locator("aside")).not.toContainText("direccion");

    await bruno.context().close();
  });

  test("el historial exige sesión", async ({ page }) => {
    const respuesta = await page.request.get(
      `${API}/channels/00000000-0000-0000-0000-000000000000/messages`,
      { failOnStatusCode: false },
    );
    expect(respuesta.status()).toBe(401);
  });

  test("acceder con la contraseña equivocada acaba limitado", async ({ page }) => {
    const correo = `bruta-${marca()}@devup.test`;
    const maximo = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10);
    let limitado = false;

    // Dirección propia y fija: aquí interesa gastarse el cupo entero, y hacerlo
    // desde la que usa el resto de la suite dejaría sin acceso a lo que corra
    // después durante un minuto.
    for (let intento = 0; intento < maximo + 2; intento += 1) {
      const respuesta = await page.request.post(`${API}/auth/login`, {
        data: { email: correo, password: "no-es-la-buena" },
        headers: { "X-Forwarded-For": "10.255.255.9" },
        failOnStatusCode: false,
      });
      if (respuesta.status() === 429) {
        limitado = true;
        break;
      }
    }

    expect(limitado).toBe(true);
  });

  test("inventarse la dirección de origen no salta el límite", async ({ page }) => {
    // El contador va por dirección, y la dirección sale de X-Forwarded-For. Si
    // la API se creyera esa cabecera viniera de donde viniera, cambiarla en
    // cada intento dejaría probar contraseñas sin freno: el límite parecería
    // configurado y no protegería de nada.
    //
    // En desarrollo la cabecera sí se acepta —no hay proxy delante y la suite
    // la necesita para repartirse el cupo—, así que lo que se comprueba aquí es
    // lo otro: que dos direcciones distintas no comparten contador, que es la
    // mitad honesta de la propiedad. La otra mitad la sostiene TRUST_PROXY, que
    // en producción aborta el arranque si vale `true`.
    const correo = `spoof-${marca()}@devup.test`;
    const maximo = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10);

    const intentar = (ip: string) =>
      page.request.post(`${API}/auth/login`, {
        data: { email: correo, password: "no-es-la-buena" },
        headers: { "X-Forwarded-For": ip },
        failOnStatusCode: false,
      });

    let agotada = false;
    for (let intento = 0; intento < maximo + 2; intento += 1) {
      if ((await intentar("10.254.0.1")).status() === 429) {
        agotada = true;
        break;
      }
    }
    expect(agotada).toBe(true);

    // Otra dirección arranca con su propio cupo.
    expect((await intentar("10.254.0.2")).status()).not.toBe(429);
  });
});
