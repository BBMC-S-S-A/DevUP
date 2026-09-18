import { randomUUID } from "node:crypto";
import pg from "pg";
import { CAMINO_BUSQUEDA, opcionesTls } from "../db/conexion.js";
import { env } from "../env.js";
import { pool } from "../db/pool.js";
import { channelHub, fileHub, userHub, type Hub, type Outbound } from "./hub.js";

/**
 * El puente entre instancias.
 *
 * EL FALLO QUE ESTO CIERRA, y estuvo semanas en producción sin que nada lo
 * dijera. `hub.ts` guarda las salas EN MEMORIA, y lo avisa en su cabecera:
 * «mientras haya una sola instancia es correcto». Producción dejó de tener una
 * sola instancia el 16 de septiembre, cuando se partió en dos servicios —`api`
 * con `REALTIME_ENABLED=false` y `live` con los sockets— y la web se quedó
 * mandando REST a una y abriendo los WebSocket contra la otra.
 *
 * A partir de ahí, TODO aviso en vivo se perdía. No a medias: del todo. Quien
 * escribe un mensaje lo escribe contra `api`, y `announceMessage` reparte en el
 * hub DE `api`, donde no hay ni un socket conectado. Los sockets están en
 * `live`, que nunca se enteró de la escritura. Mandas un mensaje y el otro no lo
 * ve hasta que recarga; muevo una tarjeta y tu tablero no se mueve; sube un
 * archivo y la biblioteca sigue igual; llega una notificación y la campana no se
 * entera. Y nada falla: no hay error, no hay traza, no hay 500. Simplemente no
 * pasa nada, que es la avería más cara de encontrar.
 *
 * `server.ts` decía justo lo contrario —«avisar a un hub sin nadie escuchando es
 * una vuelta sobre un mapa vacío, no un error»— y era verdad con una instancia
 * sola: si no hay sockets en NINGÚN sitio, no se pierde nada. Con dos, los
 * sockets están en el otro proceso, y ahí el mapa vacío sí es un error.
 *
 * CÓMO SE ARREGLA. Cada aviso se reparte en el hub local, como siempre, y además
 * se publica por `NOTIFY` de Postgres. Las instancias que sirven sockets están
 * a la escucha y lo reparten en el suyo. Quien lo publicó lo ignora al recibirlo
 * —ya lo repartió— para que nadie lo reciba dos veces.
 *
 * POSTGRES Y NO REDIS, que es lo que la cabecera de `hub.ts` proponía. Porque la
 * base ya está ahí, la comparten las dos instancias, y `LISTEN`/`NOTIFY` hace
 * exactamente esto. Añadir Redis sería un servicio más que desplegar, pagar y
 * vigilar para mover unos cuantos mensajes cortos al minuto.
 *
 * LO QUE ESTO NO ARREGLA, Y ES A PROPÓSITO: la voz y el mundo no pasan por aquí.
 * Sus salas no reparten avisos, guardan PRESENCIA —quién está dentro, con el
 * micro cómo, parado en qué casilla— y eso no se replica reenviando mensajes:
 * haría falta que cada instancia mantuviera copia del estado de la otra y lo
 * limpiara cuando el socket de la otra se cae. Mientras las dos vivan en la
 * misma instancia —hoy `live` sirve las cinco— es correcto. Si algún día hay
 * dos procesos con sockets de voz, esto NO basta, y más vale que esté escrito.
 */

/** Las tres salas que reparten avisos, y por tanto las tres que cruzan. */
export type Destino = "canal" | "espacio" | "persona";

const CANAL = "devup_hub";

/**
 * Cuánto cabe en un `NOTIFY`.
 *
 * Postgres corta el payload en 8000 bytes, y un mensaje de chat admite 8000
 * CARACTERES —que en UTF-8 pueden ser bastantes más bytes— más el autor, las
 * fechas y el sobre. O sea: el caso que no cabe no es raro, es un mensaje largo.
 * Por eso lo que no entra va en trozos, y por eso el margen es amplio: el sobre
 * ronda los 110 bytes y no quiero que un día un campo nuevo lo desborde en
 * silencio.
 */
const POR_TROZO = 6000;

/** Cuántos trozos sueltos se guardan antes de tirar los más viejos. */
const TROZOS_MAX = 64;

