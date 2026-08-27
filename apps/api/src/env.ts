import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../..");

loadEnv({ path: join(repoRoot, ".env") });

/** El valor que trae `.env.example`. Sirve para detectar que nadie lo cambió. */
const SECRETO_DE_EJEMPLO = "cambiame-en-produccion-por-32-bytes-aleatorios";
/** Igual, pero para VAULT_MASTER_KEY: tiene que decodificar a 32 bytes de verdad. */
const VAULT_DE_EJEMPLO = "ISL/c4r0CmSwLDWakAZYc5Hda7maptiLU0F+gHAqh+0=";

const bool = (fallback: "true" | "false") =>
  z
    .string()
    .default(fallback)
    .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // La API se conecta con el rol devup_app, que no es propietario de las
  // tablas. Ver db/grants.sql: si esto apunta al rol propietario, RLS deja de
  // aplicarse y el aislamiento entre organizaciones desaparece en silencio.
  DATABASE_URL: z.string().min(1),

  AUTH_SECRET: z.string().min(16, "AUTH_SECRET necesita al menos 16 caracteres"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  COOKIE_SECURE: bool("false"),

  // Cifra lo que guarda la bóveda de credenciales (connection_secrets): el
  // token de GitHub de una organización, el de Spotify de una persona. AES-256
  // exige exactamente 32 bytes, así que el valor tiene que ser ese en base64,
  // no cualquier cadena como AUTH_SECRET.
  VAULT_MASTER_KEY: z
    .string()
    .default(VAULT_DE_EJEMPLO)
    .refine((v) => {
      try {
        return Buffer.from(v, "base64").length === 32;
      } catch {
        return false;
      }
    }, "VAULT_MASTER_KEY debe ser 32 bytes codificados en base64"),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  /** Base pública de la web, para componer los enlaces de los correos. */
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),

  // --- Altas -----------------------------------------------------------------
  // `invite` es el valor por defecto a propósito: una instancia de equipo con
  // el registro abierto es una instancia donde entra cualquiera que encuentre
  // la URL. El primer usuario siempre puede darse de alta aunque el modo sea
  // `invite`, porque si no, nadie podría invitar a nadie.
  SIGNUP_MODE: z.enum(["invite", "open"]).default("invite"),
  /** Exigir correo verificado para poder entrar. */
  REQUIRE_EMAIL_VERIFICATION: bool("false"),

  // --- Correo ----------------------------------------------------------------
  // Sin SMTP configurado, los correos se escriben en el registro con su enlace.
  // Vale para desarrollo; en producción es un aviso ruidoso al arrancar.
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("DevUP <no-reply@devup.local>"),

  // --- Almacenamiento S3-compatible ------------------------------------------
  //
  // DOS DIRECCIONES PARA EL MISMO ALMACÉN, Y NO ES REDUNDANCIA.
  //
  // `S3_ENDPOINT` es la pública, y tiene que serlo: las URLs firmadas las abre
  // el navegador de cada persona, así que apuntan a un host alcanzable desde
  // fuera. `S3_ENDPOINT_INTERNO` es por dónde habla el servidor consigo mismo.
  //
  // Con una sola dirección, comprobar que una subida llegó salía a internet,
  // atravesaba Cloudflare y volvía: 154 ms medidos, contra 3 ms por la red de
  // contenedores. Cincuenta veces más lento, y —lo que importa— dependiendo de
  // que la red de salida funcione para una pregunta que el servidor puede
  // responderse solo. Cualquier corte ahí fuera se convertía en «la subida no
  // llegó a completarse» sobre un archivo que estaba perfectamente guardado.
  //
  // Sin definir, vale la pública: en desarrollo las dos son la misma.
  S3_ENDPOINT: z.string().url(),
  S3_ENDPOINT_INTERNO: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool("true"),
  S3_SIGNED_URL_TTL: z.coerce.number().int().positive().default(900),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(104857600),

  // --- Voz -------------------------------------------------------------------
  // Los servidores ICE los sirve la API, no el bundle del navegador. Ver
  // docs/TURN.md: una credencial de TURN en NEXT_PUBLIC_* es un relé abierto
  // para cualquiera que abra las herramientas de desarrollo.
  STUN_URLS: z
    .string()
    .default("stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"),
  TURN_URLS: z.string().default(""),
  /** Secreto compartido con coturn (`--use-auth-secret`). */
  TURN_SECRET: z.string().default(""),
  TURN_TTL_SECONDS: z.coerce.number().int().positive().default(12 * 3600),
  /** Solo para el coturn de desarrollo, que usa credenciales fijas. */
  TURN_STATIC_USERNAME: z.string().default(""),
  TURN_STATIC_CREDENTIAL: z.string().default(""),
  /**
   * TURN gestionado de un tercero (Metered.ca) en vez de coturn propio. La API
   * pide una credencial nueva a Metered en cada petición a /calls/ice-servers
   * — nunca guardamos una credencial fija de Metered en nuestro propio
   * entorno, así que no dispara la misma protección que TURN_STATIC_*.
   */
  METERED_APP_NAME: z.string().default(""),
  METERED_API_KEY: z.string().default(""),

  // --- Música compartida (Spotify) --------------------------------------------
  // Vacíos por defecto: sin ellos, la ruta de conectar Spotify avisa de que
  // la instancia no lo tiene configurado en vez de fallar a medias.
  SPOTIFY_CLIENT_ID: z.string().default(""),
  SPOTIFY_CLIENT_SECRET: z.string().default(""),
  /** Tiene que coincidir carácter a carácter con lo registrado en el panel de Spotify. */
  SPOTIFY_REDIRECT_URI: z.string().default(""),
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

