"use client";

import { ArrowUp, Bot, KeyRound, Loader2, User, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Boton } from "@/components/ui/Boton";
import { AreaTexto } from "@/components/ui/Field";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { ApiError, api } from "@/lib/api";

/**
 * El asistente, dentro del espacio de trabajo.
 *
 * QUÉ ES Y QUÉ NO ES. Es un chat que habla con el modelo de **quien pregunta**:
 * su clave, su gasto, su cuenta. DevUP no compra inferencia, así que sin clave
 * puesta esta pantalla no pide perdón — dice dónde se pone y por qué.
 *
 * Las imágenes que devuelve no son adorno. Cuando el asistente mira una tarea
 * que lleva capturas, la respuesta trae sus adjuntos y se pintan debajo: es la
 * diferencia entre «esa tarea tiene tres imágenes» y ver las tres. El enlace de
 * cada una se firma aquí y caduca, igual que en el tablero.
 *
 * ES UN COMPONENTE Y NO UNA PANTALLA, y eso es lo que permite que viva en dos
 * sitios: su propia pantalla y el muñeco de la sala «Agente IA» dentro de
 * DevVerse. Mismo camino que ya hizo `TaskBoard` — no hay una versión «de
 * DevVerse» del asistente, solo un sitio más donde montarlo. El marco
 * (`Pagina`, el título, el rótulo) se queda fuera a propósito: dentro del mundo
 * el marco lo pone el panel flotante.
 */

type Turno = {
  rol: "usuario" | "asistente";
  texto: string;
  pasos?: { herramienta: string; entrada: unknown }[];
  adjuntos?: { fileId: string; nombre: string; tarea: string }[];
};

export function Asistente({ workspaceId }: { workspaceId: string }) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [pregunta, setPregunta] = useState("");
  const [pensando, setPensando] = useState(false);
  const [configurado, setConfigurado] = useState<boolean | null>(null);
  const [proveedor, setProveedor] = useState<"gemini" | "anthropic" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const final = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api
      .get<{ configurado: boolean; proveedor: "gemini" | "anthropic" | null }>("/me/asistente")
      .then((r) => {
        setConfigurado(r.configurado);
        setProveedor(r.proveedor);
      })
      .catch(() => setConfigurado(false));
  }, []);

  // Al llegar una respuesta, abajo: en un chat, lo último es lo que se lee.
  useEffect(() => {
    final.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turnos, pensando]);

  const enviar = useCallback(async () => {
    const texto = pregunta.trim();
    if (texto.length === 0 || pensando) return;

    // El historial que se manda es el de ANTES de esta pregunta: el servidor
    // le añade la pregunta al final.
    const historial = turnos.map((t) => ({ rol: t.rol, texto: t.texto }));
    setTurnos((actual) => [...actual, { rol: "usuario", texto }]);
    setPregunta("");
    setPensando(true);
    setError(null);

    try {
      const r = await api.post<{
        respuesta: string;
        pasos: { herramienta: string; entrada: unknown }[];
        adjuntos: { fileId: string; nombre: string; tarea: string }[];
      }>(`/workspaces/${workspaceId}/asistente`, { pregunta: texto, historial });
      setTurnos((actual) => [
        ...actual,
        { rol: "asistente", texto: r.respuesta, pasos: r.pasos, adjuntos: r.adjuntos },
      ]);
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : "no pude preguntarle");
    } finally {
      setPensando(false);
    }
  }, [pregunta, pensando, turnos, workspaceId]);

  return (
    <>
      {configurado === false && <SinClave workspaceId={workspaceId} />}
      {configurado && proveedor === "gemini" && (
        <p className="mb-3 text-[11px] text-faint">
          Usando Gemini, tu clave gratuita. Google usa este contenido para mejorar sus productos —
          cámbialo en Mi cuenta si prefieres Anthropic.
        </p>
      )}

      <div className="space-y-3">
        {turnos.length === 0 && configurado !== false && (
          <EstadoVacio
            icono={<Bot size={20} />}
            titulo="Pregúntale algo"
            pista="«¿Qué tareas tengo?», «¿qué se me vence?», «¿en qué anda el equipo?»"
          />
        )}

        {turnos.map((turno, indice) => (
          <TurnoVista key={indice} turno={turno} />
        ))}

        {pensando && (
          <div className="flex items-center gap-2 px-1 text-xs text-faint">
            <Loader2 size={13} className="animate-spin" />
            mirando tu espacio de trabajo…
          </div>
        )}

        {error && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <div ref={final} />

        <Tarjeta className="p-2.5">
          <AreaTexto
            value={pregunta}
            onChange={(evento) => setPregunta(evento.target.value)}
            onKeyDown={(evento) => {
              // Intro envía, Mayús+Intro hace párrafo: es lo que la mano ya
              // espera de un chat.
              if (evento.key === "Enter" && !evento.shiftKey) {
                evento.preventDefault();
                void enviar();
              }
            }}
            rows={2}
            placeholder="¿Qué tareas tengo?"
            disabled={pensando}
          />
          <div className="mt-2 flex items-center gap-2">
            <span className="flex-1 text-[11px] text-faint">
              Ve exactamente lo que ves tú. Lo que gaste lo paga tu clave.
            </span>
            <Boton
              variante="primario"
              tamano="sm"
              icono={<ArrowUp size={14} />}
              cargando={pensando}
              disabled={pregunta.trim().length === 0}
              onClick={() => void enviar()}
            >
              Preguntar
            </Boton>
          </div>
        </Tarjeta>
      </div>
    </>
  );
}


