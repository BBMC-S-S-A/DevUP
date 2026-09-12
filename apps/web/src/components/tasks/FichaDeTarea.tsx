"use client";

import { useState, type ReactNode } from "react";
import { ExternalLink, GitBranch, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type AreaDeTablero, type Task, type TipoDeTarea, TIPOS_DE_TAREA } from "@/lib/api";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { AreaTexto, Desplegable, Entrada } from "@/components/ui/Field";
import {
  ESTADO_DE_RAMA,
  EVIDENCIA_EN_PALABRAS,
  PRIORIDADES,
  TIPO_EN_PALABRAS,
  TIPO_EXPLICADO,
} from "./ficha";

/**
 * La ficha de desarrollo de una tarea: tipo, prioridad, área, contexto,
 * criterio, ramas y evidencia.
 *
 * POR QUÉ VIVE APARTE DE `TaskBoard`. Ese archivo ya pasa de novecientas
 * líneas y lleva el tablero entero —arrastre, columnas, huecos—. Meterle esto
 * dentro lo haría ilegible para la siguiente persona que tenga que tocar el
 * arrastre, que no tiene nada que ver con esto.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * LA DECISIÓN QUE MANDA SOBRE TODO LO DEMÁS: **nada de esto es obligatorio**.
 * Una tarea con solo un título sigue siendo una tarea perfectamente válida, y
 * tiene que seguir creándose en dos segundos. Un formulario que exige tipo,
 * prioridad, área y criterio antes de dejar escribir «arreglar el login»
 * consigue una cosa: que la gente deje de usar el tablero.
 *
 * Por eso la ficha está PLEGADA por defecto al crear y ABIERTA al editar. Son
 * dos momentos distintos: al crear se está sacando algo de la cabeza y el único
 * campo que importa es el título; al abrir una tarjeta que ya existe se está
 * trabajando en ella, y entonces sí se quiere ver todo lo que sabe.
 *
 * RAMAS Y EVIDENCIA SE GUARDAN SOLAS, sin esperar al botón de Guardar. No es
 * una inconsistencia: son listas de cosas que se añaden y se quitan, no campos
 * de un formulario. Que pegar un PR y que desaparezca porque después se cerró
 * el diálogo con Escape sería justo la clase de pérdida que hace que nadie
 * vuelva a pegar un PR. Y por eso mismo no existen antes de que la tarea
 * exista: mientras se crea, las dos secciones dicen que hay que guardar
 * primero, en vez de ofrecer un formulario que no podría guardar nada.
 */

export type CamposDeFicha = {
  tipo: TipoDeTarea | "";
  prioridad: number;
  categoryId: string;
  contexto: string;
  criterio: string;
};

export function FichaDeTarea({
  task,
  areas,
  campos,
  onCampos,
  onRecargar,
}: {
  /** `null` mientras se crea: entonces ramas y evidencia todavía no caben. */
  task: Task | null;
  areas: AreaDeTablero[];
  campos: CamposDeFicha;
  onCampos: (siguiente: CamposDeFicha) => void;
  /** Para refrescar la tarjeta tras añadir o quitar algo que se guarda solo. */
  onRecargar: () => Promise<void>;
}) {
  const set = <K extends keyof CamposDeFicha>(clave: K, valor: CamposDeFicha[K]) =>
    onCampos({ ...campos, [clave]: valor });

  const area = areas.find((a) => a.id === campos.categoryId);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block">
          <Etiqueta>Tipo</Etiqueta>
          <Desplegable
            contenedor="w-full"
            value={campos.tipo}
            onChange={(e) => set("tipo", e.target.value as TipoDeTarea | "")}
          >
            {/* «Sin clasificar» es una opción de verdad y va primero: poner un
                tipo de oficio llenaría el tablero de un valor que nadie
                decidió, y entonces el dato dejaría de servir para nada. */}
            <option value="">Sin clasificar</option>
            {TIPOS_DE_TAREA.map((t) => (
              <option key={t} value={t}>
                {TIPO_EN_PALABRAS[t]} — {TIPO_EXPLICADO[t]}
              </option>
            ))}
          </Desplegable>
        </label>

        <label className="block">
          <Etiqueta>Prioridad</Etiqueta>
          <Desplegable
            contenedor="w-full"
            value={String(campos.prioridad)}
            onChange={(e) => set("prioridad", Number(e.target.value))}
          >
            {PRIORIDADES.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.texto} — {p.pista}
              </option>
            ))}
          </Desplegable>
        </label>

        <label className="col-span-2 block sm:col-span-1">
          <Etiqueta>Área</Etiqueta>
          <Desplegable
            contenedor="w-full"
            value={campos.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
          >
            <option value="">Sin área</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.ownerName ? ` · ${a.ownerName}` : ""}
              </option>
            ))}
          </Desplegable>
          {/* El gesto que hace útiles las áreas, dicho donde ocurre: archivar
              en un área con dueño asigna sola la tarea. Si no se avisa, la
              primera vez parece que el tablero hace cosas por su cuenta. */}
          {!task && area?.ownerName && (
            <span className="mt-1 block text-[11px] text-faint">
              Si no eliges responsable, será {area.ownerName}.
            </span>
          )}
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Etiqueta>Contexto</Etiqueta>
          <AreaTexto
            value={campos.contexto}
            onChange={(e) => set("contexto", e.target.value)}
            rows={3}
            placeholder="De dónde sale esto, qué se intentó antes, con qué no hay que romper…"
          />
        </div>
        <div>
          <Etiqueta>Cuándo está hecha</Etiqueta>
          <AreaTexto
            value={campos.criterio}
            onChange={(e) => set("criterio", e.target.value)}
            rows={3}
            placeholder="Cómo sabremos que se terminó: qué tiene que poder hacerse, y dónde se ve."
          />
        </div>
      </div>

      <Ramas task={task} onRecargar={onRecargar} />
      <Evidencias task={task} onRecargar={onRecargar} />
    </div>
  );
}

