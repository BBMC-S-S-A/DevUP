"use client";

import { AlertCircle, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { Logo } from "@/components/ui/Logo";
import { Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useSession } from "@/lib/session";

/**
 * El consentimiento del transporte remoto del MCP (ver
 * docs/HEARTH-Y-LA-PUERTA-MCP.md y `apps/api/src/routes/oauth.ts`).
 *
 * `GET /oauth/authorize` valida el cliente y el redirect_uri —eso no se
 * repite aquí— y redirige a esta pantalla con los mismos parámetros. Vive
 * bajo `(privado)/app`, así que hereda gratis el guardián de sesión de
 * `app/layout.tsx`: sin sesión, ya se manda a `/login` antes de llegar aquí.
 *
 * MISMO CHASIS QUE `/invitacion`: logo, rótulo, tarjeta — estas pantallas se
 * abren desde fuera de la navegación normal (aquí, desde el flujo de Claude)
 * y si parecen de otro producto, la petición de acceso parece sospechosa.
 */
export default function AutorizarAgentePage() {
  return (
    <Suspense fallback={null}>
      <AutorizarAgente />
    </Suspense>
  );
}

function AutorizarAgente() {
  const params = useSearchParams();
  const { user } = useSession();
  const [enviando, setEnviando] = useState<"autorizar" | "cancelar" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientId = params.get("client_id");
  const clientName = params.get("client_name") || "Una aplicación";
  const redirectUri = params.get("redirect_uri");
  const codeChallenge = params.get("code_challenge");
  const state = params.get("state");

  const faltanParametros = !clientId || !redirectUri || !codeChallenge;

  async function autorizar() {
    if (faltanParametros) return;
    setEnviando("autorizar");
    setError(null);
    try {
      const { redirectTo } = await api.post<{ redirectTo: string }>("/oauth/consentir", {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        state: state ?? undefined,
      });
      window.location.href = redirectTo;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "no se pudo completar la autorización");
      setEnviando(null);
    }
  }

  function cancelar() {
    if (!redirectUri) return;
    setEnviando("cancelar");
    const destino = new URL(redirectUri);
    destino.searchParams.set("error", "access_denied");
    if (state) destino.searchParams.set("state", state);
    window.location.href = destino.toString();
  }

  return (
    <main className="relative grid min-h-[100svh] place-items-center overflow-hidden px-6 py-12">
      <div className="rejilla pointer-events-none absolute inset-0" />

      <div className="relative w-full max-w-sm">
        <div className="devup-entrada mb-6 flex items-center gap-3">
          <Logo size={34} animated />
          <div>
            <p className="font-display text-sm font-semibold tracking-tight">DevUP</p>
            <Rotulo>Conexión de agente</Rotulo>
          </div>
        </div>

        <Tarjeta className="devup-entrada p-6">
          {faltanParametros ? (
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-danger/30 bg-danger/10 text-danger">
                <AlertCircle size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-base font-semibold">Enlace incompleto</h1>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Faltan datos en la URL. Vuelve a intentar la conexión desde el
                  cliente que la pidió.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-5 flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent-soft/60 text-accent">
                  <ShieldCheck size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <h1 className="text-base font-semibold">{clientName} quiere conectarse</h1>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    como {user?.email ?? "tu cuenta"}
                  </p>
                </div>
              </div>

              <p className="mb-5 text-xs leading-relaxed text-muted">
                Podrá leer y escribir en tus organizaciones exactamente como tú
                —las mismas reglas de acceso se te aplican a ti—, hasta que
                revoques esta conexión desde Ajustes → Conexiones de agente.
              </p>

              {error && (
                <p className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                <Boton
                  variante="fantasma"
                  className="flex-1"
                  disabled={enviando !== null}
                  cargando={enviando === "cancelar"}
                  onClick={cancelar}
                >
                  Cancelar
                </Boton>
                <Boton
                  variante="primario"
                  className="flex-1"
                  disabled={enviando !== null}
                  cargando={enviando === "autorizar"}
                  onClick={() => void autorizar()}
                >
                  Autorizar
                </Boton>
              </div>
            </>
          )}
        </Tarjeta>
      </div>
    </main>
  );
}
