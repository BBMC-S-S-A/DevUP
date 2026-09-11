const API = "https://api.github.com";

/**
 * Llamadas a la API de GitHub para el conector.
 *
 * Dos cosas que no son evidentes la primera vez que se llama a esta API:
 *
 * - **Hace falta `User-Agent`**, o responde 403 sin más explicación. No es
 *   opcional como en la mayoría de APIs REST.
 * - **`open_issues_count` del propio repositorio mezcla issues y pull
 *   requests** — para GitHub, un PR es un tipo de issue. Contarlos por
 *   separado exige `search/issues` con `type:pr` y `type:issue`, no leer ese
 *   campo directamente.
 */
const headers = (token: string | null) => ({
  // Sin token también se puede: la API de GitHub contesta a cualquiera para
  // lo público. Lo que cambia es el cupo —60 peticiones por hora y por IP en
  // vez de 5.000— y que lo privado deja de existir para quien pregunta.
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "DevUP",
});

/**
 * Saca «organización/repositorio» de lo que sea que haya pegado alguien.
 *
 * POR QUÉ ACEPTA TANTAS FORMAS. Nadie tiene a mano «organización/repositorio»:
 * lo que tiene es la barra de direcciones del navegador, o el botón de copiar
 * de GitHub, que da la URL de clonar terminada en `.git`, o la de SSH, que ni
 * siquiera es una URL. Rechazar cualquiera de esas es mandar a la persona a
 * editar a mano un texto que ya tenía bien — que es exactamente el paso que
 * esto viene a quitar.
 *
 * Se queda con los dos primeros tramos de la ruta porque `/tree/main/src` y
 * `/pull/42` son direcciones normales de las que alguien copia sin pensar, y
 * todas apuntan al mismo repositorio.
 */
const TRAMO = /^[\w.-]+$/;

export function nombreDeRepo(entrada: string): string | null {
  let texto = entrada.trim();
  if (!texto) return null;

  // La forma SSH (`git@github.com:org/repo.git`) no es una URL para nadie más
  // que para git, así que se convierte antes de mirarla como tal.
  texto = texto.replace(/^git@([^:]+):/, "https://$1/");
  if (!/^https?:\/\//i.test(texto) && /^[^/]*github\.com\//i.test(texto)) {
    texto = `https://${texto}`;
  }

  let ruta = texto;
  if (/^https?:\/\//i.test(texto)) {
    let url: URL;
    try {
      url = new URL(texto);
    } catch {
      return null;
    }
    // Solo GitHub: un enlace de GitLab que se colara aquí acabaría en un 404
    // de GitHub y en un mensaje que no explica nada.
    if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;
    ruta = url.pathname;
  }

  const tramos = ruta.split("/").filter(Boolean);
  const duenyo = tramos[0];
  const repo = tramos[1]?.replace(/\.git$/i, "");
  if (!duenyo || !repo) return null;
  if (!TRAMO.test(duenyo) || !TRAMO.test(repo)) return null;

  return `${duenyo}/${repo}`;
}

export type GithubStats = {
  defaultBranch: string;
  openPullRequests: number;
  openIssues: number;
  recentCommits: { sha: string; message: string; author: string; date: string }[];
  latestRun: { status: string; conclusion: string | null; url: string } | null;
};

export type GithubTreeEntry = {
  path: string;
  type: "blob" | "tree";
  size?: number;
};

/**
 * Los dos fallos que de verdad le pasan a quien pega un enlace sin token
 * merecen un mensaje suyo, porque el código de estado a secas dice lo
 * contrario de lo que pasa:
 *
 * - **404 no significa «no existe»**. GitHub contesta 404 y no 403 a un
 *   repositorio privado cuando quien pregunta no tiene permiso — a propósito,
 *   para no confirmar que existe. Sin el matiz, la pantalla acusaría de
 *   escribir mal un nombre que está perfecto.
 * - **403 casi siempre es el cupo**, no un permiso. Sin credencial son 60
 *   peticiones por hora Y POR IP, compartidas por todo DevUP.
 */
function traducirFallo(status: number, fullName: string, conToken: boolean): string {
  if (status === 404 && !conToken) {
    return `no encontré «${fullName}». Si existe, es privado: para esos sí hace falta un token.`;
  }
  if (status === 404) {
    return `no encontré «${fullName}», o el token no alcanza a ese repositorio.`;
  }
  if ((status === 403 || status === 429) && !conToken) {
    return "GitHub cortó por límite de peticiones. Sin token son 60 por hora para todo DevUP; con uno, 5.000.";
  }
  if (status === 401) return "el token no vale: caducado, revocado o mal pegado.";
  return `GitHub respondió ${status}`;
}

