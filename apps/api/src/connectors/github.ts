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
const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "DevUP",
});

export type GithubStats = {
  defaultBranch: string;
  openPullRequests: number;
  openIssues: number;
  recentCommits: { sha: string; message: string; author: string; date: string }[];
  latestRun: { status: string; conclusion: string | null; url: string } | null;
};

async function get(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, { headers: headers(token) });
  if (!response.ok) throw new Error(`GitHub respondió ${response.status} para ${url}`);
  return response.json();
}

/**
 * Trae lo que se enseña del repositorio. Tolerante por partes: si la
 * organización no tiene Actions habilitado, ese trozo queda en `null` en vez
 * de tirar todo el resto — es información de menos, no un error del
 * conector entero.
 */
export async function fetchGithubStats(token: string, fullName: string): Promise<GithubStats> {
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
