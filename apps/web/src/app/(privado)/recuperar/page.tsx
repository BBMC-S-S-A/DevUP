"use client";

import { AlertCircle, CheckCircle2, KeyRound, LogIn } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { Field } from "@/components/ui/Field";
import { Logo } from "@/components/ui/Logo";
import { Rotulo, Tarjeta } from "@/components/ui/Superficies";

/* Mismo chasis que el acceso y la invitación: quien llega aquí viene de un
   correo y tiene que reconocer el producto en el primer vistazo. */
const LUZ =
  "radial-gradient(34rem 26rem at 50% -8%, rgb(124 58 237 / 0.14), transparent 60%)," +
  "radial-gradient(26rem 20rem at 92% 100%, rgb(62 224 245 / 0.07), transparent 60%)";

/** Lo que exige el servidor. Aquí solo se usa para dar señal antes de enviar. */
const MINIMO = 10;

const retraso = (ms: number) => ({ "--retraso": `${ms}ms` }) as React.CSSProperties;

export default function RecuperarPage() {
  return (
    <Suspense fallback={null}>
      <Recuperar />
    </Suspense>
  );
}

function Recuperar() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [busy, setBusy] = useState(false);

  // Solo para pintar: el botón ya se bloqueaba por debajo del mínimo, y un
  // bloqueo sin explicación se lee como una avería.
  const avance = Math.min(password.length / MINIMO, 1);
  const coinciden = repetida.length > 0 && password === repetida;

  return (
    <main className="relative grid min-h-[100svh] place-items-center overflow-hidden px-6 py-12">
      <div className="rejilla pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-0" style={{ background: LUZ }} />

      <div className="relative w-full max-w-sm">
        <div className="devup-entrada mb-6 flex items-center gap-3" style={retraso(0)}>
          <Logo size={34} animated />
          <div>
            <p className="font-display text-sm font-semibold tracking-tight">DevUP</p>
            <Rotulo>Recuperación</Rotulo>
          </div>
        </div>

        <Tarjeta className="devup-entrada p-6" style={retraso(140)}>
          <div className="mb-5 flex items-start gap-3">
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-xl border ${
                listo ? "border-live/30 bg-live/10 text-live" : "border-accent/30 bg-accent-soft/60 text-accent"
              }`}
            >
              {listo ? <CheckCircle2 size={19} /> : <KeyRound size={19} />}
            </span>
            <div className="min-w-0">
              <h1 className="text-base font-semibold">
                {listo ? "Contraseña cambiada" : "Nueva contraseña"}
              </h1>
              <p className="mt-0.5 text-xs text-muted">
                {listo ? "Ya puedes entrar con la nueva." : "Elige una y repítela para confirmar."}
              </p>
            </div>
          </div>

          {listo ? (
            <>
              <p className="flex items-start gap-2 rounded-xl border border-live/25 bg-live/10 px-3 py-2.5 text-sm leading-relaxed text-live">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                Se han cerrado todas las sesiones que hubiera abiertas.
              </p>
              <Link
                href="/login"
                className="presionable mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl
                  bg-gradient-to-b from-accent-bright to-accent px-4 text-sm font-medium text-canvas
                  shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_4px_16px_-6px_rgb(124_58_237/0.7)]
                  hover:brightness-110"
              >
                <LogIn size={15} />
                Entrar
              </Link>
            </>
          ) : (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setError(null);
                if (password !== repetida) {
                  setError("las dos contraseñas no coinciden");
                  return;
                }
                setBusy(true);
                try {
                  await api.post("/auth/reset-password", { token, password });
                  setListo(true);
                } catch (caught) {
                  setError(
                    caught instanceof ApiError
                      ? caught.message
                      : "no se pudo cambiar la contraseña",
                  );
                } finally {
                  setBusy(false);
                }
              }}
              className="space-y-4"
            >
              <div>
                <Field
                  label="Contraseña"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="mínimo 10 caracteres"
                  autoComplete="new-password"
                  required
                />
                {/* Medidor de longitud: instrumento, no adorno — dice cuánto
                    falta para que el botón se desbloquee. */}
                <div className="mt-2 flex items-center gap-2.5">
                  <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-accent transition-transform duration-200"
                      style={{
                        transform: `scaleX(${avance})`,
                        transformOrigin: "left",
                        transitionTimingFunction: "var(--ease-out)",
                      }}
                    />
                  </div>
                  <span className="font-mono text-[10px] tabular-nums text-faint">
                    {Math.min(password.length, 99)}/{MINIMO}
                  </span>
                </div>
              </div>

              <div>
                <Field
                  label="Repítela"
                  type="password"
                  value={repetida}
                  onChange={setRepetida}
                  autoComplete="new-password"
                  required
                />
                {repetida.length > 0 && (
                  <p
                    className={`mt-2 font-mono text-[10px] ${coinciden ? "text-live" : "text-faint"}`}
                  >
                    {coinciden ? "coinciden" : "todavía no coinciden"}
                  </p>
                )}
              </div>

              {error && (
                <p
                  role="alert"
                  className="devup-entrada flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
                >
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              )}

              <Boton
                type="submit"
                variante="primario"
                className="w-full"
                cargando={busy}
                disabled={password.length < MINIMO}
                icono={<KeyRound size={15} />}
              >
                Cambiar contraseña
              </Boton>
            </form>
          )}
        </Tarjeta>

        <p
          className="devup-entrada mt-5 text-center font-mono text-[10px] text-faint"
          style={retraso(220)}
        >
          enlace de un solo uso
        </p>
      </div>
    </main>
  );
}
