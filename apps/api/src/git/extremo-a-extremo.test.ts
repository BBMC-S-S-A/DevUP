/**
 * Clonar y empujar DE VERDAD contra DevUP.
 *
 * ESTA ES LA PRUEBA QUE JUSTIFICA LA DECISIÓN. `almacen.test.ts` comprueba las
 * piezas —los nombres, las rutas, el formato pkt-line— pero ninguna pieza dice
 * si el programa `git` de fuera se entiende con este servidor. Y esa es toda la
 * apuesta de 0068: no era un simulacro. Sin esto, la única forma de saberlo era
 * que alguien lo probara a mano y se acordara de volver a probarlo.
 *
 * LO QUE HACE ES LO QUE HARÍA UNA PERSONA: clona por HTTP con su contraseña de
 * git, hace un commit, empuja, y vuelve a clonar desde cero para ver si lo que
 * empujó está ahí. Si el protocolo se rompe —una cabecera que falta, un cuerpo
 * que alguien leyó antes de tiempo, el gzip sin deshacer— git falla con
 * mensajes que no dicen nada («invalid server response», «early EOF»), así que
 * lo que importa aquí no es el mensaje: es que las cuatro órdenes terminen bien.
 *
 * NECESITA POSTGRES Y EL PROGRAMA `git`, como `test:rls`. La autorización la
 * decide RLS, así que no hay forma honesta de probar esto sin la base.
 *
 *   npm run test:git:e2e
 */
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Las carpetas ANTES de importar nada, porque `env.ts` se lee una sola vez al
 * cargarse y ya no vuelve a mirar. De ahí que los import sean dinámicos: con
 * los de arriba, `GIT_ROOT` se habría fijado antes de esta línea.
 */
const raiz = await mkdtemp(join(tmpdir(), "devup-git-raiz-"));
const taller = await mkdtemp(join(tmpdir(), "devup-git-taller-"));
process.env.GIT_ROOT = raiz;
process.env.REPOS_ALOJADOS = "true";

const { default: Fastify } = await import("fastify");
const { crearRepo } = await import("./almacen.js");
const { gitRoutes, hashDeToken } = await import("../routes/git.js");
const { closePool, withUser } = await import("../db/pool.js");

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error("Falta DATABASE_ADMIN_URL: la prueba necesita crear un usuario.");
  process.exit(1);
}

/**
 * Lanza git y espera. Devuelve el par código/salida en vez de reventar: una
 * orden que falla ES el resultado en la mitad de los casos de aquí abajo —la
 * contraseña mala tiene que fallar— y distinguirlos con try/catch enredaría
 * más de lo que ordena.
 */
function git(args: string[], cwd: string): Promise<{ codigo: number; salida: string }> {
  return new Promise((resolve) => {
    const hijo = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        // Sin esto, una credencial rechazada abre el diálogo del sistema y la
        // prueba se queda colgada para siempre en lugar de fallar.
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo",
        GIT_CONFIG_NOSYSTEM: "1",
        // Ni el gestor de credenciales de Windows, que guardaría la contraseña
        // de la prueba en el llavero de quien la corre.
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: "",
      },
    });
    let salida = "";
    hijo.stdout.on("data", (trozo: Buffer) => (salida += trozo.toString()));
    hijo.stderr.on("data", (trozo: Buffer) => (salida += trozo.toString()));
    hijo.on("close", (codigo) => resolve({ codigo: codigo ?? -1, salida }));
  });
}

