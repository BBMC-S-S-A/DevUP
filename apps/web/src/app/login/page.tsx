"use client";

import { AlertCircle, Loader2, MailCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ApiError, type SignupPolicy, type User, api } from "@/lib/api";
import { Field } from "@/components/ui/Field";
import { Logo } from "@/components/ui/Logo";
import { useSession } from "@/lib/session";

type Mode = "login" | "register";

const FRASES = [
  "canales, voz y archivos.",
  "un embudo de ventas que avanza solo.",
  "cifrado extremo a extremo, siempre.",
  "todo tu equipo, un solo sitio.",
];

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

/** Máquina de escribir sobria: una frase a la vez, sin sobreactuar. */
function MaquinaDeEscribir() {
  const [frase, setFrase] = useState(0);
  const [texto, setTexto] = useState("");
  const [borrando, setBorrando] = useState(false);

  useEffect(() => {
    const actual = FRASES[frase % FRASES.length]!;
    const paso = borrando ? -1 : 1;
    const siguienteLargo = texto.length + paso;

    if (!borrando && siguienteLargo > actual.length) {
      const espera = setTimeout(() => setBorrando(true), 1400);
      return () => clearTimeout(espera);
    }
    if (borrando && siguienteLargo < 0) {
      setBorrando(false);
      setFrase((f) => f + 1);
      return;
    }

    const velocidad = borrando ? 28 : 42;
    const paso_ = setTimeout(() => setTexto(actual.slice(0, siguienteLargo)), velocidad);
    return () => clearTimeout(paso_);
  }, [texto, borrando, frase]);

  return (
    <p className="font-mono text-sm text-muted">
      <span className="text-accent">$</span> devup --con {texto}
      <span className="devup-cursor text-accent">▌</span>
    </p>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const inviteToken = params.get("invite");

  const [mode, setMode] = useState<Mode>(inviteToken ? "register" : "login");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState<SignupPolicy | null>(null);
  const [forgotSent, setForgotSent] = useState(false);

  const router = useRouter();
  const { user, loading, refresh } = useSession();

  useEffect(() => {
    if (!loading && user) router.replace("/app");
  }, [user, loading, router]);

  useEffect(() => {
    void api
      .get<SignupPolicy>("/auth/signup-policy")
      .then(setPolicy)
      .catch(() => setPolicy(null));
  }, []);

  // Con el registro cerrado y sin invitación, enseñar la pestaña de alta es
  // ofrecer algo que va a fallar. Solo se ofrece cuando puede funcionar.
  const puedeRegistrarse =
    policy === null || policy.mode === "open" || policy.bootstrap || Boolean(inviteToken);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await api.post<{ user: User }>("/auth/register", {
          email,
          password,
          displayName,
          ...(inviteToken ? { inviteToken } : {}),
        });
      } else {
        await api.post<{ user: User }>("/auth/login", { email, password });
      }
      await refresh();
      router.replace("/app");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "no se pudo conectar con el servidor",
      );
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    setError(null);
    if (!email.trim()) {
      setError("escribe tu correo y vuelve a pulsar");
      return;
    }
    await api.post("/auth/forgot-password", { email }).catch(() => {});
    setForgotSent(true);
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Panel de marca. Oculto en móvil: en una pantalla pequeña es la
          mitad del sitio gastada en algo que no ayuda a entrar. */}
      <div className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="devup-rejilla pointer-events-none absolute inset-0 opacity-[0.35]" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-surface via-surface/60 to-surface" />

        <div className="relative devup-entrada" style={{ "--retraso": "0ms" } as React.CSSProperties}>
          <div className="flex items-center gap-3">
            <Logo size={36} animated />
            <span className="text-base font-semibold tracking-tight">DevUP</span>
          </div>
        </div>

        <div className="relative devup-entrada max-w-md" style={{ "--retraso": "120ms" } as React.CSSProperties}>
          <h2 className="mb-3 text-2xl font-semibold tracking-tight text-ink">
            Centro de mando para tu equipo
          </h2>
          <p className="mb-6 text-sm leading-relaxed text-muted">
            Workspaces, voz cifrada, biblioteca de archivos y control de ventas
            en un solo sitio, sin repartir el trabajo entre media docena de
            herramientas que no se hablan entre ellas.
          </p>
          <MaquinaDeEscribir />
        </div>
      </div>

      {/* Panel de formulario */}
      <div className="grid place-items-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div
            className="devup-entrada mb-8 flex items-center gap-3 lg:hidden"
            style={{ "--retraso": "0ms" } as React.CSSProperties}
          >
            <Logo size={40} animated />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">DevUP</h1>
              <p className="text-xs text-faint">Centro de mando del equipo</p>
            </div>
          </div>

          <div
            className="devup-entrada mb-8 hidden lg:block"
            style={{ "--retraso": "60ms" } as React.CSSProperties}
          >
            <h1 className="text-xl font-semibold tracking-tight">
              {mode === "login" ? "Entrar" : "Crear cuenta"}
            </h1>
            <p className="mt-1 text-sm text-faint">
              {mode === "login"
                ? "Con el correo y la contraseña de tu cuenta."
                : "Toma menos de un minuto."}
            </p>
          </div>

          {policy?.bootstrap && (
            <p
              className="devup-entrada mb-5 rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2 text-xs text-accent"
              style={{ "--retraso": "80ms" } as React.CSSProperties}
            >
              Esta instancia está vacía. La primera cuenta que se cree será la
              administradora; a partir de ahí solo se entra por invitación.
            </p>
          )}

          {puedeRegistrarse && (
            <div
              className="devup-entrada relative mb-6 flex gap-1 rounded-lg border border-line bg-surface p-1"
              style={{ "--retraso": "100ms" } as React.CSSProperties}
            >
              <div
                className="absolute inset-y-1 w-[calc(50%-4px)] rounded-md bg-raised shadow-sm transition-transform duration-300 ease-out"
                style={{ transform: mode === "register" ? "translateX(calc(100% + 4px))" : "translateX(0)" }}
              />
              {(["login", "register"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setMode(option);
                    setError(null);
                  }}
                  className={`relative flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    mode === option ? "text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  {option === "login" ? "Entrar" : "Crear cuenta"}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <div className="devup-entrada" style={{ "--retraso": "140ms" } as React.CSSProperties}>
                <Field
                  label="Nombre"
                  value={displayName}
                  onChange={setDisplayName}
                  placeholder="Ana Martín"
                  autoComplete="name"
                />
              </div>
            )}

            <div className="devup-entrada" style={{ "--retraso": "160ms" } as React.CSSProperties}>
              <Field
                label="Correo"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="ana@empresa.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="devup-entrada" style={{ "--retraso": "200ms" } as React.CSSProperties}>
              <Field
                label="Contraseña"
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="mínimo 10 caracteres"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                required
                hint={mode === "register" ? "Diez caracteres o más." : undefined}
              />
            </div>

            {error && (
              <p className="devup-entrada flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            {forgotSent && (
              <p className="devup-entrada flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-muted">
                <MailCheck size={16} className="mt-0.5 shrink-0" />
                Si esa dirección tiene cuenta, le llegará un enlace para cambiar la contraseña.
              </p>
            )}

            <div className="devup-entrada" style={{ "--retraso": "240ms" } as React.CSSProperties}>
              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-canvas transition duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
              >
                {busy && <Loader2 size={16} className="animate-spin" />}
                {mode === "login" ? "Entrar" : "Crear cuenta"}
              </button>

              {mode === "login" && !forgotSent && (
                <button
                  type="button"
                  onClick={() => void forgot()}
                  className="mt-3 w-full text-center text-xs text-faint transition hover:text-muted"
                >
                  He olvidado mi contraseña
                </button>
              )}
            </div>
          </form>

          {!puedeRegistrarse && (
            <p className="devup-entrada mt-6 text-center text-xs text-faint">
              Esta instancia solo admite altas por invitación. Pídele a alguien del equipo que te
              invite desde su organización.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
