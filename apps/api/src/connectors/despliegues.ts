const API = "https://api.github.com";

/**
 * Lee entornos y despliegues de GitHub.
 *
 * POR QUÉ GITHUB Y NO UN PROVEEDOR DE ALOJAMIENTO. La decisión cerrada es que
 * DevUP orquesta y no despliega, y para eso hace falta preguntarle a «la
 * plataforma que el cliente ya usa». Para la mayoría de equipos —y desde luego
 * para este— esa plataforma es Actions: es donde vive el flujo que empuja a
 * producción, tenga detrás lo que tenga. Y tiene una ventaja que ninguna otra
 * da hoy: la credencial ya está en la bóveda y los repositorios ya están
 * conectados, así que esto no pide nada nuevo a nadie.
 *
 * LA API DE DESPLIEGUES DE GITHUB ESTÁ EN DOS MITADES, y es lo que más
 * confunde la primera vez. `/deployments` dice QUÉ se pidió desplegar y a
 * dónde, pero no dice si salió bien: el estado vive en una lista aparte,
 * `/deployments/:id/statuses`, cuyo primer elemento es el más reciente. Un
 * despliegue sin ningún estado no es un despliegue fallido, es uno que aún no
 * ha empezado.
 *
 * Y hace falta `User-Agent` o responde 403 sin explicar por qué, igual que en
 * el conector de estadísticas.
 */

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "DevUP",
});

export type EstadoDespliegue = "pending" | "running" | "success" | "failure" | "cancelled";

export type DespliegueRemoto = {
  externalId: string;
  estado: EstadoDespliegue;
  commitSha: string | null;
  commitMessage: string | null;
  author: string | null;
  logUrl: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** A qué entorno de GitHub pertenece: «production», «staging»… */
  entorno: string;
  /** Dónde quedó publicado, si el despliegue lo dijo. */
  url: string | null;
};

async function get(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, { headers: headers(token) });
  if (!response.ok) throw new Error(`GitHub respondió ${response.status} para ${url}`);
  return response.json();
}

/**
 * Traduce el vocabulario de GitHub al nuestro.
 *
 * Se traduce AL ENTRAR y no al pintar, que es lo que permite que la pantalla no
 * sepa de qué proveedor viene cada fila. `error` y `failure` son dos palabras
 * de GitHub para lo mismo desde el punto de vista de quien mira; `inactive`
 * significa «lo sustituyó otro» y no es un fallo, así que se queda en el último
 * estado bueno en vez de pintarse en rojo.
 */
function traducir(estado: string): EstadoDespliegue | null {
  switch (estado) {
    case "queued":
    case "pending":
      return "pending";
    case "in_progress":
      return "running";
    case "success":
      return "success";
    case "error":
    case "failure":
      return "failure";
    default:
      return null;
  }
}

type DeploymentApi = {
  id: number;
  sha: string;
  environment: string;
  description: string | null;
  created_at: string;
  creator: { login: string } | null;
  statuses_url: string;
};

type StatusApi = {
  state: string;
  created_at: string;
  log_url: string | null;
  target_url: string | null;
  environment_url: string | null;
};

/**
 * Los despliegues recientes de un repositorio, con su estado ya resuelto.
 *
 * `limite` existe porque cada despliegue cuesta una segunda llamada para su
 * estado: treinta despliegues son treinta y una peticiones, y el límite de
 * GitHub es de 5.000 a la hora para toda la organización. Diez es suficiente
 * para una pantalla que enseña «lo último por entorno» y deja margen para que
 * el resto del conector siga funcionando.
 */
export async function fetchDespliegues(
  token: string,
  fullName: string,
  limite = 10,
): Promise<DespliegueRemoto[]> {
  const lista = (await get(
    `${API}/repos/${fullName}/deployments?per_page=${limite}`,
    token,
  )) as DeploymentApi[];

  const salida: DespliegueRemoto[] = [];

  for (const d of lista) {
    let estado: EstadoDespliegue = "pending";
    let logUrl: string | null = null;
    let url: string | null = null;
    let finishedAt: string | null = null;

    try {
      const estados = (await get(`${d.statuses_url}?per_page=1`, token)) as StatusApi[];
      const ultimo = estados[0];
      if (ultimo) {
        estado = traducir(ultimo.state) ?? estado;
        logUrl = ultimo.log_url ?? ultimo.target_url ?? null;
        url = ultimo.environment_url ?? null;
        // Solo lo terminado tiene final. Un despliegue en marcha con fecha de
        // fin se pintaría como acabado y con una duración inventada.
        if (estado === "success" || estado === "failure" || estado === "cancelled") {
          finishedAt = ultimo.created_at;
        }
      }
    } catch {
      // Un despliegue cuyo estado no se pudo leer sigue siendo un despliegue
      // que existió. Se guarda como pendiente en vez de perderlo entero.
    }

    salida.push({
      externalId: String(d.id),
      estado,
      commitSha: d.sha ?? null,
      commitMessage: d.description,
      author: d.creator?.login ?? null,
      logUrl,
      startedAt: d.created_at,
      finishedAt,
      entorno: d.environment,
      url,
    });
  }

  return salida;
}
