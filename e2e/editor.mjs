import { chromium } from "/home/user/DevUP/node_modules/playwright/index.mjs";
const [email, password, wsId, out] = process.argv.slice(2);
const errs = [];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 760 } });
const p = await ctx.newPage();
p.on("pageerror", e => errs.push("pageerror: " + String(e).slice(0,200)));
p.on("console", m => { if (m.type()==="error" && !m.text().includes("401")) errs.push("console: " + m.text().slice(0,200)); });

await p.goto("http://localhost:3000/login");
await p.waitForTimeout(2500);
await p.fill('input[type="email"]', email);
await p.fill('input[type="password"]', password);
await p.click('button[type="submit"]');
await p.waitForFunction(() => location.pathname.startsWith("/app"), { timeout: 15000 });
await p.goto(`http://localhost:3000/app/w/${wsId}/oficina`);
await p.locator("canvas").first().waitFor({ timeout: 15000 });
await p.waitForTimeout(3000);

// Caminar hacia el norte hasta entrar en una sala.
for (let i = 0; i < 5; i++) { await p.keyboard.down("KeyW"); await p.waitForTimeout(500); await p.keyboard.up("KeyW"); await p.waitForTimeout(120); }
await p.waitForTimeout(1200);
const inZone = await p.locator("text=Amueblar").count();
console.log("botón Amueblar visible dentro de la sala:", inZone > 0 ? "sí" : "NO");
if (inZone === 0) { console.log(errs.join("\n") || "(sin errores)"); await p.screenshot({path: out+"/ed-0.png"}); await b.close(); process.exit(0); }

await p.click("text=Amueblar");
await p.waitForTimeout(1200);
console.log("paleta abierta:", (await p.locator("text=Editando").count()) > 0 ? "sí" : "NO");
await p.screenshot({ path: out + "/ed-1-paleta.png" });

// Elegir un mueble y colocarlo en el centro del lienzo.
const items = await p.locator('button[title="poolTable"]').count();
console.log("mesa de billar en la paleta:", items > 0 ? "sí" : "NO");
if (items > 0) {
  await p.click('button[title="poolTable"]');
  await p.waitForTimeout(400);
  const box = await p.locator("canvas").first().boundingBox();
  await p.mouse.click(box.x + box.width * 0.40, box.y + box.height * 0.42);
  await p.waitForTimeout(900);
  await p.screenshot({ path: out + "/ed-2-colocado.png" });
  await p.click("text=Guardar");
  await p.waitForTimeout(2500);
  console.log("guardado, editor cerrado:", (await p.locator("text=Editando").count()) === 0 ? "sí" : "NO");
  await p.screenshot({ path: out + "/ed-3-guardado.png" });
}
console.log(errs.length ? "\nERRORES:\n" + errs.join("\n") : "\nsin errores de consola");
await b.close();
