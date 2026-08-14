import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// La suite lee AUTH_RATE_LIMIT_MAX para saber cuántos intentos hacen falta para
// agotar el cupo. Tiene que ser el mismo valor con el que corre la API.
loadEnv();

/**
 * Chromium ya instalado, si lo hay.
 *
 * Los contenedores de desarrollo traen los navegadores en `PLAYWRIGHT_BROWSERS_PATH`
 * con el número de build de *su* versión de Playwright. Si el repositorio fija
 * otra, Playwright busca un build que no está y falla entero con «Executable
 * doesn't exist» — un mensaje que parece de instalación y en realidad es de
 * versiones. Aquí se acepta el que haya: para lo que prueban estas pruebas, la
 * diferencia entre dos builds de Chromium no cambia nada.
 */
function chromiumInstalado(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;

  const raiz = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!raiz || !existsSync(raiz)) return undefined;

  for (const entrada of readdirSync(raiz)) {
    // Solo el navegador completo: el «headless shell» no sirve para lo que
    // hacen las pruebas de voz, que necesitan medios falsos y permisos.
    if (!entrada.startsWith("chromium-")) continue;
    const binario = join(raiz, entrada, "chrome-linux", "chrome");
    if (existsSync(binario)) return binario;
  }
  return undefined;
}

const CHROMIUM = chromiumInstalado();

/**
 * Pruebas de extremo a extremo.
 *
 * Corren contra la aplicación de verdad: Postgres real, almacén real y los dos
 * servidores levantados. No hay dobles de prueba a propósito — casi todos los
 * fallos que aparecieron construyendo esto (el checksum del SDK de AWS, el CORS
 * del bucket, el 429 convertido en 500) eran precisamente cosas que un doble
 * habría escondido.
 *
 *   npm run dev            # en otra terminal
 *   npm run test:e2e
 */
const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  // Crea la cuenta sembradora: la instancia solo admite altas por invitación y
  // solo la primera cuenta se libra de esa regla.
  globalSetup: "./tests/e2e/global-setup.ts",
  // Las pruebas comparten una única base de datos y varias cuentan filas, así
  // que corren en serie. Aislarlas por organización permitiría paralelizar;
  // hoy no compensa la complejidad.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: WEB,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["microphone", "camera"],
        launchOptions: {
          // En entornos donde Chromium ya viene instalado (como el contenedor
          // de desarrollo) se apunta al binario existente en vez de descargar
          // otro. En CI no hay ninguno y Playwright usa el suyo.
          ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
          args: [
            // Micrófono y cámara sintéticos, y sin diálogo de permiso: sin
            // esto no se puede probar una llamada sin un humano delante.
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
            "--no-sandbox",
          ],
        },
      },
    },
  ],
});
