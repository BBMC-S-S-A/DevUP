"use client";

import { Code2, FolderGit2, Github, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Boton } from "@/components/ui/Boton";
import { EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { ApiError, type GithubRepo, api } from "@/lib/api";

export type ProyectoElegido = { tipo: "github"; repoId: string; fullName: string } | { tipo: "blanco" };

/**
 * Pantalla de arranque del entorno de desarrollo: importar uno de los
 * repositorios de GitHub ya conectados en esta organización (solo lectura
 * en esta fase), o empezar en blanco con una plantilla mínima de Node.js que
 * no necesita ninguna conexión. Ninguna de las dos vías bloquea a la otra.
 */
export function IniciarProyecto({
  orgId,
  onElegir,
}: {
  orgId: string;
  onElegir: (proyecto: ProyectoElegido) => void;
}) {
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ repos: GithubRepo[] }>(`/organizations/${orgId}/github/repos`)
      .then(({ repos }) => setRepos(repos))
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : "no se pudo cargar"));
  }, [orgId]);

  return (
    <div className="devup-entrada mx-auto max-w-2xl space-y-6 py-10">
      <div>
        <h2 className="text-lg font-semibold">Empezar un entorno de desarrollo</h2>
        <p className="mt-1 text-sm leading-relaxed text-faint">
          Editor y terminal reales, corriendo dentro de tu propio navegador — nada de esto usa los
          servidores de DevUP.
        </p>
      </div>

      <Tarjeta className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Github size={15} className="text-faint" />
          <Rotulo>Importar de GitHub</Rotulo>
        </div>

        {repos === null && !error && (
          <div className="flex items-center gap-2 py-4 text-xs text-faint">
            <Loader2 size={14} className="animate-spin" />
            Cargando repositorios conectados…
          </div>
        )}

        {error && <p className="py-2 text-xs text-danger">{error}</p>}

        {repos && repos.length === 0 && (
          <EstadoVacio
            icono={<FolderGit2 size={18} />}
            titulo="Ningún repositorio conectado todavía"
            pista="Conéctalo primero desde la pestaña de GitHub de esta organización."
          />
        )}

        {repos && repos.length > 0 && (
          <ul className="space-y-1.5">
            {repos.map((repo) => (
              <li key={repo.id}>
                <button
                  onClick={() => onElegir({ tipo: "github", repoId: repo.id, fullName: repo.fullName })}
                  className="presionable flex w-full items-center justify-between rounded-xl border border-line bg-raised/40 px-3.5 py-2.5 text-left text-sm hover:border-accent/40 hover:bg-accent-soft/40"
                >
                  <span className="truncate font-mono">{repo.fullName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <div className="flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-line" />o<span className="h-px flex-1 bg-line" />
      </div>

      <Tarjeta className="flex items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-raised text-muted">
            <Code2 size={16} />
          </span>
          <div>
            <p className="text-sm font-medium">Empezar en blanco</p>
            <Rotulo className="mt-0.5 block">Plantilla mínima de Node.js</Rotulo>
          </div>
        </div>
        <Boton onClick={() => onElegir({ tipo: "blanco" })}>Empezar</Boton>
      </Tarjeta>
    </div>
  );
}
