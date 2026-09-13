"use client";

import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  ExternalLink,
  Loader2,
  Plus,
  Rocket,
  RefreshCw,
  Server,
  Settings2,
  Trash2,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DiagramaArquitectura } from "@/components/arquitectura/Diagrama";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Desplegable, Entrada } from "@/components/ui/Field";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, Dialogo, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useWorkspaceId } from "@/lib/workspace-context";
import type { Connection, Despliegue, Entorno, EstadoDespliegue } from "@/lib/api";
import { api, invalidar, useMutacion, useRecurso } from "@/lib/datos";

const PESTANAS = [
  { id: "entornos", texto: "Entornos" },
  { id: "arquitectura", texto: "Arquitectura" },
] as const;
type Pestana = (typeof PESTANAS)[number]["id"];

/**
 * La vista unificada de infraestructura.
 *
 * QUÉ PROMETE. Enseña dónde corre lo que el equipo escribe, y desde el 13 de
 * septiembre YA NO SOLO MIRA (0063): un entorno con un proveedor de
 * despliegue conectado (Railway hoy, otros después) puede desplegarse y
 * migrarse desde aquí mismo. Sigue siendo un reflejo entre medias — lo que
 * de verdad pasó lo cuenta el proveedor, no un estado que DevUP se invente.
 *
 * LA TARJETA ES UN INSTRUMENTO, NO UN RESUMEN. Lo primero que alguien quiere
 * saber es si producción está en pie, y lo segundo es qué fue lo último que
 * entró. Por eso el estado va en el color y en el icono —no solo en el color,
 * que dejaría fuera a quien no distingue el rojo del verde— y el commit va
 * completo con su autor: «falló» sin decir qué falló obliga a irse a otra
 * pestaña, que es justo lo que esta pantalla existe para evitar.
 */

const ESTADOS: Record<
  EstadoDespliegue,
  { texto: string; tono: "neutro" | "accent" | "live" | "warn" | "danger"; icono: typeof CircleCheck }
> = {
  pending: { texto: "En cola", tono: "neutro", icono: CircleDashed },
  running: { texto: "Desplegando", tono: "accent", icono: Loader2 },
  success: { texto: "En pie", tono: "live", icono: CircleCheck },
  failure: { texto: "Falló", tono: "danger", icono: CircleX },
  cancelled: { texto: "Cancelado", tono: "warn", icono: CircleSlash },
};

const CLASES: Record<Entorno["kind"], string> = {
  production: "border-accent/40 bg-accent-soft/60 text-accent",
  staging: "border-line text-muted",
  preview: "border-line text-faint",
};

const NOMBRE_TIPO: Record<Entorno["kind"], string> = {
  production: "Producción",
  staging: "Pruebas",
  preview: "Vista previa",
};

/** «hace 4 min», que es como se lee una hora de despliegue. */
function hace(iso: string | null): string {
  if (!iso) return "—";
  const segundos = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (segundos < 60) return "hace un momento";
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "ayer" : `hace ${dias} días`;
}

