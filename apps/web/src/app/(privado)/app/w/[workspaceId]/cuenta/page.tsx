"use client";

import {
  Bot,
  Check,
  Copy,
  ImagePlus,
  KeyRound,
  Loader2,
  Monitor,
  Plus,
  Sparkles,
  MailWarning,
  Trash2,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Field } from "@/components/ui/Field";
import { useConfirmar } from "@/components/ui/Confirmar";
import { Chip, EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { Pagina } from "@/components/ui/Pagina";
import {
  type AspectoDePersonaje,
  type ConexionDeAgente,
  type Sesion,
  ApiError,
  api,
} from "@/lib/api";
import { Dispositivos } from "@/components/ajustes/Dispositivos";
import { DatosVisibles } from "@/components/ajustes/DatosVisibles";
import { uploadAvatar } from "@/lib/files/upload";
import { CaraDePersonaje } from "@/components/perfil/CaraDePersonaje";
import { ignorar } from "@/lib/fallo";
import { useSession } from "@/lib/session";
import { useOrgId } from "@/lib/workspace-context";
import { useRecurso } from "@/lib/datos";
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
        <EnEstaOrganizacion />
        {/* Aquí y no dentro de la llamada: probar el micrófono ANTES cuesta
            diez segundos, descubrir que estaba mal DENTRO cuesta la reunión de
            todos. Es de «Mi cuenta» porque es de la persona en su mesa, no de
            la organización. */}
        <Dispositivos />
        {/* Detrás de lo que se rellena, y no delante: primero se pone el
            nombre, la cara y el oficio, y ahí es cuando importa saber a quién
            le llega. Delante sería una advertencia antes de que hubiera nada
            que advertir. */}
        <DatosVisibles />
        <ClaveDeIA />
        <ConexionesDeAgente />
        <Navegadores />
      </div>
    </Pagina>
  );
}

/**
 * Lo que cambia de una organización a otra: el oficio de aquí y el rol.
 *
 * VA APARTE DEL PERFIL A PROPÓSITO, aunque los dos hablen de «a qué te
 * dedicas». El de arriba es la persona en general —un nombre, un cargo— y este
 * cambia de proyecto en proyecto: la misma persona es «backend» en uno y
 * «plataforma» en otro (migración 0048). Juntarlos obligaría a elegir cuál de
 * los dos gana, y la respuesta es que no gana ninguno: son dos datos.
 *
 * Y TRES COSAS QUE SE LLAMAN PARECIDO Y NO SON LA MISMA. Si esta pantalla las
 * juntara, repartiría permisos sin querer:
 *
 *  · El PERMISO (owner/admin/member) no se elige: lo da quien administra. Aquí
 *    se enseña y no se toca.
 *  · El OFICIO es texto libre y es lo que ve el resto. Vacío = se enseña el
 *    general del perfil de arriba.
 *  · El ROL es una lista cerrada de trece y su única función es elegir qué
 *    tutorial se ofrece (migración 0052). Nadie más lo ve.
 *
 * NO ES OBLIGATORIO ELEGIR ROL, y es deliberado: un formulario en la puerta es
 * la forma más rápida de que alguien cierre la pestaña. Sin rol se ofrece el
 * tutorial base, que vale para todos.
 */
const ROLES: { valor: string; etiqueta: string }[] = [
  { valor: "producto", etiqueta: "Producto" },
  { valor: "gestion", etiqueta: "Gestión de proyecto" },
  { valor: "direccion", etiqueta: "Dirección técnica" },
  { valor: "frontend", etiqueta: "Frontend" },
  { valor: "backend", etiqueta: "Backend" },
  { valor: "fullstack", etiqueta: "Fullstack" },
  { valor: "movil", etiqueta: "Móvil" },
  { valor: "diseno", etiqueta: "Diseño (UX/UI)" },
  { valor: "qa", etiqueta: "Calidad y pruebas" },
  { valor: "datos", etiqueta: "Datos" },
  { valor: "ia", etiqueta: "IA" },
  { valor: "plataforma", etiqueta: "Plataforma / DevOps" },
  { valor: "seguridad", etiqueta: "Seguridad" },
];

