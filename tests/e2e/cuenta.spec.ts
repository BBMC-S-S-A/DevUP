import { expect, test } from "@playwright/test";
import {
  API,
  CLAVE,
  acceder,
  altaInvitada,
  crearOrganizacion,
  enlaceDelRegistro,
  marca,
  nuevaSesion,
} from "./ayudantes";

/**
 * Entrar en DevUP.
 *
 * Lo que se protege aquí es que nadie entre sin ser invitado, y que quien
 * pierde la contraseña pueda volver. Las dos cosas se pueden romper con un
 * cambio pequeño y no dan la cara hasta que hay gente usándolo.
 */
test.describe("Cuenta e invitaciones", () => {
  test("el registro está cerrado salvo por invitación", async ({ page }) => {
    const respuesta = await page.request.get(`${API}/auth/signup-policy`);
    const politica = (await respuesta.json()) as { mode: string; bootstrap: boolean };

    test.skip(
      politica.bootstrap,
      "la instancia está vacía: la primera cuenta puede crearse sin invitación",
    );
    test.skip(politica.mode === "open", "esta instancia tiene el registro abierto");

    await page.goto("/login");
    await expect(page.getByText(/solo admite altas por invitación/)).toBeVisible();
    // Ofrecer la pestaña de alta sería ofrecer algo que va a fallar.
    await expect(page.getByRole("button", { name: "Crear cuenta" })).toHaveCount(0);
  });

  test("intentar registrarse sin invitación se rechaza en la API", async ({ page }) => {
    const politica = await (await page.request.get(`${API}/auth/signup-policy`)).json();
    test.skip(politica.bootstrap || politica.mode === "open", "el alta está abierta");

    const respuesta = await page.request.post(`${API}/auth/register`, {
      data: { email: `colado-${marca()}@devup.test`, password: CLAVE, displayName: "Colado" },
      failOnStatusCode: false,
    });
    expect(respuesta.status()).toBe(403);
  });

  test("ciclo completo de invitación: enviar, abrir, aceptar y entrar", async ({ browser }) => {
    const id = marca();
    const anfitriona = `ana-${id}@devup.test`;
    const invitada = `bruno-${id}@devup.test`;
    const organizacion = `Acme ${id}`;

    // Quien invita necesita una organización propia.
    const anfitrion = await altaInvitada(browser, "Ana Prueba", anfitriona);
    await crearOrganizacion(anfitrion, organizacion);
    const page = anfitrion;

    await page.getByRole("button", { name: "Invitar a alguien" }).click();
    await page.getByPlaceholder("correo@empresa.com").fill(invitada);
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText(new RegExp(`Invitación enviada a ${invitada}`))).toBeVisible();
    await expect(page.getByText(new RegExp(`${invitada} · member`))).toBeVisible();

    const enlace = enlaceDelRegistro("invitacion");

    const otra = await nuevaSesion(browser);
    await otra.goto(enlace);
    // Decir de quién viene y a qué organización antes de pedir nada es lo que
    // distingue una invitación de un formulario a ciegas.
    await expect(otra.getByText(organizacion)).toBeVisible();
    await expect(otra.getByText(/Ana Prueba te ha invitado como member/)).toBeVisible();

    await otra.getByRole("link", { name: "Crear mi cuenta" }).click();
    await otra.getByPlaceholder("Ana Martín").fill("Bruno Prueba");
    await otra.getByPlaceholder("mínimo 10 caracteres").fill(CLAVE);
    await otra.getByRole("button", { name: "Crear cuenta" }).last().click();

    await expect(otra.getByText(organizacion)).toBeVisible();
    // El correo lo fija la invitación: reenviarla a otra persona no debe darle
    // acceso a la organización.
    await expect(otra.getByText(invitada)).toBeVisible();

    await otra.context().close();
  });

  test("una invitación gastada no sirve dos veces", async ({ browser }) => {
    const id = marca();
    const page = await altaInvitada(browser, "Ana Prueba", `ana2-${id}@devup.test`);
    await crearOrganizacion(page, `Bolt ${id}`);

    await page.getByRole("button", { name: "Invitar a alguien" }).click();
    await page.getByPlaceholder("correo@empresa.com").fill(`carla-${id}@devup.test`);
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText(/Invitación enviada/)).toBeVisible();

    const enlace = enlaceDelRegistro("invitacion");

    const primera = await nuevaSesion(browser);
    await primera.goto(enlace);
    await primera.getByRole("link", { name: "Crear mi cuenta" }).click();
    await primera.getByPlaceholder("Ana Martín").fill("Carla Prueba");
    await primera.getByPlaceholder("mínimo 10 caracteres").fill(CLAVE);
    await primera.getByRole("button", { name: "Crear cuenta" }).last().click();
    await expect(primera.getByText(`Bolt ${id}`)).toBeVisible();
    await primera.context().close();

    const segunda = await nuevaSesion(browser);
    await segunda.goto(enlace);
    await expect(segunda.getByText("Esta invitación ya se usó.")).toBeVisible();
    await segunda.context().close();
  });

  test("recuperar la contraseña responde igual exista o no la cuenta", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("ana@empresa.com").fill(`fantasma-${marca()}@devup.test`);
    await page.getByRole("button", { name: "He olvidado mi contraseña" }).click();
    // Decir «ese correo no está registrado» convertiría esto en un
    // comprobador de qué direcciones tienen cuenta.
    await expect(page.getByText(/Si esa dirección tiene cuenta/)).toBeVisible();
  });

  test("recuperar la contraseña deja entrar con la nueva y no con la vieja", async ({ browser }) => {
    const id = marca();
    const correo = `olvido-${id}@devup.test`;
    const nueva = "contrasena-nueva-1";

    const page = await altaInvitada(browser, "Olvidadiza", correo);
    await crearOrganizacion(page, `Olvido ${id}`);

    const otra = await nuevaSesion(browser);
    await otra.goto("/login");
    await otra.getByPlaceholder("ana@empresa.com").fill(correo);
    await otra.getByRole("button", { name: "He olvidado mi contraseña" }).click();
    await expect(otra.getByText(/Si esa dirección tiene cuenta/)).toBeVisible();

    await otra.goto(enlaceDelRegistro("recuperar"));
    await otra.getByPlaceholder("mínimo 10 caracteres").fill(nueva);
    await otra.locator("input[type=password]").last().fill(nueva);
    await otra.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(otra.getByText(/Se han cerrado todas las sesiones/)).toBeVisible();

    // La contraseña vieja ya no vale.
    const rechazo = await otra.request.post(`${API}/auth/login`, {
      data: { email: correo, password: CLAVE },
      failOnStatusCode: false,
    });
    expect(rechazo.status()).toBe(401);

    await acceder(otra, correo, nueva);
    await expect(otra.getByText(`Olvido ${id}`)).toBeVisible();
    await otra.context().close();
  });
});
