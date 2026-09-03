/**
 * YouTube como segunda fuente de música, al lado de Spotify.
 *
 * POR QUÉ EXISTE. La aplicación de Spotify vive en «modo desarrollo», que
 * admite CINCO cuentas y hay que darlas de alta a mano en su panel. Salir de
 * ahí (Extended Quota Mode) exige, desde mayo de 2025, ser una organización
 * con 250.000 usuarios activos al mes — o sea que no es algo que se arregle
 * configurando. YouTube no tiene lista blanca: quien se registre hoy puede oír
 * música sin pedirle permiso a nadie.
 *
 * NO SUSTITUYE A SPOTIFY. Quien tenga Spotify Premium y esté dado de alta
 * sigue con su catálogo y su sonido. Esto es la puerta para el resto.
 *
 * LA MISMA FORMA QUE `connectors/spotify.ts` a propósito: la cola guarda
 * canciones, no enlaces de un servicio, y quien la lee no debería tener que
 * saber de dónde vino cada una. El prefijo de `uri` —`youtube:` frente a
 * `spotify:track:`— es lo único que las distingue, y es lo que usa el
 * reproductor para saber a quién dársela.
 *
 * DE LA CUOTA, QUE ES LO QUE MÁS DUELE. La API gratuita da 10.000 unidades al
 * día y una búsqueda cuesta 100: unas cien búsquedas diarias para toda la
 * instancia. Por eso `resolverVideo` existe aparte — pegar un enlace cuesta
 * UNA unidad, cien veces menos, y es el camino que conviene enseñar cuando la
 * cuota escasee.
 */
import { env } from "../env.js";

const API = "https://www.googleapis.com/youtube/v3";

export type YoutubeTrack = {
  /** `youtube:VIDEO_ID`. El prefijo es la identidad del servicio. */
  uri: string;
  name: string;
  /** El canal que lo publicó. Es lo más cercano a un artista que hay aquí. */
  artist: string;
  imageUrl: string | null;
  durationMs: number | null;
  /**
   * Siempre null. Un vídeo de YouTube no tiene ISRC —no es una grabación
   * publicada por un sello, es un vídeo—, así que estas pistas no se pueden
   * resolver en otro servicio. Va explícito y no omitido para que quien lea
   * la cola vea que la ausencia es del dato, no del código.
   */
  isrc: null;
};

export function youtubeConfigurado(): boolean {
  return env.YOUTUBE_API_KEY.length > 0;
}

/** El id de un vídeo dentro de las muchas formas de enlace que usa YouTube. */
export function idDeEnlace(texto: string): string | null {
  const limpio = texto.trim();

  // Un id suelto: once caracteres del alfabeto que usa YouTube.
  if (/^[\w-]{11}$/.test(limpio)) return limpio;

  let url: URL;
  try {
    url = new URL(limpio);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  // youtu.be/ID
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0] ?? "";
    return /^[\w-]{11}$/.test(id) ? id : null;
  }

  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") {
    return null;
  }

  // youtube.com/watch?v=ID
  const v = url.searchParams.get("v");
  if (v && /^[\w-]{11}$/.test(v)) return v;

  // youtube.com/embed/ID, /shorts/ID, /live/ID
  const partes = url.pathname.split("/").filter(Boolean);
  if (partes.length >= 2 && ["embed", "shorts", "live", "v"].includes(partes[0]!)) {
    const id = partes[1]!;
    return /^[\w-]{11}$/.test(id) ? id : null;
  }

  return null;
}

/**
 * Duración en milisegundos desde el formato ISO 8601 que devuelve YouTube
 * (`PT4M13S`). Solo horas, minutos y segundos: un vídeo no dura días, y
 * aceptar el formato entero invitaría a confiar en casos que no existen.
 */
function duracionAMilisegundos(iso: string): number | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const [, h, min, s] = m;
  const total = Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
  return total > 0 ? total * 1000 : null;
}

async function pedir(ruta: string, params: Record<string, string>): Promise<unknown> {
  const query = new URLSearchParams({ ...params, key: env.YOUTUBE_API_KEY });
  const respuesta = await fetch(`${API}/${ruta}?${query.toString()}`, {
    // Sin esto, un proveedor que no responde deja colgada la petición del
    // usuario: `fetch` no trae tiempo límite por defecto.
    signal: AbortSignal.timeout(10_000),
  });

  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    // El 403 de aquí casi siempre es la cuota agotada, y el cuerpo lo dice
    // mientras que el código a secas no. Se propaga entero: quien llama
    // decide cómo contarlo.
    throw new Error(`YouTube respondió ${respuesta.status} en ${ruta}: ${cuerpo.slice(0, 300)}`);
  }

  return respuesta.json();
}

