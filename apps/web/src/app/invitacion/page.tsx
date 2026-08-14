"use client";

import { AlertCircle, Building2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ApiError, type Invitation, api } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function InvitacionPage() {
  return (
    <Suspense fallback={null}>
      <Invitacion />
    </Suspense>
  );
}

/**
 * Pantalla de una invitación.
 *
 * Dos caminos según quién la abra: si ya hay sesión, se acepta con un botón; si
 * no, se manda al alta con el correo y el token puestos. Enseñar de quién viene
 * y a qué organización antes de pedir nada es lo que distingue una invitación
 * de un formulario a ciegas.
 */
function Invitacion() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const { user, loading } = useSession();

  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("el enlace no lleva ningún token");
      return;
    }
    void api
      .get<{ invitation: Invitation }>(`/invitations/${token}`)
      .then(({ invitation }) => setInvitation(invitation))
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught.message : "no se pudo leer la invitación"),
      );
  }, [token]);

  async function aceptar() {
    setBusy(true);
    try {
      await api.post("/invitations/accept", { token });
      router.replace("/app");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "no se pudo aceptar");
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Marco>
        <p className="flex items-start gap-2 text-sm text-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error}
        </p>
        <Link href="/login" className="mt-4 block text-xs text-muted underline">
          Ir al acceso
        </Link>
      </Marco>
    );
  }

  if (!invitation || loading) {
    return (
      <Marco>
        <Loader2 className="mx-auto animate-spin text-faint" size={20} />
      </Marco>
    );
  }

  if (invitation.accepted) {
    return (
      <Marco>
        <p className="text-sm text-muted">Esta invitación ya se usó.</p>
        <Link href="/login" className="mt-4 block text-xs text-accent underline">
          Entrar
        </Link>
      </Marco>
    );
  }

  if (invitation.expired) {
    return (
      <Marco>
        <p className="text-sm text-muted">
          Esta invitación ha caducado. Pídele a {invitation.invitedByName} que te mande otra.
        </p>
      </Marco>
    );
  }

  return (
    <Marco>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
          <Building2 size={19} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{invitation.organizationName}</h1>
          <p className="text-xs text-faint">
            {invitation.invitedByName} te ha invitado como {invitation.role}
          </p>
        </div>
      </div>

      {user ? (
        user.email.toLowerCase() === invitation.email.toLowerCase() ? (
          <button
            type="button"
            onClick={() => void aceptar()}
            disabled={busy}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-canvas transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Entrando…" : `Unirme a ${invitation.organizationName}`}
          </button>
        ) : (
          // Aceptarla con otra cuenta metería a quien no toca en la
          // organización, y el correo iba dirigido a una persona concreta.
          <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            La invitación es para <strong>{invitation.email}</strong> y ahora mismo estás dentro
            como <strong>{user.email}</strong>. Cierra sesión y vuelve a abrir este enlace.
          </p>
        )
      ) : (
        <Link
          href={`/login?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invitation.email)}`}
          className="block w-full rounded-lg bg-accent px-4 py-2.5 text-center text-sm font-medium text-canvas transition hover:brightness-110"
        >
          Crear mi cuenta
        </Link>
      )}

      <p className="mt-4 text-center text-[11px] text-faint">
        Este enlace es de un solo uso.
      </p>
    </Marco>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6">{children}</div>
    </main>
  );
}
