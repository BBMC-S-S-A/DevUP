import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
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
