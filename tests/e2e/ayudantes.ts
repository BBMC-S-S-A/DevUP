import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, request, type Browser, type Page } from "@playwright/test";

/**
 * Ayudantes compartidos por las pruebas.
 *
 * Todo lo que aparece aquí salió de tropezar con ello: las esperas que hacen
 * falta, los sitios donde una aserción mira el componente equivocado, y cómo
 * recuperar los enlaces de los correos cuando no hay SMTP.
 */
export const API = process.env.E2E_API_URL ?? "http://localhost:4000";

/** Sufijo único por ejecución: las pruebas comparten base de datos. */
export const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

export const CLAVE = "contrasena-larga";

/**
 * Cuenta sembradora.
 *
 * La instancia solo admite altas por invitación y solo la primera cuenta se
 * libra de esa regla. `global-setup.ts` la crea (o entra con ella) y desde aquí
 * se invita a todas las demás, que es como entra una persona de verdad.
 */
export const SEMILLA = {
  email: "semilla@devup.test",
  nombre: "Cuenta Sembradora",
  slug: "semillero-e2e",
} as const;

export const estadoSemilla = resolve(process.cwd(), "tests/.auth/semilla.json");

async function contextoSemilla() {
  const guardado = JSON.parse(await readFile(estadoSemilla, "utf8")) as {
    cookies: unknown[];
    origins: unknown[];
    semillero: string;
  };
  const api = await request.newContext({
    baseURL: API,
    storageState: { cookies: guardado.cookies, origins: guardado.origins } as never,
    extraHTTPHeaders: { "X-Forwarded-For": direccionUnica() },
  });
  return { api, semillero: guardado.semillero };
}

/**
 * Crea una cuenta pasando por una invitación real.
 *
 * Sustituye al `alta()` directo, que solo funcionaba para la primera cuenta de
 * la instancia. Devuelve una página con la sesión de la persona recién creada.
 */
export async function altaInvitada(
  browser: Browser,
  nombre: string,
  correo: string,
): Promise<Page> {
  const { api, semillero } = await contextoSemilla();
  const invitada = await api.post(`/organizations/${semillero}/invitations`, {
    data: { email: correo, role: "member" },
  });
  if (!invitada.ok()) {
    throw new Error(`no se pudo invitar a ${correo}: ${invitada.status()}`);
  }
  await api.dispose();

  const enlace = enlaceDelRegistro("invitacion");
  const page = await nuevaSesion(browser);
  await page.goto(enlace);
  await page.getByRole("link", { name: "Crear mi cuenta" }).click();
  await page.getByPlaceholder("Ana Martín").fill(nombre);
  await page.getByPlaceholder("mínimo 10 caracteres").fill(CLAVE);
  await page.getByRole("button", { name: "Crear cuenta" }).last().click();
  await expect(page.getByText("Semillero")).toBeVisible({ timeout: 30_000 });
  return page;
}

/**
 * Enlace que la API escribió en su registro.
 *
 * Sin SMTP configurado los correos se vuelcan al registro con su enlace. Es
 * también como se prueba el ciclo de invitación y de recuperación sin montar un
 * servidor de correo.
 */
export function enlaceDelRegistro(ruta: "invitacion" | "recuperar" | "verificar"): string {
  const log = process.env.E2E_API_LOG ?? "/tmp/api.log";

  let contenido: string;
  try {
    contenido = readFileSync(log, "utf8");
  } catch {
    throw new Error(
      `no se pudo leer ${log}. Esta prueba necesita la API arrancada sin SMTP y con ` +
        "su salida en ese archivo (E2E_API_LOG para cambiarlo).",
    );
  }

  // En desarrollo la API escribe con pino-pretty, que colorea. Los códigos de
  // color van incrustados dentro de la línea, así que hay que quitarlos antes
  // de buscar. Esto se hacía con `grep` y fallaba de la peor manera: grep ve un
  // archivo con bytes de escape, decide que es binario y no encuentra nada, con
  // lo que el error decía «la API no está escribiendo los correos» cuando los
  // estaba escribiendo perfectamente.
  const limpio = contenido.replace(/\u001b\[[0-9;]*m/g, "");
  const encontrados = limpio.match(
    new RegExp(`https?://[^\\s"]*/${ruta}\\?token=[A-Za-z0-9_-]+`, "g"),
  );

  if (!encontrados?.length) {
    throw new Error(
      `no se encontró un enlace de ${ruta} en ${log}. ` +
        "Esta prueba necesita la API arrancada sin SMTP y con su salida en ese archivo " +
        "(E2E_API_LOG para cambiarlo).",
    );
  }
  return encontrados[encontrados.length - 1]!;
}

export async function alta(page: Page, nombre: string, correo: string): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Crear cuenta" }).first().click();
  await page.getByPlaceholder("Ana Martín").fill(nombre);
  await page.getByPlaceholder("ana@empresa.com").fill(correo);
  await page.getByPlaceholder("mínimo 10 caracteres").fill(CLAVE);
  await page.getByRole("button", { name: "Crear cuenta" }).last().click();
}

