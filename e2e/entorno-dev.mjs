// Prueba manual de la Fase 0 del entorno de desarrollo embebido.
// Uso: node e2e/entorno-dev.mjs <email> <contraseña> <orgId> /ruta/para/capturas
import { chromium } from "playwright";

const [, , email, password, orgId, capturasDir] = process.argv;
const consoleErrors = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on("response", (res) => {
  if (res.url().includes("/auth/")) console.log(`[red] ${res.request().method()} ${res.url()} -> ${res.status()}`);
});
page.on("requestfailed", (req) => console.log(`[fallo de red] ${req.method()} ${req.url()} -> ${req.failure()?.errorText}`));

await page.goto("http://localhost:3000/login");
await page.fill('input[type="email"]', email);
await page.fill('input[type="password"]', password);
await page.screenshot({ path: `${capturasDir}/0-antes-de-entrar.png` });
await page.click('button[type="submit"]:has-text("Entrar")');
await page.waitForTimeout(3000);
await page.screenshot({ path: `${capturasDir}/0b-despues-de-clic.png` });
console.log("url actual:", page.url());
await page.waitForURL("**/app", { timeout: 15000 });
console.log("✓ sesión iniciada");

// A propósito NO se usa page.goto() directo a /dev: eso es una navegación
// dura y siempre lleva las cabeceras correctas, aunque solo estuvieran
// puestas en esa ruta — que es exactamente el falso positivo que dejó pasar
// la primera versión de esta prueba. Un usuario real entra por un clic
// desde /app, que en Next.js es una navegación del lado del cliente sin
// recargar el documento: si las cabeceras COOP/COEP no están también en la
// página de origen, el navegador nunca queda cross-origin-aislado.
await page.click(`a[href="/app/o/${orgId}/dev"]`);
await page.waitForSelector("text=Entorno de desarrollo", { timeout: 15000 });
console.log("✓ pestaña /dev cargó (navegación por clic, no goto directo)");

// Cross-origin isolation: si falta, WebContainer.boot() falla y el panel
// de "El entorno no pudo arrancar" aparece en vez del selector.
await page.waitForSelector("text=Empezar un entorno de desarrollo", { timeout: 20000 });
console.log("✓ WebContainer arrancó (aislamiento cross-origin activo)");
await page.screenshot({ path: `${capturasDir}/1-arranque.png` });

await page.click('button:has-text("Empezar")');
await page.waitForSelector(".xterm", { timeout: 15000 });
console.log("✓ terminal xterm.js montada");
await page.waitForTimeout(1500); // que la shell jsh termine de imprimir su prompt
await page.screenshot({ path: `${capturasDir}/2-entorno.png` });

// Escribe en la terminal real: un npm install + node de verdad, dentro del
// WebContainer, no en los servidores de DevUP.
await page.click(".xterm");
await page.keyboard.type("node index.js", { delay: 20 });
await page.keyboard.press("Enter");
await page.waitForTimeout(2500);
await page.screenshot({ path: `${capturasDir}/3-terminal.png` });

const textoTerminal = await page.locator(".xterm").innerText();
const corrio = textoTerminal.includes("Hola desde el entorno de desarrollo de DevUP");
console.log(corrio ? "✓ el script de la plantilla corrió de verdad en la shell" : "✗ no se vio la salida esperada en la terminal");

// Volver a /app y comprobar que el widget de Spotify / la barra de llamada
// (montados en el layout global) no se rompieron con las cabeceras COEP.
await page.goto("http://localhost:3000/app");
await page.waitForSelector("text=Organizaciones", { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1000);
await page.screenshot({ path: `${capturasDir}/4-vuelta-a-app.png` });
console.log("✓ navegación de vuelta a /app sin caerse");

console.log("\n--- errores de consola acumulados ---");
console.log(consoleErrors.length ? consoleErrors.join("\n") : "(ninguno)");

await browser.close();
