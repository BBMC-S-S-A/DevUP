"use client";

import { Check, Copy, GitBranch, GitCommitHorizontal, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { api, useMutacion, useRecurso } from "@/lib/datos";
import { ApiError } from "@/lib/api";
import { diaLocal, fechaCorta } from "@/lib/fechas";
import { useWorkspaceId } from "@/lib/workspace-context";

/**
 * Los repositorios que aloja DevUP.
 *
 * NO ES UNA VISTA DE GITHUB, Y POR ESO ES OTRA PANTALLA. La de GitHub es un
 * panel de telemetría: todo lo que enseña llega de fuera y no se toca desde
 * aquí. Esto es lo contrario —se crean, se borran y se empuja contra ellos—, y
 * mezclarlas obligaría a explicar en cada tarjeta de cuál de los dos mundos es.
 *
 * LO QUE DE VERDAD SE LLEVA LA GENTE DE AQUÍ ES UNA LÍNEA: la orden de clonado.
 * Por eso está en cada tarjeta, entera y con su botón de copiar, y no escondida
 * detrás de un detalle. El resto —ramas, commits— se despliega, porque cuesta
 * lanzar git en el servidor y casi nunca es lo que se viene a buscar.
 */

type Repo = {
  id: string;
  slug: string;
  description: string;
  defaultBranch: string;
  sizeBytes: number;
  pushedAt: string | null;
  createdAt: string;
  cloneUrl: string;
};

type Rama = { nombre: string; commit: string };
type Commit = { sha: string; autor: string; cuando: string; mensaje: string };

/**
 * Todo lo que se fecha aquí es un INSTANTE —cuándo se empujó, cuándo se hizo un
 * commit—, así que pasa por `diaLocal` antes de `fechaCorta`. El porqué está
 * escrito en `lib/fechas.ts`; el síntoma era un push fechado mañana.
 */
const cuando = (iso: string) => fechaCorta(diaLocal(iso));

/** El tamaño en algo que se lea de un vistazo. */
function pesa(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RepositoriosPage() {
  const workspaceId = useWorkspaceId();
  const clave = `/workspaces/${workspaceId}/repos`;
  const lista = useRecurso<{ repos: Repo[] }>(clave);
  const [creando, setCreando] = useState(false);

  const repos = lista.datos?.repos ?? [];

  return (
    <Pagina
      titulo="Repositorios"
      rotulo="los que aloja DevUP, con git de verdad"
      icono={<GitBranch size={20} />}
      ancho="lg"
      acciones={
        repos.length > 0 && !creando ? (
          <Boton tamano="sm" icono={<Plus size={14} />} onClick={() => setCreando(true)}>
            Nuevo
          </Boton>
        ) : null
      }
    >
      <div className="space-y-4">
        <Aviso workspaceId={workspaceId} />

        {creando && (
          <NuevoRepositorio
            workspaceId={workspaceId}
            clave={clave}
            onCerrar={() => setCreando(false)}
          />
        )}

        {lista.cargando ? (
          <Cargando etiqueta="Buscando los repositorios" />
        ) : lista.error ? (
          <Fallo onReintentar={() => void lista.recargar()}>{lista.error}</Fallo>
        ) : repos.length === 0 ? (
          <Tarjeta>
            <EstadoVacio
              icono={<GitBranch size={20} />}
              titulo="Este proyecto no aloja ningún repositorio"
              pista="Crea uno y clónalo con tu git de siempre: DevUP sirve el protocolo de verdad, no una copia de la pantalla de GitHub."
              accion={
                creando ? undefined : (
                  <Boton icono={<Plus size={15} />} onClick={() => setCreando(true)}>
                    Crear el primero
                  </Boton>
                )
              }
            />
          </Tarjeta>
        ) : (
          repos.map((repo) => (
            <TarjetaRepo key={repo.id} repo={repo} workspaceId={workspaceId} clave={clave} />
          ))
        )}
      </div>
    </Pagina>
  );
}

/**
 * Dónde está la contraseña.
 *
 * Va arriba y siempre, no como error después del primer intento fallido: `git`
 * no explica nada útil cuando le rechazan la credencial —dice «authentication
 * failed» y se acabó—, así que quien no sepa de antemano que su contraseña de
 * DevUP no sirve aquí va a creer que la escribió mal.
 */
function Aviso({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="rounded-xl border border-line bg-raised/40 px-3.5 py-3">
      <p className="max-w-prose text-xs leading-relaxed text-muted">
        Al clonar o empujar, git pide usuario y contraseña. El usuario da igual; la contraseña es
        una <b>contraseña de git</b>, que se crea en{" "}
        <Link
          href={`/app/w/${workspaceId}/cuenta`}
          className="text-accent underline-offset-2 hover:underline"
        >
          Mi cuenta
        </Link>
        . Es tuya y vale en todos los espacios, pero <b>solo</b> para los repositorios: no abre el
        resto de DevUP.
      </p>
    </div>
  );
}

function NuevoRepositorio({
  workspaceId,
  clave,
  onCerrar,
}: {
  workspaceId: string;
  clave: string;
  onCerrar: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState<string | null>(null);

  const crear = useMutacion(
    () =>
      api.post<{ repo: Repo }>(`/workspaces/${workspaceId}/repos`, {
        slug: slug.trim().toLowerCase(),
        description: descripcion.trim(),
      }),
    { invalida: [clave], exito: "Repositorio creado", alTerminar: onCerrar },
  );

  return (
    <Tarjeta className="p-4">
      <form
        onSubmit={async (evento) => {
          evento.preventDefault();
          setError(null);
          try {
            await crear.ejecutar();
          } catch (caught) {
            // Junto al campo y no en un aviso flotante: lo que falla aquí es
            // casi siempre el nombre, y el nombre está a la vista esperando a
            // que lo corrijan.
            setError(caught instanceof ApiError ? caught.message : "No se pudo crear.");
          }
        }}
        className="space-y-3"
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <Rotulo className="mb-1.5 block">Nombre</Rotulo>
            <input
              value={slug}
              autoFocus
              onChange={(evento) => setSlug(evento.target.value)}
              placeholder="mi-repositorio"
              className="h-10 w-full rounded-xl border border-line bg-canvas/60 px-3.5 font-mono text-sm outline-none
                transition-[border-color,box-shadow,background-color] duration-200
                placeholder:font-sans placeholder:text-faint
                hover:border-line-strong
                focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_var(--anillo-foco)]"
            />
          </label>
          <label className="min-w-0 flex-[2]">
            <Rotulo className="mb-1.5 block">De qué es</Rotulo>
            <input
              value={descripcion}
              onChange={(evento) => setDescripcion(evento.target.value)}
              placeholder="opcional"
              className="h-10 w-full rounded-xl border border-line bg-canvas/60 px-3.5 text-sm outline-none
                transition-[border-color,box-shadow,background-color] duration-200
                placeholder:text-faint
                hover:border-line-strong
                focus:border-accent/60 focus:bg-canvas focus:shadow-[0_0_0_3px_var(--anillo-foco)]"
            />
          </label>
          <Boton
            type="submit"
            variante="primario"
            cargando={crear.enviando}
            disabled={slug.trim().length === 0}
            icono={<Plus size={15} />}
          >
            Crear
          </Boton>
          <Boton type="button" variante="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
        </div>

        <p className="text-[11px] leading-relaxed text-faint">
          Minúsculas, números y guiones. El nombre acaba siendo una carpeta en el servidor, así que
          no admite nada más.
        </p>

        {error && <p className="text-xs text-danger">{error}</p>}
      </form>
    </Tarjeta>
  );
}

function TarjetaRepo({
  repo,
  workspaceId,
  clave,
}: {
  repo: Repo;
  workspaceId: string;
  clave: string;
}) {
  const confirmar = useConfirmar();
  const [abierto, setAbierto] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const borrar = useMutacion(() => api.delete(`/workspaces/${workspaceId}/repos/${repo.slug}`), {
    invalida: [clave],
    exito: "Repositorio borrado",
    fallo: "No se pudo borrar.",
  });

  return (
    <Tarjeta className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-ink">{repo.slug}</span>
            <Chip>{repo.defaultBranch}</Chip>
            <Chip>{pesa(repo.sizeBytes)}</Chip>
          </div>
          {repo.description && (
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted">{repo.description}</p>
          )}
          <p className="mt-1 font-mono text-[10px] tabular-nums text-faint">
            {repo.pushedAt
              ? `último empuje el ${cuando(repo.pushedAt)}`
              : "todavía nadie ha empujado nada"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Boton tamano="sm" variante="fantasma" onClick={() => setAbierto((v) => !v)}>
            {abierto ? "Ocultar" : "Ver dentro"}
          </Boton>
          <BotonIcono
            etiqueta={`Borrar ${repo.slug}`}
            disabled={borrar.enviando}
            onClick={async () => {
              if (
                !(await confirmar({
                  titulo: `¿Borrar «${repo.slug}»?`,
                  descripcion:
                    "Se lleva el historial entero, con todas las ramas y todos los commits. No hay copia y no hay vuelta atrás.",
                  accion: "Borrar",
                  peligro: true,
                }))
              )
                return;
              await borrar.ejecutar();
            }}
            className="text-faint hover:text-danger"
          >
            <Trash2 size={14} />
          </BotonIcono>
        </div>
      </div>

      {/* La orden de clonado, entera. La compone el servidor con el host por el
          que llegó la petición, así que es la que funciona desde donde se está
          mirando — ver el porqué en `routes/repos.ts`. */}
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-canvas/70 px-2.5 py-2 font-mono text-[11px] text-muted">
          git clone {repo.cloneUrl}
        </code>
        <Boton
          tamano="sm"
          variante={copiado ? "fantasma" : "secundario"}
          icono={copiado ? <Check size={13} /> : <Copy size={13} />}
          onClick={async () => {
            await navigator.clipboard.writeText(`git clone ${repo.cloneUrl}`);
            setCopiado(true);
            toast.success("Copiado");
          }}
        >
          {copiado ? "Copiado" : "Copiar"}
        </Boton>
      </div>

      {abierto && <Dentro repo={repo} workspaceId={workspaceId} />}
    </Tarjeta>
  );
}

/**
 * Ramas y commits, leídos del repositorio de verdad y no de una tabla.
 *
 * SE PIDE AL ABRIR Y NO CON LA LISTA: cada uno cuesta lanzar git en el
 * servidor, y una pantalla con diez repositorios lanzaría veinte procesos para
 * enseñar algo que casi nadie mira. Por eso la frescura es larga: el historial
 * cambia cuando alguien empuja, no cada treinta segundos.
 */
function Dentro({ repo, workspaceId }: { repo: Repo; workspaceId: string }) {
  const detalle = useRecurso<{ ramas: Rama[]; commits: Commit[] }>(
    `/workspaces/${workspaceId}/repos/${repo.slug}`,
    { frescura: 300_000 },
  );

  if (detalle.cargando) return <Cargando etiqueta="Leyendo el repositorio" className="py-8" />;
  if (detalle.error) {
    return (
      <Fallo className="mt-3" onReintentar={() => void detalle.recargar()}>
        {detalle.error}
      </Fallo>
    );
  }

  const ramas = detalle.datos?.ramas ?? [];
  const commits = detalle.datos?.commits ?? [];

  if (ramas.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-line bg-canvas/40 px-3 py-2.5 text-[11px] leading-relaxed text-faint">
        Vacío: un repositorio recién creado no tiene ni una rama. Empuja algo y aquí aparecerán las
        ramas y los commits.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Rotulo className="mr-1">Ramas</Rotulo>
        {ramas.map((rama) => (
          <Chip key={rama.nombre} tono={rama.nombre === repo.defaultBranch ? "accent" : "neutro"}>
            {rama.nombre}
          </Chip>
        ))}
      </div>

      <div>
        <Rotulo className="mb-1.5 block">Últimos commits</Rotulo>
        <ul className="space-y-1.5">
          {commits.map((commit) => (
            <li key={commit.sha} className="flex items-start gap-2 text-xs">
              <GitCommitHorizontal size={13} className="mt-0.5 shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate text-muted">{commit.mensaje}</span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                {commit.autor} · {cuando(commit.cuando)} · {commit.sha.slice(0, 7)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
