/**
 * Prueba del corrillo: la sala de voz sin canal.
 *
 * QUÉ ES Y POR QUÉ EXISTE. La llamada por cercanía del DevVerse era de dos
 * personas porque tenía su propia conexión escrita a mano en el cliente. En vez
 * de escribir ahí una malla para varios —la segunda de este proyecto, que
 * heredaría todos los fallos que la primera ya arregló— se reutiliza la malla
 * de las salas de voz, que ya aguanta tres. Lo único que le faltaba era poder
 * existir SIN un canal detrás.
 *
 * LO QUE COMPRUEBA, que es justo lo que no se ve leyendo el código:
 *
 *  1. Que tres personas en el mismo corrillo se ven entre sí. Es toda la
 *     razón de ser del cambio, y es lo que el diseño anterior no podía hacer.
 *  2. Que el corrillo NO deja rastro: sin canal no hay historial de llamada.
 *  3. Que la puerta es el ESPACIO. Alguien de otra organización no entra, y ese
 *     es el único sitio donde este cambio podría abrir un agujero: la malla de
 *     antes preguntaba por el canal, y un corrillo no tiene.
 *  4. Que dos espacios distintos con el mismo identificador de corrillo no
 *     acaban en la misma sala.
 *
 * No prueba que se OIGA nada: eso necesita micrófonos de verdad y dos personas.
 * Prueba que la señalización junta a quien tiene que juntar, que es la mitad
 * que sí se puede automatizar.
 *
 *   npm run test:corrillo
 */
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import pg from "pg";
import { WebSocket } from "ws";
import { signAccessToken } from "../auth/tokens.js";
import { closePool, withUser } from "../db/pool.js";
import { signalingRoutes } from "./signaling.js";

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

type Frame = Record<string, unknown> & { type: string };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Un cliente que guarda lo que recibe, para poder contarlo después. */
class Cliente {
  readonly frames: Frame[] = [];
  cerrado: { code: number } | null = null;
  private constructor(private readonly socket: WebSocket) {}

  static async abrir(url: string): Promise<Cliente> {
    const socket = new WebSocket(url);
    const cliente = new Cliente(socket);
    socket.on("message", (raw: Buffer) => {
      cliente.frames.push(JSON.parse(raw.toString()) as Frame);
    });
    socket.on("close", (code: number) => {
      cliente.cerrado = { code };
    });
    await new Promise<void>((resolve) => {
      socket.once("open", () => resolve());
      // Un socket que el servidor rechaza no llega a abrirse: eso también es
      // un resultado, y esperar a un `open` que no va a llegar colgaría la
      // prueba en vez de contarla.
      socket.once("error", () => resolve());
      socket.once("close", () => resolve());
    });
    return cliente;
  }

  async esperar(type: string, ms = 2000): Promise<Frame | null> {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      const encontrado = this.frames.find((f) => f.type === type);
      if (encontrado) return encontrado;
      await sleep(25);
    }
    return null;
  }

  /** Espera a que el servidor lo cierre. El rechazo llega después del apretón
   *  de manos —el socket se abre y el servidor lo cierra— así que mirarlo justo
   *  al volver de `abrir` es mirar demasiado pronto. */
  async esperarCierre(ms = 2000): Promise<boolean> {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      if (this.cerrado) return true;
      await sleep(25);
    }
    return false;
  }

  de(type: string): Frame[] {
    return this.frames.filter((f) => f.type === type);
  }

  cerrar(): void {
    this.socket.close();
  }
}

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error("Falta DATABASE_ADMIN_URL: la prueba necesita crear usuarios.");
  process.exit(1);
}

