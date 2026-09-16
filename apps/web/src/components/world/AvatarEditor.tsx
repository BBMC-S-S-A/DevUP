"use client";

import { Loader2, Lock, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CATALOG,
  CLOTH_TONES,
  HAIR_TONES,
  PRIMERA_DE_PAGO,
  SKIN_TONES,
  drawAvatar,
} from "@/lib/world/atlas";
import { ApiError, api } from "@/lib/api";

/**
 * Lo que se vende, tal y como lo cuenta `/tienda` (0069).
 *
 * VESTIRSE Y COMPRAR SON LA MISMA PANTALLA, y no dos. Una tienda aparte
 * obligaría a ir, comprar, volver y buscar la pieza; aquí la pieza ya está en
 * su sitio con el candado puesto, y comprarla es pulsarla. Además dice lo
 * único que hace falta saber para querer más puntos: qué te falta y cuánto.
 */
type Articulo = {
  clave: string;
  nombre: string;
  descripcion: string;
  precio: number;
  tengo: boolean;
};
import { DEFAULT_AVATAR, type Avatar } from "@/lib/world/types";

/**
 * Vestirse.
 *
 * La vista previa se dibuja con `drawAvatar`, el mismo del renderizador y no
 * una versión aparte. Es la única manera de que lo que eliges aquí sea
 * exactamente lo que ve el resto: dos rutas de dibujo distintas se separan a
 * la tercera semana y nadie se entera hasta que alguien dice «yo no me veo
 * así».
 */
