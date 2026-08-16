const API = "http://localhost:4000";
const login = await fetch(API + "/auth/login", { method:"POST", headers:{"content-type":"application/json"},
  body: JSON.stringify({ email: process.argv[2], password: process.argv[3] }) });
const cookie = login.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
const ws = process.argv[4];
const j = async (p,o={}) => { const r = await fetch(API+p,{...o,headers:{"content-type":"application/json",cookie,...(o.headers||{})}});
  const t = await r.text(); if(!r.ok) throw new Error(p+" "+r.status+" "+t.slice(0,200)); return t?JSON.parse(t):null; };
const { columns } = await j(`/workspaces/${ws}/board`);
const titles = [["Editor de zonas",0],["Audio por proximidad",0],["Modelos nuevos",0],["Sentarse en sillas",0],
                ["Muebles vivos",1],["Pruebas e2e",1],["Migración 0010",2]];
for (const [title, col] of titles) {
  await j(`/workspaces/${ws}/tasks`, { method:"POST", body: JSON.stringify({ columnId: columns[col].id, title }) });
}
const { channels } = await j(`/workspaces/${ws}/channels`);
const dev = channels.find(c=>c.name==="desarrollo");
await j(`/channels/${dev.id}/messages`, { method:"POST", body: JSON.stringify({ body: "Probando los muebles vivos" }) });
console.log("tareas:", titles.length, "· mensaje en #desarrollo");
