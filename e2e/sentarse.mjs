import { chromium } from "/home/user/DevUP/node_modules/playwright/index.mjs";
const [email, password, wsId, out] = process.argv.slice(2);
const errs = [];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
p.on("pageerror", e => errs.push("pageerror: " + String(e).slice(0,180)));
p.on("console", m => { if (m.type()==="error" && !m.text().includes("401")) errs.push("console: " + m.text().slice(0,180)); });
await p.goto("http://localhost:3000/login"); await p.waitForTimeout(4000);
await p.fill('input[type="email"]', email); await p.fill('input[type="password"]', password);
await p.click('button[type="submit"]');
await p.waitForFunction(() => location.pathname.startsWith("/app"), { timeout: 20000 });
await p.goto(`http://localhost:3000/app/w/${wsId}/oficina`);
await p.locator("canvas").first().waitFor({ timeout: 20000 });
await p.waitForTimeout(3500);
const hint = async () => ((await p.textContent("body"))||"").match(/E\s+(Sentarse|Levantarse|Ver el tablero|Abrir la biblioteca|Abrir #\S+)/)?.[0] ?? "(ninguno)";
// Entrar en la sala y buscar una silla (están frente a los escritorios).
for (let i=0;i<6;i++){ await p.keyboard.down("KeyW"); await p.waitForTimeout(420); await p.keyboard.up("KeyW"); await p.waitForTimeout(90); }
await p.waitForTimeout(900);
await p.keyboard.down("KeyS"); await p.waitForTimeout(230); await p.keyboard.up("KeyS"); await p.waitForTimeout(400);
let found = "(ninguno)";
for (let step=0; step<12 && !found.includes("Sentarse"); step++) {
  await p.keyboard.down("KeyD"); await p.waitForTimeout(200); await p.keyboard.up("KeyD"); await p.waitForTimeout(350);
  found = await hint();
}
console.log("aviso encontrado:", found);
if (found.includes("Sentarse")) {
  await p.keyboard.press("KeyE"); await p.waitForTimeout(1200);
  console.log("tras pulsar E:", await hint());
  await p.screenshot({ path: out + "/sit-1.png" });
  await p.keyboard.press("KeyE"); await p.waitForTimeout(900);
  console.log("tras levantarse:", await hint());
} else { await p.screenshot({ path: out + "/sit-0.png" }); }
console.log(errs.length ? "ERRORES:\n"+errs.join("\n") : "sin errores de consola");
await b.close();
