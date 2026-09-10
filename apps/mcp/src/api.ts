import { cargarConfiguracion, guardarToken, type Configuracion } from "./configuracion.js";

/**
 * Cliente de la API de DevUP para el servidor MCP.
 *
 * POR QUÉ POR HTTP Y NO CONTRA POSTGRES. Es la decisión de arquitectura de la
 * puerta y está razonada en docs/HEARTH-Y-LA-PUERTA-MCP.md. En corto: en
 * cuanto hay dos caminos a los datos, RLS deja de ser la única frontera; las
 * reglas que hoy viven en las rutas (y no en las tablas) habría que
 * escribirlas dos veces; y el registro de qué pidió el agente se parte en dos
 * sitios. El precio es un salto HTTP por herramienta, y a cambio esto es un
 * traductor sin lógica propia.
 *
 * LA IDENTIDAD ES UNA SESIÓN DE LAS QUE YA HAY. No hay un tipo de token nuevo:
 * el de refresco de 30 días que ya existe, con su revocación y su listado en
 * `/auth/sessions`. Este cliente lo cambia por accesos de 15 minutos.
 */

const CADUCIDAD_MARGEN_MS = 60_000;

export class ErrorDeApi extends Error {
  constructor(
    message: string,
    readonly estado: number,
  ) {
    super(message);
    this.name = "ErrorDeApi";
  }
}

/**
 * Lo único que una herramienta necesita saber de su cliente.
 *
 * POR QUÉ UNA INTERFAZ Y NO LA CLASE. Hay dos maneras de llegar a estas
 * herramientas y no se autentican igual: por stdio, `ClienteDevUP` cambia un
 * token de refresco guardado en disco por accesos cortos; por el transporte
 * remoto (`apps/api/src/routes/mcp.ts`), el acceso ya viene verificado en la
 * petición y no hay archivo ninguno. Las herramientas no tienen por qué
 * distinguirlo: piden `get`/`post`/`patch` y no les importa de dónde sale la
 * credencial.
 *
 * Con la clase en la firma esto no se podía: sus campos privados hacen que
 * TypeScript la compare por identidad y no por forma, así que ninguna otra
 * implementación encajaría.
 */
export interface ClienteApi {
  readonly apiUrl: string;
  get<T>(camino: string): Promise<T>;
  post<T>(camino: string, cuerpo: unknown): Promise<T>;
  patch<T>(camino: string, cuerpo: unknown): Promise<T>;
}

export class ClienteDevUP implements ClienteApi {
  private config: Configuracion;
  private acceso: string | null = null;
  private caducaEn = 0;
  /** Renovaciones en curso, para que dos herramientas a la vez no consuman
   *  dos veces el mismo token de refresco y se invaliden entre ellas. */
  private renovando: Promise<string> | null = null;

  constructor(config = cargarConfiguracion()) {
    this.config = config;
  }

  get apiUrl(): string {
    return this.config.apiUrl;
  }

  private async accesoValido(): Promise<string> {
    if (this.acceso && Date.now() < this.caducaEn - CADUCIDAD_MARGEN_MS) {
      return this.acceso;
    }
    this.renovando ??= this.renovar().finally(() => {
      this.renovando = null;
    });
    return this.renovando;
  }

  /**
   * Cambia el token de refresco por uno de acceso.
   *
   * El de refresco va en la cabecera `Cookie` y no en el cuerpo porque
   * `/auth/refresh` lo lee de la cookie — así esto funciona contra la API tal
   * como está hoy, sin tocar el servidor. Si algún día acepta el token en el
   * cuerpo, este método es lo único que cambia.
   */
  private async renovar(): Promise<string> {
    const respuesta = await fetch(`${this.config.apiUrl}/auth/refresh`, {
      method: "POST",
      headers: {
        cookie: `devup_refresh=${this.config.refreshToken}`,
        "user-agent": "devup-mcp",
      },
    });

    if (!respuesta.ok) {
      throw new ErrorDeApi(
        respuesta.status === 401
          ? "La conexión de agente ya no vale: caducó o alguien la revocó. " +
            "Hay que crear otra en Ajustes de DevUP."
          : `La API contestó ${respuesta.status} al renovar la sesión.`,
        respuesta.status,
      );
    }

    const cuerpo = (await respuesta.json()) as { accessToken?: string };
    if (!cuerpo.accessToken) {
      throw new ErrorDeApi("La API no devolvió token de acceso al renovar.", 500);
    }

    // El de refresco nuevo solo viaja en `set-cookie`. Si no se guarda, la
    // próxima renovación presenta uno ya consumido y la conexión muere.
    const nuevo = tokenDeRefrescoDe(respuesta.headers.getSetCookie?.() ?? []);
    if (nuevo && nuevo !== this.config.refreshToken) {
      this.config = { ...this.config, refreshToken: nuevo };
      guardarToken(this.config);
    }

    this.acceso = cuerpo.accessToken;
    // El acceso dura 15 minutos (ACCESS_TOKEN_TTL). No se lee del token para
    // no traerse una librería de JWT solo por esto: se asume lo que la API
    // promete y el margen cubre la diferencia.
    this.caducaEn = Date.now() + 15 * 60_000;
    return this.acceso;
  }

