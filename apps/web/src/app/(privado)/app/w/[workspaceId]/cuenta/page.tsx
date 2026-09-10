"use client";

import { Bot, Check, Copy, KeyRound, Loader2, Monitor, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Field } from "@/components/ui/Field";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { Pagina } from "@/components/ui/Pagina";
import { type ConexionDeAgente, type Sesion, ApiError, api } from "@/lib/api";

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
