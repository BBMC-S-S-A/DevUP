"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";

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

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center">
        {estado === "cargando" && <Loader2 className="mx-auto animate-spin text-faint" size={20} />}

        {estado === "ok" && (
          <>
            <CheckCircle2 className="mx-auto mb-3 text-live" size={28} />
            <p className="text-sm text-muted">Correo confirmado.</p>
            <Link
              href="/app"
              className="mt-5 block w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-canvas"
            >
              Ir a DevUP
            </Link>
          </>
        )}

        {estado === "error" && (
          <>
            <AlertCircle className="mx-auto mb-3 text-danger" size={28} />
            <p className="text-sm text-danger">{error}</p>
            <p className="mt-2 text-xs text-faint">
              Puedes pedir otro enlace desde la aplicación.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
