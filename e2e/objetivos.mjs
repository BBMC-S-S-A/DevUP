const API="http://localhost:4000";
const l=await fetch(API+"/auth/login",{method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify({email:process.argv[2],password:process.argv[3]})});
const cookie=l.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
const j=async(p,o={})=>{const r=await fetch(API+p,{...o,headers:{"content-type":"application/json",cookie,...(o.headers||{})}});
 const t=await r.text(); if(!r.ok) throw new Error(`${p} → ${r.status} ${t.slice(0,200)}`); return t?JSON.parse(t):null;};
const {organizations}=await j("/organizations"); const org=organizations[0].id;
const now=new Date(), q=Math.floor(now.getMonth()/3);
const startsOn=new Date(Date.UTC(now.getFullYear(),q*3,1)).toISOString().slice(0,10);
const endsOn=new Date(Date.UTC(now.getFullYear(),q*3+3,0)).toISOString().slice(0,10);
await j(`/organizations/${org}/goals`,{method:"POST",body:JSON.stringify({name:"Trimestre en curso",targetCents:5000000,startsOn,endsOn})});
const before=(await j(`/organizations/${org}/goals`)).goals[0];
console.log("objetivo creado:", before.name, "· meta", before.targetCents/100, "€ · avance", before.progressCents/100, "€");
// Una venta NUEVA, abierta, con su línea. Reutilizar una ya ganada no prueba
// nada: el objetivo ya la estaba contando.
const {clients}=await j(`/organizations/${org}/clients`);
const {services}=await j(`/organizations/${org}/services`);
const svc=services.find(s=>s.unitPriceCents>1000);
const {opportunity}=await j(`/organizations/${org}/opportunities`,{method:"POST",
 body:JSON.stringify({clientId:clients[0].id,title:"Rediseño del panel",stage:"proposal"})});
await j(`/opportunities/${opportunity.id}/items`,{method:"POST",body:JSON.stringify({serviceId:svc.id,quantity:2})});
const {opportunities}=await j(`/organizations/${org}/pipeline`);
const open=opportunities.find(o=>o.id===opportunity.id);
await j(`/opportunities/${open.id}`,{method:"PATCH",body:JSON.stringify({stage:"won"})});
const after=(await j(`/organizations/${org}/goals`)).goals[0];
console.log("tras ganar «"+open.title+"» ("+open.amountCents/100+" €):");
console.log("  avance:", after.progressCents/100, "€ ·", after.dealCount, "venta(s) ·", Math.round(after.progressCents/after.targetCents*100)+"%");
console.log("  ¿avanzó solo?:", after.progressCents > before.progressCents ? "SÍ" : "no");
await j(`/opportunities/${open.id}`,{method:"PATCH",body:JSON.stringify({stage:"proposal"})});
const reopened=(await j(`/organizations/${org}/goals`)).goals[0];
console.log("  al reabrirla vuelve atrás:", reopened.progressCents === before.progressCents ? "sí" : "NO");
await j(`/opportunities/${open.id}`,{method:"PATCH",body:JSON.stringify({stage:"won"})});
