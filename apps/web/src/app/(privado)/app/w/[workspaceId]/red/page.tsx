"use client";

import {
  ArrowLeft,
  Boxes,
  FileText,
  Folder,
  GitBranch,
  Hash,
  KanbanSquare,
  Layers,
  MessageSquare,
  Network,
  Server,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Boton } from "@/components/ui/Boton";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useRecurso } from "@/lib/datos";
import { useWorkspaceActual, useWorkspaceId } from "@/lib/workspace-context";

/**
 * La red del proyecto: qué está enlazado con qué.
 *
 * EL GRAFO EXISTÍA ENTERO Y NO SE LLEGABA A ÉL. La 0043 dejó `graph_links` con
 * su guardián, las rutas están desde entonces y los enlaces se tejen solos desde
 * donde ya pasan las cosas. Lo que no había era ni una pantalla que los leyera:
 * la API contestaba a nadie.
 *
 * SE NAVEGA DE UNO EN UNO, Y NO ES UNA LIMITACIÓN: es lo que la ruta contesta
 * —los vecinos de un nodo— y además es lo que se puede autorizar de verdad. Un
 * mapa completo del espacio obligaría a decidir en el servidor qué parte del
 * grafo puede ver cada uno, y esa comprobación ya existe nodo a nodo
 * (`puede_ver_nodo`). Pedir el mapa entero sería escribir esa regla por segunda
 * vez, y la segunda copia es la que se queda atrás.
 *
 * PULSAR UN NODO LLEVA A LA COSA, que es el criterio de la tarjeta. Donde hay
 * una dirección exacta —un canal, un espacio— se va a ella; donde no la hay
 * todavía —una tarea vive en un diálogo del tablero, no en una URL— se va a la
 * pantalla que la contiene. Mandar a la pantalla es peor que mandar a la cosa y
 * mejor que no llevar a ninguna parte, y cuando exista la dirección exacta este
 * mapa de destinos es el único sitio que hay que tocar.
 */

type Tipo =
  | "espacio"
  | "canal"
  | "mensaje"
  | "tarea"
  | "archivo"
  | "componente"
  | "repositorio"
  | "entorno"
  | "area"
  | "persona";

type Vecino = {
  id: string;
  etiqueta: string | null;
  procedencia: "persona" | "regla" | "agente" | string;
  creadoEn: string;
  direccion: "sale" | "entra";
  tipo: Tipo;
  nodoId: string;
  nombre: string | null;
};

/** Cada tipo con su icono y cómo se le llama en voz alta. */
const TIPOS: Record<Tipo, { Icono: typeof Hash; nombre: string }> = {
  espacio: { Icono: Boxes, nombre: "Espacio" },
  canal: { Icono: Hash, nombre: "Canal" },
  mensaje: { Icono: MessageSquare, nombre: "Mensaje" },
  tarea: { Icono: KanbanSquare, nombre: "Tarea" },
  archivo: { Icono: FileText, nombre: "Archivo" },
  componente: { Icono: Layers, nombre: "Componente" },
  repositorio: { Icono: GitBranch, nombre: "Repositorio" },
  entorno: { Icono: Server, nombre: "Entorno" },
  area: { Icono: Folder, nombre: "Rama de trabajo" },
  persona: { Icono: UserRound, nombre: "Persona" },
};

/**
 * A dónde lleva cada tipo de nodo.
 *
 * `null` = todavía no hay ningún sitio al que llevar. Se devuelve nulo en vez
 * de inventar una ruta: un enlace que lleva a una pantalla que no habla de eso
 * es peor que un nodo que no es un enlace.
 */
function destinoDe(tipo: Tipo, nodoId: string, workspaceId: string): string | null {
  switch (tipo) {
    case "espacio":
      return `/app/w/${nodoId}`;
    case "canal":
      return `/app/w/${workspaceId}/c/${nodoId}`;
    case "mensaje":
      // Un mensaje vive dentro de su canal y no tiene dirección propia; el
      // grafo tampoco trae de qué canal es, así que aquí no hay a dónde ir.
      return null;
    case "tarea":
      return `/app/w/${workspaceId}/board`;
    case "archivo":
      return `/app/w/${workspaceId}/archivos`;
    case "area":
      return `/app/w/${workspaceId}/categorias`;
    case "repositorio":
      return `/app/w/${workspaceId}/github`;
    case "entorno":
      return `/app/w/${workspaceId}/infraestructura`;
    case "componente":
      return `/app/w/${workspaceId}/auditoria`;
    case "persona":
      return null;
    default:
      return null;
  }
}

type Paso = { tipo: Tipo; id: string; nombre: string };

