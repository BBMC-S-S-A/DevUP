import { api } from "./api";

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";

/**
 * Ticket efímero para abrir un WebSocket.
 *
 * `new WebSocket()` no admite cabeceras, así que el token no puede ir en
 * Authorization y tiene que viajar en la URL — donde acaba en los registros
 * del servidor, del proxy y del navegador. Por eso este ticket dura un minuto
 * y solo sirve para el apretón de manos inicial, en vez de mandar la sesión.
 */
export async function requestTicket(): Promise<string> {
  const { ticket } = await api.get<{ ticket: string }>("/auth/ws-ticket");
  return ticket;
}

export function buildWsUrl(path: string, params: Record<string, string>): string {
  const url = new URL(path, WS_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