  /**
   * Peticiones que escriben. Mismo reintento que `get` para el acceso
   * caducado, pero SIN reintentar si el fallo es otro: repetir un POST que
   * quizas si llego crearia la tarea dos veces, y una tarea duplicada en el
   * tablero de un equipo es peor que un error visible.
   */
  async post<T>(camino: string, cuerpo: unknown): Promise<T> {
    const lanzar = async () =>
      fetch(`${this.config.apiUrl}${camino}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await this.accesoValido()}`,
          "content-type": "application/json",
          "user-agent": "devup-mcp",
        },
        body: JSON.stringify(cuerpo),
      });

    let respuesta = await lanzar();
    if (respuesta.status === 401) {
      this.acceso = null;
      respuesta = await lanzar();
    }
    return leer<T>(respuesta, camino);
  }

  async patch<T>(camino: string, cuerpo: unknown): Promise<T> {
    const lanzar = async () =>
      fetch(`${this.config.apiUrl}${camino}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${await this.accesoValido()}`,
          "content-type": "application/json",
          "user-agent": "devup-mcp",
        },
        body: JSON.stringify(cuerpo),
      });

    let respuesta = await lanzar();
    if (respuesta.status === 401) {
      this.acceso = null;
      respuesta = await lanzar();
    }
    return leer<T>(respuesta, camino);
  }

  async get<T>(camino: string): Promise<T> {
    const acceso = await this.accesoValido();
    const respuesta = await fetch(`${this.config.apiUrl}${camino}`, {
      headers: { authorization: `Bearer ${acceso}`, "user-agent": "devup-mcp" },
    });

    if (respuesta.status === 401) {
      // El acceso pudo caducar entre la comprobación y la llamada. Se renueva
      // una vez y se reintenta; si vuelve a fallar, es que la sesión murió.
      this.acceso = null;
      const reintento = await fetch(`${this.config.apiUrl}${camino}`, {
        headers: {
          authorization: `Bearer ${await this.accesoValido()}`,
          "user-agent": "devup-mcp",
        },
      });
      return leer<T>(reintento, camino);
    }

    return leer<T>(respuesta, camino);
  }
}

async function leer<T>(respuesta: Response, camino: string): Promise<T> {
  if (!respuesta.ok) {
    const texto = await respuesta.text().catch(() => "");
    let mensaje = texto;
    try {
      mensaje = (JSON.parse(texto) as { message?: string }).message ?? texto;
    } catch {
      /* el cuerpo no era json; se usa tal cual */
    }
    throw new ErrorDeApi(
      `${camino} contestó ${respuesta.status}${mensaje ? `: ${mensaje}` : ""}`,
      respuesta.status,
    );
  }
  return (await respuesta.json()) as T;
}

/** Saca `devup_refresh` de las cabeceras `set-cookie`. Exportada para poder
 *  probarla sin levantar un servidor. */
export function tokenDeRefrescoDe(cookies: readonly string[]): string | null {
  for (const cookie of cookies) {
    const encaje = /(?:^|;\s*)devup_refresh=([^;]*)/.exec(cookie);
    // Un valor vacío es `clearCookie`, no un token: la API lo manda al cerrar
    // sesión, y guardarlo dejaría el archivo con una credencial en blanco.
    if (encaje?.[1]) return decodeURIComponent(encaje[1]);
  }
  return null;
}
