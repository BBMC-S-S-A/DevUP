"use client";

import {
  Bot,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Monitor,
  Plus,
  Sparkles,
  MailWarning,
  Trash2,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Field } from "@/components/ui/Field";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { Pagina } from "@/components/ui/Pagina";
import { type ConexionDeAgente, type Sesion, ApiError, api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { iniciales } from "@/lib/fechas";

/**
 * Mi cuenta: lo que es de la persona y no de la organización.
 *
 * Vive bajo la URL del workspace a propósito, no en `/app/cuenta`: así la
 * pinta `WorkspaceLayout` y abrirla no cambia de armazón ni saca a nadie de
 * donde estaba. Es el mismo criterio que Ventas o GitHub — «todo en uno» — y
 * está explicado en `NavegacionOrganizacion.tsx`.
 *
 * No está dentro de Ajustes de la organización porque eso es la
 * personalización de la entidad, lo dice su propio encabezado, y además su
 * entrada en la barra solo la ven administradores. Una conexión de agente la
 * necesita cualquiera.
 */
export default function CuentaPage() {
  return (
    <Pagina
      titulo="Mi cuenta"
      rotulo="lo tuyo, no lo de la organización"
      icono={<KeyRound size={16} />}
      ancho="lg"
    >
      <div className="space-y-4">
        <Perfil />
        <ClaveDeIA />
        <ConexionesDeAgente />
        <Navegadores />
      </div>
    </Pagina>
  );
}

/** Cuánto queda, en días, dicho como lo diría una persona. */
function caduca(iso: string): string {
  const dias = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (dias <= 0) return "caduca hoy";
  if (dias === 1) return "caduca mañana";
  return `caduca en ${dias} días`;
}

function useSesiones() {
  const [sesiones, setSesiones] = useState<Sesion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const { sessions } = await api.get<{ sessions: Sesion[] }>("/auth/sessions");
      setSesiones(sessions);
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : "no pude leer tus sesiones");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return { sesiones, error, cargar };
}

type Proveedor = "gemini" | "anthropic";

/**
 * Los dos proveedores que puede usar el asistente, y su ficha.
 *
 * Gemini va primero porque es la opción sin coste — Google no cobra por
 * tokens en su capa gratuita — y es lo que la mayoría va a querer. Anthropic
 * sigue disponible para quien prefiera pagar y no tener el aviso de abajo.
 */
const FICHA: Record<
  Proveedor,
  { nombre: string; chip: string; placeholder: string; ayuda: string; aviso?: string }
> = {
  gemini: {
    nombre: "Gemini",
    chip: "gratis",
    placeholder: "AIza…",
    ayuda: "Se saca en aistudio.google.com/apikey. Sin tarjeta, y no cuesta nada por token.",
    aviso:
      "Google usa el contenido de la capa gratuita para mejorar sus productos: lo que le " +
      "preguntes al asistente —nombres de clientes incluidos— pasa por ahí. Si eso te " +
      "preocupa, usa Anthropic en su lugar.",
  },
  anthropic: {
    nombre: "Anthropic (Claude)",
    chip: "de pago",
    placeholder: "sk-ant-…",
    ayuda: "Se saca en console.anthropic.com. Es prepago y va aparte de tu suscripción de Claude.",
  },
};

/**
 * El perfil: cómo te ve el resto.
 *
 * NO EXISTÍA, Y ERA LO PRIMERO QUE SE BUSCABA. El nombre se fijaba al
 * registrarse —o lo ponía Google— y a partir de ahí era para siempre: quien
 * entró con un apodo, o con el nombre mal escrito, no tenía dónde arreglarlo.
 * «Mi cuenta» tenía tres secciones y ninguna era la persona.
 *
 * EL CARGO YA ESTABA Y NADIE LO USABA. `PATCH /me/profile` acepta `title` desde
 * que se escribió, y la única pantalla que llamaba a esa ruta mandaba
 * únicamente la presencia. Otra función construida que no se podía encontrar.
 *
 * LA FOTO NO ESTÁ, Y NO SE FINGE. `profiles.avatar_url` existe, pero solo se
 * escribe al entrar con Google y no se pinta en ninguna pantalla: en toda la
 * aplicación el avatar es la inicial. Añadir la subida sin cambiar además todos
 * los sitios que dibujan esa chapa daría una foto que solo se ve aquí, que es
 * peor que no tenerla.
 */
