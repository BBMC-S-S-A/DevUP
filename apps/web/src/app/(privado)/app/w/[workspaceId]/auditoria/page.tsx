"use client";

import { CircleAlert, FileCode, Lightbulb, ScanSearch, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AuditoriaDelEquipo } from "@/components/auditoria/Equipo";
import { AuditoriaDelRegistro } from "@/components/auditoria/Registro";
import { Desplegable } from "@/components/ui/Field";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useWorkspaceId } from "@/lib/workspace-context";
import type { GithubRepo } from "@/lib/api";
import { useRecurso } from "@/lib/datos";

/**
 * La auditoría del repositorio, en un solo sitio.
 *
 * NO ANALIZA NADA NUEVO, Y ESE ES EL PUNTO. Los dos analizadores ya existían
 * —el criterio de migraciones y el diagnóstico de integraciones— pero vivían
 * cada uno dentro de una pantalla que se llama otra cosa: «Base de datos» e
 * «Integraciones». Quien entra buscando «auditar mi proyecto» no abre ninguna
 * de las dos. Esto es la portada que les faltaba.
 *
 * NO CUESTA PETICIONES EXTRA. `useRecurso` guarda por URL, y estas son las
 * mismas dos URLs que piden aquellas pantallas con la misma frescura de una
 * hora. Abrir la auditoría primero calienta las dos; abrirla después de ellas
 * no pide nada. Importaba comprobarlo antes de escribirla: cada análisis cuesta
 * decenas de peticiones contra un cupo de GitHub que se comparte.
 *
 * SE LEE, NO SE EJECUTA. Ni se conecta a la base del cliente ni se corre una
 * sola sentencia. Ejecutar para averiguar si algo es seguro es el orden
 * equivocado — la regla ya está escrita en el conector y esta pantalla no la
 * cambia.
 */

type Severidad = "error" | "aviso" | "bien";

type HallazgoMigracion = {
  severidad: Severidad;
  regla: "aditiva" | "idempotente" | "aislamiento";
  mensaje: string;
  linea: number | null;
};

type Analisis = { archivo: string; veredicto: Severidad; hallazgos: HallazgoMigracion[] };

