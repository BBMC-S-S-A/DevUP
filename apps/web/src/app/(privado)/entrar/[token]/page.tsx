"use client";

import { AlertCircle, Building2, FolderKanban, LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { Logo } from "@/components/ui/Logo";
import { Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useSession } from "@/lib/session";

/**
 * La pantalla que abre quien recibe un enlace de invitación.
 *
 * MISMO CHASIS QUE LA INVITACIÓN POR CORREO, y por el mismo motivo: esto se
 * abre desde un grupo de WhatsApp, muchas veces antes de haber visto nunca la
 * aplicación. Si pareciera de otro producto, el enlace parecería sospechoso.
 *
 * SE DICE A DÓNDE ANTES DE PEDIR NADA. Consultar el destino no gasta un uso del
 * enlace ni mete a nadie: eso solo pasa al aceptar. Enseñar «te invitan a
 * Producto, de Acme» y sólo entonces pedir cuenta es lo que separa esto de un
 * formulario a ciegas.
 *
 * DOS CAMINOS SEGÚN QUIÉN LO ABRA. Con sesión, un botón. Sin ella, al alta o al
 * acceso —y volviendo AQUÍ, porque el enlace se pierde si se manda a `/app` y
 * la persona tiene que buscarlo otra vez en el chat.
 */
const LUZ =
  "radial-gradient(34rem 26rem at 50% -8%, rgb(124 58 237 / 0.14), transparent 60%)," +
  "radial-gradient(26rem 20rem at 92% 100%, rgb(62 224 245 / 0.07), transparent 60%)";

type Destino = {
  organizacion: string;
  espacio: string | null;
  expirado: boolean;
  agotado: boolean;
  revocado: boolean;
};

export default function EntrarPorEnlace() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { user, loading } = useSession();

  const [destino, setDestino] = useState<Destino | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  useEffect(() => {
    if (!token) return;
    void api
      .get<Destino>(`/invite-links/${token}/destino`)
      .then(setDestino)
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught.message : "no se pudo leer el enlace"),
      );
  }, [token]);

  async function entrar() {
    setEntrando(true);
    try {
      const r = await api.post<{ workspaceId: string | null; organizationId: string }>(
        `/invite-links/${token}/aceptar`,
      );
      // Directo a donde te invitaron, no a `/app`: quien acaba de entrar a un
      // proyecto quiere ver ESE proyecto, y hacerle buscarlo en una lista es
      // deshacer lo que el enlace acababa de resolver.
      router.replace(r.workspaceId ? `/app/w/${r.workspaceId}` : `/app/o/${r.organizationId}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "no se pudo entrar");
      setEntrando(false);
    }
  }

  // Un enlace cerrado se cuenta ANTES de pedir cuenta: registrarse para
  // descubrir que no sirve es el peor orden posible.
  const cerrado = destino?.expirado || destino?.agotado || destino?.revocado;
  const motivo = destino?.revocado
    ? "Este enlace se cerró."
    : destino?.expirado
      ? "Este enlace caducó."
      : "Este enlace ya llegó a su tope de personas.";

  return (
    <main className="relative grid min-h-svh place-items-center px-5 py-10" style={{ background: LUZ }}>
      <div className="flex w-full max-w-sm flex-col items-center gap-5">
        <Logo />

        <Tarjeta className="w-full p-5">
          {error ? (
            <Aviso icono={<AlertCircle size={18} className="text-danger" />} titulo="No se pudo abrir">
              {error}
            </Aviso>
          ) : !destino ? (
            <p className="text-center text-xs text-faint">Abriendo el enlace…</p>
          ) : cerrado ? (
            <Aviso icono={<AlertCircle size={18} className="text-warn" />} titulo={motivo}>
              Pídele uno nuevo a quien te lo pasó.
            </Aviso>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Rotulo>Te invitan a</Rotulo>
                <div className="flex items-center gap-2">
                  {destino.espacio ? (
                    <FolderKanban size={17} className="shrink-0 text-accent" />
                  ) : (
                    <Building2 size={17} className="shrink-0 text-accent" />
                  )}
                  <span className="text-base font-semibold text-ink">
                    {destino.espacio ?? destino.organizacion}
                  </span>
                </div>
                {destino.espacio && (
                  // Se nombra la organización aunque el enlace sea de un
                  // proyecto: entrar al proyecto es entrar también a ella, y
                  // eso hay que decirlo antes, no descubrirlo dentro.
                  <p className="text-[11px] leading-relaxed text-muted">
                    Un proyecto de <strong className="text-ink">{destino.organizacion}</strong>.
                    Entrarás a este proyecto y a ninguno más.
                  </p>
                )}
              </div>

              {loading ? null : user ? (
                <Boton
                  type="button"
                  variante="primario"
                  cargando={entrando}
                  onClick={() => void entrar()}
                >
                  Entrar
                </Boton>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] leading-relaxed text-muted">
                    Necesitas una cuenta de DevUP. Al terminar vuelves aquí.
                  </p>
                  {/* `volverA` lleva de vuelta a ESTA pantalla: mandar a `/app`
                      obligaría a buscar el enlace otra vez en el chat. */}
                  <Boton
                    type="button"
                    variante="primario"
                    icono={<UserPlus size={14} />}
                    onClick={() => router.push(`/registro?volverA=${encodeURIComponent(`/entrar/${token}`)}`)}
                  >
                    Crear cuenta
                  </Boton>
                  <Link
                    href={`/login?volverA=${encodeURIComponent(`/entrar/${token}`)}`}
                    className="presionable inline-flex items-center justify-center gap-1.5 text-[11px] text-muted hover:text-ink"
                  >
                    <LogIn size={12} /> Ya tengo cuenta
                  </Link>
                </div>
              )}
            </div>
          )}
        </Tarjeta>
      </div>
    </main>
  );
}

function Aviso({
  icono,
  titulo,
  children,
}: {
  icono: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {icono}
      <p className="text-sm font-semibold text-ink">{titulo}</p>
      <p className="text-[11px] leading-relaxed text-muted">{children}</p>
    </div>
  );
}
