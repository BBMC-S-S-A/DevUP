"use client";

import { Bot, ChevronDown, ChevronRight, GitPullRequest, Loader2, NotebookPen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { Chip, EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import { fraseDeRenglon, type Renglon } from "@/lib/actividad";
import { Avatar } from "@/components/perfil/Avatar";
import { useWorkspaceId } from "@/lib/workspace-context";

/**
 * Sesiones: qué se hizo en cada sentada, y por qué.
 *
 * ES LA MEMORIA ENTRE CONVERSACIONES. «Qué ha pasado» cuenta los hechos uno a
 * uno; esto cuenta las sesiones enteras con lo que DevUP no puede ver solo —
 * las decisiones y su porqué, los PRs, lo que quedó pendiente—. Lo escribe la
 * persona o, casi siempre, su IA al cerrar con `registrar_sesion`, y la
 * siguiente lo recoge con `ver_sesiones`.
 *
 * EL DETALLE SE PIDE AL ABRIR. La lista trae lo escrito; los hechos de la
 * ventana (tareas movidas, archivos subidos) salen de `/sesiones/:id`, que los
 * junta del registro de actividad. Traerlos para todas de entrada sería leer
 * cientos de renglones que nadie va a abrir.
 */

type Pr = { repo: string; numero?: number; url?: string; titulo?: string; estado?: string };

type Sesion = {
  id: string;
  titulo: string;
  resumen: string;
  decisiones: string[];
  pendientes: string[];
  prs: Pr[];
  archivos: string[];
  procedencia: "persona" | "agente";
  inicio: string;
  fin: string;
  autorId: string;
  autorNombre: string | null;
};

type Detalle = { hechos: Renglon[]; archivosSubidos: { id: string; nombre: string }[] };

export default function SesionesPage() {
  const workspaceId = useWorkspaceId();
  const [sesiones, setSesiones] = useState<Sesion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [trayendoMas, setTrayendoMas] = useState(false);
  const [hayMas, setHayMas] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await api.get<{ sesiones: Sesion[]; hayMas: boolean }>(`/workspaces/${workspaceId}/sesiones`);
      setSesiones(r.sesiones);
      setHayMas(r.hayMas);
    } catch {
      setError("no se pudieron cargar las sesiones");
    } finally {
      setCargando(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const verMas = async () => {
    const ultima = sesiones[sesiones.length - 1];
    if (!ultima) return;
    setTrayendoMas(true);
    try {
      const r = await api.get<{ sesiones: Sesion[]; hayMas: boolean }>(
        `/workspaces/${workspaceId}/sesiones?antes=${encodeURIComponent(ultima.fin)}`,
      );
      setSesiones((previas) => [...previas, ...r.sesiones]);
      setHayMas(r.hayMas);
    } catch {
      setError("no se pudo traer el resto");
    } finally {
      setTrayendoMas(false);
    }
  };

  return (
    <Pagina titulo="Sesiones" rotulo="qué se hizo y por qué" icono={<NotebookPen size={18} />} ancho="lectura">
      {error ? (
        <Fallo onReintentar={() => void cargar()}>{error}</Fallo>
      ) : cargando ? (
        <Cargando etiqueta="Juntando las sesiones" />
      ) : sesiones.length === 0 ? (
        <EstadoVacio
          icono={<NotebookPen size={20} />}
          titulo="Todavía no hay sesiones"
          pista="Al terminar de trabajar, pídele a tu IA «registra la sesión en DevUP». Queda aquí con sus decisiones, PRs y pendientes, y la próxima conversación arranca sabiendo lo que ya se hizo."
        />
      ) : (
        <div className="space-y-3">
          {sesiones.map((s) => (
            <TarjetaSesion key={s.id} sesion={s} />
          ))}
          {hayMas && (
            <Boton variante="fantasma" onClick={() => void verMas()} disabled={trayendoMas}>
              {trayendoMas ? <Loader2 size={14} className="animate-spin" /> : null}
              Ver más atrás
            </Boton>
          )}
        </div>
      )}
    </Pagina>
  );
}

function TarjetaSesion({ sesion }: { sesion: Sesion }) {
  const [abierta, setAbierta] = useState(false);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [fallo, setFallo] = useState(false);

  const alternar = async () => {
    const abrir = !abierta;
    setAbierta(abrir);
    if (abrir && !detalle) {
      try {
        const { sesion: d } = await api.get<{ sesion: Detalle }>(`/sesiones/${sesion.id}`);
        setDetalle(d);
      } catch {
        setFallo(true);
      }
    }
  };

  return (
    <article className="rounded-lg border border-line bg-raised">
      <button
        type="button"
        onClick={() => void alternar()}
        aria-expanded={abierta}
        className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left"
      >
        <Avatar userId={sesion.autorId} nombre={sesion.autorNombre ?? "?"} tamano={24} className="mt-px" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{sesion.titulo}</p>
          <p className="mt-0.5 text-[11px] text-faint">
            {sesion.autorNombre ?? "alguien"} · {rango(sesion.inicio, sesion.fin)}
            {sesion.procedencia === "agente" && (
              <Chip className="ml-1.5 align-middle">
                <Bot size={10} className="mr-0.5 inline" />
                agente
              </Chip>
            )}
          </p>
          <p className="mt-1 font-mono text-[10px] text-faint">
            {sesion.decisiones.length} decisiones · {sesion.prs.length} PRs · {sesion.pendientes.length} pendientes
          </p>
        </div>
        {abierta ? <ChevronDown size={15} className="mt-1 text-muted" /> : <ChevronRight size={15} className="mt-1 text-muted" />}
      </button>

      {abierta && (
        <div className="space-y-4 border-t border-line px-3.5 py-3 text-[12px] leading-relaxed text-muted">
          {sesion.resumen && <p className="whitespace-pre-line text-ink">{sesion.resumen}</p>}
          <Lista titulo="Decisiones" cosas={sesion.decisiones} />
          {sesion.prs.length > 0 && (
            <section>
              <Rotulo>PRs</Rotulo>
              <ul className="mt-1.5 space-y-1">
                {sesion.prs.map((pr, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    <GitPullRequest size={12} className="shrink-0" />
                    {pr.url ? (
                      <a href={pr.url} target="_blank" rel="noreferrer" className="text-ink underline-offset-2 hover:underline">
                        {pr.numero ? `${pr.repo}#${pr.numero}` : pr.repo}
                      </a>
                    ) : (
                      <span className="text-ink">{pr.numero ? `${pr.repo}#${pr.numero}` : pr.repo}</span>
                    )}
                    {pr.titulo && <span>{pr.titulo}</span>}
                    {pr.estado && <Chip>{pr.estado}</Chip>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Lista titulo="Pendientes" cosas={sesion.pendientes} />
          <Lista titulo="Archivos fuera de DevUP" cosas={sesion.archivos} />

          {fallo ? (
            <p className="text-faint">No se pudo traer lo que se hizo en DevUP durante la sesión.</p>
          ) : !detalle ? (
            <p className="flex items-center gap-1.5 text-faint">
              <Loader2 size={12} className="animate-spin" /> Juntando lo que se hizo en DevUP…
            </p>
          ) : (
            <>
              <Lista titulo="Subido a la biblioteca" cosas={detalle.archivosSubidos.map((f) => f.nombre)} />
              {detalle.hechos.length > 0 && (
                <section>
                  <Rotulo>En DevUP durante la sesión</Rotulo>
                  <ol className="mt-1.5 space-y-1">
                    {detalle.hechos.map((h) => (
                      <li key={h.id}>
                        <span className="font-mono text-[10px] tabular-nums text-faint">{hora(h.cuando)}</span>{" "}
                        {fraseDeRenglon(h)}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

function Lista({ titulo, cosas }: { titulo: string; cosas: string[] }) {
  if (cosas.length === 0) return null;
  return (
    <section>
      <Rotulo>{titulo}</Rotulo>
      <ul className="mt-1.5 list-disc space-y-1 pl-4">
        {cosas.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </section>
  );
}

/** En el huso de quien mira, por lo mismo que en «Qué ha pasado». */
function rango(inicio: string, fin: string): string {
  const a = new Date(inicio);
  const b = new Date(fin);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  const dia = a.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
  return `${dia}, ${hora(inicio)}–${hora(fin)}`;
}

function hora(iso: string): string {
  const cuando = new Date(iso);
  if (Number.isNaN(cuando.getTime())) return "";
  return cuando.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}
