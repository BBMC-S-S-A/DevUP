/**
 * Ninguna credencial sale por la API ni por el MCP (SEG-10).
 *
 * QUÉ FIJA ESTO. Hoy está bien: los tokens viven cifrados en
 * `connection_secrets`, ninguna ruta selecciona `encrypted_secret`, y
 * `getDecryptedSecret` solo lo usan los conectores para hablar con fuera. Lo
 * que faltaba es que eso no se pudiera romper sin que nadie lo notara. El día
 * que alguien añada `*` a un `select`, devuelva el cuerpo de la petición tal
 * cual o meta el mensaje de un error que lleve la cadena de conexión dentro,
 * esto se pone en rojo en vez de enterarse un cliente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CÓMO: CANARIOS, NO SOLO FORMAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Se siembra un secreto inventado y reconocible en cada sitio donde hay uno de
 * verdad —la bóveda de cada proveedor, y las variables del servidor— y después
 * se busca ese texto exacto en TODAS las respuestas. Buscar solo por forma
 * («algo que parezca un token») deja pasar los secretos que no tienen forma de
 * nada, como la contraseña de una base; un canario no se confunde con nada.
 * Las formas se buscan además, para lo que se cuele sin haberlo sembrado.
 *
 * LOS CANARIOS VAN EN LA POSICIÓN DEL SECRETO, NO EN LA DEL USUARIO. Se probó
 * a mano el 24-sep: Postgres devuelve en sus errores el nombre del rol y el de
 * la base («role "x" does not exist»), pero nunca la contraseña. Poner el
 * canario en el usuario daría una alarma por algo que no es un secreto, y una
 * prueba que da alarmas falsas se acaba desactivando.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SE SIEMBRA POR LAS PUERTAS DEL PRODUCTO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Las conexiones se crean con el `POST` de verdad, no con un `insert` a mano.
 * Así se comprueba también la respuesta de crear —el sitio clásico donde se
 * devuelve el cuerpo recibido, secreto incluido— y se prueba el producto que
 * existe y no otro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE SE RECORRE SOLO, Y LO QUE OBLIGA A DECIDIR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Las rutas `GET` de conexiones, infraestructura, base de datos y arquitectura
 * se leen DEL PROPIO CÓDIGO, así que una ruta nueva en esos archivos entra sola
 * en la prueba. Si trae un parámetro que esto no sabe rellenar, falla diciendo
 * cuál: saltársela en silencio sería exactamente el hueco que esto cierra.
 *
 * Las herramientas MCP se piden al servidor (`tools/list`). Cada una tiene que
 * estar en `LEER` o en `ESCRIBIR` de abajo; una que no esté en ninguna rompe la
 * prueba. Las de leer se llaman todas. Las de escribir no, porque cambian el
 * tablero — pero hay que haber decidido que son de escribir.
 *
 * LA EXCEPCIÓN, Y SE COMPRUEBA QUE SIGA SIENDO UNA. Alojar una base devuelve su
 * cadena de conexión UNA vez, a quien la crea (decisión escrita en
 * `routes/basedatos.ts`). Se comprueba que sale en esa respuesta y en ninguna
 * de después.
 *
 *   npm run test:fugas --workspace apps/api
 */
import { randomBytes } from "node:crypto";

// ── Los canarios del servidor, ANTES de importar nada ────────────────────────
//
// `env.ts` se valida al importarse y `dotenv` no pisa lo que ya existe, así que
// esto tiene que ir antes del primer `import` que llegue a él. Por eso todo lo
// demás se importa dinámicamente más abajo.

const marca = randomBytes(5).toString("hex");
/** Un canario: alfanumérico, para que JSON no lo escape y se busque literal. */
const canario = (que: string) => `CANARIO${que}${marca}`;

const DEL_SERVIDOR: Record<string, string> = {
  AUTH_SECRET: canario("authsecretopara16"),
  VAULT_MASTER_KEY: randomBytes(32).toString("base64"),
  GOOGLE_CLIENT_SECRET: canario("google"),
  GITHUB_OAUTH_CLIENT_SECRET: canario("githuboauth"),
  SPOTIFY_CLIENT_SECRET: canario("spotify"),
  METERED_API_KEY: canario("metered"),
  MAIL_API_KEY: canario("correo"),
  TURN_SECRET: canario("turn"),
  YOUTUBE_API_KEY: canario("youtube"),
  S3_SECRET_ACCESS_KEY: canario("s3"),
};
for (const [nombre, valor] of Object.entries(DEL_SERVIDOR)) process.env[nombre] = valor;

