import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import {
  buscarVideos,
  idDeEnlace,
  resolverVideo,
  youtubeConfigurado,
} from "../connectors/youtube.js";
import { badRequest, parseQuery } from "../lib/http.js";

/**
 * La segunda fuente de música, al lado de Spotify.
 *
 * Solo busca y resuelve. La COLA NO SE TOCA: acepta cualquier `trackUri`
 * desde que se escribió, así que `youtube:VIDEO_ID` entra por la misma puerta
 * que `spotify:track:...` y el prefijo dice a qué reproductor le toca. Eso ya
 * lo anticipaba el comentario de `/spotify/resolver`: «el día que haya un
 * segundo servicio, esto es lo único que hay que escribir otra vez».
 *
 * Ninguna de las dos rutas exige tener nada conectado. Buscar no es una
 * acción sobre la cuenta de nadie, y pedir una conexión personal para esto
 * dejaría sin música justo a quien todavía no tiene ninguna.
 */
export async function youtubeRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Para que la interfaz sepa si enseñar la pestaña de YouTube. Un buscador
   * que lleva a una ruta sin configurar es peor que no tenerlo: se escribe,
   * no sale nada, y no hay forma de saber por qué.
   */
  app.get("/youtube/policy", async () => ({ configured: youtubeConfigurado() }));

  /**
   * Buscar. Cuesta 100 unidades de las 10.000 diarias que da la cuota
   * gratuita —unas cien búsquedas al día para toda la instancia—, y por eso
   * el error de cuota se cuenta con su nombre: quien lo vea tiene que
   * entender que no está roto, que se acabó por hoy, y que pegar un enlace
   * sigue funcionando porque cuesta cien veces menos.
   */
  app.get("/youtube/search", { onRequest: requireSession }, async (request) => {
    const { q } = parseQuery(z.object({ q: z.string().trim().min(1).max(200) }), request.query);
    if (!youtubeConfigurado()) {
      throw badRequest("esta instancia no tiene YouTube configurado");
    }

    try {
      return { tracks: await buscarVideos(q) };
    } catch (fallo) {
      const mensaje = fallo instanceof Error ? fallo.message : "";
      if (mensaje.includes("403") && /quota/i.test(mensaje)) {
        throw badRequest(
          "se agotó la cuota diaria de búsqueda de YouTube. Pegando el enlace del vídeo " +
            "sigue funcionando: eso cuesta cien veces menos y no se agota.",
        );
      }
      throw fallo;
    }
  });

  /**
   * Un enlace pegado a mano. Es el camino barato —una unidad de cuota— y el
   * que sigue en pie cuando la búsqueda se agota.
   *
   * Devuelve 200 con `null` cuando el vídeo no existe o su dueño no permite
   * incrustarlo. No es un error del que informar como si algo se hubiera
   * roto: es una respuesta normal, y la interfaz la cuenta como «ese vídeo no
   * se puede poner aquí».
   */
  app.get("/youtube/resolver", { onRequest: requireSession }, async (request) => {
    const { url } = parseQuery(z.object({ url: z.string().min(1).max(500) }), request.query);
    if (!youtubeConfigurado()) {
      throw badRequest("esta instancia no tiene YouTube configurado");
    }

    const id = idDeEnlace(url);
    if (!id) throw badRequest("eso no parece un enlace de YouTube");

    return { track: await resolverVideo(id) };
  });
}
