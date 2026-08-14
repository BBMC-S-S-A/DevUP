"use client";

import { AlertCircle, Loader2, MailCheck, Terminal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ApiError, type SignupPolicy, type User, api } from "@/lib/api";
import { Field } from "@/components/ui/Field";
import { useSession } from "@/lib/session";

type Mode = "login" | "register";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
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
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
            <Terminal size={20} />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">DevUP</h1>
            <p className="text-xs text-faint">Centro de mando del equipo</p>
          </div>
        </div>

        {policy?.bootstrap && (
          <p className="mb-5 rounded-lg border border-accent/30 bg-accent-soft/40 px-3 py-2 text-xs text-accent">
            Esta instancia está vacía. La primera cuenta que se cree será la
            administradora; a partir de ahí solo se entra por invitación.
          </p>
        )}

        {puedeRegistrarse && (
          <div className="mb-6 flex gap-1 rounded-lg border border-line bg-surface p-1">
            {(["login", "register"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setMode(option);
                  setError(null);
                }}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
                  mode === option ? "bg-raised text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {option === "login" ? "Entrar" : "Crear cuenta"}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          {mode === "register" && (
            <Field
              label="Nombre"
              value={displayName}
              onChange={setDisplayName}
              placeholder="Ana Martín"
              autoComplete="name"
            />
          )}

          <Field
            label="Correo"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="ana@empresa.com"
            autoComplete="email"
            required
          />

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

          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          {forgotSent && (
            <p className="flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-muted">
              <MailCheck size={16} className="mt-0.5 shrink-0" />
              Si esa dirección tiene cuenta, le llegará un enlace para cambiar la contraseña.
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-canvas transition hover:brightness-110 disabled:opacity-50"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {mode === "login" ? "Entrar" : "Crear cuenta"}
          </button>

          {mode === "login" && !forgotSent && (
            <button
              type="button"
              onClick={() => void forgot()}
              className="w-full text-center text-xs text-faint transition hover:text-muted"
            >
              He olvidado mi contraseña
            </button>
          )}
        </form>

        {!puedeRegistrarse && (
          <p className="mt-6 text-center text-xs text-faint">
            Esta instancia solo admite altas por invitación. Pídele a alguien del equipo que te
            invite desde su organización.
          </p>
        )}
      </div>
    </main>
  );
}