function Perfil() {
  const { user, refresh } = useSession();
  const [nombre, setNombre] = useState("");
  const [cargo, setCargo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [reenviando, setReenviando] = useState(false);

  // Se siembra desde la sesión cuando llega, y no se vuelve a pisar: si se
  // reasignara en cada renderizado, escribir en el campo sería imposible.
  useEffect(() => {
    if (!user) return;
    setNombre(user.displayName ?? "");
    setCargo(user.title ?? "");
  }, [user]);

  const limpio = nombre.trim();
  const cambiado = Boolean(user) && (limpio !== (user?.displayName ?? "") || cargo.trim() !== (user?.title ?? ""));

  const reenviar = async () => {
    setReenviando(true);
    try {
      await api.post("/auth/verify-email/resend");
      // El servidor contesta 202 aunque la cuenta ya estuviera verificada, así
      // que el mensaje habla de lo que se pidió y no de lo que se sabe.
      toast.success("te lo mandamos otra vez", {
        description: "Si no aparece, mira en la carpeta de spam.",
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "no se pudo reenviar");
    } finally {
      setReenviando(false);
    }
  };

  const guardar = async () => {
    if (!limpio) {
      toast.error("el nombre no puede quedar vacío");
      return;
    }
    setGuardando(true);
    try {
      await api.patch("/me/profile", { displayName: limpio, title: cargo.trim() });
      // Se recarga la sesión y no solo el estado local: el nombre se pinta en
      // la barra lateral, en las menciones y en cada tarjeta que hayas tocado.
      // Sin esto, cambiarlo aquí dejaría el resto de la pantalla diciendo el
      // anterior hasta la siguiente recarga.
      await refresh();
      toast.success("perfil actualizado");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "no se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Tarjeta className="p-4">
      <Rotulo>Perfil</Rotulo>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        Cómo te ve el resto del equipo: en la barra, en las menciones y en cada tarea que lleves.
      </p>

      <div className="mt-4 flex items-start gap-3.5">
        <span
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-2xl border border-line-strong
            bg-accent-soft/70 font-display text-base font-semibold text-accent-bright"
        >
          {iniciales(nombre || user?.displayName || "?")}
        </span>

        <div className="min-w-0 flex-1 space-y-3">
          <Field
            label="Nombre"
            value={nombre}
            onChange={setNombre}
            maxLength={80}
            placeholder="Tu nombre"
          />

          <Field
            label="Cargo"
            hint="Opcional. Sale al lado de tu nombre para que se sepa a quién preguntar."
            value={cargo}
            onChange={setCargo}
            maxLength={40}
            placeholder="Backend, diseño, ventas…"
          />

          <p className="text-[11px] text-faint">
            El correo ({user?.email}) no se cambia desde aquí: es con lo que entras.
          </p>

          {/* Sin verificar: se dice y se puede arreglar.
              `emailVerified` estaba en el tipo y no lo miraba NADIE, y
              `POST /auth/verify-email/resend` existía sin que nada lo llamara.
              O sea: si el correo de verificación no llegaba —spam, una errata
              al escribirlo, el proveedor tardando— no había ni aviso de que
              faltaba ni forma de pedir otro. */}
          {user && !user.emailVerified && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warn/30 bg-warn/[0.07] px-3 py-2">
              <MailWarning size={14} className="shrink-0 text-warn" />
              <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-warn">
                Tu correo todavía no está verificado.
              </span>
              <Boton
                variante="fantasma"
                tamano="sm"
                disabled={reenviando}
                onClick={() => void reenviar()}
              >
                {reenviando ? <Loader2 size={12} className="animate-spin" /> : null}
                Reenviar
              </Boton>
            </div>
          )}

          <Boton onClick={() => void guardar()} disabled={!cambiado || guardando} tamano="sm">
            {guardando ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Guardar
          </Boton>
        </div>
      </div>
    </Tarjeta>
  );
}

/**
 * La clave con la que funciona el asistente de dentro de DevUP.
 *
 * POR QUÉ LA PONE CADA PERSONA. Un asistente dentro del producto necesita
 * inferencia, y la inferencia se paga. Que la clave sea de quien la usa es lo
 * que permite tenerlo sin que DevUP compre ni un token y sin una factura común
 * que crece con el uso. El coste es de quien lo consume —cero, si elige
 * Gemini—, así que escala sin arruinar a nadie.
 *
 * DOS PROVEEDORES Y NO UNO. La suscripción de Claude no se puede gastar desde
 * un producto de terceros —no existe ese permiso—, así que «sin gastar nada»
 * solo es posible con una capa gratuita de verdad. Gemini la tiene; Anthropic
 * no. Se dejan las dos porque no todos van a aceptar el aviso de privacidad
 * de la gratuita.
 *
 * Las claves se guardan cifradas en la bóveda que ya existía (0015), con
 * `anthropic` y `gemini` como valores del mismo enum (0030, 0031): separadas
 * de la fila que se puede listar, por eso enseñar «tienes una clave puesta»
 * no puede filtrar la clave.
 */
function ClaveDeIA() {
  const confirmar = useConfirmar();
  const [conexiones, setConexiones] = useState<{ id: string; provider: Proveedor }[] | undefined>(
    undefined,
  );
  const [abriendo, setAbriendo] = useState<Proveedor | null>(null);
  const [clave, setClave] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [reenviando, setReenviando] = useState(false);

  const cargar = useCallback(async () => {
    const { connections } = await api
      .get<{ connections: { id: string; provider: string }[] }>("/connections")
      .catch(() => ({ connections: [] as { id: string; provider: string }[] }));
    setConexiones(
      connections.filter((c): c is { id: string; provider: Proveedor } =>
        c.provider === "gemini" || c.provider === "anthropic",
      ),
    );
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const guardar = async (proveedor: Proveedor) => {
    if (clave.trim().length === 0) return;
    setGuardando(true);
    try {
      await api.post("/connections", {
        provider: proveedor,
        displayName: `Clave del asistente (${FICHA[proveedor].nombre})`,
        secret: clave.trim(),
      });
      setClave("");
      setAbriendo(null);
      toast.success("Clave guardada. El asistente ya funciona.");
      await cargar();
    } catch (fallo) {
      toast.error(fallo instanceof ApiError ? fallo.message : "no pude guardarla");
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async (conexion: { id: string; provider: Proveedor }) => {
    if (
      !(await confirmar({
        titulo: `¿Quitar la clave de ${FICHA[conexion.provider].nombre}?`,
        descripcion: "El asistente dejará de poder usarla hasta que pongas otra.",
        accion: "Quitar",
        peligro: true,
      }))
    )
      return;
    try {
      await api.delete(`/connections/${conexion.id}`);
      await cargar();
    } catch {
      toast.error("no pude quitarla");
    }
  };

  const puestas = new Map((conexiones ?? []).map((c) => [c.provider, c]));

  return (
    <Tarjeta className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={13} className="text-accent" />
        <Rotulo>Clave del asistente</Rotulo>
      </div>

      <p className="mb-4 max-w-prose text-xs leading-relaxed text-muted">
        El asistente de DevUP habla con <b>tu propio modelo</b>. DevUP no compra inferencia: no hay
        clave compartida ni factura común, y lo que gastes —si algo— lo paga tu cuenta. Se guarda
        cifrada y no se puede volver a leer desde aquí. Si tienes las dos puestas, se usa Gemini.
      </p>

      {conexiones === undefined ? (
        <div className="grid h-12 place-items-center">
          <Loader2 size={14} className="animate-spin text-faint" />
        </div>
      ) : (
        <div className="space-y-2.5">
          {(Object.keys(FICHA) as Proveedor[]).map((proveedor) => {
            const ficha = FICHA[proveedor];
            const puesta = puestas.get(proveedor);

            if (puesta) {
              return (
                <div
                  key={proveedor}
                  className="flex items-center gap-3 rounded-xl border border-line bg-canvas/40 px-3 py-2"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-accent/40 bg-accent-soft/40 text-accent">
                    <Check size={13} />
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-ink">
                    {ficha.nombre} <Chip tono={proveedor === "gemini" ? "accent" : undefined}>{ficha.chip}</Chip>
                  </span>
                  <BotonIcono
                    etiqueta={`Quitar la clave de ${ficha.nombre}`}
                    className="!size-7 hover:bg-danger/10 hover:text-danger"
                    onClick={() => void quitar(puesta)}
                  >
                    <Trash2 size={13} />
                  </BotonIcono>
                </div>
              );
            }

            if (abriendo === proveedor) {
              return (
                <div key={proveedor} className="rounded-xl border border-line p-3">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Field
                        label={`Clave de ${ficha.nombre}`}
                        type="password"
                        value={clave}
                        onChange={setClave}
                        onKeyDown={(evento) => {
                          if (evento.key === "Enter") void guardar(proveedor);
                        }}
                        placeholder={ficha.placeholder}
                      />
                    </div>
                    <Boton
                      variante="primario"
                      cargando={guardando}
                      disabled={clave.trim().length === 0}
                      onClick={() => void guardar(proveedor)}
                    >
                      Guardar
                    </Boton>
                    <Boton variante="fantasma" onClick={() => setAbriendo(null)}>
                      Cancelar
                    </Boton>
                  </div>
                  <p className="mt-1.5 text-[11px] text-faint">{ficha.ayuda}</p>
                  {ficha.aviso && (
                    <p className="mt-1.5 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-warn">
                      {ficha.aviso}
                    </p>
                  )}
                </div>
              );
            }

            return (
              <button
                key={proveedor}
                type="button"
                onClick={() => {
                  setAbriendo(proveedor);
                  setClave("");
                }}
                className="presionable flex w-full items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2 text-left hover:border-line-strong"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-raised/40 text-faint">
                  <Plus size={13} />
                </span>
                <span className="min-w-0 flex-1 text-sm text-muted">
                  Poner clave de {ficha.nombre} <Chip tono={proveedor === "gemini" ? "accent" : undefined}>{ficha.chip}</Chip>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Tarjeta>
  );
}

/**
 * Las conexiones de agente.
 *
 * Lo que se emite aquí es una credencial de 30 días con TODO el acceso de esta
 * persona, así que la pantalla tiene una sola obligación de verdad: que quien
 * la use sepa exactamente eso antes de copiar el token, y que cortarla sea un
 * clic. Lo demás es decoración.
 */
function ConexionesDeAgente() {
  const confirmar = useConfirmar();
  const { sesiones, error, cargar } = useSesiones();
  const [nombre, setNombre] = useState("");
  const [creando, setCreando] = useState(false);
  /** El token recién emitido. Se guarda en memoria y solo hasta que se cierre:
   *  en la base únicamente hay su hash, así que no es que no queramos volver a
   *  enseñarlo — es que no podemos. */
  const [recien, setRecien] = useState<{ conexion: ConexionDeAgente; token: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  const conexiones = (sesiones ?? []).filter((s) => s.isAgent);

  const crear = async () => {
    if (nombre.trim().length === 0) return;
    setCreando(true);
    try {
      const respuesta = await api.post<{ connection: ConexionDeAgente; token: string }>(
        "/auth/agent-connections",
        { label: nombre.trim() },
      );
      setRecien({ conexion: respuesta.connection, token: respuesta.token });
      setNombre("");
      setCopiado(false);
      await cargar();
    } catch (fallo) {
      toast.error(fallo instanceof ApiError ? fallo.message : "no pude crear la conexión");
    } finally {
      setCreando(false);
    }
  };

  const cortar = async (conexion: Sesion) => {
    if (
      !(await confirmar({
        titulo: `¿Cortar «${conexion.label}»?`,
        descripcion:
          "El Claude que use esta conexión dejará de ver DevUP en cuanto le toque renovar. " +
          "No se puede volver a activar: habría que crear otra.",
        accion: "Cortar",
        peligro: true,
      }))
    )
      return;
    try {
      await api.delete(`/auth/sessions/${conexion.id}`);
      toast.success("Conexión cortada");
      await cargar();
    } catch (fallo) {
      toast.error(fallo instanceof ApiError ? fallo.message : "no pude cortarla");
    }
  };

  return (
    <Tarjeta className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Rotulo>Conexiones de agente</Rotulo>
        {conexiones.length > 0 && (
          <span className="font-mono text-[10px] tabular-nums text-faint">{conexiones.length}</span>
        )}
      </div>

      <p className="mb-4 max-w-prose text-xs leading-relaxed text-muted">
        Cada una es la llave con la que <b>tu propio Claude</b> entra a DevUP por MCP y puede
        preguntarle al proyecto. DevUP no paga la inferencia de nadie: el modelo es el tuyo, corre
        en tu máquina y ve exactamente lo que ves tú, ni una fila más.
      </p>

      {error && <p className="mb-3 text-xs text-danger">{error}</p>}

      {recien && (
        <div className="mb-4 rounded-xl border border-accent/40 bg-accent-soft/30 p-3">
          <p className="mb-2 text-xs font-semibold text-ink">
            Copia el token ahora: no se puede volver a ver.
          </p>
          <p className="mb-2.5 max-w-prose text-[11px] leading-relaxed text-muted">
            En la base solo queda su huella, así que esta es la única vez que aparece. Si se pierde,
            corta la conexión y crea otra. Trátalo como tu contraseña:{" "}
            <b>quien lo tenga entra como tú</b>.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-canvas/70 px-2.5 py-2 font-mono text-[11px]">
              {recien.token}
            </code>
            <Boton
              tamano="sm"
              variante={copiado ? "fantasma" : "primario"}
              icono={copiado ? <Check size={13} /> : <Copy size={13} />}
              onClick={async () => {
                await navigator.clipboard.writeText(recien.token);
                setCopiado(true);
                toast.success("Token copiado");
              }}
            >
              {copiado ? "Copiado" : "Copiar"}
            </Boton>
            <Boton tamano="sm" variante="fantasma" onClick={() => setRecien(null)}>
              Ya está
            </Boton>
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-muted hover:text-ink">
              Dónde se pega
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-canvas/70 p-2.5 font-mono text-[10px] leading-relaxed text-muted">
              {`{
  "mcpServers": {
    "devup": {
      "command": "npx",
      "args": ["-y", "tsx", "<ruta>/apps/mcp/src/index.ts"],
      "env": { "DEVUP_TOKEN": "${recien.token.slice(0, 6)}…" }
    }
  }
}`}
            </pre>
          </details>
        </div>
      )}

      {sesiones === null ? (
        <div className="grid h-16 place-items-center">
          <Loader2 size={14} className="animate-spin text-faint" />
        </div>
      ) : conexiones.length === 0 ? (
        <EstadoVacio
          icono={<Bot size={20} />}
          titulo="Ninguna conexión todavía"
          pista="Crea una y pega el token en la configuración de tu Claude."
        />
      ) : (
        <ul className="mb-4 space-y-1.5">
          {conexiones.map((conexion) => (
            <li
              key={conexion.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-canvas/40 px-3 py-2"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-raised/50 text-muted">
                <Bot size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{conexion.label}</span>
                <span className="block text-[11px] text-faint">
                  creada el {new Date(conexion.createdAt).toLocaleDateString("es")} ·{" "}
                  {caduca(conexion.expiresAt)}
                </span>
              </span>
              <BotonIcono
                etiqueta={`Cortar ${conexion.label}`}
                className="!size-7 hover:bg-danger/10 hover:text-danger"
                onClick={() => void cortar(conexion)}
              >
                <Trash2 size={13} />
              </BotonIcono>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            label="Nombre de la conexión"
            value={nombre}
            onChange={setNombre}
            onKeyDown={(evento) => {
              if (evento.key === "Enter") void crear();
            }}
            placeholder="Claude en el portátil"
            maxLength={60}
          />
        </div>
        <Boton
          variante="primario"
          icono={<Plus size={15} />}
          cargando={creando}
          disabled={nombre.trim().length === 0}
          onClick={() => void crear()}
        >
          Crear
        </Boton>
      </div>
      <p className="mt-1.5 text-[11px] text-faint">
        Ponle un nombre que distinga la máquina. Es lo único que verás después para saber cuál
        cortar.
      </p>
    </Tarjeta>
  );
}

/**
 * Los navegadores donde hay sesión abierta.
 *
 * Está aquí porque la lista ya existía en la API y no se enseñaba en ninguna
 * parte: cerrar sesión en un portátil que ya no tienes era imposible desde
 * dentro del producto.
 */
function Navegadores() {
  const confirmar = useConfirmar();
  const { sesiones, cargar } = useSesiones();
  const navegadores = (sesiones ?? []).filter((s) => !s.isAgent);

  const cerrar = async (sesion: Sesion) => {
    if (
      !(await confirmar({
        titulo: "¿Cerrar esta sesión?",
        descripcion: "Si es la de esta pestaña, tendrás que volver a entrar.",
        accion: "Cerrar",
        peligro: true,
      }))
    )
      return;
    try {
      await api.delete(`/auth/sessions/${sesion.id}`);
      await cargar();
    } catch {
      toast.error("no pude cerrarla");
    }
  };

  if (sesiones !== null && navegadores.length === 0) return null;

  return (
    <Tarjeta className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Rotulo>Navegadores con sesión abierta</Rotulo>
        {navegadores.length > 0 && (
          <span className="font-mono text-[10px] tabular-nums text-faint">{navegadores.length}</span>
        )}
      </div>

      {sesiones === null ? (
        <div className="grid h-12 place-items-center">
          <Loader2 size={14} className="animate-spin text-faint" />
        </div>
      ) : (
        <ul className="space-y-1.5">
          {navegadores.map((sesion) => (
            <li
              key={sesion.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-canvas/40 px-3 py-2"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-raised/50 text-muted">
                <Monitor size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-muted" title={sesion.userAgent}>
                  {sesion.userAgent || "sin identificar"}
                </span>
                <span className="block text-[11px] text-faint">
                  desde el {new Date(sesion.createdAt).toLocaleDateString("es")}
                </span>
              </span>
              <Chip>{caduca(sesion.expiresAt)}</Chip>
              <BotonIcono
                etiqueta="Cerrar esta sesión"
                className="!size-7 hover:bg-danger/10 hover:text-danger"
                onClick={() => void cerrar(sesion)}
              >
                <Trash2 size={13} />
              </BotonIcono>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}
