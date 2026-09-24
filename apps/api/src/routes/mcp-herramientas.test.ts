/**
 * Las herramientas MCP contra la API de verdad.
 *
 * QUÉ FIJA ESTO. El MCP es un traductor: pide a la API y convierte la respuesta
 * en texto para el agente. Su forma de fallar no es una excepción, es leer el
 * campo que no es —`name` donde la API manda `nombre`— y contestar «sin
 * título» o una lista vacía con toda seguridad. Eso no lo ve el compilador,
 * porque los tipos del MCP son una copia escrita a mano de lo que la API dice
 * devolver, ni la prueba del registro, que solo comprueba que se registran.
 *
 * Así que esto levanta el servidor entero, siembra un espacio por las puertas
 * del producto y llama a cada herramienta nueva por `/mcp`, igual que Claude.
 * Se comprueba lo que DICE: que el mensaje escrito sale al leer el canal, que
 * la reunión sale a su hora, que el anuncio le llega a la otra persona.
 *
 * Las escrituras se prueban leyéndolas de vuelta, no mirando que contestaron
 * «hecho»: una herramienta que dice «publicado» y no publica es la peor de
 * todas, porque el agente se lo cree y se lo cuenta a la persona.
 *
 *   npm run test:mcp-vivo --workspace apps/api
 */
import { randomBytes } from "node:crypto";

process.env["API_PORT"] = String(40000 + Math.floor(Math.random() * 20000));
process.env["API_HOST"] = "127.0.0.1";
process.env["MCP_REMOTE_ENABLED"] = "true";
process.env["LOG_LEVEL"] ??= "warn";

const { closePool } = await import("../db/pool.js");
const { signAccessToken } = await import("../auth/tokens.js");
const { env } = await import("../env.js");
await import("../server.js");

const base = `http://127.0.0.1:${env.API_PORT}`;
const marca = randomBytes(4).toString("hex");

let total = 0;
const fallos: string[] = [];
function check(nombre: string, condicion: boolean, detalle?: string): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos.push(nombre);
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle.slice(0, 600).replace(/\n/g, "\n      ")}` : ""}`);
  }
}

async function http<T>(token: string, metodo: string, camino: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${base}${camino}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${token}`,
      ...(cuerpo === undefined ? {} : { "content-type": "application/json" }),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${camino} → ${r.status}: ${texto.slice(0, 300)}`);
  return (texto ? JSON.parse(texto) : undefined) as T;
}

let id = 0;
/** Llama a una herramienta como la llama Claude, y devuelve su texto. */
async function herramienta(token: string, nombre: string, argumentos: Record<string, unknown>): Promise<string> {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: { name: nombre, arguments: argumentos },
    }),
  });
  const crudo = await r.text();
  // El transporte contesta en SSE: la respuesta es la línea «data:».
  const linea = crudo.split("\n").find((l) => l.startsWith("data:")) ?? crudo;
  const cuerpo = JSON.parse(linea.replace(/^data:\s*/, "")) as {
    result?: { content: { type: string; text?: string }[] };
    error?: { message: string };
  };
  if (cuerpo.error) return `ERROR DEL PROTOCOLO: ${cuerpo.error.message}`;
  return (cuerpo.result?.content ?? []).map((c) => c.text ?? "").join("\n");
}

