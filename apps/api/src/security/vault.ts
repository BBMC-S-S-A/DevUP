import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env.js";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Cifrado de la bóveda de credenciales: el token de GitHub de una
 * organización, el de Spotify de una persona. AES-256-GCM porque viene con
 * Node, sin dependencias nuevas — igual que scrypt para contraseñas.
 *
 * El resultado empaqueta iv + etiqueta de autenticación + texto cifrado en un
 * solo buffer, para que `connection_secrets` tenga una sola columna y no tres
 * que puedan desincronizarse entre sí.
 *
 * Quien llame a `decryptSecret` es responsable de no dejar el resultado
 * escapar hacia una respuesta HTTP: esto descifra, no decide quién debería
 * verlo — eso ya lo decidió RLS al dejar leer la fila cifrada.
 */
export function encryptSecret(plaintext: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(env.VAULT_MASTER_KEY, "base64"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptSecret(packed: Buffer): string {
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(env.VAULT_MASTER_KEY, "base64"), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
