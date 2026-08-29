"use client";

import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Desplegable, Entrada } from "@/components/ui/Field";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, Dialogo, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import type { Connection, Entorno, EstadoDespliegue } from "@/lib/api";
import { api, invalidar, useMutacion, useRecurso } from "@/lib/datos";
import { useParams } from "next/navigation";

/**
 * La vista unificada de infraestructura.
 *
 * QUÉ PROMETE Y QUÉ NO. Enseña dónde corre lo que el equipo escribe y en qué
 * estado quedó lo último que se desplegó, sin entrar en la consola de cada
 * proveedor. No despliega: DevUP orquesta, y esa decisión está cerrada.
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
  const { orgId } = useParams<{ orgId: string }>();
  const [creando, setCreando] = useState(false);

  const entornos = useRecurso<{ environments: Entorno[] }>(
    `/organizations/${orgId}/environments`,
  );
  const conexiones = useRecurso<{ connections: Connection[] }>(
    `/organizations/${orgId}/connections`,
  );

  const lista = entornos.datos?.environments ?? [];
  const github = (conexiones.datos?.connections ?? []).filter((c) => c.provider === "github");

  return (
    <>
      <Pagina
        titulo="Infraestructura"
        rotulo="Entornos y despliegues"
        icono={<Server size={20} />}
        ancho="lg"
        acciones={
          <Boton
            variante="primario"
            tamano="sm"
            icono={<Plus size={13} />}
            onClick={() => setCreando(true)}
          >
            Añadir entorno
          </Boton>
        }
      >
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
                clave={`/organizations/${orgId}/environments`}
              />
            ))}
          </div>
        )}
      </Pagina>

      {creando && (
        <NuevoEntorno
          orgId={orgId}
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
}: {
  entorno: Entorno;
  indice: number;
  clave: string;
}) {
  const confirmar = useConfirmar();
  const estado = entorno.ultimo ? ESTADOS[entorno.ultimo.state] : null;
  const Icono = estado?.icono;

  const sincronizar = useMutacion(() => api.post(`/environments/${entorno.id}/sync`), {
    invalida: [clave],
    fallo: "No se pudo sincronizar el entorno.",
  });

  const borrar = useMutacion(() => api.delete(`/environments/${entorno.id}`), {
    invalida: [clave],
    exito: "Entorno retirado",
    fallo: "No se pudo retirar el entorno.",
  });

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

function NuevoEntorno({
  orgId,
  conexiones,
  onCerrar,
  onCreado,
}: {
  orgId: string;
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
      api.post(`/organizations/${orgId}/environments`, {
        name: nombre.trim(),
        kind: tipo,
        ...(url.trim() ? { url: url.trim() } : {}),
        ...(conexion && repo.trim()
          ? { connectionId: conexion, externalId: `${repo.trim()}:${entornoRemoto.trim()}` }
          : {}),
      }),
    {
      invalida: [`/organizations/${orgId}/environments`],
      exito: "Entorno añadido",
      fallo: "No se pudo añadir el entorno.",
      alTerminar: () => {
        invalidar(`/organizations/${orgId}/environments`);
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