const PERMISOS: Record<string, string> = {
  owner: "Propietario",
  admin: "Administra",
  member: "Miembro",
};

type MiFicha = {
  role: string;
  title: string | null;
  tituloGeneral: string | null;
  rol: string | null;
};

function EnEstaOrganizacion() {
  const orgId = useOrgId();
  const ficha = useRecurso<MiFicha>(`/organizations/${orgId}/me`);
  const [oficio, setOficio] = useState("");
  const [sembrado, setSembrado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Se siembra una sola vez, igual que el perfil de arriba: reasignarlo en cada
  // renderizado haría imposible escribir en el campo.
  useEffect(() => {
    if (sembrado || !ficha.datos) return;
    setOficio(ficha.datos.title ?? "");
    setSembrado(true);
  }, [ficha.datos, sembrado]);

  const guardar = async (cambio: { title?: string; rol?: string | null }) => {
    setGuardando(true);
    try {
      await api.patch(`/organizations/${orgId}/me`, cambio);
      await ficha.recargar();
      toast.success("guardado");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "no se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  if (ficha.error || (!ficha.datos && !ficha.cargando)) return null;

  const cambiado = sembrado && oficio.trim() !== (ficha.datos?.title ?? "");

  return (
    <Tarjeta className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Rotulo>En esta organización</Rotulo>
        {ficha.datos && (
          <Chip tono={ficha.datos.role === "member" ? "neutro" : "accent"}>
            {PERMISOS[ficha.datos.role] ?? ficha.datos.role}
          </Chip>
        )}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        Lo de arriba vale en todas partes. Esto solo aquí: la misma persona puede
        ser «backend» en un proyecto y «plataforma» en otro.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <Field
            label="Tu oficio aquí"
            value={oficio}
            onChange={setOficio}
            maxLength={40}
            placeholder={ficha.datos?.tituloGeneral ?? "backend, diseño, producto…"}
          />
          <p className="mt-1.5 text-[11px] text-faint">
            {ficha.datos?.tituloGeneral
              ? `Si lo dejas en blanco se enseña «${ficha.datos.tituloGeneral}», el de tu perfil.`
              : "Si lo dejas en blanco se enseña el de tu perfil."}
          </p>
          {cambiado && (
            <Boton
              variante="primario"
              tamano="sm"
              className="mt-2"
              cargando={guardando}
              onClick={() => void guardar({ title: oficio.trim() })}
            >
              Guardar
            </Boton>
          )}
        </div>

        <div className="border-t border-line pt-3">
          <label className="block">
            <Rotulo className="mb-1.5 block">A qué te dedicas</Rotulo>
            <select
              value={ficha.datos?.rol ?? ""}
              disabled={guardando}
              onChange={(e) => void guardar({ rol: e.target.value || null })}
              className="w-full rounded-lg border border-line bg-canvas/60 px-2.5 py-1.5 text-sm text-ink"
            >
              <option value="">Sin elegir</option>
              {ROLES.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.etiqueta}
                </option>
              ))}
            </select>
          </label>
          {/* Se dice qué hace y qué NO hace. Un desplegable junto a un permiso
              se lee como si repartiera permisos, y este no toca ninguno. */}
          <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
            Solo sirve para ofrecerte el recorrido de bienvenida que te encaje.
            No cambia lo que puedes hacer, y no lo ve nadie más. Puedes dejarlo
            sin elegir.
          </p>
        </div>
      </div>
    </Tarjeta>
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
 * LA FOTO YA SE PUEDE PONER (0057), y hay que decir hasta dónde llega. Antes
 * `profiles.avatar_url` solo la escribía entrar con Google, así que quien se
 * registró con correo no tenía ninguna forma de tener foto. Ahora se sube, se
 * cambia y se quita desde aquí.
 *
 * Lo que TODAVÍA no pasa: casi todas las pantallas siguen dibujando la inicial,
 * porque cada una construye su chapa por su cuenta. Eso es lo siguiente, y se
 * dice en vez de dejar que alguien descubra solo que su foto se ve en un sitio
 * y en otro no.
 *
 * QUITARLA NO BORRA LA DE GOOGLE, y por eso se siente como deshacer: quien
 * entró con Google vuelve a la suya, y quien no, a la inicial.
 */
/**
 * La foto de perfil: ponerla, cambiarla y quitarla.
 *
 * SE PINTA LO QUE SE ACABA DE ELEGIR, sin esperar a recargar la sesión. El
 * viaje de subir y confirmar dura lo suyo, y durante ese rato la pantalla
 * seguiría enseñando la foto anterior — que es justo lo que hace dudar de si el
 * cambio funcionó y lleva a subirla otra vez.
 *
 * EL TAMAÑO SE COMPRUEBA AQUÍ aunque el almacén acepte lo que sea: una foto de
 * diez megas se sube entera, se guarda, y luego se pinta en una chapa de
 * cuarenta píxeles en cada tarjeta del tablero. El coste lo paga quien la mira,
 * no quien la sube, así que no se nota al elegirla.
 */
function FotoDePerfil() {
  const { user, refresh } = useSession();
  const entrada = useRef<HTMLInputElement | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /**
   * El personaje se pide aparte y SIEMPRE, se esté usando o no.
   *
   * Es lo que permite enseñar las dos caras a la vez para elegir. Ofrecer
   * «usar mi personaje» sin enseñarlo obliga a elegir a ciegas, ir a DevVerse a
   * verlo, y volver — y quien haga eso dos veces deja de tocarlo.
   */
  const [personaje, setPersonaje] = useState<AspectoDePersonaje | null>(null);
  useEffect(() => {
    if (!user) return;
    let vigente = true;
    // Por `/world/avatars` y no por una ruta propia: es la que ya existe y la
    // que usa DevVerse, así que comparte caché con ella. Devuelve los de la
    // organización y de ahí se saca el propio — pedir una ruta nueva para una
    // sola fila sería una segunda forma de preguntar lo mismo.
    api
      .get<{ avatars: (AspectoDePersonaje & { userId: string })[] }>("/world/avatars")
      .then(({ avatars }) => {
        const mio = avatars.find((a) => a.userId === user.id);
        if (vigente && mio) setPersonaje(mio);
      })
      .catch(ignorar("no se pudo cargar tu personaje"));
    return () => {
      vigente = false;
    };
  }, [user]);

  const usaPersonaje = user?.usaPersonaje ?? false;
  const actual = vistaPrevia ?? user?.avatarUrl ?? null;

  const elegirFuente = async (usar: boolean) => {
    setOcupado(true);
    try {
      await api.put("/me/avatar/personaje", { usar });
      await refresh();
    } catch (fallo) {
      toast.error(fallo instanceof ApiError ? fallo.message : "no se pudo cambiar");
    } finally {
      setOcupado(false);
    }
  };

  const elegir = async (fichero: File | undefined) => {
    if (!fichero) return;
    if (!fichero.type.startsWith("image/")) {
      toast.error("tiene que ser una imagen");
      return;
    }
    if (fichero.size > 5 * 1024 * 1024) {
      toast.error("la foto pesa más de 5 MB", {
        description: "Se va a pintar en chapas pequeñas: con menos sobra.",
      });
      return;
    }

    setOcupado(true);
    try {
      const url = await uploadAvatar(fichero);
      setVistaPrevia(url);
      // La sesión también, porque el avatar se lee de ahí en la barra.
      await refresh();
      toast.success("foto actualizada");
    } catch (fallo) {
      toast.error(fallo instanceof ApiError ? fallo.message : "no se pudo subir la foto");
    } finally {
      setOcupado(false);
      // Se limpia el campo para que volver a elegir EL MISMO fichero dispare el
      // evento: si no, corregir una foto mal recortada y volver a elegirla no
      // hace nada, y parece que la aplicación la ignora.
      if (entrada.current) entrada.current.value = "";
    }
  };

  const quitar = async () => {
    setOcupado(true);
    try {
      await api.delete("/me/avatar");
      setVistaPrevia(null);
      await refresh();
      toast.success("foto quitada");
    } catch (fallo) {
      toast.error(fallo instanceof ApiError ? fallo.message : "no se pudo quitar");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div>
      {/* LAS DOS CARAS A LA VEZ, y por eso el personaje se pide aunque no se
          esté usando. Ofrecer «usa tu personaje» sin enseñarlo obliga a elegir
          a ciegas, ir a DevVerse a verlo y volver — y quien hace eso dos veces
          deja de tocarlo. */}
      <div className="flex flex-wrap gap-2">
        <OpcionDeCara
          elegida={!usaPersonaje}
          titulo="Una foto"
          disabled={ocupado}
          onElegir={() => void elegirFuente(false)}
        >
          {actual ? (
            // eslint-disable-next-line @next/next/no-img-element -- la URL
            // viene firmada y caduca; el optimizador de Next no puede con eso.
            <img src={actual} alt="" className="size-full object-cover" />
          ) : (
            <span className="font-display text-base font-semibold text-accent-bright">
              {iniciales(user?.displayName || "?")}
            </span>
          )}
        </OpcionDeCara>

        <OpcionDeCara
          elegida={usaPersonaje}
          titulo="Tu personaje"
          disabled={ocupado || !personaje}
          onElegir={() => void elegirFuente(true)}
        >
          {personaje ? (
            <CaraDePersonaje look={personaje} tamano={40} />
          ) : (
            <span className="text-[10px] text-faint">…</span>
          )}
        </OpcionDeCara>
      </div>

      <input
        ref={entrada}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        hidden
        onChange={(e) => void elegir(e.target.files?.[0])}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Boton
          variante="fantasma"
          tamano="sm"
          icono={<ImagePlus size={14} />}
          cargando={ocupado}
          onClick={() => entrada.current?.click()}
        >
          {actual ? "Cambiar foto" : "Subir una foto"}
        </Boton>
        {actual && (
          <Boton variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => void quitar()}>
            Quitar la foto
          </Boton>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        {usaPersonaje
          ? "Tu personaje se dibuja al vuelo: si te cambias de ropa en DevVerse, cambia aquí también."
          : "Se ve al lado de tu nombre. Cuadrada queda mejor: se recorta al centro."}
      </p>
    </div>
  );
}

/** Una de las dos caras, para poder compararlas antes de elegir. */
function OpcionDeCara({
  elegida,
  titulo,
  disabled,
  onElegir,
  children,
}: {
  elegida: boolean;
  titulo: string;
  disabled: boolean;
  onElegir: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onElegir}
      aria-pressed={elegida}
      className={`presionable flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left
        transition-colors disabled:opacity-60 ${
          elegida ? "border-accent/50 bg-accent-soft/40" : "border-line hover:border-line-strong"
        }`}
    >
      <span
        aria-hidden
        className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border
          border-line-strong bg-accent-soft/70"
      >
        {children}
      </span>
      <span className="text-xs font-medium text-ink">{titulo}</span>
    </button>
  );
}

/**
 * El huso horario.
 *
 * POR QUÉ IMPORTA, QUE NO ES OBVIO. Sin él, todo lo que el servidor cuenta por
 * días o por semanas va en UTC — y en UTC, lo que se cerró un domingo por la
 * tarde en Bogotá cuenta en la semana SIGUIENTE. El hito no se pierde: aparece
 * en la casilla equivocada, y la pantalla se ve perfectamente normal. Eso ya
 * pasó una vez con el embudo y el panel.
 *
 * Hasta ahora lo tapaba el navegador, que manda el suyo en cada petición. Pero
 * eso solo funciona cuando hay un navegador delante: ni el asistente, ni un
 * correo, ni un aviso que el servidor mande por su cuenta tienen a quién
 * preguntárselo.
 *
 * LA LISTA LA PONE EL NAVEGADOR y no nosotros: `Intl.supportedValuesOf` conoce
 * la de verdad y se actualiza con él. Una lista escrita a mano envejece, y el
 * día que un país cambie sus reglas tendríamos una copia vieja diciendo que un
 * huso que existe no existe.
 *
 * Y SE OFRECE EL DEL NAVEGADOR DE UN CLIC, porque es el acierto en el 99 % de
 * los casos: quien abre esto está donde está. Buscar «America/Bogota» entre
 * cuatrocientos nombres para acabar eligiendo el que ya se sabía es trabajo
 * inventado.
 */
function SelectorDeHuso({
  valor,
  onCambiar,
}: {
  valor: string;
  onCambiar: (v: string) => void;
}) {
  // En estado y no calculado al vuelo: `Intl` solo existe en el navegador, y
  // leerlo al renderizar daría una pantalla en el servidor y otra al hidratar.
  const [husos, setHusos] = useState<string[]>([]);
  const [delNavegador, setDelNavegador] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDelNavegador(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
      // `supportedValuesOf` no existe en todos los navegadores. Si no está, se
      // queda la lista vacía y abajo se cae a un campo de texto, que sigue
      // funcionando — el servidor valida contra la lista de Postgres de todos
      // modos.
      const conLista = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
      setHusos(conLista.supportedValuesOf?.("timeZone") ?? []);
    } catch {
      // Un navegador que no sabe dónde está no es motivo para romper la página.
    }
  }, []);

  const ahora = valor
    ? new Date().toLocaleTimeString("es-ES", {
        timeZone: valor,
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div>
      <Rotulo className="mb-1.5 block">Huso horario</Rotulo>

      {husos.length > 0 ? (
        <select
          value={valor}
          aria-label="Huso horario"
          onChange={(e) => onCambiar(e.target.value)}
          className="w-full rounded-lg border border-line bg-canvas/60 px-2.5 py-1.5 text-sm text-ink"
        >
          <option value="">Sin decir — se usa UTC</option>
          {husos.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      ) : (
        <Field
          label=""
          value={valor}
          onChange={onCambiar}
          maxLength={60}
          placeholder="America/Bogota"
        />
      )}

      <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
        {ahora ? `Ahí son las ${ahora}. ` : ""}
        Sin esto, el diario y los recuentos por semana van en UTC — y en UTC lo
        que cierras un domingo por la tarde cuenta en la semana siguiente.
        {delNavegador && delNavegador !== valor && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => onCambiar(delNavegador)}
              className="presionable text-accent-bright underline underline-offset-2"
            >
              Usar el de este navegador ({delNavegador})
            </button>
          </>
        )}
      </p>
    </div>
  );
}

function Perfil() {
  const { user, refresh } = useSession();
  const [nombre, setNombre] = useState("");
  const [cargo, setCargo] = useState("");
  const [huso, setHuso] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [reenviando, setReenviando] = useState(false);

  // Se siembra desde la sesión cuando llega, y no se vuelve a pisar: si se
  // reasignara en cada renderizado, escribir en el campo sería imposible.
  useEffect(() => {
    if (!user) return;
    setNombre(user.displayName ?? "");
    setCargo(user.title ?? "");
    setHuso(user.timezone ?? "");
  }, [user]);

  const limpio = nombre.trim();
  const cambiado =
    Boolean(user) &&
    (limpio !== (user?.displayName ?? "") ||
      cargo.trim() !== (user?.title ?? "") ||
      huso !== (user?.timezone ?? ""));

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
      await api.patch("/me/profile", {
        displayName: limpio,
        title: cargo.trim(),
        timezone: huso,
      });
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

      <div className="mt-4">
        <FotoDePerfil />
      </div>

      <div className="mt-4 flex items-start gap-3.5">
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

          <SelectorDeHuso valor={huso} onCambiar={setHuso} />

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
