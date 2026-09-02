"use client";

import { CircleAlert, CircleCheck, Database, TriangleAlert } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Boton } from "@/components/ui/Boton";
import { Desplegable } from "@/components/ui/Field";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import type { GithubRepo } from "@/lib/api";
import { useRecurso } from "@/lib/datos";

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
  const { orgId } = useParams<{ orgId: string }>();
  const [repoId, setRepoId] = useState("");

  const repos = useRecurso<{ repos: GithubRepo[] }>(`/organizations/${orgId}/github/repos`);
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
      rotulo="Las migraciones del repositorio, contra el criterio"
      icono={<Database size={20} />}
      ancho="lg"
      acciones={
        lista.length > 1 ? (
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

          {analisis.error && (
            <Fallo className="mb-5" onReintentar={() => void analisis.recargar()}>
              {analisis.error}
            </Fallo>
          )}

          {analisis.cargando ? (
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
    </Pagina>
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