export function AvatarEditor({
  initial,
  onSave,
  onCancel,
  organizacion,
  llevaAtuendo = false,
  onQuitarAtuendo,
}: {
  initial?: Avatar;
  /** `soloAqui` decide si esto es un atuendo de esta organización o el
   *  personaje de siempre. */
  onSave: (look: Avatar, soloAqui: boolean) => Promise<void>;
  onCancel: () => void;
  /** El nombre de la organización, para poder decirlo en el botón. */
  organizacion?: string;
  /** Ya hay un atuendo guardado aquí: se puede quitar. */
  llevaAtuendo?: boolean;
  onQuitarAtuendo?: () => Promise<void>;
}) {
  const [look, setLook] = useState<Avatar>(initial ?? DEFAULT_AVATAR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** El catálogo y el saldo (0069). Vacío mientras llega: las piezas de pago
   *  se pintan bloqueadas solo cuando se sabe que lo están, y así el editor
   *  sigue sirviendo para vestirse aunque la tienda no conteste. */
  const [tienda, setTienda] = useState<Record<string, Articulo>>({});
  const [saldo, setSaldo] = useState<number | null>(null);
  const [comprando, setComprando] = useState<string | null>(null);

  const cargarTienda = useCallback(async () => {
    try {
      const { saldo, articulos } = await api.get<{ saldo: number; articulos: Articulo[] }>(
        "/tienda",
      );
      setSaldo(saldo);
      setTienda(Object.fromEntries(articulos.map((a) => [a.clave, a])));
    } catch {
      // Sin tienda se sigue pudiendo cambiar de pelo, que es a lo que se
      // venía. No hay nada que avisar.
    }
  }, []);

  useEffect(() => {
    void cargarTienda();
  }, [cargarTienda]);

  /**
   * Comprar una pieza y ponérsela.
   *
   * SE LA PONE SOLA AL COMPRARLA, sin un segundo clic: nadie compra un gorro
   * para dejarlo en el armario, y obligar a pulsarlo otra vez después de pagar
   * es el paso que hace dudar de si la compra funcionó.
   */
  const comprar = useCallback(
    async (articulo: Articulo) => {
      setComprando(articulo.clave);
      try {
        await api.post(`/tienda/${articulo.clave}/comprar`);
        await cargarTienda();
        const [ranura, indice] = articulo.clave.split(":");
        if (ranura && indice) {
          setLook((actual) => ({ ...actual, [ranura]: Number(indice) }) as Avatar);
        }
        toast.success(`${articulo.nombre}, puesto`);
      } catch (fallo) {
        // El mensaje de la función ya está escrito para leerse: «te faltan 40
        // puntos» dice qué hacer, y «no se pudo comprar» no dice nada.
        toast.error(fallo instanceof ApiError ? fallo.message : "no se pudo comprar");
      } finally {
        setComprando(null);
      }
    },
    [cargarTienda],
  );

  const set = <K extends keyof Avatar>(key: K, value: Avatar[K]) =>
    setLook((current) => ({ ...current, [key]: value }));

  // Vista previa, animada: el avatar camina en el sitio. Un muñeco quieto no
  // dice si el pelo elegido se ve bien en movimiento, que es como se le va a
  // ver el 100 % del tiempo.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = 120 * ratio;
    canvas.height = 150 * ratio;

    let frame = 0;
    const started = performance.now();

    const loop = (now: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(3 * ratio, 0, 0, 3 * ratio, 0, 0);
      ctx.imageSmoothingEnabled = false;
      // La vista previa alterna frente y perfil cada dos segundos. Un gorro
      // con visera o unas gafas se ven distinto de lado, y elegirlos mirando
      // solo de frente lleva a sorpresas dentro de la oficina.
      const side = Math.floor((now - started) / 2000) % 2 === 1;
      drawAvatar(ctx, 20, 46, look, side ? "e" : "s", true, now - started);
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [look]);

  const save = async (soloAqui: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(look, soloAqui);
    } catch {
      setError("no se pudo guardar tu personaje");
    } finally {
      setSaving(false);
    }
  };

  const quitar = async () => {
    if (!onQuitarAtuendo) return;
    setSaving(true);
    setError(null);
    try {
      await onQuitarAtuendo();
    } catch {
      setError("no se pudo quitar el atuendo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold">Mi personaje</h2>
            {/* Lo que tienes para gastar, donde está lo que cuesta. Un saldo en
                otra pantalla obliga a recordarlo mientras se mira el precio. */}
            {saldo !== null && (
              <span className="font-mono text-[11px] tabular-nums text-faint">
                {saldo} puntos
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cerrar"
            className="text-faint transition hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex max-h-[70svh] gap-5 overflow-y-auto p-5">
          <div className="sticky top-0 shrink-0 self-start rounded-xl border border-line bg-canvas p-2">
            <canvas ref={canvasRef} style={{ width: 120, height: 150 }} />
          </div>

          <div className="min-w-0 flex-1 space-y-3.5">
            <Choice
              label="Complexión"
              count={CATALOG.body}
              value={look.body}
              onChange={(v) => set("body", v)}
            />
            <Choice
              label="Pelo"
              count={CATALOG.hair}
              value={look.hair}
              onChange={(v) => set("hair", v)}
            />
            <Choice
              label="Barba"
              count={CATALOG.beard}
              value={look.beard}
              onChange={(v) => set("beard", v)}
            />
            <Choice
              label="Gafas"
              count={CATALOG.glasses}
              value={look.glasses}
              onChange={(v) => set("glasses", v)}
              ranura="glasses"
              tienda={tienda}
              ocupado={comprando !== null}
              onComprar={(articulo) => void comprar(articulo)}
            />
            <Choice
              label="Gorro"
              count={CATALOG.hat}
              value={look.hat}
              onChange={(v) => set("hat", v)}
              ranura="hat"
              tienda={tienda}
              ocupado={comprando !== null}
              onComprar={(articulo) => void comprar(articulo)}
            />
            <Choice
              label="Calzado"
              count={CATALOG.shoes}
              value={look.shoes}
              onChange={(v) => set("shoes", v)}
            />
            <Swatches
              label="Piel"
              tones={SKIN_TONES}
              value={look.skinTone}
              onChange={(v) => set("skinTone", v)}
            />
            <Swatches
              label="Color de pelo"
              tones={HAIR_TONES}
              value={look.hairTone}
              onChange={(v) => set("hairTone", v)}
            />
            <Swatches
              label="Camiseta"
              tones={CLOTH_TONES}
              value={look.topTone}
              onChange={(v) => set("topTone", v)}
            />
            <Swatches
              label="Pantalón"
              tones={CLOTH_TONES}
              value={look.bottomTone}
              onChange={(v) => set("bottomTone", v)}
            />
            {look.hat > 0 && (
              <Swatches
                label="Color del gorro"
                tones={CLOTH_TONES}
                value={look.hatTone}
                onChange={(v) => set("hatTone", v)}
              />
            )}
            {look.shoes > 0 && (
              <Swatches
                label="Color del calzado"
                tones={CLOTH_TONES}
                value={look.shoesTone}
                onChange={(v) => set("shoesTone", v)}
              />
            )}
          </div>
        </div>

        {error && <p className="px-5 pb-2 text-xs text-danger">{error}</p>}

        {/* DOS BOTONES DE GUARDAR, no un desplegable con dos opciones. Lo que
            se decide aquí no es una preferencia, es a dónde va este cambio, y
            enterrarlo en un menú haría que casi todo el mundo guardara sin
            enterarse de que había una alternativa. «Solo aquí» va primero y
            en secundario porque es la opción cauta. */}
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          {llevaAtuendo && onQuitarAtuendo && (
            <button
              type="button"
              onClick={() => void quitar()}
              disabled={saving}
              className="mr-auto rounded-lg px-2 py-1.5 text-xs text-faint transition hover:text-danger disabled:opacity-40"
            >
              Quitarme el atuendo de aquí
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:text-ink"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void save(true)}
            disabled={saving}
            title={
              organizacion
                ? `Así te verán solo en ${organizacion}`
                : "Así te verán solo en esta organización"
            }
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            Solo aquí
          </button>
          <button
            type="button"
            onClick={() => void save(false)}
            disabled={saving}
            title="Tu personaje de siempre, donde no lleves atuendo"
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            En todas partes
          </button>
        </footer>
      </div>
    </div>
  );
}

function Choice({
  label,
  count,
  value,
  onChange,
  ranura,
  tienda,
  ocupado = false,
  onComprar,
}: {
  label: string;
  count: number;
  value: number;
  onChange: (value: number) => void;
  /** Qué pieza es, para saber cuáles de estos números se compran. */
  ranura?: keyof typeof CATALOG;
  tienda?: Record<string, Articulo>;
  /** Hay una compra en curso: no se admite otra hasta que termine. */
  ocupado?: boolean;
  onComprar?: (articulo: Articulo) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: count }, (_, index) => {
          // Lo de antes de la tienda es gratis y lo será siempre: el corte
          // vive en `PRIMERA_DE_PAGO`, junto al dibujo, no aquí.
          const desde = ranura ? PRIMERA_DE_PAGO[ranura] : undefined;
          const articulo =
            ranura && desde !== undefined && index >= desde
              ? tienda?.[`${ranura}:${index}`]
              : undefined;
          const bloqueada = Boolean(articulo && !articulo.tengo);
          return (
          <button
            key={index}
            type="button"
            disabled={bloqueada && ocupado}
            onClick={() => {
              if (bloqueada && articulo && onComprar) onComprar(articulo);
              else onChange(index);
            }}
            aria-pressed={value === index}
            title={
              articulo
                ? bloqueada
                  ? `${articulo.nombre} · ${articulo.precio} puntos`
                  : articulo.nombre
                : undefined
            }
            className={`h-7 rounded-lg border text-[11px] transition ${
              bloqueada ? "w-auto gap-1 px-1.5" : "w-7"
            } ${
              value === index
                ? "border-accent/50 bg-accent-soft text-accent"
                : bloqueada
                  ? "border-dashed border-line-strong text-faint hover:text-muted"
                  : "border-line text-faint hover:text-muted"
            }`}
          >
            {bloqueada && articulo ? (
              <span className="inline-flex items-center gap-1">
                <Lock size={9} />
                <span className="font-mono tabular-nums">{articulo.precio}</span>
              </span>
            ) : (
              index + 1
            )}
          </button>
          );
        })}
      </div>
    </div>
  );
}

function Swatches({
  label,
  tones,
  value,
  onChange,
}: {
  label: string;
  tones: readonly string[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">
        {tones.map((tone, index) => (
          <button
            key={tone + String(index)}
            type="button"
            onClick={() => onChange(index)}
            aria-label={`${label} ${index + 1}`}
            aria-pressed={value === index}
            style={{ background: tone }}
            className={`h-6 w-6 rounded-md border-2 transition ${
              value === index ? "border-accent" : "border-transparent hover:border-line-strong"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
