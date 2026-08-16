/**
 * Prueba de la sala del mundo.
 *
 * Levanta la API mínima —solo el socket del mundo—, mete dos personas en la
 * misma oficina y comprueba las dos cosas que este archivo hace y que no se
 * ven leyéndolo:
 *
 *  1. Que el reparto va agrupado por tick. Es fácil escribir el código de
 *     forma que funcione y aun así mande un mensaje por movimiento; la única
 *     manera de saberlo es contar los mensajes que llegan.
 *
 *  2. Que la zona de un canal privado no se le cuenta a quien no pertenece a
 *     ese canal. Es la frontera de seguridad del archivo y la que se rompería
 *     sin que nada fallara.
 *
 *   npm run test:world
 */
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import pg from "pg";
import { WebSocket } from "ws";
import { signAccessToken } from "../auth/tokens.js";
import { closePool, withUser } from "../db/pool.js";
import { worldSocketRoutes } from "./world.js";

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

/** Un cliente que guarda todo lo que recibe, para poder contarlo después. */
class Client {
  readonly frames: Frame[] = [];
  private constructor(private readonly socket: WebSocket) {}

  static async open(url: string): Promise<Client> {
    const socket = new WebSocket(url);
    const client = new Client(socket);
    socket.on("message", (raw: Buffer) => {
      client.frames.push(JSON.parse(raw.toString()) as Frame);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return client;
  }

  send(payload: unknown): void {
    this.socket.send(JSON.stringify(payload));
  }

  /** Espera a que llegue un tipo de mensaje, o se rinde. */
  async waitFor(type: string, timeoutMs = 2000): Promise<Frame | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.frames.find((f) => f.type === type);
      if (found) return found;
      await sleep(25);
    }
    return null;
  }

  of(type: string): Frame[] {
    return this.frames.filter((f) => f.type === type);
  }

