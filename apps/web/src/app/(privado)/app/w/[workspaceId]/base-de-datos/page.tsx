"use client";

import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Database,
  Loader2,
  Play,
  Table2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Boton } from "@/components/ui/Boton";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Desplegable, Entrada } from "@/components/ui/Field";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useWorkspaceId } from "@/lib/workspace-context";
import type { GithubRepo, ResultadoSQL, TablaDB } from "@/lib/api";
import { api, useMutacion, useRecurso } from "@/lib/datos";

const PESTANAS = [
  { id: "migraciones", texto: "Migraciones" },
  { id: "administrador", texto: "Administrador" },
] as const;
type Pestana = (typeof PESTANAS)[number]["id"];

/** Cualquier sentencia que no sea un `select` a secas se confirma antes de correr. */
function esPeligrosa(sql: string): boolean {
  return !/^\s*(select|with|explain|show)\b/i.test(sql);
}

/**
 * Base de datos como código.
 *
 * LO QUE SE VENDE AQUÍ NO ES LEER ARCHIVOS, ES EL CRITERIO. Cualquiera puede
 * enseñar una lista de migraciones; lo que casi nadie mira es si cada una se
 * puede aplicar dos veces, si borra algo que no se puede recuperar, y si la
 * política de aislamiento va en la misma migración que la tabla. Ese criterio
 * lo aprendimos a base de un fallo silencioso que costó una migración entera
 * encontrar, y es exactamente por eso que vale enseñárselo a otro.
 *
 * NO SE EJECUTA NADA. Ni se conecta a la base del cliente ni se corre una sola
 * sentencia: se lee el texto de su repositorio. Ejecutar para averiguar si algo
 * es seguro es el orden equivocado.
 */

type Severidad = "error" | "aviso" | "bien";

type Hallazgo = {
  severidad: Severidad;
  regla: "aditiva" | "idempotente" | "aislamiento";
  mensaje: string;
  linea: number | null;
};

type Analisis = { archivo: string; veredicto: Severidad; hallazgos: Hallazgo[] };

type Respuesta = {
  fullName: string;
  carpetasMiradas: string[];
  migraciones: Analisis[];
  omitidas: number;
};

const VEREDICTO: Record<Severidad, { icono: typeof CircleCheck; clase: string; texto: string }> = {
  bien: { icono: CircleCheck, clase: "text-live", texto: "Cumple" },
  aviso: { icono: TriangleAlert, clase: "text-warn", texto: "Con avisos" },
  error: { icono: CircleAlert, clase: "text-danger", texto: "Con errores" },
};

const REGLAS: Record<Hallazgo["regla"], string> = {
  aditiva: "Solo se añade",
  idempotente: "Se aplica dos veces",
  aislamiento: "Aislamiento",
};

