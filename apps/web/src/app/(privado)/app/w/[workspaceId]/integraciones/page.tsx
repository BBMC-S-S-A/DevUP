"use client";

import {
  CircleCheck,
  CircleX,
  FileCode,
  Github,
  Lightbulb,
  Loader2,
  Plug,
  RefreshCw,
  Server,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { BotonIcono } from "@/components/ui/Boton";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Desplegable } from "@/components/ui/Field";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useWorkspaceId } from "@/lib/workspace-context";
import type { Connection, GithubRepo, SaludConexion } from "@/lib/api";
import { api, useMutacion, useRecurso } from "@/lib/datos";

const PESTANAS = [
  { id: "conexiones", texto: "Conexiones" },
  { id: "recomendaciones", texto: "Recomendaciones" },
] as const;
type Pestana = (typeof PESTANAS)[number]["id"];

/**
 * Integraciones: lo que este workspace conecta, y lo que podría ahorrarse.
 *
 * DOS PREGUNTAS DISTINTAS, DOS PESTAÑAS. «Conexiones» contesta si lo que ya
 * está conectado —GitHub, Railway, AWS, la base propia— sigue respondiendo
 * ahora mismo. «Recomendaciones» (la pantalla original de esta ruta) contesta
 * qué NO está conectado todavía y os costaría menos si lo estuviera. Son
 * preguntas independientes: la primera es sobre lo que hay, la segunda sobre
 * lo que falta.
 */
const PROVEEDOR: Record<
  string,
  { texto: string; icono: typeof Github }
> = {
  github: { texto: "GitHub", icono: Github },
  railway: { texto: "Railway", icono: Server },
  aws: { texto: "AWS (simulacro)", icono: Server },
  postgres: { texto: "Base de datos", icono: Server },
};

type Prueba = { archivo: string; linea: number | null; fragmento: string };

type Recomendacion = {
  id: string;
  titulo: string;
  problema: string;
  propuesta: string;
  pruebas: Prueba[];
  peso: "alta" | "media";
};

type Respuesta = {
  fullName: string;
  recomendaciones: Recomendacion[];
  archivosLeidos: number;
};

export default function IntegracionesPage() {
  const workspaceId = useWorkspaceId();
  const [pestana, setPestana] = useState<Pestana>("conexiones");

  return (
    <Pagina
      titulo="Integraciones"
      rotulo="Lo que este workspace conecta, y lo que le costaría menos si conectara"
      icono={<Plug size={20} />}
      ancho="xl"
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

      {pestana === "conexiones" ? (
        <Conexiones workspaceId={workspaceId} />
      ) : (
        <Recomendaciones workspaceId={workspaceId} />
      )}
    </Pagina>
  );
}

/**
 * Lo que ya está conectado, y si sigue respondiendo.
 *
 * NO ES DONDE SE CONECTA CADA COSA. GitHub tiene su propia pantalla, Railway
 * y AWS la suya dentro de Infraestructura, la base propia la suya dentro de
 * Base de datos — cada una sabe pedir justo lo que su proveedor necesita, y
 * repetir esos formularios aquí sería tres formas distintas de hacer lo
 * mismo. Esta pantalla agrupa lo que YA existe y contesta una sola pregunta
 * que ninguna de las otras tres contesta por sí sola: de un vistazo, ¿qué
 * está en pie ahora mismo?
 */
