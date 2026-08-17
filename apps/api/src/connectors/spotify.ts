import { env } from "../env.js";

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

const basicAuth = () =>
  Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64");

async function tokenRequest(body: URLSearchParams): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const response = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Spotify token respondió ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>;
}

export function authorizeUrl(state: string): string {
  /**
   * Los permisos que se piden.
   *
   * Los tres últimos —playlists y canciones guardadas— se añadieron después de
   * la primera versión, y eso tiene una consecuencia que hay que contar: los
   * permisos se conceden al autorizar, no al llamar. Quien conectó su cuenta
   * antes tiene un token sin ellos y sus playlists devolverán 403 hasta que
   * vuelva a conectar. La interfaz lo detecta y lo dice en vez de enseñar una
   * lista vacía, que parecería que no tiene playlists.
   */
  const scopes = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
  ];
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.SPOTIFY_CLIENT_ID,
    scope: scopes.join(" "),
    redirect_uri: env.SPOTIFY_REDIRECT_URI,
    state,
  });
  return `${ACCOUNTS}/authorize?${params.toString()}`;
}

export function exchangeCode(code: string) {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.SPOTIFY_REDIRECT_URI,
    }),
  );
}

/**
 * Spotify puede devolver un `refresh_token` nuevo al refrescar, o no —la
 * documentación lo deja como "a veces"—. Quien llame tiene que quedarse con
 * el que llegue y, si no llega ninguno, seguir usando el que ya tenía.
 */
export function refreshAccessToken(refreshToken: string) {
  return tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
}

/**
 * Token de aplicación (client credentials), para buscar sin que nadie haya
 * conectado su cuenta todavía. Cacheado en memoria: pedir uno nuevo en cada
 * búsqueda sería una llamada de más por cada tecla.
 */
let appToken: { token: string; expiresAt: number } | null = null;

export async function getAppToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now() + 30_000) return appToken.token;
  const { access_token, expires_in } = await tokenRequest(
    new URLSearchParams({ grant_type: "client_credentials" }),
  );
  appToken = { token: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return access_token;
}

export type SpotifyTrack = {
  uri: string;
  name: string;
  artist: string;
  imageUrl: string | null;
  durationMs: number;
};

export async function searchTracks(token: string, query: string): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({ q: query, type: "track", limit: "10" });
  const response = await fetch(`${API}/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Spotify search respondió ${response.status}`);
  const body = (await response.json()) as {
    tracks: {
      items: {
        uri: string;
        name: string;
        artists: { name: string }[];
        album: { images: { url: string }[] };
        duration_ms: number;
      }[];
    };
  };
  return body.tracks.items.map((track) => ({
    uri: track.uri,
    name: track.name,
    artist: track.artists.map((a) => a.name).join(", "),
    imageUrl: track.album.images[0]?.url ?? null,
    durationMs: track.duration_ms,
  }));
}

/** `product` es "premium", "free" o "open" (cuenta sin verificar). */
export async function getProfile(
  token: string,
): Promise<{ id: string; displayName: string; product: string }> {
  const response = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Spotify /me respondió ${response.status}`);
  const body = (await response.json()) as { id: string; display_name: string; product: string };
  return { id: body.id, displayName: body.display_name, product: body.product };
}
