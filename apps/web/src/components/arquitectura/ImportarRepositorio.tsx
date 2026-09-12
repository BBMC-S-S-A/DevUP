"use client";

import { AlertTriangle, Github, Workflow } from "lucide-react";
import { useState } from "react";
import { Boton } from "@/components/ui/Boton";
import { Cargando } from "@/components/ui/Pagina";
import { Dialogo, EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import type { GithubRepo } from "@/lib/api";
import { api, useMutacion, useRecurso } from "@/lib/datos";

/**
 * Sacar el diagrama del repositorio, esté escrito o haya que deducirlo.
 *
 * POR QUÉ YA NO SE LLAMA «IMPORTAR DE TERRAFORM». Lo fue, y era un callejón sin
 * salida: la mayoría de los proyectos no tienen ni un `.tf` —el propio DevUP no
 * lo tiene— y el diálogo contestaba «no encontré ningún archivo .tf», que es
 * verdad y no le sirve a nadie. La arquitectura sí está en el repositorio; lo
 * que pasa es que no está declarada en un sitio.
 *
 * SE DICE DE DÓNDE SALIÓ CADA COSA, y esto es lo que más importa de la
 * pantalla. Una caja que viene de un `depends_on` es un hecho; una que viene de
 * adivinar por el nombre de una carpeta es un indicio. Enseñarlas iguales
 * convertiría el diagrama en algo que no se puede creer del todo — y un mapa
 * que se cree completo engaña más que no tener mapa, porque se usa para
 * decidir.
 */

type Fuente = "terraform" | "compose" | "dependencias" | "carpetas";

const NOMBRE_FUENTE: Record<Fuente, string> = {
  terraform: "sus archivos .tf",
  compose: "su docker-compose",
  dependencias: "lo que declara instalar",
  carpetas: "cómo están partidas sus carpetas",
};

type Resultado = {
  fullName: string;
  fuentes: Fuente[];
  archivos: string[];
  omitidos: number;
  ilegibles: string[];
  recortados: number;
  creados: string[];
  reutilizados: string[];
  enlazados: string[];
  sinResolver: string[];
};

export function ImportarRepositorio({
  workspaceId,
  clave,
  onCerrar,
}: {
  workspaceId: string;
  /** La del diagrama, para releerlo cuando entren las cajas nuevas. */
  clave: string;
  onCerrar: () => void;
}) {
  const repos = useRecurso<{ repos: GithubRepo[] }>(`/workspaces/${workspaceId}/github/repos`);
  const [elegido, setElegido] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const importar = useMutacion(
    (repoId: string) =>
      api.post<Resultado>(`/workspaces/${workspaceId}/architecture/importar/repositorio`, { repoId }),
    {
      invalida: [clave],
      fallo: "No se pudo leer el repositorio.",
      alTerminar: (r) => setResultado(r),
    },
  );

  const lista = repos.datos?.repos ?? [];

  return (
    <Dialogo
      titulo="Leer del repositorio"
      descripcion={
        resultado
          ? `Leído de ${resultado.fullName}.`
          : "Se lee el repositorio y se dibuja la arquitectura que declara."
      }
      onCerrar={onCerrar}
      ancho="md"
    >
      {resultado ? (
        <ResumenImportacion resultado={resultado} onCerrar={onCerrar} />
      ) : repos.cargando ? (
        <Cargando etiqueta="Buscando repositorios" />
      ) : lista.length === 0 ? (
        <EstadoVacio
          icono={<Github size={20} />}
          titulo="Este proyecto no tiene ningún repositorio conectado"
          pista="Conecta uno en la pestaña Git —basta con pegar su enlace— y vuelve aquí. Cada proyecto tiene el suyo."
        />
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            {lista.map((repo) => (
              <button
                key={repo.id}
                type="button"
                onClick={() => setElegido(repo.id)}
                className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs
                  ${elegido === repo.id ? "border-accent bg-accent/5" : "border-line hover:border-faint"}`}
              >
                <Github size={13} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate font-mono">{repo.fullName}</span>
              </button>
            ))}
          </div>

          <DeDondeLoSaca />

          <div className="flex justify-end gap-2 pt-1">
            <Boton type="button" variante="fantasma" onClick={onCerrar}>
              Cancelar
            </Boton>
            <Boton
              variante="primario"
              icono={<Workflow size={14} />}
              cargando={importar.enviando}
              disabled={!elegido}
              onClick={() => elegido && void importar.ejecutar(elegido)}
            >
              Leer y dibujar
            </Boton>
          </div>
        </div>
      )}
    </Dialogo>
  );
}

/**
 * De dónde lo saca y qué no va a ver, dicho ANTES de leer y no después.
 *
 * Después ya se está mirando un diagrama, y un diagrama se cree.
 */
function DeDondeLoSaca() {
  return (
    <div className="rounded-xl border border-line bg-canvas/40 p-3">
      <Rotulo className="mb-1.5 block">De dónde lo saca</Rotulo>
      <ul className="mb-2.5 space-y-1 text-[11px] leading-relaxed text-muted">
        <li>
          De su <code className="font-mono">.tf</code> si tiene Terraform, que es lo que más dice.
        </li>
        <li>
          De su <code className="font-mono">docker-compose</code>: qué servicios hay y —en{" "}
          <code className="font-mono">depends_on</code>— quién necesita a quién. Es la única fuente
          que da flechas declaradas y no deducidas.
        </li>
        <li>
          De <strong>lo que cada servicio declara instalar</strong>: depender de{" "}
          <code className="font-mono">pg</code> es decir que se habla con Postgres.
        </li>
        <li>
          Y de <strong>cómo están partidas las carpetas</strong>: cada <code className="font-mono">apps/…</code>{" "}
          o carpeta con su <code className="font-mono">Dockerfile</code> es algo que se despliega solo.
        </li>
      </ul>

      <div className="mb-1.5 flex items-center gap-1.5">
        <AlertTriangle size={12} className="text-muted" />
        <Rotulo>Qué no va a ver</Rotulo>
      </div>
      <ul className="space-y-1 text-[11px] leading-relaxed text-muted">
        <li>
          Se lee el <strong>texto</strong>: no se ejecuta nada, no hacen falta credenciales de la
          nube y no se toca ningún estado remoto.
        </li>
        <li>
          Se lee <strong>con el enlace y nada más</strong>, sin usar ningún token de GitHub. De un
          repositorio privado no se puede leer, y se abren hasta <strong>12 archivos</strong>.
        </li>
        <li>
          <strong>No lee el código.</strong> Que dos servicios se llamen entre ellos no se sabe si
          nadie lo declaró en ningún sitio.
        </li>
        <li>
          Una dependencia declarada <strong>puede no usarse ya</strong>, y lo que solo existe en
          producción —un balanceador, una CDN— no está en el repositorio.
        </li>
        <li>Nada se borra ni se recoloca: lo que ya esté en el lienzo se queda donde está.</li>
      </ul>
    </div>
  );
}

function ResumenImportacion({ resultado, onCerrar }: { resultado: Resultado; onCerrar: () => void }) {
  const { creados, reutilizados, enlazados, archivos, omitidos, ilegibles, recortados, sinResolver, fuentes } =
    resultado;

  const nadaNuevo = creados.length === 0 && enlazados.length === 0;

  return (
    <div className="space-y-3">
      {fuentes.length === 0 ? (
        <p className="text-xs text-muted">
          Miré el repositorio y no encontré de dónde sacar la arquitectura: ni Terraform, ni{" "}
          <code className="font-mono">docker-compose</code>, ni un manifiesto de dependencias que
          nombre algo de infraestructura. Si está en otro repositorio, o en una rama distinta de la
          principal, esto no la ve — y siempre puedes dibujarla a mano o pedírsela a un agente.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Dato numero={creados.length} etiqueta={creados.length === 1 ? "caja nueva" : "cajas nuevas"} />
            <Dato numero={enlazados.length} etiqueta={enlazados.length === 1 ? "flecha" : "flechas"} />
            <Dato
              numero={archivos.length}
              etiqueta={archivos.length === 1 ? "archivo aportó" : "archivos aportaron"}
            />
          </div>

          {/* De dónde salió. Es lo que permite calibrar cuánto creerse el
              diagrama: un `depends_on` es un hecho, una carpeta es un indicio. */}
          <p className="text-[11px] leading-relaxed text-muted">
            Salió de {fuentes.map((f) => NOMBRE_FUENTE[f]).join(", ").replace(/, ([^,]*)$/, " y $1")}.
          </p>

          {nadaNuevo && (
            <p className="text-xs text-muted">
              {reutilizados.length > 0
                ? "Todo lo que encontré ya estaba en el diagrama. No se ha duplicado nada."
                : "Se leyó el repositorio, pero no salió ningún componente que dibujar."}
            </p>
          )}

          {creados.length > 0 && (
            <div>
              <Rotulo className="mb-1 block">Se añadieron</Rotulo>
              <p className="font-mono text-[11px] leading-relaxed text-muted">{creados.join(", ")}</p>
            </div>
          )}

          {reutilizados.length > 0 && (
            <div>
              <Rotulo className="mb-1 block">Ya estaban, no se duplicaron</Rotulo>
              <p className="font-mono text-[11px] leading-relaxed text-muted">{reutilizados.join(", ")}</p>
            </div>
          )}
        </>
      )}

      {/* Los avisos van juntos y al final: son lo que hace que el número de
          arriba no sea toda la verdad. */}
      {(omitidos > 0 || ilegibles.length > 0 || recortados > 0 || sinResolver.length > 0) && (
        <div className="space-y-1.5 rounded-xl border border-line bg-canvas/40 p-3 text-[11px] leading-relaxed text-muted">
          {omitidos > 0 && (
            <p>
              Quedaron <strong>{omitidos}</strong> archivo(s) <code className="font-mono">.tf</code>{" "}
              sin leer: se abren unos pocos para no agotar el cupo de lecturas que GitHub da sin
              credencial, que es el mismo para todo DevUP.
            </p>
          )}
          {ilegibles.length > 0 && (
            <p>
              No se pudieron leer: <span className="font-mono">{ilegibles.join(", ")}</span>. Puede
              que justo ahí estuviera algo que falta en el diagrama.
            </p>
          )}
          {recortados > 0 && (
            <p>
              Salieron <strong>{recortados}</strong> componente(s) más de los que caben en un
              diagrama legible, y se quedaron fuera.
            </p>
          )}
          {sinResolver.length > 0 && (
            <p>
              {sinResolver.length} dependencia(s) apuntaban a algo que no se dibujó, así que no se
              trazó la flecha.
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end pt-1">
        <Boton variante="primario" onClick={onCerrar}>
          Ver el diagrama
        </Boton>
      </div>
    </div>
  );
}

function Dato({ numero, etiqueta }: { numero: number; etiqueta: string }) {
  return (
    <div className="rounded-xl border border-line bg-canvas/40 px-3 py-2 text-center">
      <p className="text-lg font-semibold tabular-nums">{numero}</p>
      <p className="text-[10px] text-faint">{etiqueta}</p>
    </div>
  );
}
