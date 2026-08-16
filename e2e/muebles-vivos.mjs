import { chromium } from "/home/user/DevUP/node_modules/playwright/index.mjs";
const [email, password, wsId, out] = process.argv.slice(2);
const errs = [];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
p.on("pageerror", e => errs.push("pageerror: " + String(e).slice(0,180)));
p.on("console", m => { if (m.type()==="error" && !m.text().includes("401")) errs.push("console: " + m.text().slice(0,180)); });
await p.goto("http://localhost:3000/login"); await p.waitForTimeout(2000);
await p.fill('input[type="email"]', email); await p.fill('input[type="password"]', password);
await p.click('button[type="submit"]');
await p.waitForFunction(() => location.pathname.startsWith("/app"), { timeout: 20000 });
await p.goto(`http://localhost:3000/app/w/${wsId}/oficina`);
await p.locator("canvas").first().waitFor({ timeout: 20000 });
await p.waitForTimeout(3500);
// Entrar en la sala de desarrollo y acercarse a la pizarra (arriba a la derecha).
for (let i=0;i<7;i++){ await p.keyboard.down("KeyW"); await p.waitForTimeout(430); await p.keyboard.up("KeyW"); await p.waitForTimeout(90); }
await p.waitForTimeout(800);
for (let i=0;i<3;i++){ await p.keyboard.down("KeyD"); await p.waitForTimeout(300); await p.keyboard.up("KeyD"); await p.waitForTimeout(90); }
await p.waitForTimeout(1500);
const body = await p.textContent("body");
const hint = /E\s+(Ver el tablero|Abrir la biblioteca|Abrir #[^\s]+)/.exec(body||"");
console.log("aviso de interacción:", hint ? hint[0] : "(ninguno)");
await p.screenshot({ path: out + "/live-1.png" });
console.log(errs.length ? "ERRORES:\n"+errs.join("\n") : "sin errores de consola");
await b.close();
