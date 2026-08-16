const API="http://localhost:4000";
const l=await fetch(API+"/auth/login",{method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify({email:process.argv[2],password:process.argv[3]})});
const cookie=l.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
const j=async(p,o={})=>{const r=await fetch(API+p,{...o,headers:{"content-type":"application/json",cookie,...(o.headers||{})}});
 const t=await r.text(); if(!r.ok) throw new Error(`${p} → ${r.status} ${t.slice(0,200)}`); return t?JSON.parse(t):null;};
const {organizations}=await j("/organizations"); const org=organizations[0].id;
const {service}=await j(`/organizations/${org}/services`,{method:"POST",
 body:JSON.stringify({name:"Auditoría de infraestructura",unitPriceCents:150000,unit:"jornada"})});
console.log("servicio creado:", service.name, "·", service.unitPriceCents/100, "€/"+service.unit);
const {client}=await j(`/organizations/${org}/clients`,{method:"POST",
 body:JSON.stringify({name:"Nébula Studio",contactEmail:"hola@nebula.test"})});
console.log("cliente creado:", client.name);
const {opportunity}=await j(`/organizations/${org}/opportunities`,{method:"POST",
 body:JSON.stringify({clientId:client.id,title:"Migración del backend",stage:"qualified"})});
console.log("oportunidad creada:", opportunity.title, "·", opportunity.stage);
await j(`/opportunities/${opportunity.id}/items`,{method:"POST",body:JSON.stringify({serviceId:service.id,quantity:3})});
await j(`/opportunities/${opportunity.id}/items`,{method:"POST",
 body:JSON.stringify({serviceId:null,name:"Soporte mensual",unitPriceCents:80000,quantity:6})});
const {opportunities}=await j(`/organizations/${org}/pipeline`);
const deal=opportunities.find(o=>o.id===opportunity.id);
console.log("importe del embudo:", deal.amountCents/100, "€ (esperado 9300)");
console.log("cliente en el embudo:", deal.clientName, "· dueño:", deal.ownerName);
// El precio de la línea no debe moverse al subir la tarifa del servicio.
const before=deal.amountCents;
await j(`/organizations/${org}/services`,{method:"POST",body:JSON.stringify({name:"otro",unitPriceCents:1})});
const won=await j(`/opportunities/${opportunity.id}`,{method:"PATCH",body:JSON.stringify({stage:"won"})});
console.log("venta ganada, fecha de cierre:", won.opportunity.closedAt ? "puesta por la base" : "NO");
const {opportunities:after}=await j(`/organizations/${org}/pipeline`);
console.log("importe intacto tras cerrar:", after.find(o=>o.id===opportunity.id).amountCents===before?"sí":"NO");