async function main(): Promise<void> {
  const sufijo = randomUUID().slice(0, 8);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();

  const app = Fastify({ logger: false });
  await app.register(gitRoutes);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const puerto = (app.server.address() as { port: number }).port;

  try {
    const { rows } = await admin.query<{ register_user: string }>(
      "select public.register_user($1,$2,$3)",
      [`clona-${sufijo}@devup.test`, "hash-de-prueba", "Quien Clona"],
    );
    const persona = rows[0]!.register_user;

    const espacio = await withUser(persona, async (db) => {
      const org = (
        await db.query<{ create_organization: string }>(
          "select public.create_organization($1,$2)",
          ["Clonantes", `clonantes-${sufijo}`],
        )
      ).rows[0]!.create_organization;
      const ws = (
        await db.query<{ id: string }>(
          "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
          [org, "Producto", persona],
        )
      ).rows[0]!.id;
      await db.query(
        `insert into hosted_repos (workspace_id, organization_id, slug, created_by)
         values ($1,$2,$3,$4)`,
        [ws, org, "el-producto", persona],
      );
      return ws;
    });

    const contrasena = `devup_${randomBytes(24).toString("base64url")}`;
    await withUser(persona, (db) =>
      db.query("insert into git_tokens (user_id, name, token_hash) values ($1,$2,$3)", [
        persona,
        "la prueba",
        hashDeToken(contrasena),
      ]),
    );

    await crearRepo(espacio, "el-producto", "main");

    const url = (clave: string) =>
      `http://devup:${clave}@127.0.0.1:${puerto}/git/${espacio}/el-producto.git`;

    console.log("\nUna contraseña que no vale no clona nada");
    const mala = await git(["clone", url("devup_esto-no-existe"), "robado"], taller);
    // 401 y no 404: lo que falla es la credencial. Lo que se comprueba es que
    // git se rinde en vez de quedarse esperando a que alguien escriba.
    check("git se rinde en vez de colgarse", mala.codigo !== 0, mala.salida.slice(0, 120));

    console.log("\nClonar un repositorio recién creado");
    const primero = await git(["clone", url(contrasena), "copia"], taller);
    check("el clon termina bien", primero.codigo === 0, primero.salida.slice(0, 200));
    // Git avisa de que está vacío, y ese aviso es la señal de que el anuncio de
    // referencias se entendió: si no se hubiera entendido, habría fallado antes.
    check(
      "y dice que está vacío, que es la verdad",
      /vac|empty/i.test(primero.salida),
      primero.salida.slice(0, 200),
    );

    console.log("\nEmpujar un commit");
    const copia = join(taller, "copia");
    await writeFile(join(copia, "LEEME.md"), "# Alojado en DevUP\n", "utf8");
    await git(["config", "user.email", "prueba@devup.test"], copia);
    await git(["config", "user.name", "La Prueba"], copia);
    await git(["add", "."], copia);
    await git(["commit", "-m", "el primer commit"], copia);
    const empuje = await git(["push", "origin", "HEAD:main"], copia);
    check("el push termina bien", empuje.codigo === 0, empuje.salida.slice(0, 300));

    console.log("\nLo empujado está de verdad en el servidor");
    const segundo = await git(["clone", url(contrasena), "otra-copia"], taller);
    check("se vuelve a clonar desde cero", segundo.codigo === 0, segundo.salida.slice(0, 200));
    const historia = await git(["log", "--oneline"], join(taller, "otra-copia"));
    check(
      "y el commit está ahí",
      historia.salida.includes("el primer commit"),
      historia.salida.slice(0, 200),
    );

    console.log("\nLa contabilidad del push");
    const anotado = await withUser(persona, async (db) => {
      const { rows } = await db.query<{ size_bytes: string; pushed_at: string | null }>(
        "select size_bytes, pushed_at from hosted_repos where workspace_id = $1 and slug = $2",
        [espacio, "el-producto"],
      );
      return rows[0]!;
    });
    check("queda apuntado cuándo fue el último empuje", anotado.pushed_at !== null);
    check("y cuánto ocupa, que es lo que llena el volumen", Number(anotado.size_bytes) > 0);

    const usada = await withUser(persona, async (db) => {
      const { rows } = await db.query<{ last_used_at: string | null }>(
        "select last_used_at from git_tokens where token_hash = $1",
        [hashDeToken(contrasena)],
      );
      return rows[0]!.last_used_at;
    });
    check("y que la contraseña se usó, para poder revocar con criterio", usada !== null);
  } finally {
    await app.close();
    await closePool();
    await admin.end();
    await rm(raiz, { recursive: true, force: true });
    await rm(taller, { recursive: true, force: true });
  }
}

await main();

console.log(`\n${passed} comprobaciones correctas, ${failures.length} fallidas`);
if (failures.length > 0) process.exit(1);
