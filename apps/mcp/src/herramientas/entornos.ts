import { z } from "zod";
import { ErrorDeApi, type ClienteApi } from "../api.js";
import { resolverEspacio } from "../espacios.js";

/**
 * Los entornos de Infraestructura, para un agente.
 *
 * QUÉ ES UN ENTORNO AQUÍ. Un sitio donde corre lo que el equipo escribe:
 * producción, pruebas, una demo. DevUP **no despliega nada** —esa decisión está
 * cerrada en la propuesta— sino que le pregunta a quien sí despliega y enseña
 * cómo quedó. Por eso lo que de verdad importa al crearlo no es el nombre: es
 * a qué repositorio queda enganchado.
 *
 * SIN REPOSITORIO Y SIN TOKEN NO HAY DESPLIEGUES, Y SE DICE. Sincronizar exige
 * las dos cosas: el identificador del entorno en el proveedor y una conexión de
 * GitHub en ese espacio. Si falta cualquiera, el entorno se crea igual y se
 * queda en pantalla —eso es deliberado, un entorno anotado a mano es un caso
 * legítimo— pero no leerá nada. Un agente que responda «listo» sin mencionarlo
 * deja a alguien esperando unos despliegues que no van a llegar nunca, así que
 * estas herramientas lo dicen siempre y en la primera línea.
 *
 * NO HAY HERRAMIENTA DE BORRAR, igual que en el tablero y en el diagrama.
 * Equivocarse creando deja algo que revisar; equivocarse borrando se lleva por
 * delante la historia de despliegues de ese entorno.
 */

const TIPOS = ["production", "staging", "preview"] as const;

const NOMBRE_TIPO: Record<string, string> = {
  production: "producción",
  staging: "pruebas",
  preview: "vista previa",
};

const ESTADO: Record<string, string> = {
  pending: "en cola",
  running: "desplegando",
  success: "en pie",
  failure: "falló",
  cancelled: "cancelado",
};

type Despliegue = {
  id: string;
  state: keyof typeof ESTADO;
  commitSha: string | null;
  commitMessage: string | null;
  author: string | null;
  startedAt: string | null;
};

type Entorno = {
  id: string;
  name: string;
  kind: (typeof TIPOS)[number];
  url: string | null;
  externalId: string | null;
  connectionId: string | null;
  syncedAt: string | null;
  lastError: string | null;
  ultimo: Despliegue | null;
};

type Conexion = { id: string; provider: string; displayName: string };

/** El repositorio va como «organización/repositorio», que es como lo escribe
 *  todo el mundo y como lo guarda la pantalla. */
const REPO = /^[\w.-]+\/[\w.-]+$/;

function describir(e: Entorno): string {
  const partes = [`- ${e.name} (${NOMBRE_TIPO[e.kind] ?? e.kind})`];
  if (e.ultimo) {
    const commit = e.ultimo.commitSha ? ` ${e.ultimo.commitSha.slice(0, 7)}` : "";
    const mensaje = e.ultimo.commitMessage ? ` «${e.ultimo.commitMessage}»` : "";
    partes.push(`: ${ESTADO[e.ultimo.state] ?? e.ultimo.state}${commit}${mensaje}`);
  } else if (e.externalId && e.connectionId) {
    // El fallo manda sobre el vacío. Decir «todavía no ha llegado ninguno»
    // cuando la lectura falló suena a que solo falta esperar, y lo que hay que
    // hacer es arreglar el token.
    partes.push(e.lastError ? ": no se pudo leer del proveedor" : ": todavía no ha llegado ningún despliegue");
  } else if (e.externalId) {
    partes.push(": apuntado a un repositorio pero SIN TOKEN, así que no lee nada");
  } else {
    partes.push(": anotado a mano, sin proveedor al que preguntar");
  }
  if (e.url) partes.push(` · ${e.url}`);
  // El detalle va debajo y sin repetir la frase de arriba. Cuando el entorno sí
  // tiene un despliegue pintado, este renglón es lo que avisa de que esa foto
  // es vieja porque el último intento de mirar falló.
  if (e.lastError) partes.push(`\n    Último intento: ${e.lastError}`);
  return partes.join("");
}

/** La conexión de GitHub del espacio, si la hay. Es lo que decide si un
 *  entorno enganchado a un repositorio podrá leer algo o no. */
async function tokenDelEspacio(cliente: ClienteApi, espacioId: string): Promise<Conexion | null> {
  const { connections } = await cliente
    .get<{ connections: Conexion[] }>(`/workspaces/${espacioId}/connections`)
    .catch(() => ({ connections: [] as Conexion[] }));
  return connections.find((c) => c.provider === "github") ?? null;
}

