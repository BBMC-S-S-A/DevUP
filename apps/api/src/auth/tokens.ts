import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../env.js";

const secret = new TextEncoder().encode(env.AUTH_SECRET);
const ISSUER = "devup";
const AUDIENCE = "devup-api";

/** Convierte «15m», «30d», «2h», «90s» a segundos. */
export function parseDuration(input: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(input.trim());
  if (!match) throw new Error(`Duración inválida: ${input} (usa 30s, 15m, 2h o 30d)`);
  const value = Number(match[1]);
  const unit = match[2] as "s" | "m" | "h" | "d";
  return value * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
}

export const accessTtlSeconds = parseDuration(env.ACCESS_TOKEN_TTL);
export const refreshTtlSeconds = parseDuration(env.REFRESH_TOKEN_TTL);

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${accessTtlSeconds}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    // Caducado, manipulado o con otra firma: para el que llama es lo mismo.
    return null;
  }
}

/**
 * Token de refresco: 32 bytes aleatorios. Opaco a propósito — no lleva
 * información dentro, así que revocarlo es borrar una fila y no hay forma de
 * que siga valiendo después.
 *
 * En la base se guarda solo el hash. Quien consiga leer la tabla `sessions`
 * no puede suplantar a nadie con lo que encuentre allí.
 */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Comparación en tiempo constante para secretos de longitud conocida. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