type Sobre = {
  /** Quién lo publicó. Sirve para no repartirse a uno mismo lo que ya repartió. */
  de: string;
  /** Identifica el reparto, para juntar sus trozos. */
  id: string;
  /** Índice de este trozo y cuántos son. */
  i: number;
  n: number;
  /** El trozo, en base64. */
  t: string;
};

type Carga = { destino: Destino; sala: string; mensaje: Outbound };

export type Bus = {
  /** Reparte en el hub local y lo publica para las demás instancias. */
  repartir(destino: Destino, sala: string, mensaje: Outbound): void;
  /** Se pone a la escucha. Solo tiene sentido donde haya sockets. */
  escuchar(): Promise<void>;
  cerrar(): Promise<void>;
};

/**
 * `base64` y no cortar el JSON tal cual.
 *
 * Trocear una cadena UTF-8 por bytes parte los caracteres de más de un byte por
 * la mitad —una tilde, una eñe, un emoji— y lo que se recompone al otro lado ya
 * no es el mismo texto. En base64 todo son caracteres ASCII de un byte, así que
 * se puede cortar por donde sea. Cuesta un tercio más de tamaño y quita una
 * clase entera de fallos que solo aparecerían con acentos.
 */
function trocear(carga: Carga, de: string): string[] {
  const texto = Buffer.from(JSON.stringify(carga), "utf8").toString("base64");
  const id = randomUUID();
  const n = Math.max(1, Math.ceil(texto.length / POR_TROZO));
  const sobres: string[] = [];
  for (let i = 0; i < n; i += 1) {
    sobres.push(
      JSON.stringify({ de, id, i, n, t: texto.slice(i * POR_TROZO, (i + 1) * POR_TROZO) } as Sobre),
    );
  }
  return sobres;
}

