const API = "http://localhost:4000";
const j = async (path, opts = {}) => {
  const r = await fetch(API + path, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) throw new Error(`${path} → ${r.status} ${text.slice(0,300)}`);
  return { body, cookies: r.headers.getSetCookie?.() ?? [] };
};
const stamp = Date.now();
const reg = async (name) => {
  const email = `${name}${stamp}@devup.test`;
  const r = await j("/auth/register", { method: "POST", body: JSON.stringify({ email, password: "ContraseñaLarga123", displayName: name }) });
  return { email, cookie: r.cookies.map(c => c.split(";")[0]).join("; ") };
};
const ana = await reg("ana");
const auth = (c) => ({ cookie: c });
const org = (await j("/organizations", { method: "POST", headers: auth(ana.cookie), body: JSON.stringify({ name: "Acme", slug: `acme-${stamp}` }) })).body.organization;
const ws = (await j(`/organizations/${org.id}/workspaces`, { method: "POST", headers: auth(ana.cookie), body: JSON.stringify({ name: "Producto" }) })).body.workspace;
for (const [name, kind] of [["desarrollo","voice"],["música","voice"],["videojuegos","voice"],["general","text"],["reunión","voice"]]) {
  await j(`/workspaces/${ws.id}/channels`, { method: "POST", headers: auth(ana.cookie), body: JSON.stringify({ name, kind, isPrivate: false }) });
}
console.log(JSON.stringify({ email: ana.email, password: "ContraseñaLarga123", workspaceId: ws.id, orgId: org.id }));