// --- Ver ---------------------------------------------------------------------

export const esquemaVerEntornos = {
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
};

export const descripcionVerEntornos = [
  "Los entornos de un espacio de trabajo de DevUP —producción, pruebas, una",
  "demo— con el estado del último despliegue de cada uno: si está en pie, si",
  "falló, qué commit entró y quién lo subió.",
  "",
  "Es la herramienta para «¿está producción en pie?», «¿qué se desplegó",
  "último?» y «¿por qué no salen despliegues?». Dice también cuáles no pueden",
  "leer nada por no tener repositorio o token, que es la causa habitual de que",
  "un entorno aparezca vacío.",
].join("\n");

export async function verEntornos(
  cliente: ClienteApi,
  entrada: { espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const { environments } = await cliente.get<{ environments: Entorno[] }>(
    `/workspaces/${espacio.id}/environments`,
  );

  if (environments.length === 0) {
    return `«${espacio.name}» no tiene ningún entorno todavía.`;
  }

  const sinLeer = environments.filter((e) => !e.externalId || !e.connectionId).length;
  const lineas = [
    `${environments.length} entorno(s) en «${espacio.name}»:`,
    "",
    ...environments.map(describir),
  ];
  if (sinLeer > 0) {
    lineas.push(
      "",
      `${sinLeer} de ellos no tienen a quién preguntarle por sus despliegues: les falta el ` +
        "repositorio, el token de GitHub, o los dos.",
    );
  }
  return lineas.join("\n");
}

// --- Crear -------------------------------------------------------------------

export const esquemaCrearEntorno = {
  nombre: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .describe("Como lo llama el equipo: «producción», «pruebas», «demo del cliente»."),
  tipo: z
    .enum(TIPOS)
    .default("production")
    .describe("production, staging o preview. Cambia el orden y el color en la pantalla."),
  repositorio: z
    .string()
    .trim()
    .optional()
    .describe(
      "«organización/repositorio» en GitHub, de donde salen sus despliegues. " +
        "Sin esto el entorno se crea igual, pero no lee nada.",
    ),
  entorno_en_github: z
    .string()
    .trim()
    .optional()
    .describe(
      "El nombre del entorno DENTRO de GitHub, que no tiene por qué ser el de aquí. " +
        "Por defecto «production». Un mismo repositorio publica a varios, y sin esto " +
        "la tarjeta enseñaría los despliegues de otro.",
    ),
  url: z.string().url().optional().describe("Dónde se ve funcionando. Se aprende sola del despliegue si no se dice."),
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
};

export const descripcionCrearEntorno = [
  "Crea un entorno en Infraestructura y lo engancha a un repositorio de GitHub,",
  "leyendo sus despliegues en la misma llamada.",
  "",
  "DevUP no despliega: pregunta a quien despliega y enseña cómo quedó. Así que",
  "lo que hace útil a un entorno es el `repositorio` — sin él queda como una",
  "anotación a mano, que es un caso legítimo pero no enseña nada.",
  "",
  "Hace falta que el espacio tenga conectado un token de GitHub. Si no lo tiene,",
  "el entorno se crea igual y esta herramienta lo dice claramente en vez de",
  "dejar creer que va a sincronizar.",
  "",
  "No existe la operación de borrar: quitar un entorno se hace desde la pantalla",
  "de Infraestructura, porque se lleva consigo su historia de despliegues.",
].join("\n");

export async function crearEntorno(
  cliente: ClienteApi,
  entrada: {
    nombre: string;
    tipo: (typeof TIPOS)[number];
    repositorio?: string;
    entorno_en_github?: string;
    url?: string;
    espacio?: string;
    organizacion?: string;
  },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);

  if (entrada.repositorio && !REPO.test(entrada.repositorio)) {
    return (
      `«${entrada.repositorio}» no tiene la forma «organización/repositorio». ` +
      "Si tienes el enlace de GitHub, el repositorio es lo que va después de github.com."
    );
  }

  const token = entrada.repositorio ? await tokenDelEspacio(cliente, espacio.id) : null;

  const cuerpo: Record<string, unknown> = { name: entrada.nombre, kind: entrada.tipo };
  if (entrada.url) cuerpo.url = entrada.url;
  if (entrada.repositorio && token) {
    cuerpo.connectionId = token.id;
    cuerpo.externalId = `${entrada.repositorio}:${entrada.entorno_en_github?.trim() || "production"}`;
  }

  /**
   * Dos entornos no pueden llamarse igual en el mismo espacio (0035), y un
   * agente choca con eso más que una persona: reintenta, o no se acuerda de
   * que ya lo creó hace dos mensajes. Sin esto recibía «ese valor ya existe»,
   * que no dice ni qué valor ni dónde, y lo normal es que volviera a
   * intentarlo con otro nombre inventado.
   */
  const { environment } = await cliente
    .post<{ environment: Entorno }>(`/workspaces/${espacio.id}/environments`, cuerpo)
    .catch((fallo: unknown) => {
      if (fallo instanceof ErrorDeApi && fallo.estado === 409) {
        throw new ErrorDeApi(
          `ya hay un entorno llamado «${entrada.nombre}» en «${espacio.name}». ` +
            "Míralo con `ver_entornos`: si es el que querías, no hay nada que crear; " +
            "si querías otro, ponle un nombre distinto.",
          409,
        );
      }
      throw fallo;
    });

  const lineas = [`Entorno «${environment.name}» creado en «${espacio.name}».`];

  if (!entrada.repositorio) {
    lineas.push(
      "Queda anotado a mano: no tiene repositorio del que leer despliegues. " +
        "Para que los lea, hay que volver a crearlo indicando el repositorio.",
    );
  } else if (!token) {
    // El caso que más confunde: el entorno existe, parece bien puesto, y no
    // va a leer nada nunca. Se dice antes que cualquier otra cosa.
    lineas.push(
      `**No se enganchó a ${entrada.repositorio}**: este espacio no tiene ningún token de ` +
        "GitHub conectado, y sin él no se pueden leer despliegues. Conecta uno en la pantalla " +
        "de GitHub y vuelve a crear el entorno, o añádelo desde Infraestructura.",
    );
  } else if (environment.lastError) {
    lineas.push(
      `Enganchado a ${entrada.repositorio}, pero la primera lectura falló: ${environment.lastError}`,
    );
  } else if (environment.ultimo) {
    const u = environment.ultimo;
    lineas.push(
      `Enganchado a ${entrada.repositorio} y ya leyó su último despliegue: ` +
        `${ESTADO[u.state] ?? u.state}${u.commitSha ? ` (${u.commitSha.slice(0, 7)})` : ""}` +
        `${u.author ? `, por ${u.author}` : ""}.`,
    );
  } else {
    lineas.push(
      `Enganchado a ${entrada.repositorio}. Todavía no hay ningún despliegue publicado a ` +
        `«${entrada.entorno_en_github?.trim() || "production"}» en ese repositorio.`,
    );
  }

  return lineas.join("\n");
}

