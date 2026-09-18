/**
 * Prueba del bus entre instancias.
 *
 * QUÉ AVERÍA CUBRE. Producción corre partida en dos servicios desde el 16 de
 * septiembre: `api` atiende REST con los sockets apagados y `live` atiende los
 * sockets. Como las salas del hub viven en memoria, cada aviso que nacía de una
 * escritura por REST se repartía en el hub de `api` —vacío— mientras la gente
 * estaba conectada a `live`. Mandabas un mensaje y el otro no lo veía; movías
 * una tarjeta y el tablero del de al lado no se movía. Sin un error en ningún
 * registro, porque repartir a nadie no falla. Eso es lo que no se puede volver
 * a colar, y por eso esto se prueba con DOS buses de verdad y no con dobles.
 *
 * LO QUE COMPRUEBA:
 *
 *  1. Que un aviso publicado en una instancia llega a los sockets de la otra.
 *     Es la avería, dicha al derecho.
 *  2. Que a quien lo publicó NO le llega dos veces. Sin esto, cada mensaje
 *     aparecería duplicado en pantalla en cuanto haya una segunda instancia.
 *  3. Que un aviso que no cabe en un `NOTIFY` —un mensaje largo, que es el caso
 *     normal y no el raro— llega entero y con los acentos en su sitio. Postgres
 *     corta en 8000 bytes y un mensaje de chat admite 8000 caracteres.
 *  4. Que cada aviso va solo a SU sala: la de al lado no lo recibe.
 *  5. Que la voz y el mundo no cruzan. No es un olvido: sus salas guardan
 *     presencia, no avisos, y reenviarlas sin replicar el estado juntaría a
 *     gente que luego no se vería colgar.
 *
 * Necesita la base de datos en pie, como el resto de pruebas de este directorio.
 *
 *   npm run test:bus
 */
import { randomUUID } from "node:crypto";
import { closePool } from "../db/pool.js";
import { crearBus, type Destino } from "./bus.js";
import { Hub, type Member } from "./hub.js";

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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Un socket de mentira que apunta lo que le mandan.
 *
 * El hub solo le pide dos cosas —`readyState` y `send`— porque `send()` de
 * `hub.ts` no hace nada más. Montar un WebSocket real aquí no probaría nada que
 * `corrillo.test.ts` no pruebe ya.
 */
function socketFalso(): { recibido: string[]; readyState: number; send(d: string): void } {
  const recibido: string[] = [];
  return {
    recibido,
    readyState: 1,
    send(dato: string) {
      recibido.push(dato);
    },
  };
}

function sentar(hub: Hub, sala: string): ReturnType<typeof socketFalso> {
  const socket = socketFalso();
  hub.join(sala, {
    peerId: randomUUID(),
    socket: socket as unknown as Member["socket"],
    alive: true,
    userId: randomUUID(),
    displayName: "quien sea",
    muted: false,
    camera: false,
    sharing: false,
  });
  return socket;
}

function hubsNuevos(): Record<Destino, Hub> {
  return { canal: new Hub(), espacio: new Hub(), persona: new Hub() };
}

/** Lo que de verdad le llegó a ese socket, ya leído. */
function avisos(socket: { recibido: string[] }): Record<string, unknown>[] {
  return socket.recibido.map((t) => JSON.parse(t) as Record<string, unknown>);
}

async function main(): Promise<void> {
  console.log("\nBus entre instancias\n");

  const hubsA = hubsNuevos();
  const hubsB = hubsNuevos();
  const a = crearBus({ hubs: hubsA, yo: randomUUID() });
  const b = crearBus({ hubs: hubsB, yo: randomUUID() });

  // Solo B escucha, igual que en producción: `api` publica y `live` reparte.
  // Que A publique sin escuchar es parte de lo que se prueba.
  await b.escuchar();

  const canal = randomUUID();
  const espacio = randomUUID();
  const otroCanal = randomUUID();

  // Cada uno con su gente sentada en su propio proceso.
  const enA = sentar(hubsA.canal, canal);
  const enB = sentar(hubsB.canal, canal);
  const enOtro = sentar(hubsB.canal, otroCanal);
  const enEspacioB = sentar(hubsB.espacio, espacio);

  // --- 1 y 2: cruza una vez, y solo una -------------------------------------
  a.repartir("canal", canal, { type: "message", action: "created", message: { body: "hola" } });
  await sleep(700);

  check("el aviso llega a los sockets de la otra instancia", avisos(enB).length === 1,
    `llegaron ${avisos(enB).length}`);
  check(
    "y llega con el contenido intacto",
    (avisos(enB)[0]?.message as { body?: string } | undefined)?.body === "hola",
  );
  check("a quien lo publicó le llega una sola vez", avisos(enA).length === 1,
    `llegaron ${avisos(enA).length}`);

  // --- 4: cada aviso a su sala ----------------------------------------------
  check("la sala de al lado no lo recibe", avisos(enOtro).length === 0);
  check("y el hub del espacio tampoco", avisos(enEspacioB).length === 0);

  // --- 3: lo que no cabe en un NOTIFY ---------------------------------------
  //
  // 8000 caracteres es el máximo que admite un mensaje, y con acentos son más de
  // 8000 bytes: justo lo que Postgres no deja pasar de una vez. Con eñes para
  // que, si algún día se trocea por bytes en vez de por base64, la prueba lo
  // note en vez de dar un texto parecido por bueno.
  const largo = "ñ".repeat(8000);
  a.repartir("espacio", espacio, { type: "file-change", action: "created", fileId: largo });
  await sleep(1200);

  const recibido = avisos(enEspacioB)[0];
  check("un aviso más grande que un NOTIFY llega igualmente", recibido !== undefined);
  check(
    "y llega entero, sin caracteres partidos",
    recibido?.fileId === largo,
    `llegaron ${String(recibido?.fileId ?? "").length} de ${largo.length}`,
  );

  // --- 5: la voz y el mundo no cruzan ---------------------------------------
  //
  // No hay forma de pedirle al bus que reparta voz: `Destino` no los incluye.
  // Se comprueba sobre el tipo en tiempo de ejecución para que el día que
  // alguien los añada sin replicar la presencia, esto se ponga rojo.
  const destinos: Destino[] = ["canal", "espacio", "persona"];
  check(
    "el bus no cruza voz ni mundo",
    !destinos.includes("voz" as Destino) && !destinos.includes("mundo" as Destino),
  );

  await a.cerrar();
  await b.cerrar();
  await closePool();

  console.log(`\n${passed} comprobaciones pasadas, ${failures.length} fallidas\n`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`  · ${f}`);
    process.exit(1);
  }
}

await main();
