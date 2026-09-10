import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ErrorDeApi, type ClienteApi } from "@devup/mcp/api.js";
import { registrarHerramientas } from "@devup/mcp/registro.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireSession } from "../auth/plugin.js";
import { signAccessToken } from "../auth/tokens.js";
import { env } from "../env.js";
import { requireUser } from "../lib/http.js";

/**
 * La puerta MCP por HTTP: el transporte remoto.
 *
 * QUÉ RESUELVE. Por stdio (`apps/mcp`) cada persona necesita Node, el repo
 * clonado y editar un JSON con la ruta absoluta de su copia. Esto es para el
 * resto del equipo: se pega una URL en el conector de Claude, Claude negocia
 * OAuth solo contra `/oauth/*` (ver `routes/oauth.ts`) y no hay nada que
 * instalar.
 *
 * LAS HERRAMIENTAS SON LAS MISMAS, literalmente: `registrarHerramientas` de
 * `@devup/mcp` las registra aquí igual que en el stdio. Lo único distinto es
 * de dónde sale la credencial.
 *
 * SIN ESTADO ENTRE PETICIONES (`sessionIdGenerator: undefined`). El modo con
 * sesión del transporte guarda el estado en memoria del proceso, y aquí eso
 * se rompería solo: la API se despliega como dos servicios y se reinicia en
 * cada despliegue. Cada petición trae su propio `Bearer`, así que la
 * identidad ya viaja en ella y no hay nada que recordar.
 *
 * POR QUÉ SIGUE HABLANDO CON LA API POR HTTP, aunque esté DENTRO de la API.
 * Es la decisión de arquitectura de la puerta (docs/HEARTH-Y-LA-PUERTA-MCP.md
 * §3): el servidor MCP es un traductor sin lógica propia. Llamar a las rutas
 * REST por el bucle local mantiene un solo camino a los datos —las mismas
 * reglas de negocio, el mismo RLS, el mismo registro de quién pidió qué— en
 * vez de dos. El precio es una petición por herramienta contra 127.0.0.1, que
 * no sale de la máquina.
 */

/**
 * El cliente de la API para una petición MCP concreta.
 *
 * A diferencia del de stdio (`ClienteDevUP`), no hay token de refresco ni
 * archivo en disco: la identidad ya la verificó `requireSession`, así que se
 * firma un acceso corto para el salto local y se acabó. Sin rotación, sin
 * estado, sin nada que guardar.
 */
class ClienteDeLaPeticion implements ClienteApi {
  constructor(
    readonly apiUrl: string,
    private readonly acceso: string,
  ) {}

  private async pedir<T>(camino: string, init?: RequestInit): Promise<T> {
    const respuesta = await fetch(`${this.apiUrl}${camino}`, {
      ...init,
      headers: {
        ...init?.headers,
        authorization: `Bearer ${this.acceso}`,
        "user-agent": "devup-mcp-remoto",
      },
    });

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

  get<T>(camino: string): Promise<T> {
    return this.pedir<T>(camino);
  }

  post<T>(camino: string, cuerpo: unknown): Promise<T> {
    return this.pedir<T>(camino, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
  }

  patch<T>(camino: string, cuerpo: unknown): Promise<T> {
    return this.pedir<T>(camino, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
  }
}

/** El bucle local: esta misma instancia, sin salir de la máquina ni pasar por
 *  DNS o TLS. `API_PORT` ya respeta el `PORT` que inyecta Railway. */
const bucleLocal = () => `http://127.0.0.1:${env.API_PORT}`;

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Un servidor y un transporte NUEVOS por petición.
   *
   * Es lo que exige el modo sin estado, y además es lo que hace que dos
   * personas conectadas a la vez no compartan nada: cada petición registra
   * sus ocho herramientas contra el cliente de quien la manda. Montar ocho
   * herramientas es construir ocho objetos, no un servidor.
   */
  const atender = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userId = requireUser(request);
    const acceso = await signAccessToken(userId);
    const cliente = new ClienteDeLaPeticion(bucleLocal(), acceso);

    const servidor = new McpServer({ name: "devup", version: "0.1.0" });
    registrarHerramientas(servidor, () => cliente);

    const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    // Fastify deja de gestionar la respuesta: a partir de aquí escribe el
    // transporte, que necesita el socket crudo para poder mandar un flujo de
    // eventos y no un único cuerpo cerrado.
    reply.hijack();

    // Cerrar los dos al terminar la petición. Sin esto, cada llamada deja un
    // servidor y un transporte vivos, y eso a lo largo de un día de trabajo
    // es una fuga de memoria que nadie relaciona con el MCP.
    reply.raw.on("close", () => {
      void transporte.close();
      void servidor.close();
    });

    await servidor.connect(transporte);
    await transporte.handleRequest(request.raw, reply.raw, request.body);
  };

  // POST lleva las llamadas; GET abre el flujo de eventos que el protocolo usa
  // para lo que el servidor manda por su cuenta; DELETE cierra. En modo sin
  // estado los dos últimos apenas se usan, pero el transporte los contesta
  // como manda la especificación y no hay motivo para no encaminarlos.
  app.post("/mcp", { onRequest: requireSession }, atender);
  app.get("/mcp", { onRequest: requireSession }, atender);
  app.delete("/mcp", { onRequest: requireSession }, atender);
}
