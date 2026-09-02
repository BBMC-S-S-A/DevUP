"use client";

import { AlertCircle, ArrowRight, CheckCircle2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { Logo } from "@/components/ui/Logo";
import { Chip, Rotulo, Tarjeta } from "@/components/ui/Superficies";

/* Mismo chasis que el acceso, la invitación y la recuperación. */
const LUZ =
  "radial-gradient(34rem 26rem at 50% -8%, rgb(124 58 237 / 0.14), transparent 60%)," +
  "radial-gradient(26rem 20rem at 92% 100%, rgb(62 224 245 / 0.07), transparent 60%)";

const retraso = (ms: number) => ({ "--retraso": `${ms}ms` }) as React.CSSProperties;

export default function VerificarPage() {
  return (
    <Suspense fallback={null}>
      <Verificar />
    </Suspense>
  );
}

function Verificar() {
  const token = useSearchParams().get("token") ?? "";
  const [estado, setEstado] = useState<"cargando" | "ok" | "error">("cargando");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setEstado("error");
      setError("el enlace no lleva ningún token");
      return;
    }
    void api
      .post("/auth/verify-email", { token })
      .then(() => setEstado("ok"))
      .catch((caught: unknown) => {
        setEstado("error");
        setError(caught instanceof ApiError ? caught.message : "no se pudo verificar");
      });
  }, [token]);

  // Cada estado tiene su instrumento: icono, tono y titular cambian a la vez
  // para que no haya que leer el párrafo para saber cómo ha ido.
  const cara = {
    cargando: {
      icono: <MailCheck size={19} />,
      tono: "border-accent/30 bg-accent-soft/60 text-accent",
      titulo: "Comprobando",
      chip: null,
    },
    ok: {
      icono: <CheckCircle2 size={19} />,
      tono: "border-live/30 bg-live/10 text-live",
      titulo: "Correo confirmado",
      chip: <Chip tono="live">Verificado</Chip>,
    },
    error: {
      icono: <AlertCircle size={19} />,
      tono: "border-danger/30 bg-danger/10 text-danger",
      titulo: "No se pudo verificar",
      chip: <Chip tono="danger">Fallo</Chip>,
    },
  }[estado];

  return (
    <main className="relative grid min-h-[100svh] place-items-center overflow-hidden px-6 py-12">
      <div className="rejilla pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-0" style={{ background: LUZ }} />

      <div className="relative w-full max-w-sm">
        <div className="devup-entrada mb-6 flex items-center gap-3" style={retraso(0)}>
          <Logo size={34} animated />
          <div>
            <p className="font-display text-sm font-semibold tracking-tight">DevUP</p>
            <Rotulo>Verificación</Rotulo>
          </div>
        </div>

        <Tarjeta className="devup-entrada p-6" style={retraso(140)}>
          <div className="mb-5 flex items-start gap-3">
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl border ${cara.tono}`}>
              {cara.icono}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{cara.titulo}</h1>
                {cara.chip}
              </div>
              <p className="mt-0.5 text-xs text-muted">Dirección de correo de tu cuenta</p>
            </div>
          </div>

          {estado === "cargando" && (
            <p className="flex items-center gap-2 rounded-xl border border-line bg-canvas/50 px-3.5 py-2.5 font-mono text-xs text-muted">
              <span className="animate-pulse-slow size-1.5 rounded-full bg-accent" />
              comprobando el enlace…
            </p>
          )}

          {estado === "ok" && (
            <>
              <p className="text-sm leading-relaxed text-muted">
                Tu dirección queda confirmada. No hace falta hacer nada más aquí.
              </p>
              <Link
                href="/app"
                className="presionable mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl
                  bg-gradient-to-b from-accent-bright to-accent px-4 text-sm font-medium text-canvas
                  shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_4px_16px_-6px_rgb(124_58_237/0.7)]
                  hover:brightness-110"
              >
                Ir a DevUP
                <ArrowRight size={15} />
              </Link>
            </>
          )}

          {estado === "error" && (
            <>
              <p
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm leading-relaxed text-danger"
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                {error}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Los enlaces de verificación caducan. Puedes pedir otro desde la aplicación.
              </p>
              <Link
                href="/login"
                className="presionable mt-4 flex h-10 w-full items-center justify-center rounded-xl border
                  border-line bg-raised/60 px-4 text-sm text-ink hover:border-line-strong hover:bg-raised"
              >
                Ir al acceso
              </Link>
            </>
          )}
        </Tarjeta>
      </div>
    </main>
  );
}
