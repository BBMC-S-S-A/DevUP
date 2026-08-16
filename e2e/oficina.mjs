import { chromium } from "/home/user/DevUP/node_modules/playwright/index.mjs";
const [email, password, wsId] = process.argv.slice(2);
const errs = [];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 760 }, permissions: ["microphone"] });
const p = await ctx.newPage();
p.on("pageerror", e => errs.push("pageerror: " + e));
p.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });

await p.goto("http://localhost:3000/login");
await p.fill('input[type="email"]', email);
await p.fill('input[type="password"]', password);
await p.click('button[type="submit"]');
await p.waitForFunction(() => location.pathname.startsWith("/app"), { timeout: 15000 });
console.log("✓ acceso");

await p.goto(`http://localhost:3000/app/w/${wsId}/oficina`);
await p.waitForSelector("canvas", { timeout: 15000 });
await p.waitForTimeout(3500);
console.log("✓ la oficina carga");

// ¿Está el socket vivo y hay presencia?
const head = await p.textContent("body");
console.log("cabecera:", /\d+ en la oficina/.exec(head || "")?.[0] ?? "(no encontrada)");

await p.screenshot({ path: process.argv[6] + "/e2e-1-entrada.png" });

// Caminar hacia el norte para entrar en la primera sala.
for (let i = 0; i < 3; i++) { await p.keyboard.down("KeyW"); await p.waitForTimeout(700); await p.keyboard.up("KeyW"); }
await p.waitForTimeout(1200);
const afterWalk = await p.textContent("body");
console.log("tras caminar:", afterWalk?.includes("Muévete") ? "sigue en pie" : "?");
await p.screenshot({ path: process.argv[6] + "/e2e-2-caminando.png" });

// Segunda pestaña: dos personas en la misma oficina.
const p2 = await ctx.newPage();
p2.on("pageerror", e => errs.push("p2 pageerror: " + e));
await p2.goto(`http://localhost:3000/app/w/${wsId}/oficina`);
await p2.waitForSelector("canvas", { timeout: 15000 });
await p2.waitForTimeout(3000);
const two = await p.textContent("body");
console.log("con dos pestañas:", /\d+ en la oficina/.exec(two || "")?.[0] ?? "(no encontrada)");
await p.screenshot({ path: process.argv[6] + "/e2e-3-dos-personas.png" });

// Editor de personaje
await p.click("text=Mi personaje");
await p.waitForTimeout(900);
await p.screenshot({ path: process.argv[6] + "/e2e-4-personaje.png" });

console.log(errs.length ? "\nERRORES:\n" + errs.join("\n") : "\nsin errores de consola");
await b.close();
