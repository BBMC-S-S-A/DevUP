"use client";

import { AlertCircle, Loader2, Terminal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, type User, api } from "@/lib/api";
import { useSession } from "@/lib/session";

type Mode = "login" | "register";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const router = useRouter();
  const { user, loading, refresh } = useSession();

  useEffect(() => {
    if (!loading && user) router.replace("/app");
  }, [user, loading, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await api.post<{ user: User }>("/auth/register", { email, password, displayName });
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
                mode === option
                  ? "bg-raised text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              {option === "login" ? "Entrar" : "Crear cuenta"}
            </button>
          ))}
        </div>

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

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-canvas transition hover:brightness-110 disabled:opacity-50"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {mode === "login" ? "Entrar" : "Crear cuenta"}
          </button>
        </form>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      <input
        {...props}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none transition placeholder:text-faint focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
      />
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}
