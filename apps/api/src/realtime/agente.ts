/**
 * Qué está haciendo el agente de cada persona, ahora mismo.
 *
 * POR QUÉ EN MEMORIA Y NO EN UNA TABLA. Es el mismo criterio que defiende
 * `hub.ts` para el estado en vivo: esto se limpia solo. Una fila tendría que
 * borrarla alguien —y nadie borra la fila de «estaba migrando la base» cuando
 * el proceso del agente se muere a mitad—, así que la tabla acabaría
 * afirmando para siempre algo que dejó de ser cierto. Un mapa con caducidad
 * dice la verdad por construcción: si nadie late, no hay faena.
 *
 * DE DÓNDE VIENEN LOS LATIDOS. De `herramienta()` en `apps/mcp/src/registro.ts`,
 * que es el único sitio por el que pasan todas las herramientas y los dos
 * transportes (stdio y HTTP). Llegan por `POST /me/agente/latido` en vez de
 * escribirse aquí directamente porque por stdio el proceso del agente corre en
 * la máquina de cada persona: una variable local nunca llegaría al servidor.
 *
 * LA CONTRAPARTIDA, dicha entera: con dos instancias de la API esto no se
 * comparte, igual que el hub. Hoy funciona porque la puerta MCP corre en la
 * instancia que sirve los sockets (ver `MCP_REMOTE_ENABLED`); el día que
 * duela, es el mismo Redis que el hub ya tiene pendiente.
 */

/** De dónde salió la frase, que es lo que decide cuál gana. */
export type OrigenDeFaena = "declarada" | "herramienta";

type Sello = { frase: string; at: number };

type Estado = {
  /** La que el agente dijo con `estoy_haciendo`. */
  declarada?: Sello;
  /** La deducida del nombre de la última herramienta que usó. */
  herramienta?: Sello;
};

/**
 * Cuánto vale cada una, y por qué no lo mismo.
 *
 * Una frase declarada describe un arco de trabajo («estoy migrando la base»),
 * que dura minutos y abarca varias llamadas. Una herramienta es un instante:
 * pasados dos minutos sin volver a llamar a ninguna, lo honesto es callarse
 * en vez de seguir diciendo «mirando el tablero».
 */
const VIGENCIA_MS: Record<OrigenDeFaena, number> = {
  declarada: 5 * 60_000,
  herramienta: 2 * 60_000,
};

/** Por `userId`: el agente es Claude conectado con la sesión de una persona. */
const estados = new Map<string, Estado>();

function vigente(sello: Sello | undefined, origen: OrigenDeFaena, ahora: number): boolean {
  return sello !== undefined && ahora - sello.at < VIGENCIA_MS[origen];
}

/**
 * Se apunta un latido y, de paso, se tiran los caducados.
 *
 * La limpieza va aquí y no en un temporizador porque el mapa solo crece
 * cuando alguien late: recorrerlo en ese momento es gratis y evita un reloj
 * más que mantener vivo.
 */
export function anotarLatido(
  userId: string,
  origen: OrigenDeFaena,
  frase: string,
  ahora = Date.now(),
): void {
  const estado = estados.get(userId) ?? {};
  estado[origen] = { frase, at: ahora };
  estados.set(userId, estado);

  for (const [otro, suyo] of estados) {
    if (!vigente(suyo.declarada, "declarada", ahora) && !vigente(suyo.herramienta, "herramienta", ahora)) {
      estados.delete(otro);
    }
  }
}

/**
 * Qué decir que está haciendo, o `null` si está libre.
 *
 * La declarada gana mientras siga vigente, aunque haya llamado a una
 * herramienta después: quien dijo «estoy migrando la base» y luego consulta
 * el tablero sigue migrando la base — la herramienta es un paso de esa faena,
 * no una faena nueva.
 */
export function faenaDelAgente(userId: string, ahora = Date.now()): string | null {
  const estado = estados.get(userId);
  if (!estado) return null;
  if (vigente(estado.declarada, "declarada", ahora)) return estado.declarada!.frase;
  if (vigente(estado.herramienta, "herramienta", ahora)) return estado.herramienta!.frase;
  return null;
}

/** Solo para las pruebas: deja el mapa como recién arrancado. */
export function olvidarTodo(): void {
  estados.clear();
}
