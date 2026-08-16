const API="http://localhost:4000";
const l=await fetch(API+"/auth/login",{method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify({email:process.argv[2],password:process.argv[3]})});
const cookie=l.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
const look={body:1,hair:3,top:0,bottom:0,skinTone:4,hairTone:2,topTone:1,bottomTone:9,
            hat:3,glasses:1,beard:2,shoes:2,hatTone:5,shoesTone:11};
const r=await fetch(API+"/world/avatar",{method:"PUT",headers:{"content-type":"application/json",cookie},body:JSON.stringify(look)});
console.log("PUT avatar:", r.status);
const {avatars}=await (await fetch(API+"/world/avatars",{headers:{cookie}})).json();
const mine=avatars[0];
const ok=["hat","glasses","beard","shoes","hatTone","shoesTone"].every(k=>mine[k]===look[k]);
console.log("capas guardadas y devueltas:", ok ? "sí" : "NO", JSON.stringify({hat:mine.hat,glasses:mine.glasses,beard:mine.beard,shoes:mine.shoes,hatTone:mine.hatTone,shoesTone:mine.shoesTone}));
// Un cliente viejo, sin las capas nuevas: no debe romperse.
const old=await fetch(API+"/world/avatar",{method:"PUT",headers:{"content-type":"application/json",cookie},
 body:JSON.stringify({body:0,hair:0,top:0,bottom:0,skinTone:1,hairTone:1,topTone:1,bottomTone:1})});
console.log("PUT sin las capas nuevas (cliente viejo):", old.status);
