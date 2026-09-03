"use client";

import { AlertCircle, LogIn, MailCheck, ShieldCheck, UserPlus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { API_URL, ApiError, type SignupPolicy, type User, api } from "@/lib/api";
import { Boton } from "@/components/ui/Boton";

import { Field } from "@/components/ui/Field";
import { LogoAnimado } from "@/components/marca/LogoAnimado";
import { Logo } from "@/components/ui/Logo";
import { Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { useSession } from "@/lib/session";

/**
 * El logotipo de Google, en línea.
 *
 * Inline y no desde un CDN a propósito: una imagen externa en la pantalla de
 * acceso es una petición a un tercero que se hace antes de que nadie haya
 * decidido usar Google, y que además delata a cada visitante de esta pantalla.
 * Son cuatro trazos.
 */
function LogoGoogle() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15.7" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-1.9 14.5-5.3l-6.9-5.3c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3 0-6.7 5.2-.1.3C7.9 41 15.4 46 24 46" />
      <path fill="#FBBC05" d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5v-.3l-6.8-5.3-.2.1C2.9 17 2 20.4 2 24s.9 7 2.5 10z" />
      <path fill="#EA4335" d="M24 9.9c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 3.7 29.9 2 24 2 15.4 2 7.9 7 4.5 14l7 5.5C13.3 14.2 18.2 9.9 24 9.9" />
    </svg>
  );
}

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
  "radial-gradient(38rem 30rem at 10% 4%, rgb(124 58 237 / 0.16), transparent 62%)," +
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
  // La landing enlaza aquí con `?modo=registro` desde «Empezar gratis». Sin
  // esto, quien pulsa un botón que dice «gratis» aterriza en un formulario de
  // acceso y tiene que darse cuenta solo de que hay una pestaña al lado.
  const pideRegistro = params.get("modo") === "registro";

  const [mode, setMode] = useState<Mode>(inviteToken || pideRegistro ? "register" : "login");
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

      // `refresh()` no siempre encuentra sesión en el primer intento: entre
      // que el navegador aplica la cookie que acaba de llegar y que esta
      // misma pestaña hace la siguiente petición hay una rendija de tiempo,
      // rara pero real. Antes se navegaba a `/app` sin comprobar nada, y el
      // guarda de sesión de ahí devolvía a quien acababa de entrar otra vez
      // al acceso — que es exactamente lo que se sentía como «hay que darle
      // entrar dos veces». Un reintento corto basta: si la sesión de verdad
      // no cuajó, un segundo intento no lo va a arreglar y hay que decirlo.
      let quienEntro = await refresh();
      if (!quienEntro) {
        await new Promise((resuelve) => setTimeout(resuelve, 400));
        quienEntro = await refresh();
      }

      if (quienEntro) {
        router.replace("/app");
      } else {
        setError("la sesión no llegó a confirmarse — inténtalo otra vez");
      }
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
    <main className="grid min-h-[100svh] lg:grid-cols-2">
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
          {/* La marca encendiéndose. Va aquí y no en la cabecera porque es una
              animación de arranque, no un icono: necesita tamaño para que la luz
              se lea recorriendo el contorno, y necesita estar donde la mirada
              cae primero. En pantalla estrecha no aparece — ahí el formulario es
              lo único que importa y esto sería un adorno que estorba. */}
          <LogoAnimado tamano={124} className="devup-entrada mb-7" />

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

            {/* Entrar con Google.
                Va FUERA del <form> a propósito: es una navegación de nivel
                superior hacia Google, no un envío. Dentro, un clic dispararía
                también la validación del formulario y el navegador se quejaría
                de los campos vacíos antes de dejarnos salir.
                Y es un <a> y no un botón con router: el viaje de OAuth necesita
                una recarga completa para que la cookie de la ida se fije. */}
            {policy?.google && (
              <>
                <div className="my-4 flex items-center gap-3">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-[11px] uppercase tracking-wider text-faint">o</span>
                  <span className="h-px flex-1 bg-line" />
                </div>

                <a
                  href={`${API_URL}/auth/google${
                    inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ""
                  }`}
                  className="toque-comodo flex w-full items-center justify-center gap-2.5
                    rounded-lg border border-line bg-raised/60 px-4 py-2.5 text-sm font-medium
                    text-ink transition-colors hover:border-line-strong hover:bg-raised
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--anillo-foco]"
                >
                  <LogoGoogle />
                  Continuar con Google
                </a>
              </>
            )}
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