export default function BaseDeDatosPage() {
  const workspaceId = useWorkspaceId();
  const [repoId, setRepoId] = useState("");
  const [pestana, setPestana] = useState<Pestana>("migraciones");

  const repos = useRecurso<{ repos: GithubRepo[] }>(`/workspaces/${workspaceId}/github/repos`);
  const lista = repos.datos?.repos ?? [];
  const elegido = repoId || lista[0]?.id || "";

  // Una hora de frescura: las migraciones de un repositorio cambian cuando
  // alguien escribe una, no cada treinta segundos, y cada consulta cuesta
  // cuarenta peticiones a GitHub.
  const analisis = useRecurso<Respuesta>(
    elegido ? `/github/repos/${elegido}/migraciones` : null,
    { frescura: 3_600_000 },
  );

  const migraciones = analisis.datos?.migraciones ?? [];
  const conError = migraciones.filter((m) => m.veredicto === "error").length;
  const conAviso = migraciones.filter((m) => m.veredicto === "aviso").length;

  return (
    <Pagina
      titulo="Base de datos"
      rotulo="Las migraciones del repositorio, y la base de cada quien"
      icono={<Database size={20} />}
      ancho="xl"
      acciones={
        pestana === "migraciones" && lista.length > 1 ? (
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

      {pestana === "administrador" ? (
        <Administrador workspaceId={workspaceId} />
      ) : (
        <>
          {repos.error && (
            <Fallo className="mb-5" onReintentar={() => void repos.recargar()}>
              {repos.error}
            </Fallo>
          )}

          {repos.cargando ? (
            <Cargando etiqueta="Cargando repositorios" />
          ) : lista.length === 0 ? (
            <EstadoVacio
              icono={<Database size={20} />}
              titulo="No hay ningún repositorio conectado"
              pista="Conecta uno en GitHub y aquí se leerán sus migraciones. No se ejecuta nada: se lee el texto."
            />
          ) : (
            <>
              <Criterio />

              {analisis.error ? (
                <Fallo onReintentar={() => void analisis.recargar()}>{analisis.error}</Fallo>
              ) : analisis.cargando ? (
                <Cargando etiqueta="Leyendo migraciones" />
              ) : migraciones.length === 0 ? (
                <EstadoVacio
                  icono={<Database size={20} />}
                  titulo="No encontré migraciones en este repositorio"
                  pista={`Miré en: ${(analisis.datos?.carpetasMiradas ?? []).join(", ")}.`}
                />
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <Chip tono={conError > 0 ? "danger" : conAviso > 0 ? "warn" : "live"}>
                      {migraciones.length} migraciones
                    </Chip>
                    {conError > 0 && <Chip tono="danger">{conError} con errores</Chip>}
                    {conAviso > 0 && <Chip tono="warn">{conAviso} con avisos</Chip>}
                    {conError === 0 && conAviso === 0 && <Chip tono="live">Todas cumplen</Chip>}
                    {(analisis.datos?.omitidas ?? 0) > 0 && (
                      // El tope se dice, no se esconde: una lista recortada en
                      // silencio se lee como «lo miré todo».
                      <span className="text-[11px] text-faint">
                        Se leyeron las {migraciones.length} últimas; {analisis.datos?.omitidas} más
                        antiguas quedaron fuera.
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    {migraciones.map((m) => (
                      <FilaMigracion key={m.archivo} analisis={m} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </Pagina>
  );
}

/**
 * La base propia de este workspace, no la de DevUP.
 *
 * CADA WORKSPACE CONECTA LA SUYA (0065): la misma cadena de conexión que ya
 * usan por su cuenta con psql, guardada en la bóveda de conexiones como
 * cualquier otra credencial ajena. No es un acceso de superusuario a la base
 * compartida de DevUP — eso rompería el aislamiento por `workspace_id` que
 * sostiene a todos los demás.
 */
const SIN_CONECTAR = "no tiene ninguna base de datos conectada todavía";

/**
 * Se decide con el propio intento de leer las tablas, no adivinando de
 * antemano si hay una conexión `postgres`.
 *
 * DESDE QUE EL API BUSCA SOLA EN RAILWAY (ver `conexionDeBase` en
 * `basedatos.ts`), «¿hay una base conectada?» ya no es lo mismo que «¿existe
 * una fila con provider postgres?» — puede no haber ninguna y aun así
 * conectar sola desde un entorno con Railway configurado. Preguntarle a
 * `/connections` en vez de a `/database/tables` habría enseñado el
 * formulario manual a alguien que ya tiene todo resuelto.
 */
function Administrador({ workspaceId }: { workspaceId: string }) {
  const conexionesClave = `/workspaces/${workspaceId}/connections`;
  const tablas = useRecurso<{ tables: TablaDB[] }>(`/workspaces/${workspaceId}/database/tables`);

  if (tablas.cargando) return <Cargando etiqueta="Comprobando la base de datos" />;

  if (tablas.error?.includes(SIN_CONECTAR)) {
    return (
      <div className="space-y-3">
        <EstadoVacio
          icono={<Database size={20} />}
          titulo="Este workspace no tiene ninguna base de datos conectada"
          pista="Puedes alojar una aquí mismo y DevUP te la crea de verdad, con su cadena de conexión. O conectar una que ya tengas: si el workspace despliega en Railway, configúralo en un entorno de Infraestructura y esta pantalla la encuentra sola."
        />
        <AlojarBaseDeDatos workspaceId={workspaceId} />
        <ConectarBaseDeDatos conexionesClave={conexionesClave} workspaceId={workspaceId} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <BandaAlojada workspaceId={workspaceId} />
      <Tablas workspaceId={workspaceId} />
      <ConsolaSQL workspaceId={workspaceId} />
    </div>
  );
}

/**
 * Si esta base la aloja DevUP, decirlo — y dejar desalojarla.
 *
 * SIN ESTO LA RUTA DE DESALOJAR NO TENÍA PUERTA. Se podía crear una base desde
 * la pantalla y no había forma de deshacerlo sin entrar a la API a mano, que
 * es la manera de que el disco del servidor se llene de bases que nadie
 * recuerda haber pedido.
 *
 * Y SE DICE DE QUIÉN ES LA BASE, que no es un adorno: en esta misma pantalla
 * puede haber una Postgres ajena —pegada a mano, o encontrada en Railway— y
 * ahí «desalojar» no significa nada. El botón solo aparece cuando la base es
 * de DevUP, porque solo entonces DevUP puede borrarla.
 */
function BandaAlojada({ workspaceId }: { workspaceId: string }) {
  const confirmar = useConfirmar();
  const clave = `/workspaces/${workspaceId}/database/alojada`;
  const alojada = useRecurso<{ alojada: { dbName: string; creadaEn: string } | null }>(clave);

  const desalojar = useMutacion(() => api.delete(`/workspaces/${workspaceId}/database/alojada`), {
    invalida: [`/workspaces/${workspaceId}/database`],
    exito: "Base desalojada",
    fallo: "No se pudo desalojar.",
  });

  const base = alojada.datos?.alojada;
  if (!base) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/25 bg-accent-soft/25 px-3 py-2">
      <Database size={14} className="shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted">
        Esta base la aloja DevUP —{" "}
        <code className="font-mono text-accent">{base.dbName}</code>. La cadena de conexión se
        enseñó una sola vez, al crearla.
      </p>
      <Boton
        type="button"
        tamano="sm"
        variante="peligro"
        cargando={desalojar.enviando}
        onClick={async () => {
          if (
            !(await confirmar({
              titulo: "¿Desalojar esta base?",
              descripcion:
                `Se borra ${base.dbName} entera, con sus tablas y todo lo que tengan dentro. No hay copia.`,
              accion: "Desalojar",
              peligro: true,
            }))
          )
            return;
          await desalojar.ejecutar();
        }}
      >
        Desalojar
      </Boton>
    </div>
  );
}

/**
 * Alojar una base aquí mismo (0066).
 *
 * LA CADENA SE ENSEÑA UNA VEZ Y NO VUELVE. El servidor la devuelve al crearla
 * y a partir de ahí vive cifrada en la bóveda; ninguna ruta la sirve otra vez.
 * Por eso se queda en pantalla hasta que la persona la cierra, en vez de
 * desaparecer sola con un aviso flotante que se pierde en tres segundos.
 */
function AlojarBaseDeDatos({ workspaceId }: { workspaceId: string }) {
  const [cadena, setCadena] = useState<string | null>(null);

  const alojar = useMutacion(
    () =>
      api.post<{ dbName: string; connectionString: string }>(
        `/workspaces/${workspaceId}/database/alojar`,
      ),
    {
      invalida: [`/workspaces/${workspaceId}/database`],
      fallo: "No se pudo alojar la base.",
      alTerminar: (r) => setCadena(r.connectionString),
    },
  );

  if (cadena) {
    return (
      <div className="mx-auto max-w-lg space-y-2 rounded-xl border border-accent/30 bg-accent-soft/30 p-3">
        <Rotulo className="block">Tu base está lista</Rotulo>
        <p className="text-[11px] leading-relaxed text-muted">
          Guarda esta cadena ahora: es la única vez que se enseña. A partir de aquí queda cifrada
          en la bóveda, y DevUP la usa sin volver a mostrarla.
        </p>
        <code className="block overflow-x-auto rounded-lg border border-line bg-canvas/60 p-2 font-mono text-[11px] text-ink">
          {cadena}
        </code>
        <div className="flex justify-end">
          <Boton type="button" tamano="sm" variante="secundario" onClick={() => setCadena(null)}>
            Ya la guardé
          </Boton>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-lg justify-center">
      <Boton
        type="button"
        variante="primario"
        icono={<Database size={14} />}
        cargando={alojar.enviando}
        onClick={() => void alojar.ejecutar()}
      >
        Alojar una base aquí
      </Boton>
    </div>
  );
}

function ConectarBaseDeDatos({
  conexionesClave,
  workspaceId,
}: {
  conexionesClave: string;
  workspaceId: string;
}) {
  const [nombre, setNombre] = useState("");
  const [cadena, setCadena] = useState("");

  const conectar = useMutacion(
    () =>
      api.post(`/workspaces/${workspaceId}/connections`, {
        provider: "postgres",
        displayName: nombre.trim(),
        secret: cadena,
      }),
    {
      invalida: [conexionesClave],
      exito: "Base de datos conectada",
      fallo: "No se pudo conectar. Revisa la cadena de conexión.",
      alTerminar: () => {
        setNombre("");
        setCadena("");
      },
    },
  );

  return (
    <div className="mx-auto max-w-lg space-y-2 rounded-xl border border-line bg-canvas/40 p-3">
      <Entrada
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Nombre (opcional)"
      />
      <Entrada
        type="password"
        value={cadena}
        onChange={(e) => setCadena(e.target.value)}
        placeholder="postgresql://usuario:contraseña@host:5432/base"
        autoComplete="off"
        style={{ fontFamily: "var(--font-mono)" }}
      />
      <div className="flex justify-end">
        <Boton
          type="button"
          tamano="sm"
          variante="primario"
          disabled={cadena.trim().length === 0}
          cargando={conectar.enviando}
          onClick={() => void conectar.ejecutar()}
        >
          Conectar
        </Boton>
      </div>
    </div>
  );
}

function Tablas({ workspaceId }: { workspaceId: string }) {
  const tablas = useRecurso<{ tables: TablaDB[] }>(`/workspaces/${workspaceId}/database/tables`);
  const lista = tablas.datos?.tables ?? [];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Rotulo>Tablas</Rotulo>
        {lista.length > 0 && <span className="text-[11px] text-faint">{lista.length}</span>}
      </div>

      {tablas.error ? (
        <Fallo onReintentar={() => void tablas.recargar()}>{tablas.error}</Fallo>
      ) : tablas.cargando ? (
        <Cargando etiqueta="Leyendo las tablas" />
      ) : lista.length === 0 ? (
        <EstadoVacio icono={<Table2 size={20} />} titulo="No encontré ninguna tabla" pista="" />
      ) : (
        <div className="space-y-1.5">
          {lista.map((t) => (
            <FilaTabla key={`${t.esquema}.${t.nombre}`} tabla={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilaTabla({ tabla }: { tabla: TablaDB }) {
  const [abierta, setAbierta] = useState(false);

  return (
    <Tarjeta className="overflow-hidden">
      <button
        type="button"
        onClick={() => setAbierta((a) => !a)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
      >
        <Table2 size={14} className="shrink-0 text-faint" />
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
          {tabla.esquema}.{tabla.nombre}
        </code>
        <span className="shrink-0 text-[11px] text-faint">
          ~{tabla.filasEstimadas.toLocaleString("es")} filas
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-faint transition-transform ${abierta ? "rotate-180" : ""}`}
        />
      </button>

      {abierta && (
        <div className="border-t border-line px-4 py-3">
          <table className="w-full text-xs">
            <tbody>
              {tabla.columnas.map((c) => (
                <tr key={c.nombre} className="border-b border-line/50 last:border-0">
                  <td className="py-1 pr-3 font-mono text-ink">{c.nombre}</td>
                  <td className="py-1 pr-3 text-muted">{c.tipo}</td>
                  <td className="py-1 text-[11px] text-faint">{c.nulable ? "nulable" : "obligatoria"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Tarjeta>
  );
}

function ConsolaSQL({ workspaceId }: { workspaceId: string }) {
  const [sql, setSql] = useState("");
  const [resultado, setResultado] = useState<ResultadoSQL | null>(null);
  const confirmar = useConfirmar();

  const correr = useMutacion(
    (consulta: string) => api.post<ResultadoSQL>(`/workspaces/${workspaceId}/database/query`, { sql: consulta }),
    {
      invalida: [`/workspaces/${workspaceId}/database/tables`],
      fallo: "La consulta falló.",
      alTerminar: (r) => {
        setResultado(r);
        if (r.comando && r.columnas.length === 0) {
          toast.success(`${r.comando}: ${r.filasAfectadas} fila(s)`);
        }
      },
    },
  );

  async function ejecutar() {
    const consulta = sql.trim();
    if (!consulta) return;
    if (esPeligrosa(consulta)) {
      const ok = await confirmar({
        titulo: "¿Correr esta sentencia?",
        descripcion: "No es un select: puede cambiar o borrar datos de verdad en vuestra propia base.",
        accion: "Correr",
        peligro: true,
      });
      if (!ok) return;
    }
    await correr.ejecutar(consulta);
  }

  return (
    <div>
      <Rotulo className="mb-2 block">Consola SQL</Rotulo>
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void ejecutar();
        }}
        rows={5}
        placeholder="select * from ... limit 50;"
        spellCheck={false}
        className="w-full rounded-xl border border-line bg-canvas/40 p-3 font-mono text-xs text-ink
          outline-none focus:border-accent/50"
        style={{ fontFamily: "var(--font-mono)" }}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-faint">Ctrl/Cmd + Enter para correrla</span>
        <Boton
          type="button"
          tamano="sm"
          variante="primario"
          icono={<Play size={13} />}
          disabled={sql.trim().length === 0}
          cargando={correr.enviando}
          onClick={() => void ejecutar()}
        >
          Correr
        </Boton>
      </div>

      {resultado && resultado.columnas.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line bg-raised/40">
                {resultado.columnas.map((c) => (
                  <th key={c} className="px-3 py-1.5 text-left font-mono font-medium text-faint">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultado.filas.map((fila, i) => (
                <tr key={i} className="border-b border-line/50 last:border-0">
                  {resultado.columnas.map((c) => (
                    <td key={c} className="whitespace-nowrap px-3 py-1.5 font-mono text-ink">
                      {fila[c] === null ? (
                        <span className="text-faint">null</span>
                      ) : (
                        String(fila[c])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-1.5 text-[11px] text-faint">
            {resultado.filas.length} fila(s)
          </p>
        </div>
      )}
    </div>
  );
}

/** Las tres reglas, dichas antes de enseñar los resultados. */
function Criterio() {
  return (
    <Tarjeta className="mb-5 p-4">
      <Rotulo>El criterio</Rotulo>
      <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
        <li>
          <b className="text-ink">Solo se añade.</b> Una migración que borra no se puede volver a
          aplicar, ni revisar en una copia, ni deshacer.
        </li>
        <li>
          <b className="text-ink">Se puede aplicar dos veces.</b> Es lo que permite reintentar una
          que se cortó a la mitad.
        </li>
        <li>
          <b className="text-ink">El aislamiento va en la misma migración.</b> Una tabla sin política
          no da error: devuelve cero filas y sigue. Si la política llega en la siguiente, entre una y
          otra hay una ventana con la tabla desprotegida.
        </li>
      </ul>
    </Tarjeta>
  );
}

function FilaMigracion({ analisis }: { analisis: Analisis }) {
  const [abierta, setAbierta] = useState(analisis.veredicto === "error");
  const v = VEREDICTO[analisis.veredicto];
  const Icono = v.icono;
  const nombre = analisis.archivo.split("/").pop() ?? analisis.archivo;

  return (
    <Tarjeta className="overflow-hidden">
      <button
        type="button"
        onClick={() => setAbierta((a) => !a)}
        disabled={analisis.hallazgos.length === 0}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left disabled:cursor-default"
      >
        <Icono size={15} className={`shrink-0 ${v.clase}`} />
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{nombre}</code>
        <span className={`shrink-0 text-[11px] ${v.clase}`}>{v.texto}</span>
        {analisis.hallazgos.length > 0 && (
          <span className="shrink-0 text-[11px] text-faint">
            {analisis.hallazgos.length} {analisis.hallazgos.length === 1 ? "nota" : "notas"}
          </span>
        )}
      </button>

      {abierta && analisis.hallazgos.length > 0 && (
        <ul className="space-y-2 border-t border-line px-4 py-3">
          {analisis.hallazgos.map((h, i) => (
            <li key={i} className="flex gap-2.5">
              <span
                className={`mt-px shrink-0 font-mono text-[10px] ${
                  h.severidad === "error" ? "text-danger" : "text-warn"
                }`}
              >
                {h.linea ? `L${h.linea}` : "—"}
              </span>
              <span className="min-w-0 flex-1">
                <Rotulo className="mr-2">{REGLAS[h.regla]}</Rotulo>
                <span className="text-xs leading-relaxed text-muted">{h.mensaje}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}
