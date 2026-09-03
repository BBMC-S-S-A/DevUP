"use client";

import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Github,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Unplug,
  XCircle,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Field } from "@/components/ui/Field";
import { EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { ApiError, type Connection, type GithubRepo, api } from "@/lib/api";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Pagina } from "@/components/ui/Pagina";

/**
 * Conector de GitHub (S7, primera pieza). Un token de acceso personal de
 * alcance fino por organización — no una GitHub App con OAuth, ver §5.1 de
 * y los repositorios que se
 * conecten con él. Las estadísticas las refresca el barrendero del servidor
 * cada diez minutos; el botón de refrescar solo adelanta esa espera.
 *
 * La pantalla se lee como un panel de telemetría porque eso es lo que es: nada
 * de aquí se edita, todo son lecturas que llegan de fuera y que pueden estar
 * viejas o rotas. De ahí que cada cifra vaya en mono y alineada, y que un error
 * guardado se pinte como una avería del instrumento y no como texto rojo.
 */

/**
 * El semáforo de CI.
 *
 * Tres estados y el reparto es exactamente el de siempre: `success`, `failure`
 * y «cualquier otra cosa gira». Una conclusión rara —`cancelled`, `skipped`—
 * cae en el tercero; dejarla de girar sería cambiar el comportamiento, y esto
 * es un cambio de piel.
 */
type Semaforo = { Icono: typeof CheckCircle2; gira: boolean; texto: string; color: string };

function semaforo(conclusion: string | null): Semaforo {
  if (conclusion === "success") {
    return { Icono: CheckCircle2, gira: false, texto: "correcto", color: "var(--color-live)" };
  }
  if (conclusion === "failure") {
    return { Icono: XCircle, gira: false, texto: "fallo", color: "var(--color-danger)" };
  }
  return { Icono: Loader2, gira: true, texto: "en curso", color: "var(--color-accent)" };
}

export default function GithubPage() {
  const confirmar = useConfirmar();
  const { orgId } = useParams<{ orgId: string }>();

  const [connection, setConnection] = useState<Connection | null | undefined>(undefined);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ connections }, { repos }] = await Promise.all([
        api.get<{ connections: Connection[] }>(`/organizations/${orgId}/connections`),
        api.get<{ repos: GithubRepo[] }>(`/organizations/${orgId}/github/repos`),
      ]);
      setConnection(connections.find((c) => c.provider === "github") ?? null);
      setRepos(repos);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "no se pudo cargar");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(
    async (repoId: string) => {
      setRefreshing(repoId);
      try {
        const { repo } = await api.post<{ repo: GithubRepo }>(`/github/repos/${repoId}/refresh`);
        setRepos((prev) => prev.map((r) => (r.id === repoId ? repo : r)));
      } catch (caught) {
        toast.error(caught instanceof ApiError ? caught.message : "no se pudo refrescar");
      } finally {
        setRefreshing(null);
      }
    },
    [],
  );

  /**
   * El resumen de la flota. Solo suma lo que viene de una lectura completa —
   * un repositorio cuyo primer intento falló guarda `{}` y sus ceros no son
   * ceros de verdad, son «no lo sé»: contarlos hundiría el total sin avisar.
   */
  const flota = useMemo(() => {
    let pr = 0;
    let issues = 0;
    let rojos = 0;
    for (const repo of repos) {
      if (!repo.data?.defaultBranch) continue;
      pr += repo.data.openPullRequests;
      issues += repo.data.openIssues;
      if (repo.data.latestRun?.conclusion === "failure") rojos += 1;
    }
    return { pr, issues, rojos };
  }, [repos]);

  return (
    <Pagina
      titulo="GitHub"
      rotulo="Conector · telemetría de repositorios"
      icono={<Github size={20} />}
      ancho="lg"
      acciones={
          connection && (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-raised/50 py-1.5 pl-3.5 pr-1.5">
              <span className="flex items-center gap-2">
                <span className="animate-pulse-slow size-1.5 rounded-full bg-live" aria-hidden />
                <span className="text-xs text-muted">
                  {connection.displayName || "cuenta sin nombre"}
                </span>
              </span>
              <Boton
                variante="fantasma"
                tamano="sm"
                icono={<Unplug size={13} />}
                onClick={async () => {
                  if (
                    !(await confirmar({
                      titulo: "¿Desconectar esta cuenta de GitHub?",
                      descripcion:
                        "Se quitan también sus repositorios de esta organización.",
                      accion: "Desconectar",
                      peligro: true,
                    }))
                  )
                    return;
                  try {
                    await api.delete(`/connections/${connection.id}`);
                    toast.success("GitHub desconectado");
                    await load();
                  } catch (caught) {
                    toast.error(caught instanceof ApiError ? caught.message : "no se pudo desconectar");
                  }
                }}
              >
                Desconectar
              </Boton>
            </div>
          )
      }
    >
        {error && (
          <div className="devup-entrada mb-5">
            <Averia titulo="El panel no pudo cargar" detalle={error} />
          </div>
        )}

        {connection === undefined && <Cargando />}

        {connection === null && <ConectarGithub orgId={orgId} onConnected={load} />}

        {connection && (
          <>
            {repos.length > 0 && (
              <Tarjeta
                className="devup-entrada mb-5 overflow-hidden"
                style={{ "--retraso": "40ms" } as React.CSSProperties}
              >
                <div className="grid grid-cols-2 gap-px bg-line/70 sm:grid-cols-4">
                  <Lectura etiqueta="Repos" valor={repos.length} icono={<Github size={11} />} />
                  <Lectura etiqueta="PR abiertas" valor={flota.pr} icono={<GitPullRequest size={11} />} />
                  <Lectura etiqueta="Issues" valor={flota.issues} icono={<CircleDot size={11} />} />
                  <Lectura
                    etiqueta="CI en rojo"
                    valor={flota.rojos}
                    icono={<XCircle size={11} />}
                    // Cero es una buena noticia y no debería gritar en rojo:
                    // el color solo aparece cuando hay algo que mirar.
                    color={flota.rojos > 0 ? "var(--color-danger)" : undefined}
                  />
                </div>
              </Tarjeta>
            )}

            {repos.length === 0 ? (
              <EstadoVacio
                icono={<Github size={20} />}
                titulo="Ningún repositorio en el panel"
                pista="Añade uno por su nombre completo y el servidor empezará a leer sus pull requests, issues y ejecuciones de CI."
              />
            ) : (
              <div className="space-y-3">
                {repos.map((repo, index) => (
                  <RepoCard
                    key={repo.id}
                    repo={repo}
                    indice={index}
                    refreshing={refreshing === repo.id}
                    onRefresh={() => refresh(repo.id)}
                    onRemove={async () => {
                      try {
                        await api.delete(`/github/repos/${repo.id}`);
                        toast.success(`«${repo.fullName}» quitado`);
                        setRepos((prev) => prev.filter((r) => r.id !== repo.id));
                      } catch (caught) {
                        toast.error(caught instanceof ApiError ? caught.message : "no se pudo quitar");
                      }
                    }}
                  />
                ))}
              </div>
            )}

            <NuevoRepo
              orgId={orgId}
              connectionId={connection.id}
              onAdded={(repo) => setRepos((prev) => [...prev, repo])}
            />
          </>
        )}
    </Pagina>
  );
}