type ItemVideo = {
  id: string | { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  contentDetails?: { duration?: string };
};

function aPista(item: ItemVideo, duraciones: Map<string, number | null>): YoutubeTrack | null {
  const id = typeof item.id === "string" ? item.id : item.id.videoId;
  if (!id) return null;
  const s = item.snippet ?? {};
  const miniatura =
    s.thumbnails?.medium?.url ?? s.thumbnails?.default?.url ?? s.thumbnails?.high?.url ?? null;
  return {
    uri: `youtube:${id}`,
    // YouTube devuelve el título con entidades HTML («Tom &amp; Jerry»), y
    // pintarlas tal cual deja el nombre roto en la cola.
    name: descodificar(s.title ?? "sin título"),
    artist: descodificar(s.channelTitle ?? "YouTube"),
    imageUrl: miniatura,
    // La duración puede venir por dos caminos: el mapa que trae `videos.list`
    // (el de la búsqueda, porque `search.list` no la da) o el propio item
    // cuando ya se pidió con `contentDetails`. El mapa manda.
    durationMs:
      duraciones.get(id) ?? duracionAMilisegundos(item.contentDetails?.duration ?? "") ?? null,
    isrc: null,
  };
}

function descodificar(texto: string): string {
  return texto
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

/**
 * Busca vídeos reproducibles dentro de una página ajena.
 *
 * `videoEmbeddable=true` no es un adorno: un vídeo que su dueño no deja
 * incrustar aparecería en la lista, se dejaría encolar y fallaría al sonar,
 * ya dentro de la sala y delante de todos. Filtrarlo aquí es la diferencia
 * entre una búsqueda honesta y una que promete lo que no puede cumplir.
 *
 * Cuesta 100 unidades de las 10.000 diarias. La segunda llamada
 * (`videos.list`) cuesta 1 y trae las duraciones, que `search.list` no da.
 */
export async function buscarVideos(query: string): Promise<YoutubeTrack[]> {
  const busqueda = (await pedir("search", {
    part: "snippet",
    q: query,
    type: "video",
    videoEmbeddable: "true",
    // Música. No es infalible —hay canciones fuera de la categoría— pero
    // quita casi todo lo que no lo es, que es lo que ensucia una cola.
    videoCategoryId: "10",
    maxResults: "10",
  })) as { items?: ItemVideo[] };

  const items = busqueda.items ?? [];
  const ids = items
    .map((i) => (typeof i.id === "string" ? i.id : i.id.videoId))
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  const duraciones = await duracionesDe(ids);
  return items.map((i) => aPista(i, duraciones)).filter((t): t is YoutubeTrack => t !== null);
}

async function duracionesDe(ids: string[]): Promise<Map<string, number | null>> {
  const mapa = new Map<string, number | null>();
  try {
    const detalle = (await pedir("videos", {
      part: "contentDetails",
      id: ids.join(","),
    })) as { items?: { id?: string; contentDetails?: { duration?: string } }[] };
    for (const item of detalle.items ?? []) {
      if (item.id) mapa.set(item.id, duracionAMilisegundos(item.contentDetails?.duration ?? ""));
    }
  } catch {
    // Sin duraciones la cola funciona igual: se pinta sin el tiempo y el
    // reproductor lo sabrá al ponerlo. No merece tumbar la búsqueda entera.
  }
  return mapa;
}

/**
 * Un enlace pegado a mano, resuelto a pista.
 *
 * Cuesta UNA unidad frente a las 100 de una búsqueda, así que es el camino
 * barato y el que sigue funcionando cuando la cuota diaria se agota.
 */
export async function resolverVideo(id: string): Promise<YoutubeTrack | null> {
  const detalle = (await pedir("videos", {
    part: "snippet,contentDetails,status",
    id,
  })) as {
    items?: (ItemVideo & { status?: { embeddable?: boolean } })[];
  };

  const item = detalle.items?.[0];
  if (!item) return null;
  // Igual que en la búsqueda: si no se puede incrustar, es mejor decirlo ahora
  // que dejar que falle sonando.
  if (item.status?.embeddable === false) return null;

  const duraciones = await Promise.resolve(
    new Map([[id, duracionAMilisegundos(item.contentDetails?.duration ?? "")]]),
  );
  return aPista({ ...item, id }, duraciones);
}
