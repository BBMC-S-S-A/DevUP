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
export type Member = {
  peerId: string;
  userId: string;
  displayName: string;
  socket: WebSocket;
  muted: boolean;
  camera: boolean;
  sharing: boolean;
  /** Marca del último pong, para detectar sockets zombis. */
  alive: boolean;
};

export type Outbound = Record<string, unknown> & { type: string };

export class Hub {
  private readonly rooms = new Map<string, Map<string, Member>>();

  join(roomId: string, member: Member): void {
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

  members(roomId: string): Member[] {
    return [...(this.rooms.get(roomId)?.values() ?? [])];
  }

  get(roomId: string, peerId: string): Member | undefined {
    return this.rooms.get(roomId)?.get(peerId);
  }

  /** Envía a todos menos al indicado. */
  broadcast(roomId: string, payload: Outbound, exceptPeerId?: string): void {
    for (const member of this.members(roomId)) {
      if (member.peerId === exceptPeerId) continue;
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

export const voiceHub = new Hub();
export const fileHub = new Hub();