export default function InfraestructuraPage() {
  const workspaceId = useWorkspaceId();
  const [creando, setCreando] = useState(false);
  const [pestana, setPestana] = useState<Pestana>("entornos");

  const entornos = useRecurso<{ environments: Entorno[] }>(
    `/workspaces/${workspaceId}/environments`,
  );
  const conexiones = useRecurso<{ connections: Connection[] }>(
    `/workspaces/${workspaceId}/connections`,
  );

  const lista = entornos.datos?.environments ?? [];
  const github = (conexiones.datos?.connections ?? []).filter((c) => c.provider === "github");

  return (
    <>
      <Pagina
        titulo="Infraestructura"
        rotulo="Entornos y despliegues"
        icono={<Server size={20} />}
        ancho="completo"
        acciones={
          pestana === "entornos" ? (
            // CEDE EL ACENTO MIENTRAS NO HAY ENTORNOS. El estado vacío pinta su
            // propio «Añadir el primero» en acento, y tiene EL MISMO `onClick`
            // que este botón: dos veces la acción principal a la vez, y
            // entonces ninguna lo es. Se mira también `cargando`, porque
            // mientras carga el vacío no está pintado todavía y este sigue
            // siendo el único.
            <Boton
              variante={!entornos.cargando && lista.length === 0 ? "fantasma" : "primario"}
              tamano="sm"
              icono={<Plus size={13} />}
              onClick={() => setCreando(true)}
            >
              Añadir entorno
            </Boton>
          ) : undefined
        }
      >
        <div className="mb-5 flex gap-1 border-b border-line">
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPestana(p.id)}
              className={`presionable -mb-px border-b-2 px-3 py-2 text-xs font-semibold transition-colors
                ${pestana === p.id ? "border-accent text-ink" : "border-transparent text-faint hover:text-muted"}`}
            >
              {p.texto}
            </button>
          ))}
        </div>

        {pestana === "arquitectura" ? (
          <DiagramaArquitectura workspaceId={workspaceId} />
        ) : (
          <>
            {entornos.error && (
              <Fallo className="mb-5" onReintentar={() => void entornos.recargar()}>
                {entornos.error}
              </Fallo>
            )}

            {entornos.cargando ? (
              <Cargando etiqueta="Cargando entornos" />
            ) : lista.length === 0 ? (
              <EstadoVacio
                icono={<Server size={20} />}
                titulo="Todavía no hay ningún entorno"
                pista="Un entorno es un sitio donde corre lo que escribís: producción, pruebas, una demo. DevUP no lo despliega — pregunta a quien lo despliega y enseña cómo quedó."
                accion={
                  <Boton variante="primario" icono={<Plus size={14} />} onClick={() => setCreando(true)}>
                    Añadir el primero
                  </Boton>
                }
              />
            ) : (
              <div className="space-y-3">
                {lista.map((entorno, indice) => (
                  <TarjetaEntorno
                    key={entorno.id}
                    entorno={entorno}
                    indice={indice}
                    clave={`/workspaces/${workspaceId}/environments`}
                    conexiones={conexiones.datos?.connections ?? []}
                    workspaceId={workspaceId}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </Pagina>

      {creando && (
        <NuevoEntorno
          workspaceId={workspaceId}
          conexiones={github}
          onCerrar={() => setCreando(false)}
          onCreado={() => setCreando(false)}
        />
      )}
    </>
  );
}

function TarjetaEntorno({
  entorno,
  indice,
  clave,
  conexiones,
  workspaceId,
}: {
  entorno: Entorno;
  indice: number;
  clave: string;
  conexiones: Connection[];
  workspaceId: string;
}) {
  const confirmar = useConfirmar();
  const [configurando, setConfigurando] = useState(false);
  const estado = entorno.ultimo ? ESTADOS[entorno.ultimo.state] : null;
  const Icono = estado?.icono;

  const conexionDelEntorno = conexiones.find((c) => c.id === entorno.connectionId);
  const puedeDesplegar = conexionDelEntorno?.provider === "railway" || conexionDelEntorno?.provider === "aws";
  const migracion = entorno.providerConfig?.migracion as
    | { githubConnectionId?: string; fullName?: string; workflow?: string }
    | undefined;
  const puedeMigrar = Boolean(migracion?.githubConnectionId && migracion.fullName && migracion.workflow);

  const sincronizar = useMutacion(() => api.post(`/environments/${entorno.id}/sync`), {
    invalida: [clave],
    fallo: "No se pudo sincronizar el entorno.",
  });

  const borrar = useMutacion(() => api.delete(`/environments/${entorno.id}`), {
    invalida: [clave],
    exito: "Entorno retirado",
    fallo: "No se pudo retirar el entorno.",
  });

  const desplegar = useMutacion(
    () => api.post<{ mensaje: string }>(`/environments/${entorno.id}/deploy`),
    {
      invalida: [clave],
      fallo: "No se pudo disparar el despliegue.",
      alTerminar: (r) => toast.success(r.mensaje),
    },
  );

  const migrar = useMutacion(
    () => api.post<{ mensaje: string }>(`/environments/${entorno.id}/migrate`),
    {
      fallo: "No se pudo disparar la migración.",
      alTerminar: (r) => toast.success(r.mensaje),
    },
  );

  return (
    <Tarjeta
      className="devup-entrada p-4"
      viva={entorno.ultimo?.state === "running"}
      style={{ "--retraso": `${Math.min(indice, 8) * 40}ms` } as React.CSSProperties}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{entorno.name}</h2>
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5
                font-display text-[10px] font-semibold uppercase tracking-wider ${CLASES[entorno.kind]}`}
            >
              {NOMBRE_TIPO[entorno.kind]}
            </span>
            {estado && Icono && (
              <Chip tono={estado.tono}>
                {/* El icono además del color: quien no distingue el rojo del
                    verde se quedaría sin saber si producción está en pie. */}
                <Icono
                  size={10}
                  className={entorno.ultimo?.state === "running" ? "animate-spin" : ""}
                />
                {estado.texto}
              </Chip>
            )}
          </div>

          {entorno.url && (
            <a
              href={entorno.url}
              target="_blank"
              rel="noreferrer"
              className="presionable mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              {entorno.url.replace(/^https?:\/\//, "")}
              <ExternalLink size={11} />
            </a>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {puedeDesplegar && (
            <Boton
              tamano="sm"
              variante="secundario"
              icono={<Rocket size={13} />}
              cargando={desplegar.enviando}
              onClick={() => void desplegar.ejecutar()}
            >
              Desplegar
            </Boton>
          )}
          {puedeMigrar && (
            <Boton
              tamano="sm"
              variante="secundario"
              icono={<Wrench size={13} />}
              cargando={migrar.enviando}
              onClick={async () => {
                if (
                  !(await confirmar({
                    titulo: `¿Migrar «${entorno.name}»?`,
                    descripcion:
                      "Dispara el workflow de GitHub Actions que aplica las migraciones pendientes contra este entorno, con su propio respaldo antes de tocar el esquema.",
                    accion: "Migrar",
                  }))
                )
                  return;
                await migrar.ejecutar();
              }}
            >
              Migrar
            </Boton>
          )}
          <BotonIcono
            etiqueta={`Configurar ${entorno.name}`}
            onClick={() => setConfigurando((c) => !c)}
            className={configurando ? "text-accent" : ""}
          >
            <Settings2 size={14} />
          </BotonIcono>
          <BotonIcono
            etiqueta={`Sincronizar ${entorno.name}`}
            onClick={() => void sincronizar.ejecutar()}
            disabled={sincronizar.enviando}
          >
            <RefreshCw size={14} className={sincronizar.enviando ? "animate-spin" : ""} />
          </BotonIcono>
          <BotonIcono
            etiqueta={`Retirar ${entorno.name}`}
            className="hover:text-danger"
            onClick={async () => {
              if (
                !(await confirmar({
                  titulo: `¿Retirar «${entorno.name}»?`,
                  descripcion:
                    "Se quita de esta pantalla junto con su historia de despliegues. Lo que esté corriendo sigue corriendo: DevUP no lo despliega ni lo apaga.",
                  accion: "Retirar",
                  peligro: true,
                }))
              )
                return;
              await borrar.ejecutar();
            }}
          >
            <Trash2 size={14} />
          </BotonIcono>
        </div>
      </div>

      {configurando && (
        <ConfigurarEntorno
          entorno={entorno}
          conexiones={conexiones}
          clave={clave}
          workspaceId={workspaceId}
          onCerrar={() => setConfigurando(false)}
        />
      )}

      {entorno.lastError && (
        <Fallo className="mt-3 text-xs">
          <span className="font-medium">No se pudo leer del proveedor.</span> {entorno.lastError}
        </Fallo>
      )}

      {entorno.ultimo ? (
        <div className="mt-3 border-t border-line pt-3">
          <Rotulo>Último despliegue</Rotulo>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {entorno.ultimo.commitSha && (
              <code className="rounded bg-raised/70 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                {entorno.ultimo.commitSha.slice(0, 7)}
              </code>
            )}
            <span className="min-w-0 flex-1 truncate text-xs text-muted">
              {entorno.ultimo.commitMessage || "sin descripción"}
            </span>
            {entorno.ultimo.author && (
              <span className="text-[11px] text-faint">{entorno.ultimo.author}</span>
            )}
            <span className="text-[11px] text-faint">{hace(entorno.ultimo.startedAt)}</span>
            {entorno.ultimo.logUrl && (
              <a
                href={entorno.ultimo.logUrl}
                target="_blank"
                rel="noreferrer"
                className="presionable inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
              >
                Ver registro
                <ExternalLink size={10} />
              </a>
            )}
          </div>

          <Historial entorno={entorno} />
        </div>
      ) : (
        <p className="mt-3 border-t border-line pt-3 text-xs text-faint">
          {entorno.externalId
            ? "Todavía no ha llegado ningún despliegue de este entorno."
            : "Sin proveedor conectado: este entorno no tiene a quién preguntarle."}
        </p>
      )}
    </Tarjeta>
  );
}

/**
 * Cómo llegar a este entorno para desplegar y migrar (0063).
 *
 * DOS CONEXIONES DISTINTAS Y NO UNA. Desplegar habla con el proveedor de
 * infraestructura (Railway, o el simulacro de AWS); migrar dispara el mismo
 * workflow de GitHub Actions que ya migra con respaldo y verificación. Un
 * entorno puede tener las dos, una sola, o ninguna — no coinciden siempre
 * en la misma cuenta.
 */
function ConfigurarEntorno({
  entorno,
  conexiones,
  clave,
  workspaceId,
  onCerrar,
}: {
  entorno: Entorno;
  conexiones: Connection[];
  clave: string;
  workspaceId: string;
  onCerrar: () => void;
}) {
  const conexionesClave = `/workspaces/${workspaceId}/connections`;
  const deDespliegue = conexiones.filter((c) => c.provider === "railway" || c.provider === "aws");
  const deGithub = conexiones.filter((c) => c.provider === "github");

  const migracionActual = entorno.providerConfig?.migracion as
    | { githubConnectionId?: string; fullName?: string; workflow?: string; ref?: string }
    | undefined;
  const railwayActual = entorno.providerConfig?.railway as
    | { projectId?: string; environmentId?: string; serviceId?: string }
    | undefined;

  const [conexionDespliegue, setConexionDespliegue] = useState(entorno.connectionId ?? "");
  const [projectId, setProjectId] = useState(railwayActual?.projectId ?? "");
  const [environmentId, setEnvironmentId] = useState(railwayActual?.environmentId ?? "");
  const [serviceId, setServiceId] = useState(railwayActual?.serviceId ?? "");

  const [conexionGithub, setConexionGithub] = useState(migracionActual?.githubConnectionId ?? "");
  const [fullName, setFullName] = useState(migracionActual?.fullName ?? "");
  const [workflow, setWorkflow] = useState(migracionActual?.workflow ?? "desplegar.yml");
  const [ref, setRef] = useState(migracionActual?.ref ?? "");

  const guardar = useMutacion(
    () =>
      api.patch(`/environments/${entorno.id}`, {
        connectionId: conexionDespliegue || null,
        providerConfig: {
          ...(projectId && environmentId && serviceId ? { railway: { projectId, environmentId, serviceId } } : {}),
          ...(conexionGithub && fullName && workflow
            ? {
                migracion: {
                  githubConnectionId: conexionGithub,
                  fullName,
                  workflow,
                  ...(ref ? { ref } : {}),
                },
              }
            : {}),
        },
      }),
    {
      invalida: [clave],
      exito: "Configuración guardada",
      fallo: "No se pudo guardar la configuración.",
      alTerminar: onCerrar,
    },
  );

  return (
    <div className="mt-3 space-y-4 border-t border-line pt-3">
      <div>
        <Rotulo className="mb-2 block">Desplegar</Rotulo>
        {deDespliegue.length === 0 ? (
          <ConectarProveedor conexionesClave={conexionesClave} workspaceId={workspaceId} />
        ) : (
          <div className="space-y-2">
            <Desplegable
              contenedor="w-full"
              value={conexionDespliegue}
              onChange={(e) => setConexionDespliegue(e.target.value)}
            >
              <option className="bg-surface" value="">
                Ninguna
              </option>
              {deDespliegue.map((c) => (
                <option className="bg-surface" key={c.id} value={c.id}>
                  {c.displayName || c.provider} ({c.provider})
                </option>
              ))}
            </Desplegable>
            {conexionDespliegue &&
              conexiones.find((c) => c.id === conexionDespliegue)?.provider === "railway" && (
                <div className="grid grid-cols-3 gap-2">
                  <Entrada
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder="projectId"
                    aria-label="Project ID de Railway"
                  />
                  <Entrada
                    value={environmentId}
                    onChange={(e) => setEnvironmentId(e.target.value)}
                    placeholder="environmentId"
                    aria-label="Environment ID de Railway"
                  />
                  <Entrada
                    value={serviceId}
                    onChange={(e) => setServiceId(e.target.value)}
                    placeholder="serviceId"
                    aria-label="Service ID de Railway"
                  />
                </div>
              )}
          </div>
        )}
      </div>

      <div>
        <Rotulo className="mb-2 block">Migrar</Rotulo>
        {deGithub.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-faint">
            No hay ninguna cuenta de GitHub conectada — hace falta una con alcance de Actions en
            escritura para poder disparar el workflow.
          </p>
        ) : (
          <div className="space-y-2">
            <Desplegable
              contenedor="w-full"
              value={conexionGithub}
              onChange={(e) => setConexionGithub(e.target.value)}
            >
              <option className="bg-surface" value="">
                Ninguna
              </option>
              {deGithub.map((c) => (
                <option className="bg-surface" key={c.id} value={c.id}>
                  {c.displayName || "cuenta de GitHub"}
                </option>
              ))}
            </Desplegable>
            {conexionGithub && (
              <>
                <div className="flex gap-2">
                  <Entrada
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="organización/repositorio"
                    aria-label="Repositorio"
                  />
                  <Entrada
                    value={workflow}
                    onChange={(e) => setWorkflow(e.target.value)}
                    placeholder="desplegar.yml"
                    aria-label="Archivo del workflow"
                    className="max-w-[9rem]"
                  />
                </div>
                <Entrada
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="rama (opcional, por defecto la principal)"
                  aria-label="Rama"
                />
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Boton type="button" variante="fantasma" tamano="sm" onClick={onCerrar}>
          Cancelar
        </Boton>
        <Boton
          type="button"
          variante="primario"
          tamano="sm"
          cargando={guardar.enviando}
          onClick={() => void guardar.ejecutar()}
        >
          Guardar
        </Boton>
      </div>
    </div>
  );
}

/**
 * Conectar un token de Railway o del simulacro de AWS.
 *
 * NO HAY TODAVÍA UNA PANTALLA GENÉRICA DE CONEXIONES para esto, así que vive
 * aquí mismo, donde hace falta — el mismo baúl de secretos de siempre
 * (`connections`/`connection_secrets`, 0015), solo que con un proveedor
 * nuevo (0063).
 */
function ConectarProveedor({
  conexionesClave,
  workspaceId,
}: {
  conexionesClave: string;
  workspaceId: string;
}) {
  const [proveedor, setProveedor] = useState<"railway" | "aws">("railway");
  const [nombre, setNombre] = useState("");
  const [secreto, setSecreto] = useState("");

  const conectar = useMutacion(
    () =>
      api.post(`/workspaces/${workspaceId}/connections`, {
        provider: proveedor,
        displayName: nombre.trim(),
        secret: secreto,
      }),
    {
      invalida: [conexionesClave],
      exito: "Cuenta conectada",
      fallo: "No se pudo conectar.",
      alTerminar: () => {
        setNombre("");
        setSecreto("");
      },
    },
  );

  return (
    <div className="space-y-2 rounded-xl border border-line bg-canvas/40 p-3">
      <p className="text-[11px] leading-relaxed text-faint">
        No hay ninguna cuenta de Railway o AWS conectada en esta organización todavía.
        {proveedor === "aws" && " AWS es un simulacro por ahora: no hay una cuenta real detrás."}
      </p>
      <div className="flex gap-2">
        <Desplegable
          value={proveedor}
          onChange={(e) => setProveedor(e.target.value as "railway" | "aws")}
          className="max-w-[8rem]"
        >
          <option className="bg-surface" value="railway">
            Railway
          </option>
          <option className="bg-surface" value="aws">
            AWS (simulacro)
          </option>
        </Desplegable>
        <Entrada
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre (opcional)"
          className="min-w-0 flex-1"
        />
      </div>
      <Entrada
        type="password"
        value={secreto}
        onChange={(e) => setSecreto(e.target.value)}
        placeholder={proveedor === "railway" ? "Token de proyecto de Railway" : "Cualquier texto — es un simulacro"}
        autoComplete="off"
        style={{ fontFamily: "var(--font-mono)" }}
      />
      <div className="flex justify-end">
        <Boton
          type="button"
          tamano="sm"
          variante="primario"
          disabled={secreto.trim().length === 0}
          cargando={conectar.enviando}
          onClick={() => void conectar.ejecutar()}
        >
          Conectar
        </Boton>
      </div>
    </div>
  );
}

/**
 * Los despliegues anteriores, bajo petición.
 *
 * `GET /environments/:envId/deployments` devuelve los últimos treinta y **no lo
 * llamaba nadie**: se sincronizaban del proveedor, se guardaban con
 * `upsert_deployment` y solo se enseñaba el más reciente. Toda la historia
 * estaba en la base y no había forma de verla — que es justo lo que se mira
 * cuando algo se rompió y hay que saber desde cuándo.
 *
 * SE PIDE AL ABRIR, NO AL PINTAR LA TARJETA. Con varios entornos en pantalla,
 * cargar treinta despliegues de cada uno por si acaso es mucha consulta para
 * algo que casi nunca se mira. `useRecurso` con clave nula no pide nada hasta
 * que se abre.
 */
function Historial({ entorno }: { entorno: Entorno }) {
  const [abierto, setAbierto] = useState(false);
  const historial = useRecurso<{ deployments: Despliegue[] }>(
    abierto ? `/environments/${entorno.id}/deployments` : null,
  );

  // El más reciente ya está arriba: repetirlo aquí haría dudar de si son dos
  // despliegues o el mismo dos veces.
  const anteriores = (historial.datos?.deployments ?? []).filter((d) => d.id !== entorno.ultimo?.id);

  return (
    <div className="mt-2.5">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="presionable inline-flex items-center gap-1 text-[11px] text-faint hover:text-accent"
      >
        {abierto ? "Ocultar el historial" : "Ver despliegues anteriores"}
      </button>

      {abierto && (
        <div className="mt-2">
          {historial.cargando ? (
            <p className="text-[11px] text-faint">cargando…</p>
          ) : historial.error ? (
            <p className="text-[11px] text-danger">{historial.error}</p>
          ) : anteriores.length === 0 ? (
            <p className="text-[11px] text-faint">No hay ninguno anterior a este.</p>
          ) : (
            <ul className="space-y-1">
              {anteriores.map((d) => {
                const e = ESTADOS[d.state];
                return (
                  <li key={d.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <e.icono size={10} className="shrink-0 translate-y-px text-faint" />
                    {d.commitSha && (
                      <code className="font-mono text-[10px] text-faint">
                        {d.commitSha.slice(0, 7)}
                      </code>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                      {d.commitMessage || e.texto}
                    </span>
                    <span className="text-[10px] text-faint">{hace(d.startedAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NuevoEntorno({
  workspaceId,
  conexiones,
  onCerrar,
  onCreado,
}: {
  workspaceId: string;
  conexiones: Connection[];
  onCerrar: () => void;
  onCreado: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<Entorno["kind"]>("production");
  const [url, setUrl] = useState("");
  const [conexion, setConexion] = useState(conexiones[0]?.id ?? "");
  const [repo, setRepo] = useState("");
  const [entornoRemoto, setEntornoRemoto] = useState("production");

  const crear = useMutacion(
    () =>
      api.post(`/workspaces/${workspaceId}/environments`, {
        name: nombre.trim(),
        kind: tipo,
        ...(url.trim() ? { url: url.trim() } : {}),
        ...(conexion && repo.trim()
          ? { connectionId: conexion, externalId: `${repo.trim()}:${entornoRemoto.trim()}` }
          : {}),
      }),
    {
      invalida: [`/workspaces/${workspaceId}/environments`],
      exito: "Entorno añadido",
      fallo: "No se pudo añadir el entorno.",
      alTerminar: () => {
        invalidar(`/workspaces/${workspaceId}/environments`);
        onCreado();
      },
    },
  );

  return (
    <Dialogo
      titulo="Añadir un entorno"
      descripcion="Un sitio donde corre lo vuestro. DevUP le pregunta a quien lo despliega."
      onCerrar={onCerrar}
      ancho="md"
    >
      <form
        className="space-y-3"
        onSubmit={(evento) => {
          evento.preventDefault();
          void crear.ejecutar();
        }}
      >
        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <Rotulo className="mb-1.5 block">Nombre</Rotulo>
            <Entrada
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="producción"
            />
          </label>
          <label className="shrink-0">
            <Rotulo className="mb-1.5 block">Tipo</Rotulo>
            <Desplegable value={tipo} onChange={(e) => setTipo(e.target.value as Entorno["kind"])}>
              <option className="bg-surface" value="production">
                Producción
              </option>
              <option className="bg-surface" value="staging">
                Pruebas
              </option>
              <option className="bg-surface" value="preview">
                Vista previa
              </option>
            </Desplegable>
          </label>
        </div>

        <label className="block">
          <Rotulo className="mb-1.5 block">Dirección</Rotulo>
          <Entrada
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…  (opcional: se aprende sola del despliegue)"
          />
        </label>

        {conexiones.length > 0 ? (
          <div className="rounded-xl border border-line bg-raised/40 p-3">
            <Rotulo className="mb-2 block">De dónde salen sus despliegues</Rotulo>
            <div className="space-y-2">
              <Desplegable
                contenedor="w-full"
                value={conexion}
                onChange={(e) => setConexion(e.target.value)}
                aria-label="Conexión"
              >
                <option className="bg-surface" value="">
                  Ninguna — lo anoto a mano
                </option>
                {conexiones.map((c) => (
                  <option className="bg-surface" key={c.id} value={c.id}>
                    {c.displayName || "cuenta de GitHub"}
                  </option>
                ))}
              </Desplegable>

              {conexion && (
                <div className="flex gap-2">
                  <Entrada
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder="organización/repositorio"
                    aria-label="Repositorio"
                  />
                  <Entrada
                    value={entornoRemoto}
                    onChange={(e) => setEntornoRemoto(e.target.value)}
                    placeholder="production"
                    aria-label="Entorno en GitHub"
                    className="max-w-[10rem]"
                  />
                </div>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              El segundo campo es el nombre del entorno <em>dentro de GitHub</em>, que no tiene por
              qué ser el de aquí. Un mismo repositorio publica a varios, y sin esto la tarjeta
              enseñaría el despliegue de otro.
            </p>
          </div>
        ) : (
          <p className="rounded-xl border border-line bg-raised/40 p-3 text-xs leading-relaxed text-faint">
            No hay ninguna cuenta de GitHub conectada en esta organización, así que el entorno se
            crea sin proveedor: aparecerá en la lista, pero nadie le podrá preguntar por sus
            despliegues.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Boton type="button" variante="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" variante="primario" cargando={crear.enviando}>
            Añadir
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
}
