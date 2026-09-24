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

export function esConfigRailway(config: unknown): config is ConfigRailway {
  return (
    typeof config === "object" &&
    config !== null &&
    typeof (config as ConfigRailway).projectId === "string" &&
    typeof (config as ConfigRailway).environmentId === "string" &&
    typeof (config as ConfigRailway).serviceId === "string"
  );
}
export type { ConfigRailway };

/**
 * Los tres identificadores de Railway de un entorno, y NADA MÁS.
 *
 * HABÍA DOS FORMAS Y CADA LECTOR ESPERABA UNA. Desplegar los buscaba en la raíz
 * de `provider_config`; la base de datos, dentro de `provider_config.railway`.
 * Configurar un entorno para una de las dos cosas dejaba la otra sin
 * funcionar, sin que ningún mensaje lo relacionara. Aquí se aceptan las dos, y
 * la de dentro gana si están ambas, porque es la más explícita.
 *
 * Y SE DEVUELVE UN OBJETO NUEVO CON SOLO ESOS TRES CAMPOS, que es la otra mitad
 * del arreglo. Antes se mandaba `provider_config` entero como entrada de
 * GraphQL, y ese objeto también lleva `migracion` —lo que lee `/migrate`—.
 * GraphQL rechaza por especificación un campo que el tipo de entrada no
 * declara, así que configurar la migración de un entorno rompía su botón de
 * desplegar.
 */
export function configRailwayDe(providerConfig: unknown): ConfigRailway | null {
  if (typeof providerConfig !== "object" || providerConfig === null) return null;
  const dentro = (providerConfig as { railway?: unknown }).railway;
  const candidato = esConfigRailway(dentro) ? dentro : providerConfig;
  if (!esConfigRailway(candidato)) return null;
  return {
    projectId: candidato.projectId,
    environmentId: candidato.environmentId,
    serviceId: candidato.serviceId,
  };
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

/**
 * Las variables de entorno de un servicio, tal cual las tiene Railway ahora
 * mismo — no las que alguien pegó a mano en algún sitio.
 *
 * PARA QUÉ SIRVE: el servicio de la API ya tiene su propia `DATABASE_URL` en
 * Railway —así se conecta a su propia Postgres—, así que un entorno que ya
 * apunta a ese servicio (0063) es también la forma de encontrar esa cadena
 * de conexión sin pedirle a nadie que la copie y la pegue dos veces. Ver
 * `conexionDeBase` en `routes/basedatos.ts`.
 *
 * Verificado contra la documentación oficial de Railway
 * (docs.railway.com/integrations/api/manage-variables) antes de escribir
 * esto: `variables(projectId, environmentId, serviceId)` devuelve un objeto
 * plano de `{NOMBRE: valor}`, no una lista.
 */
export async function variablesDeRailway(
  token: string,
  config: ConfigRailway,
): Promise<Record<string, string>> {
  const data = await railwayGraphql<{ variables: Record<string, string> }>(
    token,
    `query($projectId: String!, $environmentId: String!, $serviceId: String) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }`,
    config,
  );
  return data.variables;
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
  async estado(providerConfig, token) {
    const config = configRailwayDe(providerConfig);
    if (!config) {
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

  async desplegar(providerConfig, token) {
    const config = configRailwayDe(providerConfig);
    if (!config) {
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
