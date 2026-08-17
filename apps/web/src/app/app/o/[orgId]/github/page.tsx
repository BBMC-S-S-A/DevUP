"use client";

import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  GitPullRequest,
  Github,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, type Connection, type GithubRepo, api } from "@/lib/api";

/**
 * Conector de GitHub (S7, primera pieza). Un token de acceso personal de
 * alcance fino por organización — no una GitHub App con OAuth, ver §5.1 de
 * docs/plan-conectores-busqueda-e-interfaz.md — y los repositorios que se
 * conecten con él. Las estadísticas las refresca el barrendero del servidor
 * cada diez minutos; el botón de refrescar solo adelanta esa espera.
 */
export default function GithubPage() {
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

  return (
    <div className="min-h-screen">
      <header className="border-b border-line px-6 py-4">
        <Link
          href="/app"
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-faint transition hover:text-muted"
        >
          <ArrowLeft size={13} />
          Organizaciones
        </Link>
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Github size={18} />
          GitHub
        </h1>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        {error && <p className="mb-4 text-sm text-danger">{error}</p>}

        {connection === undefined && <Loader2 className="animate-spin text-faint" size={20} />}

        {connection === null && (
          <ConectarGithub orgId={orgId} onConnected={load} />
        )}

        {connection && (
          <>
            <div className="mb-6 flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3">
              <span className="text-sm">
                Conectado como <span className="font-medium">{connection.displayName || "sin nombre"}</span>
              </span>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm("¿Desconectar esta cuenta de GitHub? Se quitan también sus repositorios.")) return;
                  try {
                    await api.delete(`/connections/${connection.id}`);
                    toast.success("GitHub desconectado");
                    await load();
                  } catch (caught) {
                    toast.error(caught instanceof ApiError ? caught.message : "no se pudo desconectar");
                  }
                }}
                className="text-xs text-faint transition hover:text-danger"
              >
                Desconectar
              </button>
            </div>

            <div className="space-y-3">
              {repos.map((repo) => (
                <RepoCard
                  key={repo.id}
                  repo={repo}
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

            <NuevoRepo
              orgId={orgId}
              connectionId={connection.id}
              onAdded={(repo) => setRepos((prev) => [...prev, repo])}
            />
          </>
        )}
      </main>
    </div>
  );
}

function ConectarGithub({ orgId, onConnected }: { orgId: string; onConnected: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h2 className="mb-1 text-sm font-medium">Conectar GitHub</h2>
      <p className="mb-4 text-xs leading-relaxed text-faint">
        Pega un token de acceso personal de alcance fino, limitado solo a los
        repositorios que quieras ver aquí — con permisos de lectura de
        contenido, pull requests, issues y Actions.{" "}
        <a
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-accent hover:underline"
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
        className="space-y-3"
      >
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Nombre para identificarla (opcional)"
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-accent/60"
        />
        <input
          required
          type="password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder="github_pat_…"
          autoComplete="off"
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-sm outline-none placeholder:text-faint focus:border-accent/60"
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy || secret.trim().length === 0}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-canvas disabled:opacity-40"
        >
          Conectar
        </button>
      </form>
    </div>
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
      className="mt-4 flex gap-2"
    >
      <input
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
        placeholder="organización/repositorio"
        className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm outline-none placeholder:text-faint focus:border-accent/60"
      />
      <button
        type="submit"
        disabled={busy || fullName.trim().length === 0}
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-muted transition hover:text-ink disabled:opacity-40"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Añadir
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}

function RepoCard({
  repo,
  refreshing,
  onRefresh,
  onRemove,
}: {
  repo: GithubRepo;
  refreshing: boolean;
  onRefresh: () => void;
  onRemove: () => Promise<void>;
}) {
  const run = repo.data?.latestRun;

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-medium">{repo.fullName}</p>
          {repo.lastError ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-danger">
              <AlertCircle size={12} />
              {repo.lastError}
            </p>
          ) : repo.refreshedAt ? (
            <p className="mt-1 text-xs text-faint">
              actualizado {new Date(repo.refreshedAt).toLocaleString("es-ES")}
            </p>
          ) : (
            <p className="mt-1 text-xs text-faint">todavía sin actualizar</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title="Refrescar ahora"
            className="rounded-lg p-1.5 text-faint transition hover:bg-raised hover:text-ink"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Quitar"
            className="rounded-lg p-1.5 text-faint transition hover:bg-raised hover:text-danger"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* `defaultBranch` solo existe en una lectura completada de verdad —
          un repo recién añadido cuyo primer intento falló guarda `{}`, y ese
          objeto vacío es "truthy" igual que uno real. Comprobar un campo
          concreto en vez de la presencia del objeto es lo que evita pintar
          un resumen a medio rellenar. */}
      {repo.data?.defaultBranch && (
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <GitPullRequest size={13} />
            {repo.data.openPullRequests} abiertas
          </span>
          <span>{repo.data.openIssues} issues</span>
          <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px]">
            {repo.data.defaultBranch}
          </span>
          {run && (
            <a
              href={run.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 hover:text-ink"
            >
              {run.conclusion === "success" ? (
                <CheckCircle2 size={13} className="text-live" />
              ) : run.conclusion === "failure" ? (
                <XCircle size={13} className="text-danger" />
              ) : (
                <Loader2 size={13} className="animate-spin" />
              )}
              CI
            </a>
          )}
        </div>
      )}

      {repo.data && (repo.data.recentCommits?.length ?? 0) > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3">
          {repo.data.recentCommits.slice(0, 3).map((commit) => (
            <li key={commit.sha} className="flex items-center gap-2 text-xs text-faint">
              <span className="rounded bg-raised px-1 font-mono text-[10px] text-muted">{commit.sha}</span>
              <span className="min-w-0 flex-1 truncate">{commit.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
