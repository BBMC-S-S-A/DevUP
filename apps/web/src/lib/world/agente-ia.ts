/**
 * El muñeco de la sala «Agente IA».
 *
 * QUÉ ES Y QUÉ NO ES. Es un `Peer` que el servidor no conoce: se fabrica aquí
 * a partir de dos cosas que ya viajan —el mapa y `/world/live`— y se concatena
 * al array del render. El precedente es el propio avatar de quien mira
 * (`renderer.ts:163-178`), que también se construye en el cliente.
 *
 * NO ENTRA EN `roster`, y eso no es un detalle de estilo: en la lista de
 * personas heredaría el menú de «Llamar», y llamar a un `peerId` que el
 * servidor no conoce se queda colgado para siempre en «llamando» porque
 * `enviarA` devuelve `false` en silencio. Fuera de `roster` tampoco infla el
 * contador de «N en la oficina», que cuenta gente.
 *
 * TODO ES DETERMINISTA, como el resto del mundo (ver la cabecera de
 * `rooms.ts`): ni un `Math.random`. Las frases de reposo rotan por reloj, así
 * que dos personas mirando la misma sala al mismo tiempo leen lo mismo. Con
 * azar, el muñeco diría una cosa distinta en cada navegador y en cada
 * fotograma.
 *
 * LA BURBUJA NO SE GUARDA, SE DERIVA. El barrido de caducidad del bucle de
 * animación solo recorre `state.peers`, así que una burbuja puesta a mano en
 * un personaje sintético se quedaría pegada en pantalla. Aquí se recalcula
 * entera en cada fotograma desde `live.agente`: cuando el latido caduca en el
 * servidor, la frase desaparece sola.
 */
import type { LiveData, Peer, Zone } from "./types";

/**
 * El nombre del canal que crea la sala, ya normalizado. Sin ese canal, no hay
 * muñeco.
 */
const CANAL = "agenteia";

/**
 * El nombre de un canal, reducido a lo comparable.
 *
 * POR QUÉ NO BASTA `=== "agente-ia"`, que es lo que había antes y por lo que la
 * sala no aparecía: el nombre de un canal es texto libre —la API solo lo recorta
 * y lo limita a 80 caracteres, no lo convierte en identificador—, así que quien
 * crea la sala la llama «Agente IA», que es como se llama en el producto, y no
 * `agente-ia`, que es como se llamaba en el código. Pedir una grafía exacta que
 * no se enseña en ninguna parte es pedir que falle.
 *
 * Se quitan los acentos también: «Agente IÁ» no debería ser otra sala.
 */
function normalizar(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Un `userId` que no existe.
 *
 * Sirve para dos cosas a la vez: `avatars.get(...)` falla y el renderizador
 * cae en `FALLBACK_AVATAR` —el gris que ya se lee como «nadie»— sin ningún
 * caso especial, y ninguna comparación con `selfUserId` puede acertar.
 */
const USER_ID = "agente-ia";

/** Cada cuánto cambia la frase de reposo. */
const ROTACION_MS = 9_000;

/**
 * Las columnas que significan «ya está».
 *
 * Se compara por nombre porque el tablero no marca ninguna columna como
 * final: es una lista ordenada y la última suele ser la de terminadas, pero
 * «suele» no basta para contar. Lo que no reconozca cuenta como pendiente, que
 * es el error que menos molesta: preguntar por trabajo que ya estaba hecho es
 * más barato que callarse el que falta.
 */
const COLUMNAS_FINALES = ["hecho", "done", "termin", "listo", "cerrad", "complet", "archiv"];

function pendientes(board: LiveData["board"]): number {
  return board
    .filter((c) => {
      const nombre = c.name.toLowerCase();
      return !COLUMNAS_FINALES.some((palabra) => nombre.includes(palabra));
    })
    .reduce((total, c) => total + c.count, 0);
}

const REPOSO = [
  "¿Hay algo por hacer?",
  "¿En qué te puedo ayudar hoy?",
  "Aquí estoy cuando me necesites.",
  "Pídeme algo y me pongo.",
];

/**
 * Qué dice cuando no está haciendo nada.
 *
 * Cuando el tablero trae tareas sin terminar, una de las frases las nombra:
 * es la única que dice algo que la otra persona no sabía ya, y el dato viene
 * en la misma respuesta que la frase, sin ninguna petición más.
 */
function fraseDeReposo(live: LiveData | null, ahora: number): string {
  const sinTerminar = live ? pendientes(live.board) : 0;
  const frases =
    sinTerminar > 0
      ? [
          ...REPOSO,
          sinTerminar === 1
            ? "Queda 1 tarea sin terminar, ¿la vemos?"
            : `Quedan ${sinTerminar} tareas sin terminar, ¿empezamos?`,
        ]
      : REPOSO;
  return frases[Math.floor(ahora / ROTACION_MS) % frases.length]!;
}

/** Si una zona es la sala del agente. */
export function esSalaDelAgente(zone: { channelName: string } | null): boolean {
  return zone !== null && normalizar(zone.channelName) === CANAL;
}

/** La zona de la sala del agente, si su canal existe. */
export function zonaDelAgente(zones: Zone[]): Zone | null {
  return zones.find((z) => normalizar(z.channelName) === CANAL) ?? null;
}

/**
 * El muñeco, o `null` si nadie ha creado el canal `agente-ia`.
 *
 * `ahora` entra como parámetro y no se lee de `Date.now()` dentro para que la
 * rotación de frases se pueda probar sin esperar nueve segundos.
 */
export function peerDelAgente(zones: Zone[], live: LiveData | null, ahora: number): Peer | null {
  const zona = zonaDelAgente(zones);
  if (!zona) return null;

  // En el centro de la sala y mirando al sur: el amueblado deducido pega los
  // escritorios a las paredes, así que el centro es lo que queda libre en
  // cualquier tamaño de zona, sin coordenadas a mano por sala.
  const x = zona.x + Math.floor(zona.width / 2);
  const y = zona.y + Math.floor(zona.height / 2);

  return {
    peerId: "agente-ia",
    userId: USER_ID,
    displayName: "Agente IA",
    title: "asistente",
    x,
    y,
    tx: x,
    ty: y,
    facing: "s",
    moving: false,
    sitting: false,
    bubble: live?.agente ?? fraseDeReposo(live, ahora),
    zoneId: zona.id,
  };
}

/**
 * La lista de personajes que se dibuja: los de verdad, más el agente si su
 * sala existe.
 *
 * Se llama una vez por fotograma, de ahí que no se guarde nada: `Date.now()`
 * es lo que hace que la frase de reposo rote sin que React vuelva a dibujar.
 */
export function peersConAgente(
  peers: Map<string, Peer>,
  zones: Zone[],
  live: LiveData | null,
): Peer[] {
  const lista = [...peers.values()];
  const agente = peerDelAgente(zones, live, Date.now());
  return agente ? [...lista, agente] : lista;
}