/**
 * Una avería del instrumento.
 *
 * El error guardado de un repositorio no es un dato más de la tarjeta: dice que
 * todo lo que hay alrededor está viejo. Como texto rojo suelto se lee igual que
 * cualquier otra línea; con cinta de peligro al canto, no.
 */
function Averia({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-danger/30 bg-danger/[0.07] py-2.5 pl-5 pr-3">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1.5"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgb(251 113 133 / 0.8) 0 3px, transparent 3px 6px)",
        }}
      />
      <div className="flex items-start gap-2.5">
        <TriangleAlert size={13} className="mt-px shrink-0 text-danger" />
        <div className="min-w-0">
          {/* No es un `Rotulo`: ese es siempre `text-faint` por definición, y
              esta etiqueta tiene que llevar el color de la avería. */}
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-danger">
            {titulo}
          </span>
          <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-danger/90">
            {detalle}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Una cifra del panel: etiqueta arriba, número grande en mono debajo. */
function Lectura({
  etiqueta,
  valor,
  icono,
  color,
}: {
  etiqueta: string;
  valor: number;
  icono: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <span className="flex items-center gap-1.5 text-faint">
        {icono}
        <Rotulo>{etiqueta}</Rotulo>
      </span>
      <p
        className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-ink"
        style={color ? { color } : undefined}
      >
        {valor}
      </p>
    </div>
  );
}

/** Esqueletos mientras llega la primera lectura, con la forma de lo que viene. */
function Cargando() {
  return (
    <div className="space-y-3">
      <div className="devup-esqueleto h-[74px] rounded-2xl" />
      {[0, 1].map((i) => (
        <div key={i} className="devup-esqueleto h-[104px] rounded-2xl" />
      ))}
    </div>
  );
}

