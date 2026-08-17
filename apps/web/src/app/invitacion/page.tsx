"use client";

import { AlertCircle, Building2, CheckCircle2, Clock, LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ApiError, type Invitation, api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { Logo } from "@/components/ui/Logo";
import { Chip, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useSession } from "@/lib/session";

/* Mismo chasis que el acceso: rejilla, luz difusa y la tarjeta llegando después
   de la marca. Estas pantallas se abren desde un correo, muchas veces antes de
   haber visto nunca la aplicación — si parecen de otro producto, la invitación
   parece un enlace sospechoso. */
const LUZ =
  "radial-gradient(34rem 26rem at 50% -8%, rgb(91 140 255 / 0.14), transparent 60%)," +
  "radial-gradient(26rem 20rem at 92% 100%, rgb(62 224 245 / 0.07), transparent 60%)";

const TONOS = {
  accent: "border-accent/30 bg-accent-soft/60 text-accent",
  live: "border-live/30 bg-live/10 text-live",
  warn: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-danger/30 bg-danger/10 text-danger",
} as const;

/** El rol viaja en inglés desde la API; en pantalla se lee en español. */
const ROLES: Record<string, string> = {
  owner: "propietaria",
  admin: "administradora",
  member: "miembro",
};

const retraso = (ms: number) => ({ "--retraso": `${ms}ms` }) as React.CSSProperties;

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
      <Marco
        rotulo="Invitación"
        icono={<AlertCircle size={19} />}
        tono="danger"
        titulo="No se pudo abrir"
      >
        <p role="alert" className="text-sm leading-relaxed text-muted">
          {error}
        </p>
        <EnlaceSecundario href="/login">Ir al acceso</EnlaceSecundario>
      </Marco>
    );
  }

  if (!invitation || loading) {
    // Un esqueleto con la forma que va a llegar, no un giro suelto: así el salto
    // al contenido real no reordena media pantalla.
    return (
      <Marco rotulo="Invitación" icono={<Building2 size={19} />} titulo="Leyendo invitación…">
        <div className="space-y-2.5">
          <div className="devup-esqueleto h-3 w-2/3 rounded" />
          <div className="devup-esqueleto h-3 w-1/2 rounded" />
          <div className="devup-esqueleto mt-5 h-10 w-full rounded-xl" />
        </div>
      </Marco>
    );
  }

  if (invitation.accepted) {
    return (
      <Marco
        rotulo="Invitación"
        icono={<CheckCircle2 size={19} />}
        tono="live"
        titulo="Ya se usó"
        chip={<Chip tono="live">Aceptada</Chip>}
      >
        <p className="text-sm leading-relaxed text-muted">
          Esta invitación ya está canjeada. Entra con tu cuenta y la organización estará ahí.
        </p>
        <EnlacePrimario href="/login">
          <LogIn size={15} />
          Entrar
        </EnlacePrimario>
      </Marco>
    );
  }

  if (invitation.expired) {
    return (
      <Marco
        rotulo="Invitación"
        icono={<Clock size={19} />}
        tono="warn"
        titulo="Enlace caducado"
        chip={<Chip tono="warn">Caducada</Chip>}
      >
        <p className="text-sm leading-relaxed text-muted">
          Pídele a {invitation.invitedByName} que te mande otra: las invitaciones dejan de valer
          pasado un tiempo, a propósito.
        </p>
        <EnlaceSecundario href="/login">Ir al acceso</EnlaceSecundario>
      </Marco>
    );
  }

  return (
    <Marco
      rotulo="Invitación"
      icono={<Building2 size={19} />}
      titulo={invitation.organizationName}
      subtitulo={`${invitation.invitedByName} te ha invitado`}
      chip={<Chip tono="accent">{ROLES[invitation.role] ?? invitation.role}</Chip>}
    >
      {/* La ficha de datos: a quién va dirigida y con qué rango. En mono porque
          es un dato que se compara letra a letra con el propio correo. */}
      <dl className="mb-5 space-y-2 rounded-xl border border-line bg-canvas/50 px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-4">
          <dt>
            <Rotulo>Para</Rotulo>
          </dt>
          <dd className="truncate font-mono text-xs text-ink">{invitation.email}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt>
            <Rotulo>Rango</Rotulo>
          </dt>
          <dd className="font-mono text-xs text-ink">{ROLES[invitation.role] ?? invitation.role}</dd>
        </div>
      </dl>

      {user ? (
        user.email.toLowerCase() === invitation.email.toLowerCase() ? (
          <Boton
            type="button"
            variante="primario"
            className="w-full"
            cargando={busy}
            icono={<Building2 size={15} />}
            onClick={() => void aceptar()}
          >
            {busy ? "Entrando…" : `Unirme a ${invitation.organizationName}`}
          </Boton>
        ) : (
          // Aceptarla con otra cuenta metería a quien no toca en la
          // organización, y el correo iba dirigido a una persona concreta.
          <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2.5 text-xs leading-relaxed text-warn">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              La invitación es para <strong>{invitation.email}</strong> y ahora mismo estás dentro
              como <strong>{user.email}</strong>. Cierra sesión y vuelve a abrir este enlace.
            </span>
          </p>
        )
      ) : (
        <EnlacePrimario
          href={`/login?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invitation.email)}`}
        >
          <UserPlus size={15} />
          Crear mi cuenta
        </EnlacePrimario>
      )}

      <p className="mt-4 text-center font-mono text-[10px] text-faint">enlace de un solo uso</p>
    </Marco>
  );
}

/**
 * El chasis compartido de las pantallas de correo: marca arriba, instrumento
 * debajo. El rótulo dice de qué trata antes de que se lea el titular.
 */
function Marco({
  rotulo,
  icono,
  titulo,
  subtitulo,
  chip,
  tono = "accent",
  children,
}: {
  rotulo: string;
  icono: React.ReactNode;
  titulo: string;
  subtitulo?: string;
  chip?: React.ReactNode;
  tono?: keyof typeof TONOS;
  children: React.ReactNode;
}) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-6 py-12">
      <div className="rejilla pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-0" style={{ background: LUZ }} />

      <div className="relative w-full max-w-sm">
        <div className="devup-entrada mb-6 flex items-center gap-3" style={retraso(0)}>
          <Logo size={34} animated />
          <div>
            <p className="font-display text-sm font-semibold tracking-tight">DevUP</p>
            <Rotulo>{rotulo}</Rotulo>
          </div>
        </div>

        <Tarjeta className="devup-entrada p-6" style={retraso(140)}>
          <div className="mb-5 flex items-start gap-3">
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-xl border ${TONOS[tono]}`}
            >
              {icono}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{titulo}</h1>
                {chip}
              </div>
              {subtitulo && <p className="mt-0.5 truncate text-xs text-muted">{subtitulo}</p>}
            </div>
          </div>
          {children}
        </Tarjeta>
      </div>
    </main>
  );
}

/** Enlace con la piel del botón primario: aquí la acción siguiente es navegar,
 *  no enviar un formulario, y un `<button>` que navega rompe el clic medio. */
function EnlacePrimario({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="presionable mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-xl
        bg-gradient-to-b from-accent-bright to-accent px-4 text-sm font-medium text-canvas
        shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_4px_16px_-6px_rgb(91_140_255/0.7)]
        hover:brightness-110"
    >
      {children}
    </Link>
  );
}

function EnlaceSecundario({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="presionable mt-4 flex h-10 w-full items-center justify-center rounded-xl border
        border-line bg-raised/60 px-4 text-sm text-ink hover:border-line-strong hover:bg-raised"
    >
      {children}
    </Link>
  );
}
