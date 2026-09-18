import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireSession } from "../auth/plugin.js";
import { env, stunUrls, turnUrls } from "../env.js";
import { requireUser } from "../lib/http.js";

/**
 * Servidores ICE para la sala de voz.
 *
 * Esto lo sirve la API y no una variable `NEXT_PUBLIC_*` por un motivo
 * concreto: todo lo que empieza por NEXT_PUBLIC_ acaba escrito en el bundle de
 * JavaScript, que cualquiera puede leer. Una credencial fija de TURN ahí es un
 * relé abierto a internet con tu factura de ancho de banda.
 *
 * Con `TURN_SECRET` se emiten credenciales temporales: el usuario es
 * `<caducidad unix>:<userId>` y la contraseña es su HMAC-SHA1 con el secreto
 * compartido con coturn (`--use-auth-secret`). El navegador nunca ve el
 * secreto, y la credencial que recibe deja de valer sola.
 *
 * Meter el userId dentro del usuario no es decorativo: si hay que investigar
 * un abuso del relé, los registros de coturn dicen de quién era la credencial.
 */
export async function iceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/calls/ice-servers", { onRequest: requireSession }, async (request) => {
    const userId = requireUser(request);

    if (env.METERED_API_KEY) {
      return fetchMeteredIceServers(request);
    }

    const iceServers: RTCIceServerLike[] = [];

    if (stunUrls.length > 0) iceServers.push({ urls: stunUrls });

    if (turnUrls.length > 0) {
      if (env.TURN_SECRET) {
        const expira = Math.floor(Date.now() / 1000) + env.TURN_TTL_SECONDS;
        const username = `${expira}:${userId}`;
        const credential = createHmac("sha1", env.TURN_SECRET)
          .update(username)
          .digest("base64");
        iceServers.push({ urls: turnUrls, username, credential });
      } else if (env.TURN_STATIC_USERNAME && env.TURN_STATIC_CREDENTIAL) {
        // El coturn de desarrollo. `env.ts` impide que esta rama llegue a
        // producción con TURN configurado.
        iceServers.push({
          urls: turnUrls,
          username: env.TURN_STATIC_USERNAME,
          credential: env.TURN_STATIC_CREDENTIAL,
        });
      } else {
        request.log.warn(
          "TURN_URLS está puesto pero no hay ni TURN_SECRET ni credencial fija; " +
            "se sirve solo STUN",
        );
      }
    }

    return {
      iceServers,
      // La interfaz lo usa para avisar en pantalla. Sin TURN la llamada conecta
      // y parece correcta, pero en NAT simétrico no llega el audio, y es mejor
      // decirlo antes que dejar que lo descubran a mitad de una reunión.
      turnConfigured: turnUrls.length > 0,
    };
  });
}

type RTCIceServerLike = {
  urls: string[];
  username?: string;
  credential?: string;
};

type MeteredIceServer = {
  urls: string;
  username?: string;
  credential?: string;
};

/**
 * TURN de Metered.ca en vez de coturn propio: cada llamada le pide a Metered
 * una credencial nueva con su propia API, así que aquí nunca se guarda ni se
 * reutiliza un secreto fijo — la caducidad y la rotación las gestiona Metered.
 * Si su API falla, se sirve solo STUN en vez de tumbar la petición entera.
 *
 * CON PLAZO, Y NO ES UN DETALLE. Esta llamada es lo PRIMERO que hace `join()`
 * en el cliente: antes de pedir el micrófono, antes de abrir el socket. Sin
 * plazo, un Metered lento no da error —se queda—, y lo que se ve es el botón de
 * entrar a la sala girando para siempre sin decir nada, con la llamada sin
 * empezar y sin nada que mirar en los registros. Un tercero que tarda no puede
 * decidir cuánto dura una llamada nuestra: a los seis segundos se sigue sin él,
 * con STUN, que es exactamente lo que ya hace cuando contesta mal.
 *
 * Seis y no quince: aquí hay alguien esperando delante de una pantalla, no un
 * refresco de fondo. Medido contra la API de Metered, la respuesta normal tarda
 * poco más de un segundo.
 */
const PLAZO_MS = 6_000;

async function fetchMeteredIceServers(request: FastifyRequest) {
  const url =
    `https://${env.METERED_APP_NAME}.metered.live/api/v1/turn/credentials` +
    `?apiKey=${encodeURIComponent(env.METERED_API_KEY)}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PLAZO_MS) });
    if (!response.ok) {
      throw new Error(`Metered respondió ${response.status}`);
    }
    const servers = (await response.json()) as MeteredIceServer[];
    const iceServers: RTCIceServerLike[] = servers.map((s) => ({
      urls: [s.urls],
      ...(s.username ? { username: s.username } : {}),
      ...(s.credential ? { credential: s.credential } : {}),
    }));
    return {
      iceServers,
      turnConfigured: iceServers.some((s) => s.username),
    };
  } catch (error) {
    request.log.warn(
      { error },
      "No se pudo obtener credenciales de Metered.ca; se sirve solo STUN",
    );
    // Sin TURN la llamada conecta igual y, en muchas redes, no se oye nada. El
    // cliente lo enseña en pantalla con `turnConfigured`, pero quien mira los
    // registros de producción también tiene que poder saberlo.
    return {
      iceServers: stunUrls.length > 0 ? [{ urls: stunUrls }] : [],
      turnConfigured: false,
    };
  }
}
