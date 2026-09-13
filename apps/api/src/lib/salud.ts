import type { Db } from "../db/pool.js";
import { env } from "../env.js";
import { almacenResponde } from "../storage/s3.js";

/**
 * El estado de esta instalación: qué está configurado y qué no.
 *
 * QUÉ PROBLEMA RESUELVE. Saber si el despliegue está al día, si el almacén
 * responde o si el correo sale de verdad exige hoy entrar por SSH. Así que no
 * se mira — y lo que no se mira se descubre el día que alguien intenta subir un
 * archivo, o cuando un correo de invitación no llega y nadie sabe por qué.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO DEVUELVE NI UN SOLO VALOR, SOLO ESTADOS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Ni una clave, ni una dirección, ni un identificador de cliente. Sale por la
 * API a un navegador, y una pantalla de diagnóstico que enseña la mitad de un
 * secreto es una filtración con buena intención. «Configurado» y «sin
 * configurar» contestan la pregunta entera.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTO NO PUEDE SABER, Y SE DICE EN VEZ DE ADIVINARLO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Cuántas migraciones faltan.** La imagen de la API no lleva `db/migrations`
 * —ver su Dockerfile: copia `dist`, no el repositorio— así que el servidor
 * puede decir cuántas ha APLICADO y cuál fue la última, pero no contra qué
 * compararlas. Quien sabe eso es el flujo de despliegue, que sí tiene el
 * repositorio delante y ya se planta si hay alguna sin aplicar.
 *
 * Inventarse ese número leyendo una carpeta que en producción no existe daría
 * «0 pendientes» siempre, que es la peor respuesta posible: tranquiliza.
 */

export type Salud = {
  entorno: {
    nodeEnv: string;
    /** Cómo se entra: solo con invitación, o cualquiera. */
    altas: "invite" | "open";
    verificaCorreo: boolean;
  };
  migraciones: {
    aplicadas: number;
    ultima: { nombre: string; cuando: string } | null;
  };
  almacen: { responde: boolean };
  correo: { via: "smtp" | "api" | "sin configurar" };
  llamadas: { turn: "propio" | "metered" | "sin configurar" };
  boveda: { conClaveDeEjemplo: boolean };
  entrar: { google: boolean };
  integraciones: { spotify: boolean; youtube: boolean };
};

/** La del `.env.example`. Si sigue puesta, cualquiera que lo lea descifra la bóveda. */
const VAULT_DE_EJEMPLO = "ISL/c4r0CmSwLDWakAZYc5Hda7maptiLU0F+gHAqh+0=";

export async function saludDeLaInstalacion(db: Db): Promise<Salud> {
  const { rows } = await db.query<{ aplicadas: string; nombre: string | null; cuando: string | null }>(
    `select count(*)::text as aplicadas,
            max(name) as nombre,
            max(applied_at)::text as cuando
       from public.schema_migrations`,
  );
  const fila = rows[0];

  return {
    entorno: {
      nodeEnv: env.NODE_ENV,
      altas: env.SIGNUP_MODE,
      verificaCorreo: env.REQUIRE_EMAIL_VERIFICATION,
    },
    migraciones: {
      aplicadas: Number(fila?.aplicadas ?? 0),
      // `max(name)` funciona porque van numeradas con ceros a la izquierda:
      // el orden alfabético y el cronológico coinciden. Si algún día alguien
      // numera sin ceros, esto miente — y por eso está escrito aquí.
      ultima: fila?.nombre ? { nombre: fila.nombre, cuando: fila.cuando ?? "" } : null,
    },
    // La única comprobación que sale a la red. Las demás son leer variables.
    almacen: { responde: await almacenResponde() },
    correo: {
      via: env.SMTP_URL ? "smtp" : env.MAIL_API_KEY ? "api" : "sin configurar",
    },
    llamadas: {
      // Sin TURN, una llamada entre dos redes con NAT estricto no se establece
      // —ni con aviso: se queda «conectando»— así que esto no es un adorno.
      turn: env.TURN_URLS
        ? "propio"
        : env.METERED_API_KEY
          ? "metered"
          : "sin configurar",
    },
    boveda: { conClaveDeEjemplo: env.VAULT_MASTER_KEY === VAULT_DE_EJEMPLO },
    entrar: { google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) },
    integraciones: {
      spotify: Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET),
      youtube: Boolean(env.YOUTUBE_API_KEY),
    },
  };
}
