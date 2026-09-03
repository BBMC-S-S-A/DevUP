"use client";

import { FileCode, Lightbulb, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Desplegable } from "@/components/ui/Field";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useOrgId } from "@/lib/workspace-context";
import type { GithubRepo } from "@/lib/api";
import { useRecurso } from "@/lib/datos";

/**
 * Integraciones guiadas.
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
  const orgId = useOrgId();
  const [repoId, setRepoId] = useState("");

  const repos = useRecurso<{ repos: GithubRepo[] }>(`/organizations/${orgId}/github/repos`);
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
    <Pagina
      titulo="Integraciones"
      rotulo="Lo que estáis haciendo a mano, y qué os lo ahorraría"
      icono={<Lightbulb size={20} />}
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
          icono={<Lightbulb size={20} />}
          titulo="No hay ningún repositorio conectado"
          pista="Conecta uno en GitHub y aquí se leerá para ver qué estáis resolviendo a mano. No se ejecuta nada."
        />
      ) : (
        <>
          {diagnostico.error && (
            <Fallo className="mb-5" onReintentar={() => void diagnostico.recargar()}>
              {diagnostico.error}
            </Fallo>
          )}

          {diagnostico.cargando ? (
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
    </Pagina>
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