async function main(): Promise<void> {
  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: process.env["DATABASE_ADMIN_URL"] });
  await admin.connect();
  await admin.query("set search_path to public");

  const registrar = async (quien: string) =>
    (
      await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
        `${quien.toLowerCase()}-mcp-${marca}@devup.test`,
        "no-se-usa-en-esta-prueba",
        `${quien} Mcp`,
      ])
    ).rows[0]!.id;

  const ana = await registrar("Ana");
  const beto = await registrar("Beto");
  const tokenAna = await signAccessToken(ana);
  const tokenBeto = await signAccessToken(beto);

  const org = `Herramientas ${marca}`;
  const espacio = `Producto ${marca}`;
  let orgId = "";

  try {
    // ── Sembrar, por las puertas del producto ────────────────────────────
    const { organization } = await http<{ organization: { id: string } }>(tokenAna, "POST", "/organizations", {
      name: org,
      slug: `herramientas-${marca}`,
    });
    orgId = organization.id;
    const { workspace } = await http<{ workspace: { id: string } }>(
      tokenAna,
      "POST",
      `/organizations/${orgId}/workspaces`,
      { name: espacio },
    );
    await http(tokenAna, "POST", `/organizations/${orgId}/members`, {
      email: `beto-mcp-${marca}@devup.test`,
    });
    await http(tokenAna, "POST", `/workspaces/${workspace.id}/channels`, { name: "sala", kind: "voice" });
    await http(tokenAna, "POST", `/workspaces/${workspace.id}/carpetas`, { nombre: `Diseño ${marca}` });
    const { client } = await http<{ client: { id: string } }>(
      tokenAna,
      "POST",
      `/organizations/${orgId}/clients`,
      { name: `Acme ${marca}` },
    );
    await http(tokenAna, "POST", `/organizations/${orgId}/opportunities`, {
      title: `Contrato ${marca}`,
      stage: "proposal",
      clientId: client.id,
    });

    const donde = { organizacion: org, espacio };

    console.log("\nCanales: escribir y leerlo de vuelta");

    const escrito = await herramienta(tokenAna, "escribir_en_canal", {
      ...donde,
      canal: "#general",
      texto: `El despliegue ${marca} ya está`,
    });
    check("escribir contesta que publicó", /Publicado en #general/.test(escrito), escrito);

    const leido = await herramienta(tokenBeto, "leer_canal", { ...donde, canal: "general" });
    check("otra persona lee el mensaje", leido.includes(`El despliegue ${marca} ya está`), leido);
    check("con el nombre de quien lo escribió", leido.includes("Ana Mcp"), leido);

    const canales = await herramienta(tokenBeto, "ver_canales", donde);
    check("ver_canales lista #general", canales.includes("#general"), canales);
    check("y cuenta lo que Beto no ha leído", /#general — \d+ sin leer/.test(canales), canales);
    check("y enseña la sala de voz, vacía", /sala — vacía/.test(canales), canales);

    const otraVez = await herramienta(tokenBeto, "ver_canales", donde);
    check(
      "leer con el agente NO marca como leído",
      /#general — \d+ sin leer/.test(otraVez),
      otraVez,
    );

    const voz = await herramienta(tokenAna, "escribir_en_canal", { ...donde, canal: "sala", texto: "hola" });
    check("escribir en una sala de voz se rechaza diciendo por qué", /sala de voz/.test(voz), voz);

    console.log("\nReuniones: la hora con su zona");

    const sinZona = await herramienta(tokenAna, "crear_reunion", {
      ...donde,
      titulo: "Sin zona",
      empieza: "2030-01-15T15:00",
      minutos: 30,
    });
    check("una hora sin zona se rechaza", /zona/.test(sinZona) && !/Convocada/.test(sinZona), sinZona);

    const convocada = await herramienta(tokenAna, "crear_reunion", {
      ...donde,
      titulo: `Revisión ${marca}`,
      empieza: "2030-01-15T15:00:00-05:00",
      minutos: 45,
    });
    check("convocar contesta con la reunión", convocada.includes(`Revisión ${marca}`), convocada);

    const agenda = await herramienta(tokenBeto, "ver_reuniones", donde);
    check("Beto la ve en su agenda", agenda.includes(`Revisión ${marca}`), agenda);
    check("con su duración", agenda.includes("45 min"), agenda);
    // Beto no tiene zona puesta: sale en UTC, y las tres de Bogotá son las 20.
    check("a la hora que se pidió, pasada a la zona de quien mira", agenda.includes("20:00"), agenda);

    console.log("\nAnuncios y avisos: le llega a la otra persona");

    const publicado = await herramienta(tokenAna, "publicar_anuncio", {
      organizacion: org,
      titulo: `Cambio de horario ${marca}`,
      texto: "Desde el lunes, a las nueve.",
    });
    check("publicar dice a cuántos avisó", /avisadas \d+ persona/.test(publicado), publicado);

    const tablon = await herramienta(tokenBeto, "ver_anuncios", { organizacion: org });
    check("sale en el tablón", tablon.includes(`Cambio de horario ${marca}`), tablon);
    check("con su texto", tablon.includes("Desde el lunes"), tablon);

    const campana = await herramienta(tokenBeto, "mis_avisos", {});
    check("y en la campana de Beto", campana.includes(`Cambio de horario ${marca}`), campana);

    console.log("\nLos tres niveles");

    await herramienta(tokenAna, "crear_area", { ...donde, nombre: `Backend ${marca}` });
    const ramas = await herramienta(tokenAna, "ver_ramas", donde);
    check("ver_ramas enseña la rama creada", ramas.includes(`Backend ${marca}`), ramas);
    check("y quién responde de ella", /responde: /.test(ramas), ramas);

    const equipo = await herramienta(tokenAna, "ver_equipo", { organizacion: org });
    check("ver_equipo tiene a las dos personas", equipo.includes("Ana Mcp") && equipo.includes("Beto Mcp"), equipo);
    check("con su permiso", /propietario/.test(equipo) && /miembro/.test(equipo), equipo);

    const casa = await herramienta(tokenAna, "ver_organizacion", { organizacion: org });
    check("ver_organizacion lista el proyecto", casa.includes(espacio), casa);
    check("y la gente", casa.includes("Beto Mcp"), casa);

    const inicio = await herramienta(tokenAna, "mi_inicio", {});
    check("mi_inicio contesta sin romperse", /Lo que tienes entre manos/.test(inicio), inicio);

    const embudo = await herramienta(tokenAna, "ver_embudo", { organizacion: org });
    check("ver_embudo pone la oportunidad en su etapa", /Propuesta — 1/.test(embudo) && embudo.includes(`Contrato ${marca}`), embudo);

    const repos = await herramienta(tokenAna, "ver_repositorios", donde);
    check("ver_repositorios sin repositorios lo dice", /no tiene repositorios/.test(repos), repos);

    const biblioteca = await herramienta(tokenAna, "ver_biblioteca", donde);
    check("ver_biblioteca enseña la carpeta en la raíz", biblioteca.includes(`Diseño ${marca}/`), biblioteca);

    const dentro = await herramienta(tokenAna, "ver_biblioteca", { ...donde, carpeta: `Diseño ${marca}` });
    check("y se puede abrir", dentro.includes(`Diseño ${marca}`) && /Vacía/.test(dentro), dentro);

    console.log("\nNinguna herramienta nueva contesta con un error de protocolo");
    const todas = [escrito, leido, canales, convocada, agenda, publicado, tablon, campana, ramas, equipo, casa, inicio, embudo, repos, biblioteca];
    check("ninguna", todas.every((t) => !t.startsWith("ERROR DEL PROTOCOLO") && !t.startsWith("No pude")), todas.find((t) => t.startsWith("ERROR") || t.startsWith("No pude")));
  } finally {
    if (orgId) await admin.query("delete from organizations where id = $1", [orgId]).catch(() => {});
    await admin.query("delete from users where id = any($1)", [[ana, beto]]).catch(() => {});
    await admin.end();
    await closePool();
  }
}

main()
  .then(() => {
    console.log(`\n${total - fallos.length} comprobaciones correctas, ${fallos.length} fallidas\n`);
    process.exit(fallos.length > 0 ? 1 : 0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