// --- Sincronizar -------------------------------------------------------------

export const esquemaSincronizarEntornos = {
  entorno: z
    .string()
    .trim()
    .optional()
    .describe("Nombre del entorno. Omitir para sincronizar todos los del espacio."),
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
};

export const descripcionSincronizarEntornos = [
  "Vuelve a preguntarle a GitHub por los despliegues de un entorno, o de todos",
  "los del espacio, y devuelve cómo quedaron.",
  "",
  "El servidor ya lo hace solo cada diez minutos; esto sirve para no esperar —",
  "«acabo de desplegar, ¿ya salió?»— y para ver el error concreto cuando un",
  "entorno lleva tiempo sin actualizarse.",
].join("\n");

export async function sincronizarEntornos(
  cliente: ClienteApi,
  entrada: { entorno?: string; espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const { environments } = await cliente.get<{ environments: Entorno[] }>(
    `/workspaces/${espacio.id}/environments`,
  );

  if (environments.length === 0) return `«${espacio.name}» no tiene ningún entorno.`;

  let aSincronizar = environments;
  if (entrada.entorno) {
    const buscado = entrada.entorno.toLowerCase();
    aSincronizar = environments.filter((e) => e.name.toLowerCase().includes(buscado));
    if (aSincronizar.length === 0) {
      return (
        `No hay ningún entorno que se llame «${entrada.entorno}» en «${espacio.name}». ` +
        `Hay: ${environments.map((e) => e.name).join(", ")}.`
      );
    }
  }

  const resultados: Entorno[] = [];
  for (const e of aSincronizar) {
    const { environment } = await cliente.post<{ environment: Entorno }>(
      `/environments/${e.id}/sync`,
      {},
    );
    resultados.push(environment);
  }

  return [`Sincronizado(s) ${resultados.length} en «${espacio.name}»:`, "", ...resultados.map(describir)].join(
    "\n",
  );
}
