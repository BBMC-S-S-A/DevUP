import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Hash de contraseñas con scrypt, que viene en Node y no arrastra dependencias
 * nativas. Los parámetros son los recomendados por OWASP para scrypt.
 *
 * N=2^15 con r=8 pide unos 33 MB por hash: por encima del maxmem por defecto
 * de Node (32 MB), de ahí que haya que subirlo explícitamente. Sin eso, el
 * hash falla con un error que no menciona la memoria por ningún lado.
 */
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/**
 * Comprueba una contraseña contra su hash.
 *
 * Los parámetros salen del propio hash, no de las constantes de arriba: así
 * las contraseñas creadas con parámetros antiguos siguen validando cuando se
 * suban los costes, en vez de dejar a todo el mundo fuera de su cuenta.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltRaw, "base64url");
  const expected = Buffer.from(hashRaw, "base64url");

  const derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
    N,
    r,
    p,
    maxmem: Math.max(PARAMS.maxmem, 128 * N * r * 2),
  });

  // Comparación en tiempo constante: comparar con === filtra por cuánto tarda
  // en fallar cuántos bytes iniciales eran correctos.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Hash falso con el mismo coste que uno real.
 *
 * Se usa cuando el correo no existe: sin esto, un acceso con correo
 * desconocido responde en microsegundos y uno con correo válido tarda lo que
 * tarde scrypt, y esa diferencia deja enumerar qué cuentas existen.
 */
const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));

export async function burnTime(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}