  close(): void {
    this.socket.close();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error("Falta DATABASE_ADMIN_URL: la prueba necesita crear usuarios.");
  process.exit(1);
}

async function main(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();

  const app = Fastify({ logger: false });
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });
  await app.register(worldSocketRoutes);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;

  const mkUser = async (label: string): Promise<string> => {
    const { rows } = await admin.query<{ register_user: string }>(
      "select public.register_user($1, $2, $3)",
      [`${label}-${suffix}@devup.test`, "hash-de-prueba", label],
    );
    return rows[0]!.register_user;
  };

  const ana = await mkUser("ana");
  const carla = await mkUser("carla");

  try {
    // Ana y Carla comparten organización y workspace. Ana además tiene un
    // canal privado en el que Carla no está: su zona es lo que no debe
    // escaparse.
    const { ws, publicChannel, privateChannel } = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ create_organization: string }>(
          "select public.create_organization($1,$2)",
          ["Acme", `acme-${suffix}`],
        )
      ).rows[0]!.create_organization;

      const workspace = (
        await db.query<{ id: string }>(
          "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
          [org, "Producto", ana],
        )
      ).rows[0]!.id;

      const pub = (
        await db.query<{ create_channel: string }>("select public.create_channel($1,$2,$3,$4)", [
          workspace,
          "general",
          "voice",
          false,
        ])
      ).rows[0]!.create_channel;

      const priv = (
        await db.query<{ create_channel: string }>("select public.create_channel($1,$2,$3,$4)", [
          workspace,
          "dirección",
          "voice",
          true,
        ])
      ).rows[0]!.create_channel;

      await db.query("select public.add_member_by_email($1,$2,$3)", [
        org,
        `carla-${suffix}@devup.test`,
        "member",
      ]);

      return { ws: workspace, publicChannel: pub, privateChannel: priv };
    });

    const zoneOf = (user: string, channel: string): Promise<string | null> =>
      withUser(user, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          "select id from world_zones where channel_id = $1",
          [channel],
        );
        return rows[0]?.id ?? null;
      });

    const url = async (user: string): Promise<string> =>
      `ws://127.0.0.1:${port}/ws/world?workspaceId=${ws}&ticket=${await signAccessToken(user)}`;

    console.log("\nConexión y presencia");

    const anaClient = await Client.open(await url(ana));
    const anaWelcome = await anaClient.waitFor("welcome");
    check("Ana entra y recibe su bienvenida", anaWelcome !== null);
    check(
      "aparece en el pasillo, no dentro de una zona",
      typeof (anaWelcome?.you as { x?: number })?.x === "number",
    );

    const carlaClient = await Client.open(await url(carla));
    const carlaWelcome = await carlaClient.waitFor("welcome");
    check("Carla entra y ve que Ana ya estaba", ((carlaWelcome?.peers as unknown[]) ?? []).length === 1);
    check("a Ana le avisan de que entró Carla", (await anaClient.waitFor("peer-joined")) !== null);

    // --- Reparto agrupado --------------------------------------------------
    //
    // Ana manda veinte posiciones seguidas. Si el servidor reenviara cada una,
    // a Carla le llegarían veinte mensajes; con reparto por tick a 10 Hz, le
    // llegan unos pocos. Se comprueba el orden de magnitud, no un número
    // exacto: el reloj no está sincronizado con el envío.
    console.log("\nReparto agrupado por tick");

    const before = carlaClient.of("tick").length;
    for (let i = 0; i < 20; i += 1) {
      anaClient.send({ type: "move", x: 10 + i * 0.1, y: 12, facing: "e", moving: true });
      await sleep(50);
    }
    await sleep(250);
    const ticks = carlaClient.of("tick").length - before;

    check(`llegan ticks con el movimiento (${ticks})`, ticks > 0);
    check(
      `veinte movimientos no producen veinte mensajes (${ticks} ≤ 15)`,
      ticks <= 15,
      "el reparto no está agrupando",
    );

    const lastTick = carlaClient.of("tick").at(-1);
    const moves = (lastTick?.moves as { x: number }[]) ?? [];
    check("el tick trae la posición de quien se movió", moves.length > 0 && moves[0]!.x > 10);

    // --- La frontera -------------------------------------------------------
    //
    // Ana entra en la zona de su canal privado. Carla no pertenece a ese canal
    // y no debe enterarse ni del identificador de la zona.
    console.log("\nZonas privadas");

    const privateZone = await zoneOf(ana, privateChannel);
    const publicZone = await zoneOf(ana, publicChannel);
    check("la zona del canal privado existe para Ana", privateZone !== null);
    check("Carla no ve la zona privada en la base", (await zoneOf(carla, privateChannel)) === null);

    anaClient.send({ type: "zone", zoneId: privateZone });
    await sleep(300);
    check(
      "a Carla no le llega que Ana entró en la zona privada",
      carlaClient.of("peer-zone").every((f) => f.zoneId !== privateZone),
    );

    anaClient.send({ type: "zone", zoneId: publicZone });
    const shared = await carlaClient.waitFor("peer-zone");
    check("la zona compartida sí se anuncia", shared?.zoneId === publicZone);

    // Un cliente que se invente el identificador de una zona a la que no tiene
    // acceso no consigue nada: el servidor lo descarta en silencio.
    const carlaZonesBefore = anaClient.of("peer-zone").length;
    carlaClient.send({ type: "zone", zoneId: privateZone });
    await sleep(300);
    check(
      "Carla no puede declararse dentro de una zona que no puede ver",
      anaClient.of("peer-zone").length === carlaZonesBefore,
    );

    // --- Salida ------------------------------------------------------------
    console.log("\nSalida");
    carlaClient.close();
    check("al irse Carla se avisa a quien queda", (await anaClient.waitFor("peer-left")) !== null);
    anaClient.close();
  } finally {
    await app.close();
    await admin.query("delete from public.organizations where slug like $1", [`%-${suffix}`]);
    await admin.query("delete from public.users where email like $1", [`%-${suffix}@devup.test`]);
    await admin.end();
    await closePool();
  }

  console.log(`\n${passed} comprobaciones correctas, ${failures.length} fallidas`);
  if (failures.length > 0) {
    console.error("\nFallaron:\n" + failures.map((f) => `  · ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