function Conexiones({ workspaceId }: { workspaceId: string }) {
  const clave = `/workspaces/${workspaceId}/connections`;
  const conexiones = useRecurso<{ connections: Connection[] }>(clave);
  const lista = (conexiones.datos?.connections ?? []).filter((c) => c.provider in PROVEEDOR);

  const [salud, setSalud] = useState<Record<string, SaludConexion>>({});
  const comprobar = useMutacion(
    () => api.get<{ health: Record<string, SaludConexion> }>(`${clave}/health`),
    {
      fallo: "No se pudo comprobar el estado.",
      alTerminar: (r) => setSalud(r.health),
    },
  );

  if (conexiones.error) {
    return (
      <Fallo onReintentar={() => void conexiones.recargar()}>{conexiones.error}</Fallo>
    );
  }

  if (conexiones.cargando) return <Cargando etiqueta="Cargando conexiones" />;

  if (lista.length === 0) {
    return (
      <EstadoVacio
        icono={<Plug size={20} />}
        titulo="Este workspace todavía no tiene nada conectado"
        pista="GitHub, Railway o AWS (en Infraestructura) y la base propia (en Base de datos) aparecerán aquí en cuanto se conecten."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <BotonIcono
          etiqueta="Comprobar el estado de todas"
          onClick={() => void comprobar.ejecutar()}
          disabled={comprobar.enviando}
        >
          <RefreshCw size={14} className={comprobar.enviando ? "animate-spin" : ""} />
        </BotonIcono>
      </div>

      <div className="space-y-2">
        {lista.map((c) => (
          <FilaConexion
            key={c.id}
            conexion={c}
            salud={salud[c.id]}
            comprobando={comprobar.enviando}
            clave={clave}
          />
        ))}
      </div>
    </div>
  );
}

function FilaConexion({
  conexion,
  salud,
  comprobando,
  clave,
}: {
  conexion: Connection;
  salud: SaludConexion | undefined;
  comprobando: boolean;
  clave: string;
}) {
  const confirmar = useConfirmar();
  const info = PROVEEDOR[conexion.provider];
  const Icono = info?.icono ?? Plug;

  const borrar = useMutacion(() => api.delete(`/connections/${conexion.id}`), {
    invalida: [clave],
    exito: "Desconectada",
    fallo: "No se pudo desconectar.",
  });

  return (
    <Tarjeta className="flex items-center gap-3 p-3">
      <Icono size={16} className="shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">
            {conexion.displayName || info?.texto || conexion.provider}
          </span>
          <span className="text-[11px] text-faint">{info?.texto ?? conexion.provider}</span>
        </div>
        {salud && (
          <p className={`mt-0.5 text-[11px] ${salud.ok ? "text-faint" : "text-danger"}`}>
            {salud.detalle}
          </p>
        )}
      </div>

      {comprobando && !salud ? (
        <Loader2 size={14} className="shrink-0 animate-spin text-faint" />
      ) : salud ? (
        <Chip tono={salud.ok ? "live" : "danger"}>
          {salud.ok ? <CircleCheck size={10} /> : <CircleX size={10} />}
          {salud.ok ? "En pie" : "Con problemas"}
        </Chip>
      ) : null}

      <BotonIcono
        etiqueta={`Desconectar ${info?.texto ?? conexion.provider}`}
        className="hover:text-danger"
        onClick={async () => {
          if (
            !(await confirmar({
              titulo: `¿Desconectar ${info?.texto ?? conexion.provider}?`,
              descripcion:
                "Se quita de la bóveda de este workspace. Lo que ya esté desplegado o guardado no se toca.",
              accion: "Desconectar",
              peligro: true,
            }))
          )
            return;
          await borrar.ejecutar();
        }}
      >
        <Trash2 size={14} />
      </BotonIcono>
    </Tarjeta>
  );
}

/**
 * Integraciones guiadas (la pantalla original de esta ruta).
 *
 * NO ES UN CATÁLOGO, Y ESA ES TODA LA DIFERENCIA. Un sitio donde buscas lo que
 * ya sabes que quieres no le sirve a quien no sabe que eso existe — y ese es el
 * caso mayoritario: mucha gente no ha descartado estas herramientas, es que no
 * las conoce. Aquí no se busca nada: se lee lo que ya están escribiendo y se
 * dice qué se lo ahorraría.
 *
 * CADA RECOMENDACIÓN ENSEÑA SU PRUEBA, y por eso se puede discutir. «Te
 * recomendamos Supabase» no lo lee nadie; «en `src/auth.ts:34` estás firmando
 * tus propios tokens» se puede mirar y darle o quitarle la razón. Sin la
 * prueba esto sería publicidad dentro de una herramienta de trabajo, que es la
 * forma más rápida de que nadie vuelva a abrir esta pantalla.
 *
 * LO QUE TODAVÍA NO HACE, y conviene no fingirlo: montar la integración. La
 * propuesta describe un «¿lo monto?» que crea el proyecto, guarda las claves en
 * la bóveda y escribe el esquema. Eso necesita credenciales del proveedor y
 * decisiones que no están tomadas. Esta pantalla es la mitad del diagnóstico,
 * que es la que de verdad no tiene nadie.
 */
function Recomendaciones({ workspaceId }: { workspaceId: string }) {
  const [repoId, setRepoId] = useState("");

  const repos = useRecurso<{ repos: GithubRepo[] }>(`/workspaces/${workspaceId}/github/repos`);
  const lista = repos.datos?.repos ?? [];
  const elegido = repoId || lista[0]?.id || "";

  // Una hora: lo que hace un equipo a mano no cambia entre dos visitas a esta
  // pantalla, y cada consulta cuesta veinte peticiones a GitHub.
  const diagnostico = useRecurso<Respuesta>(
    elegido ? `/github/repos/${elegido}/integraciones` : null,
    { frescura: 3_600_000 },
  );

  const recomendaciones = diagnostico.datos?.recomendaciones ?? [];

  return (
    <>
      {lista.length > 1 && (
        <div className="mb-4 flex justify-end">
          <Desplegable
            tamano="sm"
            value={elegido}
            onChange={(e) => setRepoId(e.target.value)}
            aria-label="Repositorio"
          >
            {lista.map((r) => (
              <option className="bg-surface" key={r.id} value={r.id}>
                {r.fullName}
              </option>
            ))}
          </Desplegable>
        </div>
      )}

      {repos.error && (
        <Fallo className="mb-5" onReintentar={() => void repos.recargar()}>
          {repos.error}
        </Fallo>
      )}

      {repos.cargando ? (
        <Cargando etiqueta="Cargando repositorios" />
      ) : lista.length === 0 ? (
        <EstadoVacio
          icono={<Lightbulb size={20} />}
          titulo="No hay ningún repositorio conectado"
          pista="Conecta uno en GitHub y aquí se leerá para ver qué estáis resolviendo a mano. No se ejecuta nada."
        />
      ) : (
        <>
          {diagnostico.error ? (
            <Fallo onReintentar={() => void diagnostico.recargar()}>{diagnostico.error}</Fallo>
          ) : diagnostico.cargando ? (
            <Cargando etiqueta="Leyendo el repositorio" />
          ) : recomendaciones.length === 0 ? (
            // El vacío aquí es una buena noticia y hay que decirlo como tal: si
            // se pinta igual que «no encontré nada», se lee como que falló.
            <EstadoVacio
              icono={<Lightbulb size={20} />}
              titulo="No encontré nada que recomendar"
              pista={`Leí ${diagnostico.datos?.archivosLeidos ?? 0} archivos de ${diagnostico.datos?.fullName ?? "el repositorio"} y no vi nada que estéis resolviendo a mano pudiendo no hacerlo. Es una buena noticia.`}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-faint">
                Salen de leer {diagnostico.datos?.archivosLeidos} archivos de{" "}
                <code className="font-mono text-[11px] text-muted">
                  {diagnostico.datos?.fullName}
                </code>
                . Cada una enseña dónde se ve, para que se pueda discutir.
              </p>

              {recomendaciones.map((r, i) => (
                <Recomendada key={r.id} r={r} indice={i} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function Recomendada({ r, indice }: { r: Recomendacion; indice: number }) {
  return (
    <Tarjeta
      className="devup-entrada p-4"
      style={{ "--retraso": `${Math.min(indice, 8) * 40}ms` } as React.CSSProperties}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-sm font-semibold">{r.titulo}</h2>
        {r.peso === "alta" && (
          <Chip tono="danger">
            <TriangleAlert size={10} />
            Cuesta ya
          </Chip>
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted">{r.problema}</p>

      <div className="mt-3 rounded-xl border border-accent/25 bg-accent-soft/40 p-3">
        <Rotulo className="mb-1 block">Lo que lo sustituye</Rotulo>
        <p className="text-xs leading-relaxed text-muted">{r.propuesta}</p>
      </div>

      <div className="mt-3 border-t border-line pt-2.5">
        <Rotulo className="mb-1.5 block">Dónde se ve</Rotulo>
        <ul className="space-y-1">
          {r.pruebas.map((p, i) => (
            <li key={i} className="flex min-w-0 items-baseline gap-2">
              <FileCode size={11} className="shrink-0 translate-y-px text-faint" />
              <code className="shrink-0 font-mono text-[11px] text-accent">
                {p.archivo}
                {p.linea ? `:${p.linea}` : ""}
              </code>
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">
                {p.fragmento}
              </code>
            </li>
          ))}
        </ul>
      </div>
    </Tarjeta>
  );
}
