"use client";

import { ArrowRight, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { Rotulo } from "@/components/ui/Superficies";
import { ignorar } from "@/lib/fallo";
import { PASOS, porDondeEmpezar } from "@/lib/recorrido";
import { useSession } from "@/lib/session";
import { useOrgIdOpcional, useWorkspaceIdOpcional } from "@/lib/workspace-context";

/**
 * El recorrido de bienvenida.
 *
 * QUÉ CIERRA. La 0052 guarda el rol de cada quien con un único propósito
 * escrito en su propio comentario —elegir qué tutorial se ofrece— y llevaba
 * tres tandas guardándose sin que existiera ningún tutorial. Un dato que solo
 * se escribe es una promesa a medias.
 *
 * SE PUEDE CERRAR DESDE EL PRIMER PASO, y cerrar cuenta como visto. Quien lo
 * cierra ha tomado una decisión —«esto no me hace falta»— y ponérselo delante
 * otra vez mañana es no haberla respetado. Se vuelve a pedir desde Mi cuenta,
 * que es donde se busca algo que se cerró queriendo.
 *
 * NO ES UNA VISITA GUIADA CON FLECHAS SOBRE LA PANTALLA, y es deliberado. Esas
 * obligan a que la aplicación esté en un estado concreto —el tablero abierto,
 * con tareas dentro— y se rompen en cuanto alguien llega a un espacio vacío,
 * que es justo el caso de quien acaba de entrar. Cinco cartas que se leen y un
 * botón que lleva a donde toca funcionan en todos los casos.
 *
 * EL ÚLTIMO PASO ES EL QUE IMPORTA: dice por dónde empezar según el rol. Un
 * recorrido que termina con «¡listo!» deja a la persona exactamente donde
 * estaba, mirando una pantalla que no sabe usar.
 */
export function Recorrido() {
  const { user, refresh } = useSession();
  const orgId = useOrgIdOpcional();
  const workspaceId = useWorkspaceIdOpcional();
  const [paso, setPaso] = useState(0);
  const [rol, setRol] = useState<string | null>(null);
  const [cerrado, setCerrado] = useState(false);

  /**
   * El rol se pide aparte porque es por organización y la sesión no lo lleva.
   *
   * Si no llega —o no hay organización en contexto— el último paso ofrece el
   * tablero, que es lo que todo el mundo usa. Esperar a saber el rol para
   * enseñar el recorrido sería retrasar lo importante por afinar lo accesorio.
   */
  useEffect(() => {
    if (!orgId) return;
    let vigente = true;
    api
      .get<{ rol: string | null }>(`/organizations/${orgId}/me`)
      .then((ficha) => {
        if (vigente) setRol(ficha.rol);
      })
      .catch(ignorar("no se pudo saber tu rol"));
    return () => {
      vigente = false;
    };
  }, [orgId]);

  const cerrar = () => {
    setCerrado(true);
    // Se marca y se sigue: si la petición falla, lo peor que pasa es que
    // vuelva a salir mañana. Bloquear el cierre por eso sería dejar a alguien
    // atrapado en una bienvenida.
    void api
      .put("/me/recorrido", { visto: true })
      .then(() => refresh())
      .catch(ignorar("no se pudo guardar que ya lo viste"));
  };

  // Solo a quien no lo ha visto, y solo dentro de un espacio: los pasos hablan
  // de ramas y tableros, y enseñarlos en la lista de organizaciones sería
  // explicar una casa desde la calle.
  if (!user || user.recorridoVisto || cerrado || !workspaceId) return null;

  const actual = PASOS[paso];
  if (!actual) return null;
  const ultimo = paso === PASOS.length - 1;
  const empezar = porDondeEmpezar(rol);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bienvenida a DevUP"
      className="fixed inset-0 z-50 grid place-items-center bg-canvas/80 px-5 backdrop-blur-sm"
    >
      <div className="capa-flotante devup-entrada w-full max-w-md rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent-soft/60 text-accent">
            <Sparkles size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <Rotulo>
              Bienvenida · {paso + 1} de {PASOS.length}
            </Rotulo>
            <h2 className="mt-0.5 text-base font-semibold text-ink">{actual.titulo}</h2>
          </div>
          <button
            type="button"
            onClick={cerrar}
            aria-label="Saltar la bienvenida"
            className="presionable shrink-0 rounded-lg p-1 text-faint hover:text-muted"
          >
            <X size={15} />
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-muted">{actual.cuerpo}</p>

        {/* El aviso va aparte y no pegado al cuerpo: es lo que se suele hacer
            mal, y mezclarlo con la explicación lo convierte en un detalle más
            de un párrafo que nadie relee. */}
        {actual.ojo && (
          <p className="mt-2.5 rounded-xl border border-warn/25 bg-warn/5 px-3 py-2 text-[12px] leading-relaxed text-warn">
            {actual.ojo}
          </p>
        )}

        {ultimo && (
          <div className="mt-3 rounded-xl border border-accent/25 bg-accent-soft/30 px-3 py-2.5">
            <p className="text-xs font-medium text-ink">{empezar.titulo}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{empezar.cuerpo}</p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* Los puntos, y no una barra: con cinco pasos una barra de progreso
              es una decoración que mide algo que ya se lee arriba. */}
          <span className="flex items-center gap-1" aria-hidden>
            {PASOS.map((p, i) => (
              <span
                key={p.titulo}
                className={`size-1.5 rounded-full transition-colors ${
                  i === paso ? "bg-accent" : i < paso ? "bg-line-strong" : "bg-line"
                }`}
              />
            ))}
          </span>

          <span className="ml-auto flex flex-wrap gap-2">
            {paso > 0 && (
              <Boton variante="fantasma" tamano="sm" onClick={() => setPaso(paso - 1)}>
                Atrás
              </Boton>
            )}
            {ultimo ? (
              <Link
                href={`/app/w/${workspaceId}/${empezar.destino}`}
                onClick={cerrar}
                className="presionable inline-flex h-8 items-center gap-1.5 rounded-lg
                  bg-gradient-to-b from-accent-bright to-accent px-3 text-xs font-medium text-canvas
                  hover:brightness-110"
              >
                {empezar.etiqueta}
                <ArrowRight size={13} />
              </Link>
            ) : (
              <Boton variante="primario" tamano="sm" onClick={() => setPaso(paso + 1)}>
                Siguiente
              </Boton>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
