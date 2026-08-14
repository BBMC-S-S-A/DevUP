"use client";

import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { Field } from "@/components/ui/Field";

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

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
            <KeyRound size={19} />
          </span>
          <h1 className="text-base font-semibold">Nueva contraseña</h1>
        </div>

        {listo ? (
          <>
            <p className="flex items-start gap-2 text-sm text-live">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              Contraseña cambiada. Se han cerrado todas las sesiones que hubiera abiertas.
            </p>
            <Link
              href="/login"
              className="mt-5 block w-full rounded-lg bg-accent px-4 py-2.5 text-center text-sm font-medium text-canvas"
            >
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
                  caught instanceof ApiError ? caught.message : "no se pudo cambiar la contraseña",
                );
              } finally {
                setBusy(false);
              }
            }}
            className="space-y-4"
          >
            <Field
              label="Contraseña"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="mínimo 10 caracteres"
              autoComplete="new-password"
              required
            />
            <Field
              label="Repítela"
              type="password"
              value={repetida}
              onChange={setRepetida}
              autoComplete="new-password"
              required
            />

            {error && (
              <p className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || password.length < 10}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-canvas transition hover:brightness-110 disabled:opacity-50"
            >
              Cambiar contraseña
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