process.env["API_PORT"] = String(40000 + Math.floor(Math.random() * 20000));
process.env["API_HOST"] = "127.0.0.1";
process.env["MCP_REMOTE_ENABLED"] = "true";
// Cuarenta peticiones registradas taparían la única línea que importa.
process.env["LOG_LEVEL"] ??= "warn";

const { config: cargarEnv } = await import("dotenv");
const { dirname, join, resolve } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { readFileSync } = await import("node:fs");
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
cargarEnv({ path: join(raiz, ".env") });

/** La contraseña de una cadena `postgres://`, si la lleva. */
function contrasenaDe(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const clave = decodeURIComponent(u.password);
    // Una contraseña que es su propio usuario, o una palabra corriente, no
    // sirve de canario: en CI la base es postgres:postgres, y «postgres» sale
    // legítimamente en cada listado de conexiones —es el nombre de un
    // proveedor—. Buscarla daba una fuga en cada respuesta que no lo era.
    const corriente = ["postgres", "password", "secret", "devup"];
    if (clave === decodeURIComponent(u.username) || corriente.includes(clave.toLowerCase())) return null;
    return clave.length >= 6 ? clave : null;
  } catch {
    return null;
  }
}

// Las que no se pueden inventar porque el servidor las necesita para hablar con
// su base: se busca su valor de verdad, que es exactamente lo que no debe salir.
const deVerdad = [
  contrasenaDe(process.env["DATABASE_URL"]),
  contrasenaDe(process.env["DATABASE_ADMIN_URL"]),
  process.env["APP_DB_PASSWORD"] && process.env["APP_DB_PASSWORD"].length >= 6
    ? process.env["APP_DB_PASSWORD"]
    : null,
].filter((v): v is string => Boolean(v));

// ── De aquí en adelante ya se puede importar ─────────────────────────────────

const { closePool, withUser } = await import("../db/pool.js");
const { signAccessToken } = await import("../auth/tokens.js");
const { env } = await import("../env.js");
await import("../server.js");

const base = `http://127.0.0.1:${env.API_PORT}`;

let total = 0;
const fallos: string[] = [];

function check(nombre: string, condicion: boolean, detalle?: string): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos.push(nombre);
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

// ── Qué cuenta como fuga ─────────────────────────────────────────────────────

/** Los de la bóveda. Se rellenan al sembrar. */
const DE_LA_BOVEDA: Record<string, string> = {};

/**
 * Formas de credencial, para lo que se cuele sin haberse sembrado.
 *
 * Cortas a propósito: una forma demasiado general («cualquier cosa larga en
 * base64») salta con los identificadores y los hashes de commit, y entonces
 * alguien la afloja hasta que ya no ve nada.
 */