function SinClave({ workspaceId }: { workspaceId: string }) {
  return (
    <Tarjeta className="mb-4 p-4">
      <div className="mb-2 flex items-center gap-2">
        <KeyRound size={14} className="text-accent" />
        <Rotulo>Falta tu clave</Rotulo>
      </div>
      <p className="mb-3 max-w-prose text-xs leading-relaxed text-muted">
        El asistente usa <b>tu propio modelo</b>, no uno de DevUP: aquí no hay ninguna clave
        compartida ni factura común. Pega una clave de Gemini —gratis, sin tarjeta— o de
        Anthropic en Mi cuenta y vuelve.
      </p>
      <Link href={`/app/w/${workspaceId}/cuenta`}>
        <Boton variante="primario" tamano="sm" icono={<KeyRound size={13} />}>
          Ir a Mi cuenta
        </Boton>
      </Link>
    </Tarjeta>
  );
}

function TurnoVista({ turno }: { turno: Turno }) {
  const mio = turno.rol === "usuario";
  return (
    <div className={`flex gap-2.5 ${mio ? "flex-row-reverse" : ""}`}>
      <span
        className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border
          ${mio ? "border-line bg-raised/50 text-muted" : "border-accent/40 bg-accent-soft/40 text-accent"}`}
      >
        {mio ? <User size={13} /> : <Bot size={13} />}
      </span>

      <div className={`min-w-0 flex-1 ${mio ? "flex flex-col items-end" : ""}`}>
        <div
          className={`max-w-prose whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed
            ${mio ? "border border-line bg-raised/40 text-ink" : "capa text-ink"}`}
        >
          {turno.texto}
        </div>

        {/* Qué miró para contestar. Va plegado y en pequeño: importa poder
            comprobarlo, no leerlo siempre. */}
        {turno.pasos && turno.pasos.length > 0 && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[11px] text-faint hover:text-muted">
              <Wrench size={10} className="mr-1 inline" />
              miró {turno.pasos.length} {turno.pasos.length === 1 ? "cosa" : "cosas"}
            </summary>
            <ul className="mt-1 space-y-0.5">
              {turno.pasos.map((paso, i) => (
                <li key={i} className="font-mono text-[10px] text-faint">
                  {paso.herramienta}
                  {Object.keys(paso.entrada as object).length > 0
                    ? ` ${JSON.stringify(paso.entrada)}`
                    : ""}
                </li>
              ))}
            </ul>
          </details>
        )}

        {turno.adjuntos && turno.adjuntos.length > 0 && (
          <Adjuntos adjuntos={turno.adjuntos} />
        )}
      </div>
    </div>
  );
}

/**
 * Las imágenes de las tareas que el asistente miró.
 *
 * El enlace se firma de una en una y caduca, así que se piden al pintar y no
 * se guardan: un `src` cacheado sería un enlace muerto la próxima vez.
 */
function Adjuntos({ adjuntos }: { adjuntos: { fileId: string; nombre: string; tarea: string }[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viendo, setViendo] = useState<{ url: string; nombre: string } | null>(null);

  // Esc cierra el visor. Se escucha en la ventana porque el foco puede estar
  // en el campo de la pregunta.
  useEffect(() => {
    if (!viendo) return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setViendo(null);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [viendo]);

  useEffect(() => {
    let vivo = true;
    void Promise.all(
      adjuntos.map(async (a) => {
        const { url } = await api
          .get<{ url: string }>(`/files/${a.fileId}/download-url`)
          .catch(() => ({ url: "" }));
        return [a.fileId, url] as const;
      }),
    ).then((pares) => {
      if (vivo) setUrls(Object.fromEntries(pares.filter(([, url]) => url)));
    });
    return () => {
      vivo = false;
    };
  }, [adjuntos]);

  return (
    <>
    <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2">
      {adjuntos.map((adjunto) => (
        <figure key={adjunto.fileId} className="min-w-0">
          {/* Se abre AQUI, no en otra pestana: el requisito de que todo pase
              dentro de la aplicacion vale igual para una imagen. */}
          <button
            type="button"
            disabled={!urls[adjunto.fileId]}
            onClick={() =>
              setViendo({ url: urls[adjunto.fileId]!, nombre: adjunto.nombre })
            }
            title={`${adjunto.nombre} — ${adjunto.tarea}`}
            className="presionable block w-full overflow-hidden rounded-lg border border-line bg-canvas/60"
          >
            {urls[adjunto.fileId] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={urls[adjunto.fileId]}
                alt={adjunto.nombre}
                className="h-28 w-full object-cover"
              />
            ) : (
              <div className="grid h-28 place-items-center">
                <Loader2 size={13} className="animate-spin text-faint" />
              </div>
            )}
          </button>
          <figcaption className="mt-1 truncate text-[10px] text-faint">{adjunto.tarea}</figcaption>
        </figure>
      ))}
    </div>

    {viendo && (
      <div
        className="devup-velo fixed inset-0 z-50 grid place-items-center bg-canvas/80 p-4 backdrop-blur-md"
        onClick={() => setViendo(null)}
        role="presentation"
      >
        <div
          className="devup-dialogo relative max-h-full"
          onClick={(evento) => evento.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={viendo.nombre}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viendo.url}
            alt={viendo.nombre}
            className="max-h-[80svh] max-w-full rounded-xl shadow-[var(--sombra-panel)]"
          />
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => setViendo(null)}
            className="presionable absolute -right-2 -top-2 grid size-8 place-items-center rounded-full border border-line bg-elevated text-muted hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    )}
    </>
  );
}
