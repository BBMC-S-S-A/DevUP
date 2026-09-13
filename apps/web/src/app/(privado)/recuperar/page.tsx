"use client";

import { AlertCircle, CheckCircle2, KeyRound, LogIn, MailPlus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { leerUltimoCorreo } from "@/lib/quien-entro";
import { Boton } from "@/components/ui/Boton";
import { Field } from "@/components/ui/Field";
import { Logo } from "@/components/ui/Logo";
import { Rotulo, Tarjeta } from "@/components/ui/Superficies";

/* Mismo chasis que el acceso y la invitación: quien llega aquí viene de un
   correo y tiene que reconocer el producto en el primer vistazo. */
const LUZ =
  "radial-gradient(34rem 26rem at 50% -8%, rgb(124 58 237 / 0.14), transparent 60%)," +
  "radial-gradient(26rem 20rem at 92% 100%, rgb(62 224 245 / 0.07), transparent 60%)";

/** Lo que exige el servidor. Aquí solo se usa para dar señal antes de enviar. */
const MINIMO = 10;

/**
 * Lo que responde `POST /auth/reset-password/check`, más los dos estados que
 * solo existen en el navegador: mientras se pregunta, y cuando la dirección ni
 * siquiera trae token.
 */
type Estado = "mirando" | "valido" | "caducado" | "usado" | "desconocido" | "sin-token";

/**
 * QUÉ SE LE DICE A CADA UNO Y A DÓNDE SE LE MANDA.
 *
 * El fallo que esto arregla no es que el enlace caducado no funcione —eso es
 * lo correcto—: es que antes se descubría DESPUÉS de elegir una contraseña
 * nueva y teclearla dos veces. Y que «pide otro» sin decir desde dónde deja a
 * la persona buscando por su cuenta una pantalla que no sabe cómo se llama:
 * está detrás de un botón dentro de /login, no en una dirección propia.
 *
 * Caducado y usado se separan a propósito. A quien ya cambió la contraseña
 * mandarle a pedir otro correo es mandarle a repetir algo que ya hizo.
 */
const SALIDA: Record<
  Exclude<Estado, "mirando" | "valido">,
  { titulo: string; explicacion: string; pedirOtro: boolean }
> = {
  caducado: {
    titulo: "El enlace ha caducado",
    explicacion:
      "Los enlaces de recuperación duran una hora desde que se envían. Este ya no sirve, pero pedir otro cuesta un clic.",
    pedirOtro: true,
  },
  usado: {
    titulo: "Este enlace ya se usó",
    explicacion:
      "Con él ya se cambió la contraseña de esta cuenta. Si fuiste tú, entra con la nueva; si no reconoces el cambio, escríbenos.",
    pedirOtro: false,
  },
  desconocido: {
    titulo: "El enlace no es válido",
    explicacion:
      "Suele pasar cuando el correo lo parte en dos líneas y al copiarlo se queda la mitad. Pide otro y ábrelo pulsándolo, sin copiar.",
    pedirOtro: true,
  },
  "sin-token": {
    titulo: "Falta el enlace",
    explicacion:
      "Esta pantalla se abre desde el correo de recuperación. Sin el enlace no hay ninguna cuenta que cambiar.",
    pedirOtro: true,
  },
};

const retraso = (ms: number) => ({ "--retraso": `${ms}ms` }) as React.CSSProperties;

export default function RecuperarPage() {
  return (
    <Suspense fallback={null}>
      <Recuperar />
    </Suspense>
  );
}

function Recuperar() {
  const token = useSearchParams().get("token") ?? "";
  const [estado, setEstado] = useState<Estado>(token ? "mirando" : "sin-token");
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Preguntar por el enlace al abrir, antes de enseñar el formulario.
   *
   * La ruta que se llama es la que MIRA, no la que canjea: comprobar con
   * `/auth/reset-password` gastaría el enlace al pintar la pantalla y la
   * persona se quedaría sin poder enviarlo — el enlace se lo habría gastado
   * ella misma al abrirlo.
   *
   * Si la comprobación no llega a responder se deja pasar al formulario: el
   * servidor vuelve a decidir al enviar, así que una red mala no puede dejar
   * fuera a alguien con un enlace bueno.
   */
  useEffect(() => {
    if (!token) return;
    let vigente = true;
    void api
      .post<{ estado: Estado }>("/auth/reset-password/check", { token })
      .then((respuesta) => {
        if (vigente) setEstado(respuesta.estado);
      })
      .catch(() => {
        if (vigente) setEstado("valido");
      });
    return () => {
      vigente = false;
    };
  }, [token]);

  // Solo para pintar: el botón ya se bloqueaba por debajo del mínimo, y un
  // bloqueo sin explicación se lee como una avería.
  const avance = Math.min(password.length / MINIMO, 1);
  const coinciden = repetida.length > 0 && password === repetida;

  const problema = estado === "mirando" || estado === "valido" ? null : SALIDA[estado];
  // Para que pedir otro sea de verdad un clic y no «busca tú la pantalla»:
  // /login abre el formulario con el correo puesto y el botón de olvido justo
  // debajo. Si este navegador no recuerda a nadie, se va igual — con el campo
  // vacío, que es lo único honesto cuando no se sabe de quién es el enlace.
  const pedirOtro = (() => {
    const ultimo = leerUltimoCorreo();
    return ultimo
      ? `/login?modo=acceso&email=${encodeURIComponent(ultimo)}`
      : "/login?modo=acceso";
  })();

  return (
    <main className="relative grid min-h-[100svh] place-items-center overflow-hidden px-6 py-12">
      <div className="rejilla pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-0" style={{ background: LUZ }} />

      <div className="relative w-full max-w-sm">
        <div className="devup-entrada mb-6 flex items-center gap-3" style={retraso(0)}>
          <Logo size={34} animated />
          <div>
            <p className="font-display text-sm font-semibold tracking-tight">DevUP</p>
            <Rotulo>Recuperación</Rotulo>
          </div>
        </div>

        <Tarjeta className="devup-entrada p-6" style={retraso(140)}>
          <div className="mb-5 flex items-start gap-3">
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-xl border ${
                listo
                  ? "border-live/30 bg-live/10 text-live"
                  : problema
                    ? "border-danger/30 bg-danger/10 text-danger"
                    : "border-accent/30 bg-accent-soft/60 text-accent"
              }`}
            >
              {listo ? (
                <CheckCircle2 size={19} />
              ) : problema ? (
                <AlertCircle size={19} />
              ) : (
                <KeyRound size={19} />
              )}
            </span>
            <div className="min-w-0">
              <h1 className="text-base font-semibold">
                {listo ? "Contraseña cambiada" : (problema?.titulo ?? "Nueva contraseña")}
              </h1>
              <p className="mt-0.5 text-xs text-muted">
                {listo
                  ? "Ya puedes entrar con la nueva."
                  : problema
                    ? "Nada de lo que escribas aquí se guardaría."
                    : estado === "mirando"
                      ? "Comprobando el enlace…"
                      : "Elige una y repítela para confirmar."}
              </p>
            </div>
          </div>

          {listo ? (
            <>
              <p className="flex items-start gap-2 rounded-xl border border-live/25 bg-live/10 px-3 py-2.5 text-sm leading-relaxed text-live">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                Se han cerrado todas las sesiones que hubiera abiertas.
              </p>
              <Link
                href="/login"
                className="presionable mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl
                  bg-gradient-to-b from-accent-bright to-accent px-4 text-sm font-medium text-canvas
                  shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_4px_16px_-6px_rgb(124_58_237/0.7)]
                  hover:brightness-110"
              >
                <LogIn size={15} />
                Entrar
              </Link>
            </>
          ) : problema ? (
            <>
              <p className="text-sm leading-relaxed text-muted">{problema.explicacion}</p>
              {problema.pedirOtro ? (
                <>
                  <Link
                    href={pedirOtro}
                    className="presionable mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl
                      bg-gradient-to-b from-accent-bright to-accent px-4 text-sm font-medium text-canvas
                      shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_4px_16px_-6px_rgb(124_58_237/0.7)]
                      hover:brightness-110"
                  >
                    <MailPlus size={15} />
                    Pedir otro enlace
                  </Link>
                  {/* El botón está DENTRO de /login, no en una pantalla
                      propia. Decirlo aquí es la diferencia entre «pide otro» y
                      saber cómo. */}
                  <p className="mt-2.5 text-center text-xs text-faint">
                    Allí, «He olvidado mi contraseña», debajo de Entrar.
                  </p>
                </>
              ) : (
                <Link
                  href="/login?modo=acceso"
                  className="presionable mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl
                    bg-gradient-to-b from-accent-bright to-accent px-4 text-sm font-medium text-canvas
                    shadow-[0_1px_0_rgb(255_255_255/0.25)_inset,0_4px_16px_-6px_rgb(124_58_237/0.7)]
                    hover:brightness-110"
                >
                  <LogIn size={15} />
                  Entrar
                </Link>
              )}
            </>
          ) : estado === "mirando" ? (
            /* Mientras se pregunta no se enseña el formulario: verlo aparecer
               y desaparecer es peor que esperar medio segundo. */
            <div className="space-y-3" aria-busy="true">
              <div className="h-10 animate-pulse rounded-xl bg-line/60" />
              <div className="h-10 animate-pulse rounded-xl bg-line/40" />
              <div className="h-10 animate-pulse rounded-xl bg-line/20" />
            </div>
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
                    caught instanceof ApiError
                      ? caught.message
                      : "no se pudo cambiar la contraseña",
                  );
                } finally {
                  setBusy(false);
                }
              }}
              className="space-y-4"
            >
              <div>
                <Field
                  label="Contraseña"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="mínimo 10 caracteres"
                  autoComplete="new-password"
                  required
                />
                {/* Medidor de longitud: instrumento, no adorno — dice cuánto
                    falta para que el botón se desbloquee. */}
                <div className="mt-2 flex items-center gap-2.5">
                  <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-accent transition-transform duration-200"
                      style={{
                        transform: `scaleX(${avance})`,
                        transformOrigin: "left",
                        transitionTimingFunction: "var(--ease-out)",
                      }}
                    />
                  </div>
                  <span className="font-mono text-[10px] tabular-nums text-faint">
                    {Math.min(password.length, 99)}/{MINIMO}
                  </span>
                </div>
              </div>

              <div>
                <Field
                  label="Repítela"
                  type="password"
                  value={repetida}
                  onChange={setRepetida}
                  autoComplete="new-password"
                  required
                />
                {repetida.length > 0 && (
                  <p
                    className={`mt-2 font-mono text-[10px] ${coinciden ? "text-live" : "text-faint"}`}
                  >
                    {coinciden ? "coinciden" : "todavía no coinciden"}
                  </p>
                )}
              </div>

              {error && (
                <p
                  role="alert"
                  className="devup-entrada flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
                >
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              )}

              <Boton
                type="submit"
                variante="primario"
                className="w-full"
                cargando={busy}
                disabled={password.length < MINIMO}
                icono={<KeyRound size={15} />}
              >
                Cambiar contraseña
              </Boton>
            </form>
          )}
        </Tarjeta>

        <p
          className="devup-entrada mt-5 text-center font-mono text-[10px] text-faint"
          style={retraso(220)}
        >
          {problema ? "enlace de un solo uso · este ya no vale" : "enlace de un solo uso"}
        </p>
      </div>
    </main>
  );
}
