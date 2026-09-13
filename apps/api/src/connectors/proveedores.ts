/**
 * Proveedores de despliegue: desplegar y ver el estado de un entorno de
 * verdad, no solo leerlo.
 *
 * CAMBIA LA DECISIÓN DE LA 0021 ("DevUP no despliega, orquesta"), y se pidió
 * así a propósito: la pantalla de Infraestructura pasa de mostrar lo que ya
 * pasó a poder disparar lo que falta. Lo que no cambia es dónde vive el
 * secreto — sigue en la bóveda de `connections` que ya existe — ni la regla
 * de que cada fila de `deployments` es un reflejo: seguimos preguntando al
 * proveedor después de actuar, no inventando el resultado.
 *
 * UN PROVEEDOR, UNA FORMA. `ProveedorDespliegue` es la interfaz mínima que
 * cualquier proveedor cumple: mirar el estado y disparar un despliegue.
 * `provider_config` (0063) es la forma libre en la que cada uno guarda CÓMO
 * llegar a su entorno — un projectId de Railway no se parece en nada a un
 * nombre de función de AWS Lambda, y forzarlos a la misma forma sería
 * inventar una abstracción que ninguno de los dos usa de verdad.
 *
 * AWS ES UN SIMULACRO A PROPÓSITO (ver `aws.ts` más abajo, en este mismo
 * archivo). No hay cuenta de AWS conectada a este proyecto todavía, así que
 * implementarlo de verdad sería adivinar una API contra la que nadie puede
 * probar nada. Lo que sí prueba el simulacro es que la interfaz no es
 * Railway disfrazado: un segundo proveedor con una forma de configuración
 * completamente distinta cumple el mismo contrato.
 */

export type EstadoProveedor = {
  estado: "desplegando" | "listo" | "fallo" | "desconocido";
  url: string | null;
  actualizadoEn: string | null;
};

export type ResultadoAccion = { ok: boolean; mensaje: string };

export type ProveedorDespliegue = {
  estado(config: unknown, token: string): Promise<EstadoProveedor>;
  desplegar(config: unknown, token: string): Promise<ResultadoAccion>;
};

// --- Railway ------------------------------------------------------------

type ConfigRailway = { projectId: string; environmentId: string; serviceId: string };

function esConfigRailway(config: unknown): config is ConfigRailway {
  return (
    typeof config === "object" &&
    config !== null &&
    typeof (config as ConfigRailway).projectId === "string" &&
    typeof (config as ConfigRailway).environmentId === "string" &&
    typeof (config as ConfigRailway).serviceId === "string"
  );
}

const RAILWAY_GRAPHQL = "https://backboard.railway.com/graphql/v2";

/**
 * Nombres de mutation y de query verificados contra la documentación
 * oficial de Railway (docs.railway.com/integrations/api/manage-deployments)
 * antes de escribir esto — no son un supuesto.
 */
export async function railwayGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(RAILWAY_GRAPHQL, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });

  const cuerpo = (await response.json().catch(() => null)) as {
    data?: T;
    errors?: { message: string }[];
  } | null;

  if (!response.ok || !cuerpo) {
    throw new Error(`Railway respondió ${response.status} sin cuerpo legible`);
  }
  if (cuerpo.errors?.length) {
    throw new Error(cuerpo.errors[0]!.message);
  }
  return cuerpo.data as T;
}

function traducirEstadoRailway(status: string): EstadoProveedor["estado"] {
  switch (status) {
    case "BUILDING":
    case "DEPLOYING":
    case "INITIALIZING":
    case "QUEUED":
    case "WAITING":
      return "desplegando";
    case "SUCCESS":
    case "ACTIVE":
      return "listo";
    case "FAILED":
    case "CRASHED":
    case "REMOVED":
      return "fallo";
    default:
      return "desconocido";
  }
}

export const proveedorRailway: ProveedorDespliegue = {
  async estado(config, token) {
    if (!esConfigRailway(config)) {
      throw new Error(
        "falta configurar este entorno: necesita projectId, environmentId y serviceId de Railway.",
      );
    }

    const data = await railwayGraphql<{
      deployments: { edges: { node: { status: string; createdAt: string; url: string | null; staticUrl: string | null } }[] };
    }>(
      token,
      `query($input: DeploymentListInput!) {
        deployments(input: $input, first: 1) {
          edges { node { status createdAt url staticUrl } }
        }
      }`,
      { input: config },
    );

    const nodo = data.deployments.edges[0]?.node;
    if (!nodo) return { estado: "desconocido", url: null, actualizadoEn: null };

    return {
      estado: traducirEstadoRailway(nodo.status),
      url: nodo.url ?? nodo.staticUrl ?? null,
      actualizadoEn: nodo.createdAt,
    };
  },

  async desplegar(config, token) {
    if (!esConfigRailway(config)) {
      throw new Error(
        "falta configurar este entorno: necesita projectId, environmentId y serviceId de Railway.",
      );
    }

    // `environmentTriggersDeploy`, no `deploymentRedeploy`: la segunda repite
    // el ÚLTIMO build tal cual, y lo que pide «Desplegar» aquí es traer lo
    // que haya de nuevo en el repositorio conectado, no repetir lo de ayer.
    await railwayGraphql(
      token,
      `mutation($input: EnvironmentTriggersDeployInput!) {
        environmentTriggersDeploy(input: $input)
      }`,
      { input: config },
    );

    return { ok: true, mensaje: "Despliegue disparado en Railway." };
  },
};

// --- AWS (simulacro) ------------------------------------------------------

/**
 * No hay cuenta de AWS conectada a este proyecto. Esto responde con datos
 * creíbles y estructuralmente correctos para poder construir y probar la
 * pantalla — el día que haya una cuenta real, se cambia el cuerpo de estas
 * dos funciones y nada más: la interfaz ya está puesta a prueba.
 */
export const proveedorAwsSimulado: ProveedorDespliegue = {
  async estado() {
    await new Promise((resuelve) => setTimeout(resuelve, 300));
    return { estado: "listo", url: null, actualizadoEn: new Date().toISOString() };
  },

  async desplegar() {
    await new Promise((resuelve) => setTimeout(resuelve, 300));
    return {
      ok: true,
      mensaje: "Simulado: no hay una cuenta de AWS conectada todavía, esto no desplegó nada de verdad.",
    };
  },
};

export function proveedorPara(provider: string): ProveedorDespliegue | null {
  if (provider === "railway") return proveedorRailway;
  if (provider === "aws") return proveedorAwsSimulado;
  return null;
}