/** El nombre del repositorio dentro de una URL de la API, para el mensaje. */
function repoDeUrl(url: string): string {
  return url.match(/repos\/([^/?]+\/[^/?]+)/)?.[1] ?? url.replace(`${API}/`, "");
}

async function get(url: string, token: string | null): Promise<unknown> {
  const response = await fetch(url, { headers: headers(token) });
  if (!response.ok) {
    throw new Error(traducirFallo(response.status, repoDeUrl(url), Boolean(token)));
  }
  return response.json();
}

/**
 * Trae lo que se enseña del repositorio. Tolerante por partes: si la
 * organización no tiene Actions habilitado, ese trozo queda en `null` en vez
 * de tirar todo el resto — es información de menos, no un error del
 * conector entero.
 */
export async function fetchGithubStats(token: string | null, fullName: string): Promise<GithubStats> {
  const repo = (await get(`${API}/repos/${fullName}`, token)) as { default_branch: string };

  const [prs, issues, commits, runs] = await Promise.all([
    get(`${API}/search/issues?q=${encodeURIComponent(`repo:${fullName} type:pr state:open`)}`, token) as Promise<{
      total_count: number;
    }>,
    get(
      `${API}/search/issues?q=${encodeURIComponent(`repo:${fullName} type:issue state:open`)}`,
      token,
    ) as Promise<{ total_count: number }>,
    get(`${API}/repos/${fullName}/commits?per_page=5`, token) as Promise<
      { sha: string; commit: { message: string; author: { name: string; date: string } } }[]
    >,
    get(`${API}/repos/${fullName}/actions/runs?per_page=1`, token).catch(() => null) as Promise<{
      workflow_runs: { status: string; conclusion: string | null; html_url: string }[];
    } | null>,
  ]);

  const latestRun = runs?.workflow_runs?.[0];

  return {
    defaultBranch: repo.default_branch,
    openPullRequests: prs.total_count,
    openIssues: issues.total_count,
    recentCommits: commits.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0]!.slice(0, 120),
      author: c.commit.author.name,
      date: c.commit.author.date,
    })),
    latestRun: latestRun
      ? { status: latestRun.status, conclusion: latestRun.conclusion, url: latestRun.html_url }
      : null,
  };
}

/**
 * Árbol completo de un repositorio, para el entorno de desarrollo embebido.
 *
 * La API de árboles de Git (`git/trees`, no `contents/`) trae la jerarquía
 * entera en una sola llamada con `recursive=1` — recorrer `contents/`
 * directorio por directorio sería una llamada por carpeta, y un repo mediano
 * tarda segundos en cargar en vez de uno.
 *
 * Sin rama, se resuelve primero la rama por defecto: el árbol de Git exige
 * un `sha` o una rama, y quien llama a esto normalmente solo tiene el nombre
 * del repositorio, no su rama.
 */
export async function fetchGithubTree(
  token: string | null,
  fullName: string,
  ref?: string,
): Promise<GithubTreeEntry[]> {
  const branch =
    ref ?? ((await get(`${API}/repos/${fullName}`, token)) as { default_branch: string }).default_branch;

  const result = (await get(
    `${API}/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token,
  )) as { tree: { path: string; type: string; size?: number }[]; truncated: boolean };

  // GitHub trunca árboles enormes en vez de fallar. Un aviso en el log basta
  // por ahora — nada en el editor distingue hoy un árbol completo de uno
  // recortado, y es mejor decirlo aquí que fingir que se vio todo.
  if (result.truncated) {
    console.warn(`[github] árbol de ${fullName}@${branch} truncado por GitHub (repositorio muy grande)`);
  }

  return result.tree
    .filter((entry) => entry.type === "blob" || entry.type === "tree")
    .map((entry) => ({ path: entry.path, type: entry.type as "blob" | "tree", size: entry.size }));
}

/**
 * Contenido de un único archivo de texto. GitHub lo devuelve en base64 salvo
 * que el archivo pese más de 1 MB, caso en el que `content` viene vacío y
 * hay que ir por `download_url` — no lo cubrimos todavía porque un archivo
 * de más de 1 MB no es el caso común de "abrir para editar" de esta semilla.
 */
export async function fetchGithubFileContent(
  token: string | null,
  fullName: string,
  path: string,
  ref?: string,
): Promise<string> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const file = (await get(`${API}/repos/${fullName}/contents/${path}${query}`, token)) as {
    content?: string;
    encoding?: string;
    size: number;
  };

  if (!file.content || file.encoding !== "base64") {
    throw new Error(
      `«${path}» no se pudo leer como texto (${file.size} bytes) — probablemente pesa más de 1 MB`,
    );
  }

  return Buffer.from(file.content, "base64").toString("utf8");
}