export function crearBus(opciones: {
  hubs: Record<Destino, Hub>;
  /** Con qué identidad se publica. Uno por proceso; la prueba usa dos. */
  yo?: string;
  /** Para avisar de lo que va mal sin arrastrar el logger de Fastify hasta aquí. */
  anotar?: (mensaje: string, error?: unknown) => void;
}): Bus {
  const yo = opciones.yo ?? randomUUID();
  const anotar = opciones.anotar ?? (() => {});
  const { hubs } = opciones;

  /** Trozos a medio juntar, por identificador de reparto. */
  const pendientes = new Map<string, { n: number; partes: (string | undefined)[] }>();

  let cliente: pg.Client | null = null;
  let cerrado = false;
  let reintento: NodeJS.Timeout | null = null;
  let intentos = 0;

  function entregar(carga: Carga): void {
    const hub = hubs[carga.destino];
    // Un destino que no conozco es una instancia más nueva hablando: ignorarlo
    // en silencio es lo correcto durante un despliegue, cuando conviven dos
    // versiones del código repartiendo por el mismo canal.
    if (hub) hub.broadcast(carga.sala, carga.mensaje);
  }

  function recibir(texto: string): void {
    let sobre: Sobre;
    try {
      sobre = JSON.parse(texto) as Sobre;
    } catch {
      return;
    }
    // Lo que publiqué yo ya lo repartí en mi hub antes de publicarlo.
    if (sobre.de === yo) return;

    if (sobre.n === 1) {
      try {
        entregar(JSON.parse(Buffer.from(sobre.t, "base64").toString("utf8")) as Carga);
      } catch (error) {
        anotar("[bus] no se pudo leer un aviso", error);
      }
      return;
    }

    let pendiente = pendientes.get(sobre.id);
    if (!pendiente) {
      // Los trozos de un mismo reparto van en UNA sentencia, así que Postgres
      // los entrega juntos y en orden. Quedarse a medias solo pasa si el
      // listener se cae en medio — y entonces se ha perdido mucho más que esto.
      // El tope existe para que ese caso no crezca sin fin.
      if (pendientes.size >= TROZOS_MAX) {
        const viejo = pendientes.keys().next().value;
        if (viejo !== undefined) pendientes.delete(viejo);
      }
      pendiente = { n: sobre.n, partes: Array.from({ length: sobre.n }) };
      pendientes.set(sobre.id, pendiente);
    }
    pendiente.partes[sobre.i] = sobre.t;
    if (pendiente.partes.some((p) => p === undefined)) return;

    pendientes.delete(sobre.id);
    try {
      entregar(
        JSON.parse(Buffer.from(pendiente.partes.join(""), "base64").toString("utf8")) as Carga,
      );
    } catch (error) {
      anotar("[bus] no se pudo juntar un aviso troceado", error);
    }
  }

  async function conectar(): Promise<void> {
    if (cerrado) return;
    const nuevo = new pg.Client({
      connectionString: env.DATABASE_URL,
      ssl: opcionesTls(env.DATABASE_URL),
    });

    // Una conexión que se cae no puede tumbar el proceso, y tampoco puede
    // quedarse muerta en silencio: sin volver a conectar, los avisos de la otra
    // instancia dejan de llegar y estamos otra vez en el fallo de arriba, pero
    // ahora intermitente — que es peor.
    nuevo.on("error", (error) => {
      anotar("[bus] la escucha se cayó, se reintenta", error);
      volverAConectar();
    });
    nuevo.on("end", () => volverAConectar());
    nuevo.on("notification", (aviso) => {
      if (aviso.channel === CANAL && aviso.payload) recibir(aviso.payload);
    });

    await nuevo.connect();
    await nuevo.query(`set search_path to ${CAMINO_BUSQUEDA}`);
    // Entre comillas porque `listen` no admite parámetros y el nombre tiene que
    // ir tal cual; es una constante de este archivo, no entra nada de fuera.
    await nuevo.query(`listen "${CANAL}"`);
    cliente = nuevo;
    intentos = 0;
  }

  function volverAConectar(): void {
    if (cerrado || reintento) return;
    cliente = null;
    intentos += 1;
    const espera = Math.min(1000 * 2 ** intentos, 30_000);
    reintento = setTimeout(() => {
      reintento = null;
      void conectar().catch((error) => {
        anotar("[bus] no se pudo volver a escuchar", error);
        volverAConectar();
      });
    }, espera);
    reintento.unref?.();
  }

  return {
    repartir(destino, sala, mensaje) {
      // Primero el hub local: lo de siempre, y lo que tiene que seguir
      // funcionando aunque la base esté de mal humor.
      hubs[destino]?.broadcast(sala, mensaje);

      const sobres = trocear({ destino, sala, mensaje }, yo);
      // UNA sola sentencia para todos los trozos: así van en la misma
      // transacción implícita y Postgres los entrega juntos y en orden. Con una
      // sentencia por trozo, otra publicación podría colarse en medio.
      //
      // `pool.query` y no `withUser`: esto no toca ni una tabla, así que no hay
      // identidad que fijar ni política que aplicar. Es la excepción, y por eso
      // está escrita.
      void pool
        .query("select pg_notify($1, aviso) from unnest($2::text[]) as aviso", [CANAL, sobres])
        .catch((error: unknown) => {
          // Que no se pueda publicar no puede tumbar la escritura que lo
          // provocó: el mensaje ya está guardado, lo que se pierde es el empujón
          // en vivo hacia la OTRA instancia. Se anota porque, si esto pasa
          // seguido, explica exactamente el síntoma con el que empezó todo.
          anotar("[bus] no se pudo publicar un aviso", error);
        });
    },

    async escuchar() {
      await conectar();
    },

    async cerrar() {
      cerrado = true;
      if (reintento) clearTimeout(reintento);
      reintento = null;
      const abierto = cliente;
      cliente = null;
      await abierto?.end().catch(() => {});
    },
  };
}

/**
 * El bus del proceso.
 *
 * `fileHub` es el del ESPACIO pese al nombre: su sala es el workspace y por ahí
 * van la biblioteca, el tablero y la ocupación de las salas de voz. Ver
 * `announceBoardChange` en `signaling.ts`.
 */
export const bus = crearBus({
  hubs: { canal: channelHub, espacio: fileHub, persona: userHub },
  anotar: (mensaje, error) => console.warn(mensaje, error instanceof Error ? error.message : error),
});

/**
 * Se escucha solo donde hay sockets.
 *
 * Una instancia de solo REST no tiene a quién repartir: abrir una conexión
 * permanente a Postgres para recibir avisos que no van a ningún sitio sería
 * pagar una conexión por nada. Publicar sí lo hace siempre —es justamente su
 * papel en el reparto.
 */
export async function escucharElBus(): Promise<void> {
  if (!env.REALTIME_ENABLED) return;
  await bus.escuchar();
}