function Etiqueta({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
      {children}
    </span>
  );
}

/** Un aviso cuando la sección todavía no puede existir, en vez de un formulario
 *  que al pulsarlo daría un error que nadie puede interpretar. */
function TodaviaNo({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-faint">{children}</p>;
}

// ---------------------------------------------------------------------------
// Ramas
// ---------------------------------------------------------------------------

function Ramas({ task, onRecargar }: { task: Task | null; onRecargar: () => Promise<void> }) {
  const [nombre, setNombre] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const anadir = async () => {
    const limpio = nombre.trim();
    if (!limpio || !task) return;
    setOcupado(true);
    try {
      await api.post(`/tasks/${task.id}/ramas`, { nombre: limpio });
      setNombre("");
      await onRecargar();
    } catch {
      toast.error("no se pudo enlazar la rama");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div>
      <Etiqueta>
        <GitBranch size={10} className="mr-1 inline align-[-1px]" />
        Ramas
      </Etiqueta>

      {!task ? (
        <TodaviaNo>Guarda la tarea y podrás enlazarle las ramas donde se trabaje.</TodaviaNo>
      ) : (
        <div className="space-y-2">
          {task.ramas.length > 0 && (
            <ul className="space-y-1.5">
              {task.ramas.map((rama) => (
                <li key={rama.id} className="flex items-center gap-2">
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5
                      font-display text-[10px] font-semibold uppercase tracking-wider
                      ${ESTADO_DE_RAMA[rama.estado]?.clase ?? ""}`}
                  >
                    {ESTADO_DE_RAMA[rama.estado]?.texto ?? rama.estado}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">
                    {rama.nombre}
                    {rama.repo && <span className="ml-1.5 text-faint">en {rama.repo}</span>}
                  </span>

                  {/* Cambiar el estado es un desplegable y no tres botones:
                      son tres valores excluyentes y es el control que ya
                      significa eso en el resto del producto. */}
                  <Desplegable
                    tamano="sm"
                    value={rama.estado}
                    aria-label={`Estado de ${rama.nombre}`}
                    onChange={async (e) => {
                      try {
                        await api.patch(`/ramas/${rama.id}`, { estado: e.target.value });
                        await onRecargar();
                      } catch {
                        toast.error("no se pudo cambiar el estado de la rama");
                      }
                    }}
                  >
                    <option value="abierta">Abierta</option>
                    <option value="fusionada">Fusionada</option>
                    <option value="descartada">Descartada</option>
                  </Desplegable>

                  <BotonIcono
                    type="button"
                    etiqueta={`Quitar ${rama.nombre}`}
                    onClick={async () => {
                      await api.delete(`/ramas/${rama.id}`);
                      await onRecargar();
                    }}
                  >
                    <Trash2 size={13} />
                  </BotonIcono>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <span className="flex-1">
            <Entrada
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="feat/pasarela-de-pagos"
              className="font-mono"
              // Enter añade la rama en vez de enviar el formulario de la tarea,
              // que es lo que haría por defecto dentro de un <form> y dejaría
              // el texto escrito sin guardar y el diálogo cerrado.
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void anadir();
                }
              }}
            />
            </span>
            <Boton
              type="button"
              variante="secundario"
              tamano="sm"
              icono={<Plus size={13} />}
              cargando={ocupado}
              disabled={nombre.trim().length === 0}
              onClick={() => void anadir()}
            >
              Enlazar
            </Boton>
          </div>
          <p className="text-[11px] text-faint">
            Varias, si el trabajo va por varios caminos. Se apunta el nombre tal cual: no hace
            falta tener el repositorio conectado.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidencia
// ---------------------------------------------------------------------------

export function FormularioDeEvidencia({
  onEnviar,
  ocupado,
  textoBoton = "Adjuntar",
}: {
  onEnviar: (e: {
    tipo: "pr" | "commit" | "enlace" | "nota";
    url: string | null;
    nota: string;
  }) => Promise<void>;
  ocupado?: boolean;
  textoBoton?: string;
}) {
  const [tipo, setTipo] = useState<"pr" | "commit" | "enlace" | "nota">("pr");
  const [url, setUrl] = useState("");
  const [nota, setNota] = useState("");
  const esNota = tipo === "nota";
  const listo = esNota ? nota.trim().length > 0 : url.trim().length > 0;

  return (
    <div className="flex flex-wrap items-start gap-2">
      <Desplegable
        tamano="sm"
        value={tipo}
        aria-label="Clase de prueba"
        onChange={(e) => setTipo(e.target.value as typeof tipo)}
      >
        <option value="pr">PR</option>
        <option value="commit">Commit</option>
        <option value="enlace">Enlace</option>
        <option value="nota">Nota</option>
      </Desplegable>

      {/* Una nota ES su texto; lo demás APUNTA a algo. Enseñar los dos campos
          siempre haría que la mitad se dejaran en blanco y la otra mitad se
          rellenaran sin saber cuál valía. */}
      {esNota ? (
        <span className="min-w-[12rem] flex-1">
          <Entrada
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Qué comprobaste, y dónde"
          />
        </span>
      ) : (
        <span className="min-w-[12rem] flex-1">
          <Entrada
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="font-mono"
          />
        </span>
      )}

      <Boton
        type="button"
        variante="secundario"
        tamano="sm"
        icono={<Plus size={13} />}
        cargando={ocupado}
        disabled={!listo}
        onClick={async () => {
          await onEnviar({ tipo, url: esNota ? null : url.trim(), nota: nota.trim() });
          setUrl("");
          setNota("");
        }}
      >
        {textoBoton}
      </Boton>
    </div>
  );
}

function Evidencias({ task, onRecargar }: { task: Task | null; onRecargar: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState(false);
  const lista = task?.evidencia ?? [];

  return (
    <div>
      <Etiqueta>
        <ShieldCheck size={10} className="mr-1 inline align-[-1px]" />
        Evidencia
      </Etiqueta>

      {!task ? (
        <TodaviaNo>Guarda la tarea y podrás dejar aquí lo que pruebe que se hizo.</TodaviaNo>
      ) : (
        <div className="space-y-2">
          {lista.length > 0 && (
            <ul className="space-y-1.5">
              {lista.map((e) => (
                <li key={e.id} className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 rounded-full border border-line px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider text-faint">
                    {EVIDENCIA_EN_PALABRAS[e.tipo] ?? e.tipo}
                  </span>
                  <span className="min-w-0 flex-1">
                    {e.url ? (
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-w-0 max-w-full items-center gap-1 text-[11px] text-accent hover:underline"
                      >
                        <span className="truncate font-mono">{e.titulo || e.url}</span>
                        <ExternalLink size={10} className="shrink-0" />
                      </a>
                    ) : (
                      <span className="block text-[11px] leading-relaxed text-ink">{e.nota}</span>
                    )}
                    {/* Quién lo afirma y cuándo, siempre. Es lo que separa una
                        evidencia de un enlace suelto: alguien pone su nombre. */}
                    <span className="block text-[10px] text-faint">
                      {e.autor || "alguien"} · {e.creadaEn.slice(0, 10)}
                    </span>
                  </span>
                  <BotonIcono
                    type="button"
                    etiqueta="Quitar esta evidencia"
                    onClick={async () => {
                      await api.delete(`/evidencia/${e.id}`);
                      await onRecargar();
                    }}
                  >
                    <Trash2 size={13} />
                  </BotonIcono>
                </li>
              ))}
            </ul>
          )}

          <FormularioDeEvidencia
            ocupado={ocupado}
            onEnviar={async (nueva) => {
              setOcupado(true);
              try {
                await api.post(`/tasks/${task.id}/evidencia`, {
                  tipo: nueva.tipo,
                  url: nueva.url,
                  nota: nueva.nota,
                });
                await onRecargar();
              } catch {
                toast.error("no se pudo guardar la evidencia");
              } finally {
                setOcupado(false);
              }
            }}
          />
          <p className="text-[11px] text-faint">
            No se puede editar lo ya puesto: corregir es quitarlo y volver a ponerlo, y las dos
            cosas quedan en el registro. Una evidencia lleva el nombre de quien la afirma.
          </p>
        </div>
      )}
    </div>
  );
}