export default function RedPage() {
  const workspaceId = useWorkspaceId();
  const workspace = useWorkspaceActual();

  /**
   * Por dónde se ha ido llegando. El primero es el espacio y no se quita: es la
   * única puerta de entrada que no depende de haber pulsado algo antes.
   */
  const [camino, setCamino] = useState<Paso[]>([]);
  const raiz: Paso = {
    tipo: "espacio",
    id: workspaceId,
    nombre: workspace?.name ?? "Este espacio",
  };
  const actual = camino[camino.length - 1] ?? raiz;

  const datos = useRecurso<{ vecinos: Vecino[] }>(`/grafo/${actual.tipo}/${actual.id}`);
  const vecinos = datos.datos?.vecinos ?? [];

  // Agrupados por tipo: una lista de cuarenta enlaces sueltos no se lee, y lo
  // que se pregunta mirando esto es «¿qué hay de esto otro?».
  const porTipo = useMemo(() => {
    const mapa = new Map<Tipo, Vecino[]>();
    for (const vecino of vecinos) {
      const lista = mapa.get(vecino.tipo) ?? [];
      lista.push(vecino);
      mapa.set(vecino.tipo, lista);
    }
    return [...mapa.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [vecinos]);

  const Icono = TIPOS[actual.tipo].Icono;

  return (
    <Pagina
      titulo="Red del proyecto"
      rotulo="qué está enlazado con qué"
      icono={<Network size={20} />}
      ancho="lg"
      acciones={
        camino.length > 0 ? (
          <Boton
            tamano="sm"
            variante="secundario"
            icono={<ArrowLeft size={14} />}
            onClick={() => setCamino((pasos) => pasos.slice(0, -1))}
          >
            Volver
          </Boton>
        ) : null
      }
    >
      <div className="space-y-4">
        {/* Por dónde se ha llegado. Se puede saltar a cualquier paso anterior:
            explorar un grafo es entrar en callejones, y la única forma de que
            eso no canse es que salir cueste un clic. */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setCamino([])}
            className={`presionable rounded-lg border px-2 py-1 ${
              camino.length === 0
                ? "border-line-strong text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {raiz.nombre}
          </button>
          {camino.map((paso, indice) => (
            <span key={`${paso.tipo}:${paso.id}`} className="flex items-center gap-1.5">
              <span className="text-faint" aria-hidden>
                ·
              </span>
              <button
                type="button"
                onClick={() => setCamino((pasos) => pasos.slice(0, indice + 1))}
                className={`presionable truncate rounded-lg border px-2 py-1 ${
                  indice === camino.length - 1
                    ? "border-line-strong text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {paso.nombre}
              </button>
            </span>
          ))}
        </div>

        {/* El nodo donde se está. Es lo único de esta pantalla que lleva el
            acento: es dónde estás, que es exactamente para lo que se reserva. */}
        <Tarjeta className="flex flex-wrap items-center gap-3 p-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-accent/30 bg-accent-soft/40 text-accent">
            <Icono size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <Rotulo>{TIPOS[actual.tipo].nombre}</Rotulo>
            <span className="mt-0.5 block truncate text-base font-semibold text-ink">
              {actual.nombre}
            </span>
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
            {datos.cargando ? "—" : `${vecinos.length} ${vecinos.length === 1 ? "enlace" : "enlaces"}`}
          </span>
          {destinoDe(actual.tipo, actual.id, workspaceId) && (
            <Boton
              tamano="sm"
              variante="secundario"
              onClick={() => {
                const destino = destinoDe(actual.tipo, actual.id, workspaceId);
                if (destino) window.location.href = destino;
              }}
            >
              Abrir
            </Boton>
          )}
        </Tarjeta>

        {datos.cargando ? (
          <Cargando etiqueta="Siguiendo los enlaces" />
        ) : datos.error ? (
          <Fallo onReintentar={() => void datos.recargar()}>{datos.error}</Fallo>
        ) : vecinos.length === 0 ? (
          <Tarjeta>
            <EstadoVacio
              icono={<Network size={20} />}
              titulo="Aquí todavía no llega ningún enlace"
              pista="La red se teje sola desde donde pasan las cosas: al asignar una tarea, al subir un archivo a un canal, al enlazar una rama. También se pueden poner a mano."
            />
          </Tarjeta>
        ) : (
          porTipo.map(([tipo, lista]) => {
            const { Icono: IconoTipo, nombre } = TIPOS[tipo];
            return (
              <div key={tipo}>
                <Rotulo className="mb-1.5 flex items-center gap-1.5">
                  <IconoTipo size={11} />
                  {nombre}
                  <span className="font-mono tabular-nums">{lista.length}</span>
                </Rotulo>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {lista.map((vecino) => {
                    const destino = destinoDe(vecino.tipo, vecino.nodoId, workspaceId);
                    return (
                      <li key={vecino.id}>
                        <Tarjeta className="flex items-center gap-2.5 p-2.5">
                          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-raised/50 text-muted">
                            <IconoTipo size={14} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-ink">
                              {vecino.nombre ?? "sin nombre"}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              {/* La dirección del enlace importa: «esta tarea
                                  cierra ese PR» y «ese PR cierra esta tarea»
                                  son la misma arista contada al revés. */}
                              <span className="font-mono text-[10px] text-faint">
                                {vecino.direccion === "sale" ? "→" : "←"} {vecino.etiqueta ?? "enlaza"}
                              </span>
                              {/* Lo que puso una persona se distingue de lo que
                                  tejió una regla: lo segundo se puede rehacer
                                  desde los hechos, lo primero no. */}
                              {vecino.procedencia === "persona" && (
                                <Chip>a mano</Chip>
                              )}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <Boton
                              tamano="sm"
                              variante="fantasma"
                              onClick={() =>
                                setCamino((pasos) => [
                                  ...pasos,
                                  {
                                    tipo: vecino.tipo,
                                    id: vecino.nodoId,
                                    nombre: vecino.nombre ?? TIPOS[vecino.tipo].nombre,
                                  },
                                ])
                              }
                            >
                              Seguir
                            </Boton>
                            {destino && (
                              <Link
                                href={destino}
                                className="presionable rounded-lg border border-line px-2 py-1 text-xs text-muted hover:border-line-strong hover:text-ink"
                              >
                                Abrir
                              </Link>
                            )}
                          </span>
                        </Tarjeta>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </Pagina>
  );
}