const FORMAS: [string, RegExp][] = [
  ["cadena postgres con contraseña", /postgres(?:ql)?:\/\/[^\s:@/"]+:[^\s@/"]+@/i],
  ["token de GitHub", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ["clave de Anthropic", /\bsk-ant-[A-Za-z0-9_-]{10,}/],
  ["clave de AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["clave privada", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

/** Lo que se permite ver una vez, y solo en su sitio. */
const permitidoEn = new Map<string, string>();

type Fuga = { donde: string; que: string };

function fugasEn(donde: string, cuerpo: string): Fuga[] {
  const halladas: Fuga[] = [];
  const buscar = (que: string, valor: string) => {
    if (!valor || !cuerpo.includes(valor)) return;
    if (permitidoEn.get(valor) === donde) return;
    halladas.push({ donde, que });
  };
  for (const [nombre, valor] of Object.entries(DEL_SERVIDOR)) buscar(`variable ${nombre}`, valor);
  for (const valor of deVerdad) buscar("contraseña de la base del servidor", valor);
  for (const [nombre, valor] of Object.entries(DE_LA_BOVEDA)) buscar(`secreto de ${nombre}`, valor);
  for (const [nombre, forma] of FORMAS) {
    const hallado = cuerpo.match(forma)?.[0];
    if (hallado && permitidoEn.get(hallado) !== donde) {
      // Lo permitido se registra entero; la forma solo casa el principio.
      const esPermitido = [...permitidoEn.entries()].some(
        ([valor, sitio]) => sitio === donde && valor.startsWith(hallado),
      );
      if (!esPermitido) halladas.push({ donde, que: nombre });
    }
  }
  return halladas;
}

const todas: Fuga[] = [];
let respuestas = 0;

async function pedir(
  metodo: string,
  camino: string,
  token: string,
  cuerpo?: unknown,
  cabeceras: Record<string, string> = {},
): Promise<{ status: number; texto: string }> {
  const respuesta = await fetch(`${base}${camino}`, {
    method: metodo,
    redirect: "manual",
    headers: {
      authorization: `Bearer ${token}`,
      ...(cuerpo === undefined ? {} : { "content-type": "application/json" }),
      ...cabeceras,
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(30_000),
  });
  // Las cabeceras también: una redirección con el token en la URL es una fuga
  // igual de buena que un cuerpo.
  const texto =
    [...respuesta.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n") +
    "\n\n" +
    (await respuesta.text());
  respuestas += 1;
  todas.push(...fugasEn(`${metodo} ${camino}`, texto));
  return { status: respuesta.status, texto };
}

const json = <T>(texto: string): T => JSON.parse(texto.slice(texto.indexOf("\n\n") + 2)) as T;

// ── Las rutas que se recorren solas ──────────────────────────────────────────

const ARCHIVOS = ["connections.ts", "infraestructura.ts", "basedatos.ts", "arquitectura.ts"];

function rutasGet(): string[] {
  const rutas = new Set<string>();
  for (const archivo of ARCHIVOS) {
    const codigo = readFileSync(join(raiz, "apps/api/src/routes", archivo), "utf8");
    for (const m of codigo.matchAll(/app\.get\(\s*"([^"]+)"/g)) rutas.add(m[1]!);
  }
  return [...rutas];
}

// ── Las herramientas MCP, clasificadas a mano ────────────────────────────────

/**
 * Las que se llaman todas. `sincronizar_entornos` va aquí aunque escriba en el
 * registro de un entorno: es la que usa el token de Railway o de GitHub y guarda
 * el error que conteste el proveedor, que es justo donde una fuga se quedaría
 * guardada para siempre. No llamarla sería probar lo que no importa.
 */
const LEER: Record<string, (o: string, e: string) => Record<string, unknown>> = {
  buscar: () => ({ texto: "canario" }),
  mis_tareas: (o, e) => ({ organizacion: o, espacio: e, con_imagenes: false }),
  ver_tablero: (o, e) => ({ organizacion: o, espacio: e }),
  ver_tarea: (o) => ({ organizacion: o, tarea: "una que no existe" }),
  ver_arquitectura: (o, e) => ({ organizacion: o, espacio: e }),
  que_ha_pasado: (o, e) => ({ organizacion: o, espacio: e }),
  diario: (o, e) => ({ organizacion: o, espacio: e }),
  puntos: (o) => ({ organizacion: o }),
  contexto_de_tarea: (o) => ({ organizacion: o, tarea: "una que no existe" }),
  ver_entornos: (o, e) => ({ organizacion: o, espacio: e }),
  sincronizar_entornos: (o, e) => ({ organizacion: o, espacio: e }),
  mi_inicio: () => ({}),
  ver_organizacion: (o) => ({ organizacion: o }),
  ver_equipo: (o) => ({ organizacion: o }),
  ver_ramas: (o, e) => ({ organizacion: o, espacio: e }),
  ver_repositorios: (o, e) => ({ organizacion: o, espacio: e }),
  ver_embudo: (o) => ({ organizacion: o }),
  ver_canales: (o, e) => ({ organizacion: o, espacio: e }),
  leer_canal: (o, e) => ({ organizacion: o, espacio: e, canal: "general" }),
  ver_reuniones: (o, e) => ({ organizacion: o, espacio: e, incluir_pasadas: true }),
  ver_anuncios: (o) => ({ organizacion: o }),
  mis_avisos: () => ({ todos: true }),
  ver_biblioteca: (o, e) => ({ organizacion: o, espacio: e }),
  descargar_archivo: (o, e) => ({ organizacion: o, espacio: e, archivo: "uno que no existe" }),
};

/** Cambian el tablero o la biblioteca. Se clasifican; no se llaman. */
const ESCRIBIR = new Set([
  "estoy_haciendo",
  "crear_tarea",
  "crear_columna",
  "crear_area",
  "enlazar_rama",
  "marcar_hecha",
  "mover_tarea",
  "actualizar_tarea",
  "dibujar_arquitectura",
  "crear_entorno",
  "subir_archivos",
  "borrar_archivo",
  "escribir_en_canal",
  "crear_reunion",
  "publicar_anuncio",
  "comentar_tarea",
]);

async function mcp(token: string, id: number, method: string, params: unknown) {
  return pedir(
    "POST",
    "/mcp",
    token,
    { jsonrpc: "2.0", id, method, params },
    { accept: "application/json, text/event-stream" },
  );
}

// ── La prueba ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: process.env["DATABASE_ADMIN_URL"] });
  await admin.connect();
  await admin.query("set search_path to public");

  const ana = (
    await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
      `ana-fugas-${marca}@devup.test`,
      "no-se-usa-en-esta-prueba",
      "Ana Fugas",
    ])
  ).rows[0]!.id;
  const token = await signAccessToken(ana);

  const nombreOrg = `Fugas ${marca}`;
  const nombreEspacio = `Producto ${marca}`;
  const { orgId, ws } = await withUser(ana, async (db) => {
    const org = (
      await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
        nombreOrg,
        `fugas-${marca}`,
      ])
    ).rows[0]!.id;
    const { rows } = await db.query<{ id: string }>(
      "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
      [org, nombreEspacio, ana],
    );
    return { orgId: org, ws: rows[0]!.id };
  });

  let alojada = false;
  try {
    console.log("\nSembrar la bóveda por sus puertas, sin que crear devuelva el secreto");

    const sembrar = async (camino: string, provider: string, secret: string) => {
      DE_LA_BOVEDA[`${provider} (${camino.split("/")[1]})`] = secret;
      const r = await pedir("POST", camino, token, { provider, displayName: provider, secret });
      check(`crear ${provider} en ${camino.split("/")[1]} contesta 201`, r.status === 201, r.texto);
      return r.status === 201
        ? json<{ connection: { id: string } }>(r.texto).connection.id
        : null;
    };

    // Veinte alfanuméricos detrás del prefijo, para que además case la forma.
    const github = await sembrar(`/workspaces/${ws}/connections`, "github", `ghp_${canario("gh")}`);
    const railway = await sembrar(`/workspaces/${ws}/connections`, "railway", canario("railway"));
    // Puerto 1: rechaza al momento, así que el error se ve sin esperar ocho
    // segundos a que caduque un intento contra una máquina que no existe.
    await sembrar(
      `/workspaces/${ws}/connections`,
      "postgres",
      `postgres://postgres:${canario("pg")}@127.0.0.1:1/nada`,
    );
    await sembrar(`/workspaces/${ws}/connections`, "aws", canario("aws"));
    await sembrar(`/organizations/${orgId}/connections`, "github", `ghp_${canario("ghorg")}`);
    await sembrar("/connections", "anthropic", `sk-ant-${canario("ia")}`);
    await sembrar("/connections", "gemini", canario("gemini"));
    await sembrar("/connections", "spotify", canario("spotifyusuario"));

    console.log("\nUn entorno que pregunta al proveedor, y guarda lo que conteste");

    const creado = await pedir("POST", `/workspaces/${ws}/environments`, token, {
      name: "producción",
      connectionId: github,
      externalId: `acme-${marca}/web:production`,
    });
    const envId =
      creado.status === 201 ? json<{ environment: { id: string } }>(creado.texto).environment.id : null;
    check("el entorno se crea", Boolean(envId), creado.texto.slice(0, 300));

    if (envId) {
      // Ids de Railway: no son secretos (0063), y así `deploy` llega a llamar
      // al proveedor con el token en vez de pararse antes.
      await pedir("PATCH", `/environments/${envId}`, token, {
        connectionId: railway,
        providerConfig: {
          railway: { projectId: "p-falso", serviceId: "s-falso", environmentId: "e-falso" },
        },
      });
      // Contra GitHub y Railway de verdad, que aquí no contestan o dicen que no.
      // El error que quede guardado es lo que se lee después en el listado.
      await pedir("POST", `/environments/${envId}/sync`, token, {});
      await pedir("POST", `/environments/${envId}/deploy`, token, {});
      await pedir("POST", `/environments/${envId}/migrate`, token, {});
    }

    console.log("\nLa consola SQL contra una base que no contesta");
    await pedir("POST", `/workspaces/${ws}/database/query`, token, { sql: "select 1" });

    console.log("\nLa excepción: la cadena de una base alojada sale una vez");
    const alojar = await pedir("POST", `/workspaces/${ws}/database/alojar`, token, {});
    if (alojar.status === 200) {
      alojada = true;
      const { connectionString } = json<{ connectionString: string }>(alojar.texto);
      // Se permite en esta respuesta y en ninguna otra. Se retira la fuga que
      // `pedir` ya anotó —se anotó antes de saber cuál era la cadena— y desde
      // aquí la cadena es un canario más.
      permitidoEn.set(connectionString, `POST /workspaces/${ws}/database/alojar`);
      for (let i = todas.length - 1; i >= 0; i--) {
        if (todas[i]!.donde === `POST /workspaces/${ws}/database/alojar`) todas.splice(i, 1);
      }
      todas.push(...fugasEn(`POST /workspaces/${ws}/database/alojar`, alojar.texto));
      DE_LA_BOVEDA["base alojada"] = connectionString;
      check("alojar devuelve la cadena a quien la crea", connectionString.startsWith("postgres"));
    } else {
      // No es un fallo de esta prueba: alojar pide que el rol de la API pueda
      // crear bases (grants.sql), y hay instalaciones donde no. Se dice, en vez
      // de callarlo, porque entonces esta parte no ha comprobado nada.
      console.log(`  · no se pudo alojar aquí (${alojar.status}); la excepción no se comprueba`);
    }

    console.log("\nTodas las rutas de leer de esos cuatro archivos");

    const valores: Record<string, string | null> = {
      workspaceId: ws,
      orgId,
      envId,
      connectionId: github,
      nodeId: null,
    };
    const rutas = rutasGet();
    check(`se encuentran rutas que recorrer (${rutas.length})`, rutas.length >= 10);
    for (const ruta of rutas) {
      const parametros = [...ruta.matchAll(/:(\w+)/g)].map((m) => m[1]!);
      const sinValor = parametros.filter((p) => !(p in valores));
      if (sinValor.length > 0) {
        check(
          `${ruta}: la prueba sabe rellenar sus parámetros`,
          false,
          `falta un valor para ${sinValor.join(", ")} en «valores» — añádelo en vez de saltarla`,
        );
        continue;
      }
      if (parametros.some((p) => valores[p] === null)) continue;
      const camino = ruta.replace(/:(\w+)/g, (_, p: string) => valores[p]!);
      await pedir("GET", camino, token);
    }
    // Y la comprobación de salud dos veces: la primera llama a los
    // proveedores, la segunda vuelve a leer lo que haya quedado.
    await pedir("GET", `/workspaces/${ws}/connections/health`, token);

    console.log("\nLas herramientas MCP");

    const lista = await mcp(token, 1, "tools/list", {});
    const nombres = [...lista.texto.matchAll(/"name":"([a-z_]+)"/g)].map((m) => m[1]!);
    check(`el MCP contesta con sus herramientas (${nombres.length})`, nombres.length > 0, lista.texto.slice(0, 400));

    const sinClasificar = nombres.filter((n) => !(n in LEER) && !ESCRIBIR.has(n));
    check(
      "cada herramienta está clasificada como de leer o de escribir",
      sinClasificar.length === 0,
      `sin clasificar: ${sinClasificar.join(", ")} — ponla en LEER (y se llamará) o en ESCRIBIR`,
    );
    const desaparecidas = [...Object.keys(LEER), ...ESCRIBIR].filter((n) => !nombres.includes(n));
    check(
      "ninguna de la lista ha desaparecido del servidor",
      desaparecidas.length === 0 || nombres.length === 0,
      `ya no existen: ${desaparecidas.join(", ")} — quítalas de la lista`,
    );

    let id = 2;
    for (const [nombre, argumentos] of Object.entries(LEER)) {
      if (!nombres.includes(nombre)) continue;
      await mcp(token, id++, "tools/call", {
        name: nombre,
        arguments: argumentos(nombreOrg, nombreEspacio),
      });
    }

    console.log("\nEl veredicto");

    check(`se miraron respuestas de verdad (${respuestas})`, respuestas >= 25);
    check(
      "ninguna respuesta lleva una credencial",
      todas.length === 0,
      todas
        .slice(0, 12)
        .map((f) => `${f.que} en ${f.donde}`)
        .join("\n      "),
    );
  } finally {
    if (alojada) await pedir("DELETE", `/workspaces/${ws}/database/alojada`, token).catch(() => {});
    await admin.query("delete from organizations where id = $1", [orgId]).catch(() => {});
    await admin.query("delete from connections where user_id = $1", [ana]).catch(() => {});
    await admin.query("delete from users where id = $1", [ana]).catch(() => {});
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