async function main(): Promise<void> {
  const sufijo = randomUUID().slice(0, 8);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();

  const app = Fastify({ logger: false });
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });
  await app.register(signalingRoutes);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const puerto = (app.server.address() as { port: number }).port;

  const mkUser = async (label: string): Promise<string> => {
    const { rows } = await admin.query<{ register_user: string }>(
      "select public.register_user($1,$2,$3)",
      [`${label}-${sufijo}@devup.test`, "hash-de-prueba", label],
    );
    return rows[0]!.register_user;
  };

  const ana = await mkUser("ana");
  const carla = await mkUser("carla");
  const dario = await mkUser("dario");
  const bruno = await mkUser("bruno");

  try {
    // Ana, Carla y Darío comparten oficina. Bruno está en otra organización:
    // es quien no debe poder asomarse.
    const acme = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ create_organization: string }>("select public.create_organization($1,$2)", [
          "Acme",
          `acme-${sufijo}`,
        ])
      ).rows[0]!.create_organization;
      const ws = (
        await db.query<{ id: string }>(
          "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
          [org, "Producto", ana],
        )
      ).rows[0]!.id;
      for (const correo of [`carla-${sufijo}@devup.test`, `dario-${sufijo}@devup.test`]) {
        await db.query("select public.add_member_by_email($1,$2,$3)", [org, correo, "member"]);
      }
      return { org, ws };
    });

    const otra = await withUser(bruno, async (db) => {
      const org = (
        await db.query<{ create_organization: string }>("select public.create_organization($1,$2)", [
          "Otra",
          `otra-${sufijo}`,
        ])
      ).rows[0]!.create_organization;
      const ws = (
        await db.query<{ id: string }>(
          "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
          [org, "Suyo", bruno],
        )
      ).rows[0]!.id;
      return { org, ws };
    });

    const url = async (quien: string, corrillo: string, workspaceId: string): Promise<string> => {
      const ticket = await signAccessToken(quien);
      return `ws://127.0.0.1:${puerto}/ws/voice?corrillo=${corrillo}&workspaceId=${workspaceId}&ticket=${encodeURIComponent(ticket)}`;
    };

    const corrillo = randomUUID();

    console.log("\nTres personas en el mismo corrillo se ven entre sí");

    const a = await Cliente.abrir(await url(ana, corrillo, acme.ws));
    const bienvenidaA = await a.esperar("welcome");
    check("Ana entra", bienvenidaA !== null);
    check(
      "y de momento está sola",
      Array.isArray(bienvenidaA?.peers) && (bienvenidaA.peers as unknown[]).length === 0,
    );

    const c = await Cliente.abrir(await url(carla, corrillo, acme.ws));
    const bienvenidaC = await c.esperar("welcome");
    check(
      "Carla entra y ve a Ana ya dentro",
      Array.isArray(bienvenidaC?.peers) && (bienvenidaC.peers as unknown[]).length === 1,
    );
    check("y a Ana le avisan de que llegó alguien", (await a.esperar("peer-joined")) !== null);

    const d = await Cliente.abrir(await url(dario, corrillo, acme.ws));
    const bienvenidaD = await d.esperar("welcome");
    // LA QUE JUSTIFICA TODO EL CAMBIO. Con la llamada de antes —una conexión y
    // un solo interlocutor— el tercero no podía existir: entraba y el segundo
    // se quedaba fuera, o le rechazaban solo por estar ocupado.
    check(
      "Darío entra y ve a los DOS que ya estaban",
      Array.isArray(bienvenidaD?.peers) && (bienvenidaD.peers as unknown[]).length === 2,
      `vio ${(bienvenidaD?.peers as unknown[] | undefined)?.length}`,
    );
    await sleep(150);
    check("Ana se entera de las dos llegadas", a.de("peer-joined").length === 2);
    check("y Carla, de la de Darío", c.de("peer-joined").length === 1);

    console.log("\nUn corrillo no deja rastro");

    const sesiones = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ n: string }>("select count(*)::text as n from call_sessions");
      return Number(rows[0]!.n);
    });
    check("no se abre ninguna sesión de llamada: sin canal no hay historial", sesiones === 0);

    console.log("\nLa puerta de un corrillo es el espacio");

    const forastero = await Cliente.abrir(await url(bruno, corrillo, acme.ws));
    check("alguien de otra organización no entra", await forastero.esperarCierre());
    check("y no llega a ver a nadie", forastero.de("welcome").length === 0);

    // El identificador lo propone el cliente, así que dos oficinas podrían
    // proponer el mismo. La clave de la sala lleva el espacio dentro por esto.
    const suyo = await Cliente.abrir(await url(bruno, corrillo, otra.ws));
    const bienvenidaSuya = await suyo.esperar("welcome");
    check("el mismo identificador en otro espacio es otro corrillo", bienvenidaSuya !== null);
    check(
      "y ahí Bruno está solo, no con los tres de Acme",
      Array.isArray(bienvenidaSuya?.peers) && (bienvenidaSuya.peers as unknown[]).length === 0,
    );

    console.log("\nSalir vacía la sala");

    c.cerrar();
    await sleep(200);
    check("a los demás les llega que se fue", a.de("peer-left").length === 1);

    for (const cliente of [a, c, d, forastero, suyo]) cliente.cerrar();
  } finally {
    await app.close();
    await closePool();
    await admin.query("delete from public.organizations where slug like $1", [`%-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [`%-${sufijo}@devup.test`]);
    await admin.end();
  }
}

await main();

console.log(`\n${passed} comprobaciones correctas, ${failures.length} fallidas`);
if (failures.length > 0) {
  console.error("\nFallaron:\n" + failures.map((f) => `  · ${f}`).join("\n"));
  process.exit(1);
}
