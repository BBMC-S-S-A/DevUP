import { refreshAccessToken } from "../../connectors/spotify.js";
import { type Db, withUser } from "../../db/pool.js";
import { notFound } from "../../lib/http.js";
import { decryptSecret, encryptSecret } from "../../security/vault.js";

/** Lo que se guarda cifrado en la bóveda para una cuenta de Spotify. */
export type StoredTokens = { accessToken: string; refreshToken: string };

/**
 * Token de acceso válido del usuario, refrescando si hace falta. Lanza si no
 * tiene Spotify conectado — quien llama decide si eso es un 404 o un
 * "conecta tu cuenta" en la interfaz.
 */
export async function getValidUserToken(userId: string): Promise<string> {
  return withUser(userId, async (db) => getValidUserTokenWithDb(db, userId));
}

export async function getValidUserTokenWithDb(db: Db, userId: string): Promise<string> {
  const { rows } = await db.query<{
    connection_id: string;
    encrypted_secret: Buffer;
    expires_at: Date | null;
  }>(
    `select c.id as connection_id, s.encrypted_secret, s.expires_at
       from connections c
       join connection_secrets s on s.connection_id = c.id
      where c.provider = 'spotify' and c.user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw notFound("Spotify no está conectado");

  const stored = JSON.parse(decryptSecret(row.encrypted_secret)) as StoredTokens;
  const expired = !row.expires_at || row.expires_at.getTime() < Date.now() + 30_000;
  if (!expired) return stored.accessToken;

  const refreshed = await refreshAccessToken(stored.refreshToken);
  const packed: StoredTokens = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? stored.refreshToken,
  };
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await db.query(
    "update connection_secrets set encrypted_secret = $2, expires_at = $3 where connection_id = $1",
    [row.connection_id, encryptSecret(JSON.stringify(packed)), expiresAt],
  );
  return refreshed.access_token;
}
