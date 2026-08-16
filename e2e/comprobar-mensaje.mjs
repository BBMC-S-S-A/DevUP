const API="http://localhost:4000";
const l=await fetch(API+"/auth/login",{method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify({email:process.argv[2],password:process.argv[3]})});
const cookie=l.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
const {channels}=await (await fetch(`${API}/workspaces/${process.argv[4]}/channels`,{headers:{cookie}})).json();
const dev=channels.find(c=>c.name==="desarrollo");
const {messages}=await (await fetch(`${API}/channels/${dev.id}/messages`,{headers:{cookie}})).json();
const last=messages[messages.length-1] ?? messages[0];
console.log("último mensaje del canal #desarrollo:", JSON.stringify(last?.body));
console.log("¿viene del mundo?:", /hola desde la oficina/.test(last?.body ?? "") ? "SÍ — quedó en el canal" : "no");
