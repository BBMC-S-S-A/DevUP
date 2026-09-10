import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * De dónde salen la dirección de la API y el token, y dónde se guarda el
 * token nuevo cuando rota.
 *
 * El token de refresco ROTA en cada renovación: `/auth/refresh` consume el que
 * se presenta y emite otro. Eso es bueno —un token robado deja de valer en
 * cuanto el dueño renueva— pero obliga a guardar el nuevo en algún sitio, o la
 * conexión se muere al reiniciar el proceso. De ahí este archivo.
 *
 * Vive en el disco de la persona y no en el servidor a propósito: DevUP no
 * guarda credenciales de nadie para hablar con modelos. Cada quien conecta su
 * propio Claude con su propia sesión.
 */
export type Configuracion = {
  apiUrl: string;
  refreshToken: string;
  /**
   * El token que puso `DEVUP_TOKEN` la última vez que se adoptó.
   *
   * Existe para distinguir «la variable sigue trayendo el mismo token de
   * siempre» de «alguien ha pegado uno nuevo a propósito». Sin esto no se
   * puede tener las dos cosas: que el archivo mande (porque es donde está el
   * token vivo) y que la variable sirva para cambiar de sesión.
   */
  sembradoDesde?: string;
};

const API_POR_DEFECTO = "https://api.hytrex.co";

/** `DEVUP_CONFIG` existe para las pruebas: así no se toca el archivo de
 *  verdad de quien está desarrollando. */
export function rutaDeConfiguracion(): string {
  return process.env.DEVUP_CONFIG ?? join(homedir(), ".devup", "mcp.json");
}

function leerArchivo(): Partial<Configuracion> {
  try {
    return JSON.parse(readFileSync(rutaDeConfiguracion(), "utf8")) as Partial<Configuracion>;
  } catch {
    return {};
  }
}

/**
 * QUIÉN GANA, Y POR QUÉ NO ES LO OBVIO.
 *
 * Lo natural sería «la variable de entorno pisa al archivo», que es lo que
 * hace todo el mundo. Aquí está al revés para el token, y costó descubrirlo
 * probándolo: como el token ROTA, el vivo es el del archivo. Si la variable
 * ganara siempre, cada arranque presentaría el token con el que se sembró la
 * conexión —ya consumido— y la conexión se moriría después del primer uso, con
 * un mensaje que dice «caducó o alguien la revocó» y no señala a la causa.
 *
 * Así que: el archivo manda, y `DEVUP_TOKEN` **siembra**. Si trae un token
 * distinto del que se sembró la última vez, se entiende que es deliberado —una
 * conexión nueva— y se adopta.
 *
 * `DEVUP_API_URL` sí pisa, porque eso no rota y es lo que se cambia para
 * apuntar a la API local.
 */
export function cargarConfiguracion(): Configuracion {
  const archivo = leerArchivo();
  const semilla = process.env.DEVUP_TOKEN;
  const apiUrl = process.env.DEVUP_API_URL ?? archivo.apiUrl ?? API_POR_DEFECTO;

  const esSemillaNueva = Boolean(semilla) && semilla !== archivo.sembradoDesde;
  const refreshToken = esSemillaNueva ? semilla! : (archivo.refreshToken ?? semilla ?? "");

  if (!refreshToken) {
    throw new Error(
      [
        "No hay token con el que entrar a DevUP.",
        "",
        "En DevUP: Ajustes -> Conexiones de agente -> crear una, y pegar el token en",
        `${rutaDeConfiguracion()} asi:`,
        "",
        `  { "apiUrl": "${API_POR_DEFECTO}", "refreshToken": "<el token>" }`,
        "",
        "O pasarlo una vez en DEVUP_TOKEN, que siembra el archivo.",
      ].join("\n"),
    );
  }

  const config: Configuracion = { apiUrl: apiUrl.replace(/\/+$/, ""), refreshToken };
  if (esSemillaNueva) {
    config.sembradoDesde = semilla!;
    guardarToken(config);
  } else if (archivo.sembradoDesde) {
    config.sembradoDesde = archivo.sembradoDesde;
  }
  return config;
}

/**
 * Guarda el token rotado.
 *
 * Escribe a un temporal y renombra: un corte a mitad de la escritura dejaría
 * el archivo truncado, y un token a medias es una sesión perdida que hay que
 * volver a crear a mano. El renombrado dentro del mismo directorio es atómico.
 *
 * Si no se puede escribir no se cae: el proceso sigue con el token en memoria
 * y solo se pierde al reiniciar. Avisa por la salida de error, que en stdio es
 * el único sitio donde se puede hablar sin romper el protocolo.
 */
export function guardarToken(config: Configuracion): void {
  const ruta = rutaDeConfiguracion();
  try {
    mkdirSync(dirname(ruta), { recursive: true });
    const temporal = `${ruta}.nuevo`;
    writeFileSync(temporal, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporal, ruta);
    chmodSync(ruta, 0o600);
  } catch (fallo) {
    console.error(
      `[devup-mcp] no pude guardar el token rotado en ${ruta}: ` +
        `${fallo instanceof Error ? fallo.message : String(fallo)}. ` +
        "La sesión seguirá viva hasta que se reinicie el proceso.",
    );
  }
}
