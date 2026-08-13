import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../..");

loadEnv({ path: join(repoRoot, ".env") });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // La API se conecta con el rol devup_app, que no es propietario de las
  // tablas. Ver db/grants.sql: si esto apunta al rol propietario, RLS deja de
  // aplicarse y el aislamiento entre organizaciones desaparece en silencio.
  DATABASE_URL: z.string().min(1),

  AUTH_SECRET: z.string().min(16, "AUTH_SECRET necesita al menos 16 caracteres"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  S3_SIGNED_URL_TTL: z.coerce.number().int().positive().default(900),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(104857600),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((i) => `  · ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(`Configuración inválida en .env:\n${detail}`);
  process.exit(1);
}

export const env = parsed.data;

export const webOrigins = env.WEB_ORIGIN.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (env.NODE_ENV === "production" && !env.COOKIE_SECURE) {
  console.warn(
    "AVISO: COOKIE_SECURE=false en producción. Las cookies de sesión viajarán " +
      "por HTTP plano y cualquiera en la red puede robarlas.",
  );
}
