"use client";

import { AlertCircle, LogIn, MailCheck, ShieldCheck, UserPlus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ApiError, type SignupPolicy, type User, api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";
import { Field } from "@/components/ui/Field";
import { Logo } from "@/components/ui/Logo";
import { Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useSession } from "@/lib/session";

type Mode = "login" | "register";

const FRASES = [
  "canales, voz y archivos.",
  "un embudo de ventas que avanza solo.",
  "cifrado extremo a extremo, siempre.",
  "todo tu equipo, un solo sitio.",
];

/**
 * Los subsistemas que promete la marca, pintados como lecturas de un panel:
 * rótulo a la izquierda, nota técnica a la derecha. Es texto fijo, no telemetría
 * — el punto encendido dice «esto existe», no «esto está pasando ahora».
 */
const MODULOS = [
  { nombre: "Canales", nota: "texto e hilos" },
  { nombre: "Voz", nota: "cifrada" },
  { nombre: "Archivos", nota: "biblioteca" },
  { nombre: "Ventas", nota: "embudo" },
];

/* La luz de la cabina: el foco azul arriba a la izquierda repite el de
   `body::before`, para que el acceso y la aplicación estén iluminados igual. */
const LUZ_MARCA =
  "radial-gradient(38rem 30rem at 10% 4%, rgb(91 140 255 / 0.16), transparent 62%)," +
  "radial-gradient(30rem 24rem at 92% 98%, rgb(62 224 245 / 0.09), transparent 60%)";

/** El escalonado vive en CSS (`--retraso` de globals.css); esto solo lo escribe. */
const retraso = (ms: number) => ({ "--retraso": `${ms}ms` }) as React.CSSProperties;

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
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="rejilla pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-0" style={{ background: LUZ_MARCA }} />
        {/* El panel se apaga contra su canto derecho para que el formulario no
            tenga que competir con la marca por la atención. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-40 bg-gradient-to-r from-transparent to-canvas/70" />

        <div className="filo-luz relative pb-6 devup-entrada" style={retraso(0)}>
          <div className="flex items-center gap-3">
            <Logo size={38} animated />
            <div>
              <p className="font-display text-base font-semibold tracking-tight">DevUP</p>
              <Rotulo>Centro de mando</Rotulo>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2
            className="devup-entrada text-[2rem] leading-[1.08] text-ink"
            style={retraso(80)}
          >
            Todo el equipo <span className="texto-plasma">en un solo panel</span>
          </h2>
          <p
            className="devup-entrada mt-4 text-sm leading-relaxed text-muted"
            style={retraso(140)}
          >
            Workspaces, voz cifrada, biblioteca de archivos y control de ventas
            en un solo sitio, sin repartir el trabajo entre media docena de
            herramientas que no se hablan entre ellas.
          </p>

          <div
            className="devup-entrada relative mt-7 overflow-hidden rounded-xl border border-line bg-canvas/70 py-2.5 pl-4 pr-3.5"
            style={retraso(200)}
          >
            {/* Filamento del acento en el canto: convierte la línea de consola
                en un instrumento encendido y no en una cita suelta. */}
            <span className="absolute inset-y-2 left-0 w-px bg-gradient-to-b from-transparent via-accent to-transparent" />
            <MaquinaDeEscribir />
          </div>
        </div>

        <div className="relative max-w-md">
          <ul
            className="devup-entrada grid grid-cols-2 gap-x-8 gap-y-2.5"
            style={retraso(260)}
          >
            {MODULOS.map((modulo) => (
              <li key={modulo.nombre} className="flex items-center gap-2">
                <span className="size-1.5 shrink-0 rounded-full bg-accent/70" />
                <span className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                  {modulo.nombre}
                </span>
                <span className="ml-auto font-mono text-[10px] text-faint">{modulo.nota}</span>
              </li>
            ))}
          </ul>
          <p
            className="devup-entrada mt-6 flex items-center gap-1.5 font-mono text-[10px] text-faint"
            style={retraso(300)}
          >
            <ShieldCheck size={12} />
            cifrado extremo a extremo
          </p>
        </div>
      </aside>

      {/* Panel de formulario */}
      <div className="relative grid place-items-center overflow-hidden px-6 py-12">
        {/* Sin panel de marca al lado, el móvil se quedaba con un formulario
            flotando en negro; la rejilla le devuelve el suelo. */}
        <div className="rejilla pointer-events-none absolute inset-0 lg:hidden" />

        <div className="relative w-full max-w-sm">
          <div
            className="devup-entrada mb-6 flex items-center gap-3 lg:hidden"
            style={retraso(0)}
          >
            <Logo size={40} animated />
            <div>
              <p className="font-display text-lg font-semibold tracking-tight">DevUP</p>
              <Rotulo>Centro de mando</Rotulo>
            </div>
          </div>

          {/* El formulario llega después de la marca: primero se enciende la
              pantalla, luego aparece lo que hay que rellenar. */}
          <Tarjeta className="devup-entrada p-6" style={retraso(340)}>
            <div className="mb-5">
              <Rotulo>{inviteToken ? "Invitación" : "Acceso"}</Rotulo>
              <h1 className="mt-1.5 text-xl font-semibold tracking-tight">
                {mode === "login" ? "Entrar" : "Crear cuenta"}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {mode === "login"
                  ? "Con el correo y la contraseña de tu cuenta."
                  : "Toma menos de un minuto."}
              </p>
            </div>

            {policy?.bootstrap && (
              <div className="mb-5 rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-accent" />
                  <Rotulo className="text-accent">Instancia vacía</Rotulo>
                </div>
                <p className="text-xs leading-relaxed text-muted">
                  La primera cuenta que se cree será la administradora; a partir
                  de ahí solo se entra por invitación.
                </p>
              </div>
            )}

            {puedeRegistrarse && (
              <div className="relative mb-5 grid grid-cols-2 rounded-xl border border-line bg-canvas/60 p-1">
                {/* Un solo pulgar que se desplaza, en vez de dos fondos que se
                    encienden y apagan: así el conmutador tiene continuidad. Sin
                    hueco entre columnas, el ancho del pulgar y el de la celda
                    coinciden exactamente y `translateX(100%)` cae en su sitio. */}
                <div
                  className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-raised shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_1px_2px_rgb(0_0_0/0.4)] transition-transform duration-200"
                  style={{
                    transform: mode === "register" ? "translateX(100%)" : "translateX(0)",
                    transitionTimingFunction: "var(--ease-out)",
                  }}
                />
                {(["login", "register"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setMode(option);
                      setError(null);
                    }}
                    className={`presionable relative rounded-lg px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.12em] ${
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
                <p
                  role="alert"
                  className="devup-entrada flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
                >
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              )}

              {forgotSent && (
                <p className="devup-entrada flex items-start gap-2 rounded-xl border border-line bg-raised/60 px-3 py-2 text-sm text-muted">
                  <MailCheck size={16} className="mt-0.5 shrink-0 text-live" />
                  Si esa dirección tiene cuenta, le llegará un enlace para cambiar la contraseña.
                </p>
              )}

              <Boton
                type="submit"
                variante="primario"
                cargando={busy}
                className="w-full"
                icono={mode === "login" ? <LogIn size={15} /> : <UserPlus size={15} />}
              >
                {mode === "login" ? "Entrar" : "Crear cuenta"}
              </Boton>

              {mode === "login" && !forgotSent && (
                <Boton
                  type="button"
                  variante="fantasma"
                  tamano="sm"
                  className="w-full"
                  onClick={() => void forgot()}
                >
                  He olvidado mi contraseña
                </Boton>
              )}
            </form>
          </Tarjeta>

          {!puedeRegistrarse && (
            <p
              className="devup-entrada mt-5 text-center text-xs leading-relaxed text-faint"
              style={retraso(420)}
            >
              Esta instancia solo admite altas por invitación. Pídele a alguien del equipo que te
              invite desde su organización.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
