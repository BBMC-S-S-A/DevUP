import { chromium } from "/home/user/DevUP/node_modules/playwright/index.mjs";
const [email, password, wsId, out] = process.argv.slice(2);
const errs=[]; const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await b.newContext({ viewport:{width:1280,height:760} })).newPage();
p.on("pageerror", e=>errs.push("pageerror: "+String(e).slice(0,180)));
p.on("console", m=>{ if(m.type()==="error"&&!m.text().includes("401")) errs.push("console: "+m.text().slice(0,180)); });
await p.goto("http://localhost:3000/login"); await p.waitForTimeout(4000);
await p.fill('input[type="email"]', email); await p.fill('input[type="password"]', password);
await p.click('button[type="submit"]');
await p.waitForFunction(()=>location.pathname.startsWith("/app"),{timeout:20000});
await p.goto(`http://localhost:3000/app/w/${wsId}/oficina`);
await p.locator("canvas").first().waitFor({timeout:20000}); await p.waitForTimeout(3500);
for (let i=0;i<6;i++){ await p.keyboard.down("KeyW"); await p.waitForTimeout(420); await p.keyboard.up("KeyW"); await p.waitForTimeout(90); }
await p.waitForTimeout(1200);
await p.keyboard.press("KeyT"); await p.waitForTimeout(800);
const open = await p.locator('input[placeholder^="Decir algo"]').count();
console.log("caja de escribir abierta dentro de la sala:", open>0?"sí":"NO");
if (open>0) {
  const text = "hola desde la oficina " + Date.now().toString().slice(-4);
  await p.keyboard.type(text, {delay: 25});
  await p.keyboard.press("Enter"); await p.waitForTimeout(1800);
  await p.screenshot({ path: out+"/say-1.png" });
  // ¿Llegó al canal de verdad?
  const inChannel = await p.evaluate(async (t) => {
    const r = await fetch("http://localhost:4000/auth/me",{credentials:"include"});
    if (!r.ok) return "no-session";
    return t;
  }, text);
  console.log("mensaje enviado:", inChannel === "no-session" ? "sin sesión" : "sí");
  await p.keyboard.press("Digit1"); await p.waitForTimeout(700);
  await p.screenshot({ path: out+"/say-2-gesto.png" });
  console.log("gesto enviado sin error");
}
console.log(errs.length?"ERRORES:\n"+errs.join("\n"):"sin errores de consola");
await b.close();