function ConectarGithub({ orgId, onConnected }: { orgId: string; onConnected: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Tarjeta className="devup-entrada mx-auto max-w-lg p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent-soft/60 text-accent">
          <KeyRound size={16} />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Conectar GitHub</h2>
          <Rotulo className="mt-0.5 block">Instrumento sin señal</Rotulo>
        </div>
      </div>

      {/* El aviso del alcance fino va antes del formulario y con su propio
          canto: pegar aquí un token clásico de toda la cuenta es el error caro
          de esta pantalla, y avisar después de pegarlo no sirve de nada. */}
      <p className="mt-5 rounded-xl border border-line bg-canvas/40 px-3.5 py-3 text-xs leading-relaxed text-muted">
        Pega un token de acceso personal de alcance fino, limitado solo a los
        repositorios que quieras ver aquí — con permisos de lectura de
        contenido, pull requests, issues y Actions.{" "}
        <a
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 whitespace-nowrap text-accent hover:underline"
        >
          Crear uno <ExternalLink size={10} />
        </a>
      </p>

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setBusy(true);
          try {
            await api.post(`/organizations/${orgId}/connections`, {
              provider: "github",
              displayName,
              secret,
            });
            toast.success("GitHub conectado");
            setDisplayName("");
            setSecret("");
            await onConnected();
          } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : "no se pudo conectar");
          } finally {
            setBusy(false);
          }
        }}
        className="mt-5 space-y-4"
      >
        <Field
          label="Nombre de la cuenta"
          value={displayName}
          onChange={setDisplayName}
          placeholder="Para identificarla (opcional)"
        />
        <Field
          label="Token de alcance fino"
          type="password"
          value={secret}
          onChange={setSecret}
          placeholder="github_pat_…"
          autoComplete="off"
          required
          // `Field` fija el `className` de su input, así que la familia mono
          // —que aquí importa: un token es una cadena que se revisa carácter a
          // carácter— entra por `style`, que sí sobrevive al spread.
          style={{ fontFamily: "var(--font-mono)" }}
        />

        {error && <Averia titulo="No se pudo conectar" detalle={error} />}

        <Boton
          type="submit"
          variante="primario"
          cargando={busy}
          disabled={secret.trim().length === 0}
          className="w-full"
        >
          Conectar
        </Boton>
      </form>
    </Tarjeta>
  );
}

function NuevoRepo({
  orgId,
  connectionId,
  onAdded,
}: {
  orgId: string;
  connectionId: string;
  onAdded: (repo: GithubRepo) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        setBusy(true);
        try {
          const { repo } = await api.post<{ repo: GithubRepo }>(
            `/organizations/${orgId}/github/repos`,
            { connectionId, fullName },
          );
          if (repo.lastError) {
            toast.warning(`Añadido, pero la primera lectura falló: ${repo.lastError}`);
          } else {
            toast.success(`«${repo.fullName}» conectado`);
          }
          setFullName("");
          onAdded(repo);
        } catch (caught) {
          setError(caught instanceof ApiError ? caught.message : "no se pudo añadir");
        } finally {
          setBusy(false);
        }
      }}
      className="mt-5"
    >
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <Rotulo className="mb-1.5 block">Añadir repositorio</Rotulo>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="organización/repositorio"
            className="h-10 w-full rounded-xl border border-line bg-canvas/60 px-3.5 font-mono text-sm outline-none
              transition-[border-color,box-shadow,background-color] duration-200
              placeholder:font-sans placeholder:text-faint
              hover:border-line-strong
              focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_var(--anillo-foco)]"
          />
        </label>
        <Boton
          type="submit"
          cargando={busy}
          disabled={fullName.trim().length === 0}
          icono={<Plus size={15} />}
        >
          Añadir
        </Boton>
      </div>

      {/* El error va debajo y no dentro de la fila: en la fila estrujaba el
          campo y el mensaje quedaba cortado a media palabra. */}
      {error && (
        <div className="mt-2.5">
          <Averia titulo="No se pudo añadir" detalle={error} />
        </div>
      )}
    </form>
  );
}