export const stunUrls = env.STUN_URLS.split(",")
  .map((u) => u.trim())
  .filter(Boolean);

export const turnUrls = env.TURN_URLS.split(",")
  .map((u) => u.trim())
  .filter(Boolean);

/**
 * Comprobaciones que solo importan en producción.
 *
 * Se aborta el arranque en vez de avisar. Un aviso en el registro de arranque
 * lo lee nadie: la primera vez que se despliega hay cien líneas más, y la
 * segunda ya nadie mira. Un proceso que no levanta sí se ve.
 */
if (env.NODE_ENV === "production") {
  const fatales: string[] = [];

  if (env.AUTH_SECRET === SECRETO_DE_EJEMPLO) {
    fatales.push(
      "AUTH_SECRET sigue teniendo el valor de .env.example. Cualquiera que haya " +
        "leído el repositorio puede firmar sesiones válidas.\n" +
        '    Genera uno: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    );
  }

  if (env.VAULT_MASTER_KEY === VAULT_DE_EJEMPLO) {
    fatales.push(
      "VAULT_MASTER_KEY sigue teniendo el valor de .env.example. Cualquiera que haya " +
        "leído el repositorio podría descifrar cualquier credencial guardada en la bóveda.\n" +
        '    Genera uno: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  if (!env.COOKIE_SECURE) {
    fatales.push(
      "COOKIE_SECURE=false en producción. Las cookies de sesión viajarían por " +
        "HTTP plano y cualquiera en la red podría robarlas.",
    );
  }

  if (env.APP_BASE_URL.startsWith("http://")) {
    fatales.push(
      `APP_BASE_URL apunta a HTTP plano (${env.APP_BASE_URL}). Los enlaces de ` +
        "invitación y de recuperar contraseña son credenciales de un solo uso y " +
        "no pueden viajar sin cifrar.",
    );
  }

  if (turnUrls.length > 0 && !env.TURN_SECRET && env.TURN_STATIC_CREDENTIAL) {
    fatales.push(
      "TURN configurado con credencial fija en producción. Usa TURN_SECRET y " +
        "credenciales temporales; ver docs/TURN.md.",
    );
  }

  if (fatales.length > 0) {
    console.error(
      "\nNo se arranca en producción con esta configuración:\n\n" +
        fatales.map((f) => `  ✗ ${f}`).join("\n\n") +
        "\n",
    );
    process.exit(1);
  }

  if (turnUrls.length === 0) {
    console.warn(
      "[aviso] Sin TURN configurado. Las llamadas conectarán pero no se oirá " +
        "nada en NAT simétrico ni en buena parte de las redes móviles.",
    );
  }
  if (!env.SMTP_URL) {
    console.warn(
      "[aviso] Sin SMTP configurado: las invitaciones y los correos de " +
        "recuperación se escribirán en el registro en vez de enviarse.",
    );
  }
}