type RespuestaMigraciones = {
  fullName: string;
  carpetasMiradas: string[];
  migraciones: Analisis[];
  omitidas: number;
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

type RespuestaIntegraciones = {
  fullName: string;
  recomendaciones: Recomendacion[];
  archivosLeidos: number;
};

const REGLAS: Record<HallazgoMigracion["regla"], string> = {
  aditiva: "Solo se añade",
  idempotente: "Se aplica dos veces",
  aislamiento: "Aislamiento",
};

/**
 * Una fila de la auditoría, venga del analizador que venga.
 *
 * Los dos hablan idiomas distintos —uno da severidad y regla, el otro peso y
 * pruebas— y mezclarlos sin traducir daría una lista que no se puede ordenar.
 * Esto es la traducción, y es deliberadamente pobre: lo justo para ordenar y
 * enseñar. El detalle completo sigue estando en su pantalla.
 */
type Fila = {
  clave: string;
  origen: "migraciones" | "integraciones";
  /** 0 es lo más grave. Es lo único que decide el orden. */
  rango: 0 | 1 | 2;
  titulo: string;
  detalle: string;
  donde: { archivo: string; linea: number | null }[];
  etiqueta: string;
};

/** Solo el color del icono: los recuentos de arriba ya llevan su propio tono. */
const TONO: Record<0 | 1 | 2, string> = {
  0: "text-danger",
  1: "text-warn",
  2: "text-muted",
};

function filasDeMigraciones(datos: RespuestaMigraciones | null | undefined): Fila[] {
  if (!datos) return [];
  return datos.migraciones.flatMap((m) =>
    m.hallazgos
      // `bien` no es un hallazgo: es la ausencia de uno. En la pantalla de
      // Base de datos tiene sentido enseñar que un archivo cumple; en una
      // lista de cosas que mirar, no.
      .filter((h) => h.severidad !== "bien")
      .map((h, i) => ({
        clave: `mig:${m.archivo}:${i}`,
        origen: "migraciones" as const,
        rango: (h.severidad === "error" ? 0 : 1) as 0 | 1,
        titulo: REGLAS[h.regla],
        detalle: h.mensaje,
        donde: [{ archivo: m.archivo, linea: h.linea }],
        etiqueta: "Base de datos",
      })),
  );
}

function filasDeIntegraciones(datos: RespuestaIntegraciones | null | undefined): Fila[] {
  if (!datos) return [];
  return datos.recomendaciones.map((r) => ({
    clave: `int:${r.id}`,
    origen: "integraciones" as const,
    // `alta` es «les está costando dinero o riesgo ahora mismo», que es lo
    // mismo que un error de migración pide: mirarlo hoy. `media` baja del todo
    // porque es una mejora, no un fallo.
    rango: (r.peso === "alta" ? 0 : 2) as 0 | 2,
    titulo: r.titulo,
    detalle: r.problema,
    donde: r.pruebas.map((p) => ({ archivo: p.archivo, linea: p.linea })),
    etiqueta: "Integraciones",
  }));
}

/**
 * Tres vistas, y las tres son auditoría.
 *
 * «El equipo» es lo que se pedía cuando se pidió esta pantalla: cómo trabaja
 * la gente junta, cruzando mensajes, llamadas y tarjetas. «El repositorio» es
 * lo que se construyó primero, porque la palabra se leyó en su sentido
 * técnico. «El registro» es la tercera y la más reciente: lee la tabla
 * `activity` de la 0038, donde cada línea es un hecho fechado.
 *
 * POR QUÉ EL REGISTRO NO SUSTITUYE AL EQUIPO, que era la tentación al
 * añadirlo. Aquella contesta con aproximaciones —una tarea no guardaba cuándo
 * se cerró— pero ve cosas que el registro no ve: quién habla con quién, quién
 * coincide en llamadas. Esta contesta con hechos, y solo sobre el tablero. Las
 * dos preguntas son distintas y las dos se hacen.
 *
 * El equipo va delante porque es la que se abre más veces.
 */
const MITADES = [
  { id: "equipo", texto: "El equipo" },
  { id: "registro", texto: "El registro" },
  { id: "repositorio", texto: "El repositorio" },
] as const;
type Mitad = (typeof MITADES)[number]["id"];

export default function AuditoriaPage() {
  const workspaceId = useWorkspaceId();
  const [repoId, setRepoId] = useState("");
  const [mitad, setMitad] = useState<Mitad>("equipo");

  const repos = useRecurso<{ repos: GithubRepo[] }>(`/workspaces/${workspaceId}/github/repos`);
  const lista = repos.datos?.repos ?? [];
  const elegido = repoId || lista[0]?.id || "";

  // La misma URL y la misma frescura que las dos pantallas de detalle, a
  // propósito: así comparten lo guardado en vez de pedirlo dos veces.
  const migraciones = useRecurso<RespuestaMigraciones>(
    elegido ? `/github/repos/${elegido}/migraciones` : null,
    { frescura: 3_600_000 },
  );
  const integraciones = useRecurso<RespuestaIntegraciones>(
    elegido ? `/github/repos/${elegido}/integraciones` : null,
    { frescura: 3_600_000 },
  );

  const filas = [
    ...filasDeMigraciones(migraciones.datos),
    ...filasDeIntegraciones(integraciones.datos),
  ].sort((a, b) => a.rango - b.rango);

  const graves = filas.filter((f) => f.rango === 0).length;
  const avisos = filas.filter((f) => f.rango === 1).length;
  const mejoras = filas.filter((f) => f.rango === 2).length;

  // Los dos análisis son independientes: que uno falle no debe esconder al
  // otro. Se enseña el fallo y se sigue con lo que sí llegó.
  const cargando = migraciones.cargando || integraciones.cargando;

  return (
    <Pagina
      titulo="Auditoría"
      rotulo={
        mitad === "equipo"
          ? "Cómo trabaja el equipo junto"
          : mitad === "registro"
            ? "Qué ha hecho cada uno en el tablero, hecho por hecho"
            : "Todo lo que hay que mirar en este repositorio, junto"
      }
      icono={<ScanSearch size={20} />}
      ancho="xl"
      acciones={
        mitad === "repositorio" && lista.length > 1 ? (
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
        {MITADES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMitad(m.id)}
            className={`presionable -mb-px border-b-2 px-3 py-2 text-xs font-semibold transition-colors
              ${mitad === m.id ? "border-accent text-ink" : "border-transparent text-faint hover:text-muted"}`}
          >
            {m.texto}
          </button>
        ))}
      </div>

      {mitad === "equipo" ? (
        <AuditoriaDelEquipo workspaceId={workspaceId} />
      ) : mitad === "registro" ? (
        <AuditoriaDelRegistro workspaceId={workspaceId} />
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
          icono={<ScanSearch size={20} />}
          titulo="No hay ningún repositorio conectado"
          pista="Conecta uno en GitHub y aquí se audita. Se lee el texto de su repositorio: no se ejecuta nada ni se toca ninguna base de datos."
        />
      ) : (
        <>
          <Alcance workspaceId={workspaceId} />

          {migraciones.error && (
            <Fallo className="mb-3" onReintentar={() => void migraciones.recargar()}>
              Las migraciones no se pudieron leer: {migraciones.error}
            </Fallo>
          )}
          {integraciones.error && (
            <Fallo className="mb-3" onReintentar={() => void integraciones.recargar()}>
              El diagnóstico de integraciones no se pudo leer: {integraciones.error}
            </Fallo>
          )}

          {cargando ? (
            <Cargando etiqueta="Leyendo el repositorio" />
          ) : filas.length === 0 && !migraciones.error && !integraciones.error ? (
            // Vacío aquí es una buena noticia, y hay que decirlo como tal: si
            // se pinta igual que «no encontré nada», se lee como que falló.
            <EstadoVacio
              icono={<ScanSearch size={20} />}
              titulo="No hay nada que mirar"
              pista={`Pasé las ${migraciones.datos?.migraciones.length ?? 0} migraciones por el criterio y leí ${integraciones.datos?.archivosLeidos ?? 0} archivos buscando qué se resuelve a mano. Sin hallazgos. Es una buena noticia.`}
            />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {graves > 0 && <Chip tono="danger">{graves} para mirar hoy</Chip>}
                {avisos > 0 && <Chip tono="warn">{avisos} avisos</Chip>}
                {mejoras > 0 && <Chip tono="live">{mejoras} mejoras</Chip>}
                {(migraciones.datos?.omitidas ?? 0) > 0 && (
                  // El tope se dice, no se esconde: una lista recortada en
                  // silencio se lee como «lo miré todo».
                  <span className="text-[11px] text-faint">
                    {migraciones.datos?.omitidas} migraciones más antiguas quedaron fuera del
                    recuento.
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {filas.map((f, i) => (
                  <FilaAuditoria key={f.clave} fila={f} indice={i} workspaceId={workspaceId} />
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

/** De dónde sale esto, dicho antes de los resultados. */
function Alcance({ workspaceId }: { workspaceId: string }) {
  return (
    <Tarjeta className="mb-5 p-4">
      <Rotulo>Qué se mira</Rotulo>
      <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
        <li>
          <b className="text-ink">Las migraciones, contra el criterio.</b> Si solo añaden, si se
          pueden aplicar dos veces, y si el aislamiento llega en la misma migración que la tabla. El
          detalle, en{" "}
          <Link
            href={`/app/w/${workspaceId}/base-de-datos`}
            className="text-accent underline-offset-2 hover:underline"
          >
            Base de datos
          </Link>
          .
        </li>
        <li>
          <b className="text-ink">Qué se está resolviendo a mano.</b> Cada hallazgo enseña el archivo
          y la línea donde se ve, para que se pueda discutir. El detalle, en{" "}
          <Link
            href={`/app/w/${workspaceId}/integraciones`}
            className="text-accent underline-offset-2 hover:underline"
          >
            Integraciones
          </Link>
          .
        </li>
        <li>
          <b className="text-ink">Se lee, no se ejecuta.</b> No se conecta a ninguna base de datos ni
          se corre una sola sentencia: se lee el texto del repositorio.
        </li>
      </ul>
    </Tarjeta>
  );
}

function FilaAuditoria({
  fila,
  indice,
  workspaceId,
}: {
  fila: Fila;
  indice: number;
  workspaceId: string;
}) {
  const tono = TONO[fila.rango];
  const Icono = fila.rango === 0 ? CircleAlert : fila.rango === 1 ? TriangleAlert : Lightbulb;
  const destino =
    fila.origen === "migraciones"
      ? `/app/w/${workspaceId}/base-de-datos`
      : `/app/w/${workspaceId}/integraciones`;

  return (
    <Tarjeta
      className="devup-entrada p-4"
      style={{ "--retraso": `${Math.min(indice, 8) * 40}ms` } as React.CSSProperties}
    >
      <div className="flex items-start gap-2.5">
        <Icono size={15} className={`mt-0.5 shrink-0 ${tono}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold text-ink">{fila.titulo}</h2>
            <Link
              href={destino}
              className="text-[10px] uppercase tracking-wide text-faint underline-offset-2 hover:text-accent hover:underline"
            >
              {fila.etiqueta}
            </Link>
          </div>

          <p className="mt-1.5 text-xs leading-relaxed text-muted">{fila.detalle}</p>

          {fila.donde.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {fila.donde.map((d, i) => (
                <li key={i} className="flex min-w-0 items-baseline gap-2">
                  <FileCode size={11} className="shrink-0 translate-y-px text-faint" />
                  <code className="min-w-0 truncate font-mono text-[11px] text-accent">
                    {d.archivo}
                    {d.linea ? `:${d.linea}` : ""}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Tarjeta>
  );
}
