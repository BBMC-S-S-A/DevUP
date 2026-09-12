"use client";

import { AlertTriangle, FileCode2, Github } from "lucide-react";
import { useState } from "react";
import { Boton } from "@/components/ui/Boton";
import { Cargando } from "@/components/ui/Pagina";
import { Dialogo, EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import type { GithubRepo } from "@/lib/api";
import { api, useMutacion, useRecurso } from "@/lib/datos";

/**
 * Traer al diagrama la arquitectura que ya está escrita en Terraform.
 *
 * POR QUÉ EXISTE. Quien usa Terraform ya declaró su infraestructura entera
 * —qué hay y qué depende de qué— y volver a dibujarla caja por caja es copiar
 * a mano algo que ya está escrito, con el agravante de que las dos copias se
 * separan en cuanto alguien cambia una.
 *
 * SE DICE LO QUE NO SE PUEDE VER, y ocupa la mitad del diálogo a propósito. El
 * lector es de texto: no ejecuta `terraform plan`, no resuelve variables y no
 * entra en los módulos. Un diagrama al que le falta la mitad y no lo dice es
 * peor que no tener diagrama, porque se usa para decidir.
 */

type Resultado = {
  fullName: string;
  archivos: string[];
  omitidos: number;
  ilegibles: string[];
  recortados: number;
  creados: string[];
  reutilizados: string[];
  enlazados: string[];
  sinResolver: string[];
};

export function ImportarTerraform({
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
      api.post<Resultado>(`/workspaces/${workspaceId}/architecture/importar/terraform`, { repoId }),
    {
      invalida: [clave],
      fallo: "No se pudo leer el Terraform del repositorio.",
      alTerminar: (r) => setResultado(r),
    },
  );

  const lista = repos.datos?.repos ?? [];

  return (
    <Dialogo
      titulo="Importar de Terraform"
      descripcion={
        resultado
          ? `Leído de ${resultado.fullName}.`
          : "Se leen los archivos .tf del repositorio y se dibuja lo que declaran."
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

          <LoQueNoLee />

          <div className="flex justify-end gap-2 pt-1">
            <Boton type="button" variante="fantasma" onClick={onCerrar}>
              Cancelar
            </Boton>
            <Boton
              variante="primario"
              icono={<FileCode2 size={14} />}
              cargando={importar.enviando}
              disabled={!elegido}
              onClick={() => elegido && void importar.ejecutar(elegido)}
            >
              Importar
            </Boton>
          </div>
        </div>
      )}
    </Dialogo>
  );
}

/**
 * Los límites del lector, dichos antes de importar y no después.
 *
 * Después ya se está mirando un diagrama, y un diagrama se cree.
 */
function LoQueNoLee() {
  return (
    <div className="rounded-xl border border-line bg-canvas/40 p-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        <AlertTriangle size={12} className="text-muted" />
        <Rotulo>Qué no va a ver</Rotulo>
      </div>
      <ul className="space-y-1 text-[11px] leading-relaxed text-muted">
        <li>
          Se lee el <strong>texto</strong> de los <code className="font-mono">.tf</code>: no se
          ejecuta nada, no hacen falta credenciales de la nube y no se toca el estado remoto.
        </li>
        <li>
          Se lee <strong>con el enlace y nada más</strong>, sin usar ningún token de GitHub. De un
          repositorio privado no se puede importar, y se leen hasta{" "}
          <strong>12 archivos</strong> <code className="font-mono">.tf</code>.
        </li>
        <li>
          Un nombre que venga de una <code className="font-mono">var</code> o de un{" "}
          <code className="font-mono">local</code> se queda como está escrito, sin resolver.
        </li>
        <li>
          Los <code className="font-mono">module</code> no se abren: lo que declaran vive en otra
          carpeta y no se trae.
        </li>
        <li>
          <code className="font-mono">count</code> y <code className="font-mono">for_each</code>{" "}
          dibujan <strong>una</strong> caja: diez réplicas son un recurso en el texto.
        </li>
        <li>Nada se borra ni se recoloca: lo que ya esté en el lienzo se queda donde está.</li>
      </ul>
    </div>
  );
}

function ResumenImportacion({ resultado, onCerrar }: { resultado: Resultado; onCerrar: () => void }) {
  const { creados, reutilizados, enlazados, archivos, omitidos, ilegibles, recortados, sinResolver } =
    resultado;

  const nadaNuevo = creados.length === 0 && enlazados.length === 0;

  return (
    <div className="space-y-3">
      {archivos.length === 0 ? (
        <p className="text-xs text-muted">
          No encontré ningún archivo <code className="font-mono">.tf</code> en ese repositorio. Si la
          infraestructura está en otro sitio —otro repositorio, o una rama distinta de la principal—,
          esto no la ve.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Dato numero={creados.length} etiqueta={creados.length === 1 ? "caja nueva" : "cajas nuevas"} />
            <Dato numero={enlazados.length} etiqueta={enlazados.length === 1 ? "flecha" : "flechas"} />
            <Dato numero={archivos.length} etiqueta={archivos.length === 1 ? "archivo leído" : "archivos leídos"} />
          </div>

          {nadaNuevo && (
            <p className="text-xs text-muted">
              {reutilizados.length > 0
                ? "Todo lo que declara ese Terraform ya estaba en el diagrama. No se ha duplicado nada."
                : "Los archivos se leyeron, pero no declaran ningún recurso que dibujar."}
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
              sin leer: se leen los doce primeros para no agotar el cupo de lecturas que GitHub da
              sin credencial, que es el mismo para todo DevUP.
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
              El Terraform declara <strong>{recortados}</strong> recurso(s) más de los que caben en
              un diagrama legible, y se quedaron fuera.
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