export async function acceder(page: Page, correo: string, clave = CLAVE): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("ana@empresa.com").fill(correo);
  await page.getByPlaceholder("mínimo 10 caracteres").fill(clave);
  await page.getByRole("button", { name: "Entrar" }).last().click();
}

export async function crearOrganizacion(page: Page, nombre: string): Promise<void> {
  // Con una organización ya visible (la del semillero) el formulario llega
  // plegado; con ninguna, abierto. Se abre solo si hace falta.
  const abrir = page.getByRole("button", { name: "Nueva organización" });
  if (await abrir.count()) await abrir.click();

  await page.getByPlaceholder("Nombre", { exact: true }).waitFor();
  await page.getByPlaceholder("Nombre", { exact: true }).fill(nombre);
  await page.getByRole("button", { name: "Crear", exact: true }).click();
  await expect(page.getByText(nombre)).toBeVisible();
}

export async function crearWorkspace(
  page: Page,
  nombre: string,
  visibilidad: "shared" | "personal" = "shared",
): Promise<void> {
  // La última: quien llega por invitación ve primero el semillero y después la
  // organización que acaba de crearse, que es la suya.
  await page.getByRole("button", { name: "Nuevo workspace" }).last().click();
  await page.getByPlaceholder("Nombre del workspace").fill(nombre);
  if (visibilidad === "personal") await page.getByRole("button", { name: "Personal" }).click();
  await page.getByRole("button", { name: "Crear" }).click();
  await expect(page.getByRole("link", { name: new RegExp(nombre) })).toBeVisible();
}

/**
 * Entra en un workspace y espera a que esté montado de verdad.
 *
 * El `Tablero` como testigo no es arbitrario: en `/app` también hay campana de
 * notificaciones, y comprobarla antes de que termine la navegación mira la que
 * está a punto de desmontarse. Esa confusión costó una tarde.
 */
export async function abrirWorkspace(page: Page, nombre: string): Promise<void> {
  await page.getByRole("link", { name: new RegExp(nombre) }).click();
  await expect(page.getByRole("link", { name: "Tablero" })).toBeVisible();
}

export async function crearCanal(
  page: Page,
  nombre: string,
  tipo: "Texto" | "Voz",
  privado = false,
): Promise<void> {
  await page.getByRole("button", { name: "Nuevo canal" }).click();
  await page.getByPlaceholder("nombre-del-canal").fill(nombre);
  await page.getByRole("button", { name: tipo }).click();
  if (privado) await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Crear" }).click();
  await expect(page.getByRole("link", { name: nombre })).toBeVisible();
}

/**
 * Dirección distinta para cada contexto.
 *
 * El límite de acceso cuenta diez intentos por minuto y dirección, y la suite
 * crea decenas de cuentas seguidas: sin esto se ahoga a sí misma. La tentación
 * era subir el límite mientras corren las pruebas, pero entonces lo que se
 * prueba no es lo que se despliega — y la prueba que comprueba el límite deja
 * de poder alcanzarlo.
 *
 * Funciona porque en desarrollo `TRUST_PROXY` vale 1 y no hay proxy delante. En
 * producción vale `false` o la lista de proxis reales, y una cabecera puesta a
 * mano por el cliente no cuenta. Que este truco no funcione contra producción
 * es exactamente la propiedad que se busca.
 */
let contador = 0;
export const direccionUnica = (): string => {
  contador += 1;
  return `10.${(contador >> 16) & 255}.${(contador >> 8) & 255}.${contador & 255}`;
};

/** Contexto nuevo: sin esto, una segunda pestaña hereda la sesión de la primera. */
export async function nuevaSesion(browser: Browser): Promise<Page> {
  const contexto = await browser.newContext({
    permissions: ["microphone", "camera"],
    extraHTTPHeaders: { "X-Forwarded-For": direccionUnica() },
  });
  return contexto.newPage();
}

/** Un PNG mínimo válido, para probar subida y previsualización. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** ¿Hay almacén? Las pruebas de archivos se saltan si no. */
export async function hayAlmacen(): Promise<boolean> {
  const endpoint = process.env.E2E_S3_ENDPOINT ?? "http://localhost:9000";
  try {
    await fetch(endpoint, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}
