import type { WebSocket } from "ws";

/**
 * Salas en memoria.
 *
 * Sustituye a Supabase Realtime Presence, y hereda su propiedad más útil: el
 * estado en vivo se limpia solo. Cuando el socket se cierra —pestaña cerrada,
 * red caída, portátil dormido— el miembro desaparece de la sala sin que nadie
 * tenga que acordarse de borrarlo. Una tabla no hace eso, y por eso el estado
 * en vivo de una llamada no vive en Postgres.
 *
 * Contrapartida honesta: esto vive en el proceso. Con dos instancias de la API
 * detrás de un balanceador, dos personas en la misma sala pero en instancias
 * distintas no se ven. Mientras haya una sola instancia es correcto; cuando
 * haya dos, este archivo es el que hay que respaldar con Redis pub/sub, y solo
 * este.
 */
/**
 * Lo mínimo que el hub necesita saber de alguien para repartirle mensajes.
 * Cada sala añade encima lo suyo: la de voz, el estado del micrófono; la del
 * mundo, dónde está parado.
 */
export type BaseMember = {
  peerId: string;
  socket: WebSocket;
  /** Marca del último pong, para detectar sockets zombis. */
  alive: boolean;
};

export type Member = BaseMember & {
  userId: string;
  displayName: string;
  muted: boolean;
  camera: boolean;
  sharing: boolean;
  /**
   * `MediaStream.id` de cada vía de vídeo, si está activa. Cámara y pantalla
   * viajan en streams separados para poder estar las dos encendidas a la vez;
   * esto es lo que le permite al otro extremo saber cuál es cuál al recibir
   * las pistas por `ontrack`, sin que el servidor toque el vídeo en ningún
   * momento — solo reenvía este identificador junto al resto del estado.
   */
  cameraStreamId?: string | null;
  screenStreamId?: string | null;
};

export type Outbound = Record<string, unknown> & { type: string };

/**
 * Genérico en el tipo de miembro para que la sala del mundo no tenga que
 * duplicar el reparto ni arrastrar campos que no usa (micrófono, cámara).
 * El día que la presencia haya que respaldarla con Redis, sigue siendo un
 * solo sitio que tocar.
 */
export class Hub<M extends BaseMember = Member> {
  private readonly rooms = new Map<string, Map<string, M>>();

  join(roomId: string, member: M): void {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Map();
      this.rooms.set(roomId, room);
    }
    room.set(member.peerId, member);
  }

  leave(roomId: string, peerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.delete(peerId);
    if (room.size === 0) this.rooms.delete(roomId);
  }

  members(roomId: string): M[] {
    return [...(this.rooms.get(roomId)?.values() ?? [])];
  }

  get(roomId: string, peerId: string): M | undefined {
    return this.rooms.get(roomId)?.get(peerId);
  }

  /** Envía a todos menos al indicado. */
  broadcast(roomId: string, payload: Outbound, exceptPeerId?: string): void {
    for (const member of this.members(roomId)) {
      if (member.peerId === exceptPeerId) continue;
      send(member.socket, payload);
    }
  }

  /**
   * Envía solo a quien cumpla la condición. Existe para el mundo: qué zona
   * pisa alguien no se le puede contar a quien no tiene acceso a esa zona,
   * porque el identificador de la zona lleva al canal que proyecta.
   */
  broadcastWhere(
    roomId: string,
    payload: Outbound,
    allowed: (member: M) => boolean,
    exceptPeerId?: string,
  ): void {
    for (const member of this.members(roomId)) {
      if (member.peerId === exceptPeerId) continue;
      if (!allowed(member)) continue;
      send(member.socket, payload);
    }
  }

  sendTo(roomId: string, peerId: string, payload: Outbound): boolean {
    const member = this.get(roomId, peerId);
    if (!member) return false;
    send(member.socket, payload);
    return true;
  }
}

/** OPEN === 1. Escribir en un socket cerrado lanza; comprobarlo no. */
export function send(socket: WebSocket, payload: Outbound): void {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // Un socket que se cae a mitad de un envío se limpia solo en su 'close'.
  }
}

/**
 * Alguien dentro de la oficina de un workspace.
 *
 * La posición vive aquí y no en Postgres, por lo mismo que el estado en vivo
 * de una llamada: se limpia sola cuando el socket se cierra. Una tabla se
 * quedaría con gente de pie en una oficina vacía.
 */
export type WorldMember = BaseMember & {
  userId: string;
  displayName: string;
  /**
   * La cartelera: a qué se dedica y si se le puede interrumpir.
   *
   * Se resuelve al conectar y viaja con cada reparto, en vez de pedirse
   * aparte: son dos campos cortos, y una segunda petición por cada persona
   * que entra en la sala para pintar su cartel sería mucho más cara que
   * llevarlos puestos.
   */
  presence: "available" | "busy_open" | "do_not_disturb";
  title: string | null;
  /** Coordenadas en tiles, con decimales: el avatar se mueve entre casillas. */
  x: number;
  y: number;
  facing: "n" | "s" | "e" | "o";
  moving: boolean;
  /** Sentado en un mueble: cambia la postura y bloquea el movimiento. */
  sitting: boolean;
  /** Zona que pisa ahora mismo, o null si está en el pasillo. */
  zoneId: string | null;
  /**
   * Zonas que esta persona puede ver, resuelto al conectar. El reparto de
   * «fulano entró en la zona X» se filtra con esto: el identificador de una
   * zona lleva a su canal, así que contárselo a quien no tiene acceso es
   * decirle que ese canal existe.
   */
  allowedZones: Set<string>;
  /** Última vez que mandó posición, para acotar la frecuencia. */
  lastMoveAt: number;
  /** Se movió desde el último tick y hay que incluirlo en el siguiente. */
  dirty: boolean;
};

export const voiceHub = new Hub();
export const fileHub = new Hub();
/** Una sala por canal de conversación, para repartir los mensajes nuevos. */
export const channelHub = new Hub();
/** Una sala por persona, para las notificaciones. */
export const userHub = new Hub();
/** Una sala por workspace: la oficina de la vista inmersiva. */
export const worldHub = new Hub<WorldMember>();
