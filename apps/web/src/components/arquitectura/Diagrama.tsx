"use client";

import { Boxes, Database, Globe, HardDrive, Layers, Link2, Plus, Trash2, X, Zap } from "lucide-react";
import { useRef, useState } from "react";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { useConfirmar } from "@/components/ui/Confirmar";
import { AreaTexto, Desplegable, Entrada } from "@/components/ui/Field";
import { Cargando, Fallo } from "@/components/ui/Pagina";
import { Dialogo, EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import type { EnlaceArquitectura, NodoArquitectura, TipoNodoArquitectura } from "@/lib/api";
import { api, sembrar, useMutacion, useRecurso } from "@/lib/datos";

/**
 * El diagrama de arquitectura: un lienzo con nodos que se arrastran y se
 * enlazan entre sí.
 *
 * QUÉ PROMETE. Un sitio para dibujar cómo está montado el sistema —un
 * servicio, una base de datos, una cola— y cómo se hablan entre ellos. Traer
 * una arquitectura ya escrita en Terraform queda para después: esto es la
 * pieza a mano.
 *
 * LA POSICIÓN SE MUEVE OPTIMISTA Y SE GUARDA AL SOLTAR, no en cada píxel. Un
 * arrastre manda una petición por movimiento del ratón sería decenas de
 * peticiones para mover una caja tres centímetros; con la posición en estado
 * local durante el gesto y un solo `PATCH` al soltar, el lienzo se siente
 * instantáneo y el servidor recibe una escritura, no cien.
 */

const ICONO: Record<TipoNodoArquitectura, typeof Database> = {
  servicio: Boxes,
  base_datos: Database,
  cola: Layers,
  cache: Zap,
  almacenamiento: HardDrive,
  api_externa: Globe,
  otro: Layers,
};

const NOMBRE_TIPO: Record<TipoNodoArquitectura, string> = {
  servicio: "Servicio",
  base_datos: "Base de datos",
  cola: "Cola",
  cache: "Caché",
  almacenamiento: "Almacenamiento",
  api_externa: "API externa",
  otro: "Otro",
};

const ANCHO_NODO = 176;
const ALTO_LIENZO = 560;

type Respuesta = { nodes: NodoArquitectura[]; links: EnlaceArquitectura[] };

export function DiagramaArquitectura({ workspaceId }: { workspaceId: string }) {
  const clave = `/workspaces/${workspaceId}/architecture`;
  const recurso = useRecurso<Respuesta>(clave);
  const lienzoRef = useRef<HTMLDivElement>(null);
  const confirmar = useConfirmar();

  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<NodoArquitectura | null>(null);
  const [conectando, setConectando] = useState<NodoArquitectura | null>(null);
  const [enlazandoCon, setEnlazandoCon] = useState<{ origen: NodoArquitectura; destino: NodoArquitectura } | null>(
    null,
  );
  // Posición optimista del nodo que se está arrastrando ahora mismo.
  const [arrastre, setArrastre] = useState<{ id: string; x: number; y: number } | null>(null);

  const nodos = recurso.datos?.nodes ?? [];
  const enlaces = recurso.datos?.links ?? [];
  const porId = new Map(nodos.map((n) => [n.id, n]));

  /**
   * Mover NO invalida, escribe la posición nueva directamente en lo guardado.
   *
   * Invalidando, soltar una caja disparaba una relectura del diagrama entero
   * —con su parpadeo— para enterarse de algo que esta pantalla ya sabía: dónde
   * acaba de soltarla la persona que la arrastró. El servidor se entera igual
   * por el `PATCH`; lo que no hace falta es preguntárselo de vuelta.
   */
  const mover = useMutacion(
    (id: string, posX: number, posY: number) => api.patch(`/architecture/nodes/${id}`, { posX, posY }),
    { fallo: "No se pudo guardar la posición." },
  );

  const borrarNodo = useMutacion((id: string) => api.delete(`/architecture/nodes/${id}`), {
    invalida: [clave],
    exito: "Nodo retirado",
    fallo: "No se pudo retirar el nodo.",
  });

  const borrarEnlace = useMutacion((id: string) => api.delete(`/architecture/links/${id}`), {
    invalida: [clave],
    fallo: "No se pudo borrar el enlace.",
  });

  /** Lo último que trajo el servidor, para reescribirlo con la posición nueva. */
  function cacheDelDiagrama(): Respuesta | undefined {
    return recurso.datos;
  }

  function posicionDe(nodo: NodoArquitectura): { x: number; y: number } {
    if (arrastre && arrastre.id === nodo.id) return { x: arrastre.x, y: arrastre.y };
    return { x: nodo.posX, y: nodo.posY };
  }

  function alPulsarNodo(nodo: NodoArquitectura, evento: React.PointerEvent) {
    // Un botón dentro de la tarjeta (enlazar, editar, retirar) también hace
    // saltar este `onPointerDown` al burbujear. Si se captura el puntero aquí,
    // el `click` del botón nunca llega a dispararse. Se deja pasar tal cual.
    if ((evento.target as HTMLElement).closest("button")) return;

    if (conectando) {
      if (conectando.id === nodo.id) {
        setConectando(null);
        return;
      }
      setEnlazandoCon({ origen: conectando, destino: nodo });
      setConectando(null);
      return;
    }

    const caja = lienzoRef.current?.getBoundingClientRect();
    if (!caja) return;
    const inicioX = evento.clientX;
    const inicioY = evento.clientY;
    const desdeX = nodo.posX;
    const desdeY = nodo.posY;
    let movido = false;
    evento.currentTarget.setPointerCapture(evento.pointerId);

    function alMover(e: PointerEvent) {
      movido = true;
      const x = Math.max(0, Math.round(desdeX + (e.clientX - inicioX)));
      const y = Math.max(0, Math.round(desdeY + (e.clientY - inicioY)));
      setArrastre({ id: nodo.id, x, y });
    }
    function alSoltar(e: PointerEvent) {
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSoltar);
      if (!movido) return;
      const x = Math.max(0, Math.round(desdeX + (e.clientX - inicioX)));
      const y = Math.max(0, Math.round(desdeY + (e.clientY - inicioY)));

      // La posición nueva se guarda ANTES de soltar el estado del arrastre. Al
      // revés, entre una cosa y otra hay un fotograma con la posición vieja y
      // la caja da un salto hacia atrás justo al soltarla.
      const actual = cacheDelDiagrama();
      if (actual) {
        sembrar(clave, {
          ...actual,
          nodes: actual.nodes.map((n) => (n.id === nodo.id ? { ...n, posX: x, posY: y } : n)),
        });
      }
      setArrastre(null);
      void mover.ejecutar(nodo.id, x, y);
    }
    window.addEventListener("pointermove", alMover);
    window.addEventListener("pointerup", alSoltar, { once: true });
  }

  if (recurso.error) {
    return <Fallo onReintentar={() => void recurso.recargar()}>{recurso.error}</Fallo>;
  }
  if (recurso.cargando) {
    return <Cargando etiqueta="Cargando el diagrama" />;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Rotulo>
          {nodos.length === 0
            ? "El lienzo está vacío"
            : conectando
              ? `Elige con qué conectar «${conectando.name}» — o vuelve a pulsarlo para cancelar`
              : `${nodos.length} nodo${nodos.length === 1 ? "" : "s"} · ${enlaces.length} enlace${enlaces.length === 1 ? "" : "s"}`}
        </Rotulo>
        <Boton tamano="sm" variante="primario" icono={<Plus size={13} />} onClick={() => setCreando(true)}>
          Añadir nodo
        </Boton>
      </div>

      <div
        ref={lienzoRef}
        className="rejilla relative overflow-auto rounded-2xl border border-line bg-canvas/40"
        style={{ height: ALTO_LIENZO }}
      >
        {nodos.length === 0 ? (
          <div className="grid h-full place-items-center">
            <EstadoVacio
              icono={<Boxes size={20} />}
              titulo="Todavía no hay ningún nodo"
              pista="Un nodo es una caja: un servicio, una base de datos, una cola. Añade el primero y conéctalo con los demás."
              accion={
                <Boton variante="primario" icono={<Plus size={14} />} onClick={() => setCreando(true)}>
                  Añadir el primero
                </Boton>
              }
            />
          </div>
        ) : (
          <>
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              <defs>
                <marker id="flecha-arquitectura" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="var(--c-faint)" />
                </marker>
              </defs>
              {enlaces.map((enlace) => {
                const origen = porId.get(enlace.sourceId);
                const destino = porId.get(enlace.targetId);
                if (!origen || !destino) return null;
                const a = posicionDe(origen);
                const b = posicionDe(destino);
                const x1 = a.x + ANCHO_NODO / 2;
                const y1 = a.y + 28;
                const x2 = b.x + ANCHO_NODO / 2;
                const y2 = b.y + 28;
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;
                return (
                  <g key={enlace.id}>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="var(--c-faint)"
                      strokeWidth={1.5}
                      markerEnd="url(#flecha-arquitectura)"
                    />
                    {enlace.label && (
                      <foreignObject x={mx - 60} y={my - 11} width={120} height={22} className="pointer-events-auto">
                        <button
                          type="button"
                          onClick={() =>
                            void confirmar({
                              titulo: "¿Borrar este enlace?",
                              descripcion: `«${enlace.label}» entre ${origen.name} y ${destino.name}.`,
                              accion: "Borrar",
                              peligro: true,
                            }).then((si) => si && borrarEnlace.ejecutar(enlace.id))
                          }
                          className="mx-auto block max-w-full truncate rounded-full border border-line bg-surface px-2 py-0.5 text-center font-mono text-[10px] text-muted hover:border-danger/40 hover:text-danger"
                        >
                          {enlace.label}
                        </button>
                      </foreignObject>
                    )}
                  </g>
                );
              })}
            </svg>

            {nodos.map((nodo) => {
              const Icono = ICONO[nodo.kind];
              const pos = posicionDe(nodo);
              return (
                <div
                  key={nodo.id}
                  onPointerDown={(e) => alPulsarNodo(nodo, e)}
                  className={`devup-entrada absolute cursor-grab touch-none select-none rounded-xl border bg-surface p-2.5 shadow-sm active:cursor-grabbing
                    ${conectando?.id === nodo.id ? "border-accent ring-2 ring-accent/40" : "border-line"}`}
                  style={{ left: pos.x, top: pos.y, width: ANCHO_NODO }}
                >
                  <div className="flex items-center gap-1.5">
                    <Icono size={13} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">{nodo.name}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-faint">{NOMBRE_TIPO[nodo.kind]}</p>

                  <div className="mt-1.5 flex items-center justify-end gap-0.5">
                    <BotonIcono etiqueta={`Enlazar ${nodo.name}`} onClick={() => setConectando(nodo)}>
                      <Link2 size={12} />
                    </BotonIcono>
                    <BotonIcono etiqueta={`Editar ${nodo.name}`} onClick={() => setEditando(nodo)}>
                      <Boxes size={12} />
                    </BotonIcono>
                    <BotonIcono
                      etiqueta={`Retirar ${nodo.name}`}
                      className="hover:text-danger"
                      onClick={async () => {
                        if (
                          !(await confirmar({
                            titulo: `¿Retirar «${nodo.name}»?`,
                            descripcion: "Se borra del diagrama junto con sus enlaces.",
                            accion: "Retirar",
                            peligro: true,
                          }))
                        )
                          return;
                        await borrarNodo.ejecutar(nodo.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </BotonIcono>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {conectando && (
          <button
            type="button"
            onClick={() => setConectando(null)}
            className="presionable absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft/80 px-2.5 py-1 text-[11px] text-accent"
          >
            <X size={11} /> Cancelar enlace
          </button>
        )}
      </div>

      {creando && (
        <FormularioNodo
          clave={clave}
          nodosExistentes={nodos.length}
          onCerrar={() => setCreando(false)}
          onListo={() => setCreando(false)}
        />
      )}

      {editando && (
        <FormularioNodo
          clave={clave}
          nodo={editando}
          onCerrar={() => setEditando(null)}
          onListo={() => setEditando(null)}
        />
      )}

      {enlazandoCon && (
        <FormularioEnlace
          clave={clave}
          origen={enlazandoCon.origen}
          destino={enlazandoCon.destino}
          onCerrar={() => setEnlazandoCon(null)}
        />
      )}
    </div>
  );
}

function FormularioNodo({
  clave,
  nodo,
  nodosExistentes = 0,
  onCerrar,
  onListo,
}: {
  clave: string;
  nodo?: NodoArquitectura;
  nodosExistentes?: number;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const [nombre, setNombre] = useState(nodo?.name ?? "");
  const [tipo, setTipo] = useState<TipoNodoArquitectura>(nodo?.kind ?? "servicio");
  const [descripcion, setDescripcion] = useState(nodo?.description ?? "");

  const guardar = useMutacion(
    () =>
      nodo
        ? api.patch(`/architecture/nodes/${nodo.id}`, { name: nombre.trim(), kind: tipo, description: descripcion })
        : // Cascada simple para que dos nodos nuevos no caigan exactamente
          // encima: cada uno nace un poco más abajo y a la derecha que el
          // anterior.
          api.post(`${clave}/nodes`, {
            name: nombre.trim(),
            kind: tipo,
            description: descripcion,
            posX: 40 + (nodosExistentes % 5) * 60,
            posY: 40 + (nodosExistentes % 5) * 50,
          }),
    {
      invalida: [clave],
      exito: nodo ? "Nodo actualizado" : "Nodo añadido",
      fallo: "No se pudo guardar.",
      alTerminar: onListo,
    },
  );

  return (
    <Dialogo
      titulo={nodo ? `Editar «${nodo.name}»` : "Añadir un nodo"}
      descripcion="Una caja del diagrama: un servicio, una base de datos, una cola."
      onCerrar={onCerrar}
    >
      <form
        className="space-y-3"
        onSubmit={(evento) => {
          evento.preventDefault();
          void guardar.ejecutar();
        }}
      >
        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <Rotulo className="mb-1.5 block">Nombre</Rotulo>
            <Entrada
              required
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="API de pagos"
            />
          </label>
          <label className="shrink-0">
            <Rotulo className="mb-1.5 block">Tipo</Rotulo>
            <Desplegable value={tipo} onChange={(e) => setTipo(e.target.value as TipoNodoArquitectura)}>
              {Object.entries(NOMBRE_TIPO).map(([valor, etiqueta]) => (
                <option key={valor} className="bg-surface" value={valor}>
                  {etiqueta}
                </option>
              ))}
            </Desplegable>
          </label>
        </div>

        <label className="block">
          <Rotulo className="mb-1.5 block">Descripción</Rotulo>
          <AreaTexto
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Opcional: qué hace, dónde vive…"
            rows={2}
          />
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Boton type="button" variante="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" variante="primario" cargando={guardar.enviando}>
            {nodo ? "Guardar" : "Añadir"}
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
}

function FormularioEnlace({
  clave,
  origen,
  destino,
  onCerrar,
}: {
  clave: string;
  origen: NodoArquitectura;
  destino: NodoArquitectura;
  onCerrar: () => void;
}) {
  const [label, setLabel] = useState("");

  const crear = useMutacion(
    () => api.post("/architecture/links", { sourceId: origen.id, targetId: destino.id, label: label.trim() }),
    { invalida: [clave], exito: "Enlace creado", fallo: "No se pudo crear el enlace.", alTerminar: onCerrar },
  );

  return (
    <Dialogo
      titulo={`Enlazar «${origen.name}» → «${destino.name}»`}
      descripcion="Cómo se relacionan. Libre: «llama a», «lee de», «publica en»…"
      onCerrar={onCerrar}
      ancho="sm"
    >
      <form
        className="space-y-3"
        onSubmit={(evento) => {
          evento.preventDefault();
          void crear.ejecutar();
        }}
      >
        <Entrada
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="llama a"
        />
        <div className="flex justify-end gap-2 pt-1">
          <Boton type="button" variante="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" variante="primario" cargando={crear.enviando}>
            Enlazar
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
}