function RepoCard({
  repo,
  indice,
  refreshing,
  onRefresh,
  onRemove,
}: {
  repo: GithubRepo;
  indice: number;
  refreshing: boolean;
  onRefresh: () => void;
  onRemove: () => Promise<void>;
}) {
  const run = repo.data?.latestRun;
  const ci = run ? semaforo(run.conclusion) : null;

  // El dueño en gris y el nombre en tinta: en una columna de «org/repo» lo que
  // distingue una fila de otra casi siempre es la segunda mitad.
  const corte = repo.fullName.indexOf("/");
  const duenyo = corte > 0 ? repo.fullName.slice(0, corte + 1) : "";
  const nombre = corte > 0 ? repo.fullName.slice(corte + 1) : repo.fullName;

  return (
    <Tarjeta
      className="devup-entrada overflow-hidden"
      style={
        {
          "--retraso": `${Math.min(indice, 8) * 40 + 80}ms`,
          // El canto de la tarjeta lo pone `.panel` en CSS sin capa, así que
          // una utilidad de Tailwind no lo puede vencer: el rojo de la avería
          // tiene que entrar en línea.
          ...(repo.lastError ? { borderColor: "rgb(251 113 133 / 0.3)" } : null),
        } as React.CSSProperties
      }
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-sm">
              <span className="text-faint">{duenyo}</span>
              <span className="font-medium text-ink">{nombre}</span>
            </p>
            {repo.refreshedAt ? (
              <p className="mt-1 font-mono text-[11px] tabular-nums text-faint">
                leído {new Date(repo.refreshedAt).toLocaleString("es-ES")}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-faint">todavía sin actualizar</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <BotonIcono etiqueta="Refrescar ahora" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            </BotonIcono>
            <BotonIcono
              etiqueta="Quitar del panel"
              onClick={onRemove}
              className="hover:text-danger"
            >
              <Trash2 size={14} />
            </BotonIcono>
          </div>
        </div>

        {repo.lastError && (
          <div className="mt-3">
            <Averia titulo="Avería de lectura" detalle={repo.lastError} />
          </div>
        )}
      </div>

      {/* `defaultBranch` solo existe en una lectura completada de verdad —
          un repo recién añadido cuyo primer intento falló guarda `{}`, y ese
          objeto vacío es "truthy" igual que uno real. Comprobar un campo
          concreto en vez de la presencia del objeto es lo que evita pintar
          un resumen a medio rellenar. */}
      {repo.data?.defaultBranch && (
        <div className="grid grid-cols-2 gap-px border-t border-line bg-line/70 sm:grid-cols-4">
          <Celda etiqueta="PR abiertas" icono={<GitPullRequest size={11} />}>
            <span className="font-mono text-base font-semibold tabular-nums text-ink">
              {repo.data.openPullRequests}
            </span>
          </Celda>
          <Celda etiqueta="Issues" icono={<CircleDot size={11} />}>
            <span className="font-mono text-base font-semibold tabular-nums text-ink">
              {repo.data.openIssues}
            </span>
          </Celda>
          <Celda etiqueta="Rama" icono={<GitBranch size={11} />}>
            <span className="block truncate font-mono text-xs text-muted">
              {repo.data.defaultBranch}
            </span>
          </Celda>

          {run && ci ? (
            <a
              href={run.url}
              target="_blank"
              rel="noreferrer"
              className="presionable group flex flex-col justify-center px-4 py-3"
              style={{
                // Tinte y barra inferior del color del estado: el semáforo se
                // tiene que ver de un vistazo desde el otro lado de la mesa,
                // no leyendo la palabra.
                backgroundColor: `color-mix(in oklab, ${ci.color} 9%, var(--color-surface))`,
                boxShadow: `inset 0 -2px 0 ${ci.color}`,
              }}
            >
              <span className="flex items-center gap-1.5 text-faint">
                <ci.Icono
                  size={11}
                  className={ci.gira ? "animate-spin" : ""}
                  style={{ color: ci.color }}
                />
                <Rotulo>CI</Rotulo>
              </span>
              <span className="mt-1 flex items-center gap-1">
                <span
                  className="font-display text-xs font-semibold uppercase tracking-wide"
                  style={{ color: ci.color }}
                >
                  {ci.texto}
                </span>
                <ExternalLink
                  size={10}
                  className="text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                />
              </span>
            </a>
          ) : (
            <Celda etiqueta="CI" icono={<CheckCircle2 size={11} />}>
              <span className="font-display text-xs uppercase tracking-wide text-faint">
                sin señal
              </span>
            </Celda>
          )}
        </div>
      )}

      {repo.data && (repo.data.recentCommits?.length ?? 0) > 0 && (
        <div className="border-t border-line px-4 py-3">
          <span className="flex items-center gap-1.5 text-faint">
            <GitCommitHorizontal size={12} />
            <Rotulo>Últimos commits</Rotulo>
          </span>
          <ul className="mt-2 space-y-1.5">
            {repo.data.recentCommits.slice(0, 3).map((commit) => (
              <li key={commit.sha} className="flex items-center gap-2.5">
                <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 font-mono text-[10px] text-accent">
                  {commit.sha}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{commit.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tarjeta>
  );
}

/** Una casilla del grupo de instrumentos de la tarjeta. */
function Celda({
  etiqueta,
  icono,
  children,
}: {
  etiqueta: string;
  icono: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-center bg-surface px-4 py-3">
      <span className="flex items-center gap-1.5 text-faint">
        {icono}
        <Rotulo>{etiqueta}</Rotulo>
      </span>
      <span className="mt-1 block min-w-0">{children}</span>
    </div>
  );
}
