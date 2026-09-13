/**
 * Pruebas de la sala del Agente IA.
 *
 * QUÉ SE PRUEBA, Y POR QUÉ ESTE ARCHIVO EXISTE. La primera versión comparaba
 * el nombre del canal con `=== "agente-ia"`, y la sala no apareció: quien la
 * creó la llamó «Agente IA», que es como se llama en el producto. Un nombre de
 * canal es texto libre —la API solo lo recorta—, así que exigir una grafía que
 * no se enseña en ninguna parte es exigir que falle. Y fallaba en silencio: sin
 * coincidencia no hay muñeco, y no hay nada que distinga eso de «no está
 * hecho».
 *
 * Lo demás que se fija aquí es lo que no puede depender del reloj ni del azar:
 * dos personas mirando la misma sala al mismo tiempo tienen que leer lo mismo.
 *
 *   npm run test:agente-ia
 */
import {
  USER_ID_AGENTE,
  esSalaDelAgente,
  peerDelAgente,
  zonaDelAgente,
} from "./agente-ia.js";
import type { LiveData, Zone } from "./types.js";

let total = 0;
let fallos = 0;

function check(nombre: string, condicion: boolean): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
  }
}

function zona(channelName: string): Zone {
  return {
    id: `z-${channelName}`,
    channelId: `c-${channelName}`,
    channelName,
    channelKind: "text",
    channelPrivate: false,
    x: 1,
    y: 1,
    width: 11,
    height: 9,
    palette: 0,
    customized: false,
    material: null,
    props: [],
  };
}

const vivo = (agente: string | null, board: LiveData["board"] = []): LiveData => ({
  board,
  channels: [],
  agente,
});

console.log("\nCómo se reconoce la sala");

// La grafía que de verdad escribe una persona. Era la que fallaba.
check("«Agente IA», como se llama en el producto", esSalaDelAgente(zona("Agente IA")));
check("«agente-ia», como se llamaba en el código", esSalaDelAgente(zona("agente-ia")));
check("«agente ia», con espacio", esSalaDelAgente(zona("agente ia")));
check("«AGENTE_IA», a gritos", esSalaDelAgente(zona("AGENTE_IA")));
check("«Agente IÁ», con un acento de más", esSalaDelAgente(zona("Agente IÁ")));

// Y que no se pase de listo: cualquier canal que hable de agentes NO es la
// sala. Si lo fuera, un canal llamado «agentes de ventas» se llenaría de
// muñecos sin que nadie entendiera por qué.
check("«agentes» no es la sala", !esSalaDelAgente(zona("agentes")));
check("«agente-ia-pruebas» no es la sala", !esSalaDelAgente(zona("agente-ia-pruebas")));
check("«prueba» no es la sala", !esSalaDelAgente(zona("prueba")));
check("sin zona, no es la sala", !esSalaDelAgente(null));

console.log("\nSin el canal no hay muñeco");

check("ninguna zona", peerDelAgente([], vivo(null), 0) === null);
check("otras zonas", peerDelAgente([zona("general"), zona("prueba")], vivo(null), 0) === null);
check("y la encuentra entre varias", zonaDelAgente([zona("prueba"), zona("Agente IA")]) !== null);

console.log("\nEl muñeco");

const zonas = [zona("Agente IA")];
const muñeco = peerDelAgente(zonas, vivo(null), 0)!;

check("existe", muñeco !== null);
check("se llama Agente IA", muñeco.displayName === "Agente IA");
check("dice que es un asistente", muñeco.title === "asistente");
// El `userId` es un contrato con el renderizador, no un detalle: es por lo que
// `renderer.ts` decide dibujar el aparato en vez de una persona. Se compara
// contra la constante exportada justamente para que no puedan descuadrar — si
// alguien cambia el valor, el renderizador lo sigue; si alguien escribe el
// literal a mano en el renderizador, esto no lo caza, y por eso allí también se
// importa.
check("lleva el userId del agente", muñeco.userId === USER_ID_AGENTE);
// Y que no pueda chocar con el de una persona: los `userId` de verdad son
// uuid, así que un nombre a secas no colisiona nunca. Si algún día dejaran de
// ser uuid, esto se pone rojo antes de que dos identidades se confundan.
check(
  "y no puede chocar con el de una persona",
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(USER_ID_AGENTE),
);
// Quieto es lo único coherente con que no lo mueva nadie.
check("está quieto", muñeco.moving === false && muñeco.sitting === false);
check("está dentro de la sala", muñeco.zoneId === zonas[0]!.id);
check(
  "y dentro de sus paredes",
  muñeco.x > zonas[0]!.x &&
    muñeco.x < zonas[0]!.x + zonas[0]!.width &&
    muñeco.y > zonas[0]!.y &&
    muñeco.y < zonas[0]!.y + zonas[0]!.height,
);

console.log("\nQué dice");

check(
  "la faena, cuando hay",
  peerDelAgente(zonas, vivo("estoy migrando la base de datos"), 0)!.bubble ===
    "estoy migrando la base de datos",
);
check("y algo, siempre", (peerDelAgente(zonas, vivo(null), 12_345)!.bubble ?? "").length > 0);

// Determinista: el mismo instante da la misma frase. Con `Math.random` cada
// navegador leería otra cosa, y cambiaría sesenta veces por segundo.
check(
  "el mismo instante da la misma frase",
  peerDelAgente(zonas, vivo(null), 7_000)!.bubble ===
    peerDelAgente(zonas, vivo(null), 7_000)!.bubble,
);
// Y rota: dos instantes separados por más de la rotación no dicen lo mismo.
check(
  "y rota con el tiempo",
  peerDelAgente(zonas, vivo(null), 0)!.bubble !==
    peerDelAgente(zonas, vivo(null), 9_000)!.bubble,
);

console.log("\nCuenta las pendientes, y sabe cuáles no lo son");

const tablero = [
  { name: "Por hacer", count: 3 },
  { name: "En curso", count: 2 },
  { name: "Hecho", count: 40 },
];
// Se recorren las frases de una rotación entera para encontrar la que habla
// del tablero: cuál toca depende del reloj, y eso es justo lo que no hay que
// fijar en una prueba.
const frases = [0, 9_000, 18_000, 27_000, 36_000, 45_000].map(
  (t) => peerDelAgente(zonas, vivo(null, tablero), t)!.bubble ?? "",
);
check("dice 5 y no 45: «Hecho» no cuenta", frases.some((f) => f.includes("5 tareas")));
check("ninguna frase menciona las 45", !frases.some((f) => f.includes("45")));

const unaSola = [{ name: "Por hacer", count: 1 }];
const frasesUna = [0, 9_000, 18_000, 27_000, 36_000, 45_000].map(
  (t) => peerDelAgente(zonas, vivo(null, unaSola), t)!.bubble ?? "",
);
check("con una sola, habla en singular", frasesUna.some((f) => f.includes("Queda 1 tarea")));

// Con el tablero vacío no debe inventarse un número ni decir «quedan 0».
const frasesVacio = [0, 9_000, 18_000, 27_000, 36_000, 45_000].map(
  (t) => peerDelAgente(zonas, vivo(null, []), t)!.bubble ?? "",
);
check("con el tablero vacío no nombra ninguna cifra", !frasesVacio.some((f) => /\d/.test(f)));

console.log(`\n${total} comprobaciones, ${fallos} fallidas`);
if (fallos > 0) process.exit(1);
