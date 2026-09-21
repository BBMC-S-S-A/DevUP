"use client";

import { Building2, Hand, Hourglass, Loader2, Plus, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Boton } from "@/components/ui/Boton";
import { Field } from "@/components/ui/Field";
import { Cargando, Fallo, Pagina } from "@/components/ui/Pagina";
import { EstadoVacio, Rotulo, Tarjeta } from "@/components/ui/Superficies";
import { Miembros } from "@/components/organizacion/Miembros";
import { Marcador } from "@/components/puntos/Marcador";
import { IconoDeTipo, tonoDePrioridad } from "@/components/tasks/ficha";
import { fechaCorta } from "@/lib/fechas";
import { useOrgId } from "@/lib/workspace-context";
import { useRecurso } from "@/lib/datos";
import { useSession } from "@/lib/session";
import { ApiError, api, type OrganizationMember, type TipoDeTarea } from "@/lib/api";

/**
 * La casa de la organización: cómo va, quién la mueve y qué no tiene dueño.
 *
 * ANTES ERA UN ÍNDICE. Enseñaba la lista de espacios de trabajo bajo el título
 * «Espacios de trabajo», que es casi lo único que no hace falta saber aquí: los
 * espacios ya están en el menú lateral, a un clic, y repetirlos en el centro
 * gasta la mejor posición del producto en un índice.
 *
 * Y ERA EL SÍNTOMA DE ALGO MÁS GORDO. DevUP tiene tres niveles —persona,
 * organización, espacio— y ninguno tenía casa: `/app` era una redirección al
 * último espacio, la raíz de un espacio otra redirección al canal general, y
 * esto una lista. La jerarquía que promete el riel no existía en el producto.
 * Decidido el 20 de septiembre: es un sistema de carpetas, y **una carpeta que
 * se abre enseña lo que tiene dentro**.
 *
 * LA API YA ESTABA ENTERA Y NO LA LLAMABA NADIE. `GET
 * /organizations/:id/panorama` lleva desde su migración devolviendo esto en una
 * sola petición, con el porqué de cada trozo escrito en `lib/panorama.ts`. Lo
 * único que faltaba era la pantalla — el mismo caso que «Inicio» y que la red
 * del proyecto, y por eso conviene decirlo: aquí lo caro no ha sido construir,
 * ha sido darse cuenta de lo que ya estaba construido.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * EL ORDEN DE LA PANTALLA ES UNA OPINIÓN. Primero lo que no tiene dueño, y no
 * porque sea lo más grave: porque es lo único de aquí que se puede ACCIONAR.
 * «Doce tareas pendientes» informa; «tres tareas que no tiene nadie» pide algo,
 * y lo que pide siempre es lo mismo —repartirlas—. Una portada que empieza por
 * lo que se puede hacer se abre por la mañana; una que empieza por cifras se
 * abre una vez.
 *
 * NO HAY RECUENTOS DE ADORNO. La pantalla anterior tenía «ORGANIZACIONES 02 /
 * WORKSPACES 05» en la mejor franja de la página, y nadie decide nada distinto
 * sabiendo que tiene dos. Los números que quedan van pegados a la cosa que
 * cuentan y sirven para elegir: cuatro pendientes y nada cerrado esta semana no
 * se lee igual que cuatro pendientes y once cerradas.
 *
 * EL ESTADO DE ALGUIEN ES LO QUE ESA PERSONA ELIGIÓ, nunca una deducción. La
 * tentación de una portada con puntitos verdes es la contraria —deducir «en
 * línea» de si hay una pestaña abierta— y un estado adivinado miente: dice
 * «disponible» de quien salió a comer con el portátil abierto, y enseña a no
 * fiarse de él, que es peor que no tenerlo.
 *
 * LO QUE TODAVÍA NO HACE: invitar y retirar desde aquí. Los dos gestos viven
 * hoy dentro de los ajustes de la organización, escritos a mano en una pantalla
 * de 797 líneas, y sacarlos de ahí es una mudanza con su propio riesgo — no un
 * trozo de esta. Mientras tanto, la sección de la gente lleva la salida a donde
 * están.
 */

type Espacio = {
  id: string;
  nombre: string;
  pendientes: number;
  cerradasReciente: number;
  personas: number;
  ultimoMovimiento: string | null;
};

/**
 * El panorama sigue trayendo a la gente y ya no se pinta con ella: la lista la
 * pone `Miembros`, que además sabe invitar y retirar. Se deja declarado porque
 * describe lo que contesta la API, y quitarlo haría que la siguiente pantalla
 * que lo necesite tenga que volver a leer el SQL para saber qué llega.
 */
type Persona = {
  id: string;
  nombre: string;
  avatar: string | null;
  estado: "available" | "busy_open" | "do_not_disturb" | null;
  oficio: string | null;
  permiso: "owner" | "admin" | "member";
  enQue: string[];
};

type Tarea = {
  id: string;
  titulo: string;
  prioridad?: number;
  tipo?: TipoDeTarea | null;
  espacio: string;
  espacioId?: string;
  responsable?: string | null;
  ultimoToque?: string | null;
  creada?: string;
};

type Panorama = {
  dias: number;
  espacios: Espacio[];
  gente: Persona[];
  enMarcha: Tarea[];
  atascadas: Tarea[];
  sinDuenio: Tarea[];
};

export default function OrganizacionPage() {
  const orgId = useOrgId();
  const panorama = useRecurso<Panorama>(`/organizations/${orgId}/panorama`);
  const datos = panorama.datos;

  return (
    <Pagina
      titulo="Resumen"
      rotulo="cómo va la organización y quién la mueve"
      icono={<Building2 size={18} />}
      // Se llena de contenido: tarjetas de gente y listas de tareas en paralelo.
      ancho="trabajo"
    >
      {panorama.error ? (
        <Fallo onReintentar={() => void panorama.recargar()}>{panorama.error}</Fallo>
      ) : !datos ? (
        <Cargando etiqueta="Mirando cómo va la organización" />
      ) : (
        <div className="space-y-7">
          <SinDuenio tareas={datos.sinDuenio} />

          <LaGente orgId={orgId} />

          <div className="grid gap-5 lg:grid-cols-2">
            <EnMarcha tareas={datos.enMarcha} />
            <Atascadas tareas={datos.atascadas} dias={datos.dias} />
          </div>

          <Espacios espacios={datos.espacios} dias={datos.dias} />

          {/* Crear un espacio SE QUEDA AQUÍ. Era lo único accionable de la
              pantalla anterior y perderlo al reescribirla habría sido cambiar
              una lista inútil por una portada incompleta. Va debajo de los
              proyectos porque es donde se mira antes de decidir que falta uno. */}
          <NuevoEspacio orgId={orgId} onCreado={() => void panorama.recargar()} />

          {/* El marcador se queda de la pantalla anterior: los puntos se ganan
              solos al cerrar tareas, y una pantalla a la que hay que acordarse
              de ir no la abre nadie. Va abajo porque celebra, y lo que celebra
              no es lo primero que hay que mirar por la mañana. */}
          <Marcador orgId={orgId} />
        </div>
      )}
    </Pagina>
  );
}

/* -------------------------------------------------------------------------- */

function Seccion({
  titulo,
  cuantas,
  children,
}: {
  titulo: string;
  cuantas?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <Rotulo>{titulo}</Rotulo>
        {cuantas !== undefined && cuantas > 0 && (
          <span className="font-mono text-[11px] tabular-nums text-faint">{cuantas}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Lo que no tiene dueño, arriba del todo.
 *
 * Cuando está vacío NO se calla: decirlo es una buena noticia y cuesta una
 * línea. Un hueco en blanco se lee como «esto no ha cargado».
 */
function SinDuenio({ tareas }: { tareas: Tarea[] }) {
  if (tareas.length === 0) {
    return (
      <Tarjeta className="flex items-center gap-2.5 px-4 py-3">
        <Hand size={15} className="shrink-0 text-live" />
        <p className="text-xs text-muted">Todo lo que está abierto tiene a alguien detrás.</p>
      </Tarjeta>
    );
  }

  return (
    <Seccion titulo="No lo tiene nadie" cuantas={tareas.length}>
      <ul className="space-y-1.5">
        {tareas.map((t) => (
          <li key={t.id}>
            <Link
              href={`/app/w/${t.espacioId}/board`}
              className="presionable flex items-center gap-3 rounded-xl border border-line bg-surface/60
                px-3.5 py-2.5 hover:border-line-strong hover:bg-raised/60"
            >
              {t.tipo && <IconoDeTipo tipo={t.tipo} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{t.titulo}</span>
                <span className="mt-0.5 block text-[11px] text-faint">
                  {t.espacio}
                  {t.creada ? ` · apuntada el ${fechaCorta(t.creada)}` : ""}
                </span>
              </span>
              {/* Solo urgente y alta: el resto de prioridades no cambian a
                  quién hay que darle esto, que es la decisión de esta lista. */}
              {(() => {
                const tono = t.prioridad === undefined ? null : tonoDePrioridad(t.prioridad);
                return tono && t.prioridad! > 1 ? (
                  <span
                    className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] ${tono.clase}`}
                  >
                    {tono.texto}
                  </span>
                ) : null;
              })()}
            </Link>
          </li>
        ))}
      </ul>
    </Seccion>
  );
}

/**
 * La gente, con lo que se puede hacer con ella.
 *
 * AQUÍ HABÍA TARJETAS DE SOLO LECTURA, dibujadas con lo que trae el panorama,
 * y debajo un enlace a Ajustes para invitar o retirar a alguien. Enseñaba a la
 * gente en el sitio correcto y mandaba a otra pantalla para tocarla, que es la
 * mitad de un gesto.
 *
 * Ahora es el mismo componente que usa Ajustes: se extrajo de allí en vez de
 * copiarse, porque dos copias del alta de miembros se separan y la que se
 * queda atrás es la que pierde una comprobación de permisos — que aquí
 * significa dar de alta a alguien como administrador sin que nadie lo revise.
 *
 * LO QUE SE PIERDE AL CAMBIARLAS, dicho: las tarjetas del panorama decían «en
 * qué anda» cada cual, cruzando todos los espacios. Esto no lo dice en la
 * lista — lo dice al pulsar a alguien, en su ficha, junto a lo último que ha
 * tocado. Un dato menos de un vistazo a cambio de poder hacer algo con él.
 */
function LaGente({ orgId }: { orgId: string }) {
  const { user } = useSession();
  const equipo = useRecurso<{ members: OrganizationMember[] }>(
    `/organizations/${orgId}/members`,
  );
  const members = equipo.datos?.members ?? null;
  const yo = members?.find((m) => m.userId === user?.id);
  const administro = yo ? yo.role === "owner" || yo.role === "admin" : false;

  return (
    <Miembros
      orgId={orgId}
      members={members}
      yo={user?.id ?? null}
      administro={administro}
      onChange={equipo.recargar}
    />
  );
}

function EnMarcha({ tareas }: { tareas: Tarea[] }) {
  return (
    <Seccion titulo="En marcha" cuantas={tareas.length}>
      {tareas.length === 0 ? (
        <EstadoVacio
          icono={<Users size={18} />}
          titulo="Nada empezado"
          pista="Lo que se mueva de la primera columna de cualquier tablero aparece aquí."
        />
      ) : (
        <ul className="space-y-1.5">
          {tareas.slice(0, 8).map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface/40 px-3.5 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{t.titulo}</span>
                <span className="mt-0.5 block truncate text-[11px] text-faint">
                  {t.espacio}
                  {t.responsable ? ` · ${t.responsable}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}

/**
 * Atascada NO es vencida, y por eso es una sección aparte.
 *
 * Una tarea sin fecha no vence nunca y puede llevar tres semanas quieta. Es
 * justo la que hay que sacar a la superficie, porque nadie va a ir a buscarla.
 */
function Atascadas({ tareas, dias }: { tareas: Tarea[]; dias: number }) {
  return (
    <Seccion titulo={`Sin tocar en ${dias} días`} cuantas={tareas.length}>
      {tareas.length === 0 ? (
        <EstadoVacio
          icono={<Hourglass size={18} />}
          titulo="Nada parado"
          pista="Todo lo abierto se ha tocado esta semana."
        />
      ) : (
        <ul className="space-y-1.5">
          {tareas.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface/40 px-3.5 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{t.titulo}</span>
                <span className="mt-0.5 block truncate text-[11px] text-faint">
                  {t.espacio}
                  {t.responsable ? ` · ${t.responsable}` : " · sin responsable"}
                </span>
              </span>
              {t.ultimoToque && (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                  {fechaCorta(t.ultimoToque)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}

function Espacios({ espacios, dias }: { espacios: Espacio[]; dias: number }) {
  if (espacios.length === 0) {
    return (
      <EstadoVacio
        icono={<Users size={20} />}
        titulo="Todavía no hay ningún espacio"
        pista="Un espacio de trabajo es un proyecto: sus canales, sus archivos, su tablero y su repositorio. Se crea desde el menú lateral."
      />
    );
  }

  return (
    <Seccion titulo="Los proyectos" cuantas={espacios.length}>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {espacios.map((e) => (
          <Link
            key={e.id}
            href={`/app/w/${e.id}`}
            className="presionable rounded-2xl border border-line bg-surface/60 p-4
              hover:border-line-strong hover:bg-raised/60"
          >
            <p className="truncate text-sm font-medium text-ink">{e.nombre}</p>
            {/* Los dos números juntos, y no uno: cuatro pendientes con nada
                cerrado esta semana es un proyecto parado; cuatro con once
                cerradas es uno que va. Un solo número no distingue los dos. */}
            <p className="mt-1.5 text-[11px] text-faint">
              {e.pendientes} {e.pendientes === 1 ? "pendiente" : "pendientes"}
              {" · "}
              {e.cerradasReciente} {e.cerradasReciente === 1 ? "cerrada" : "cerradas"} en {dias} días
            </p>
            <p className="mt-0.5 text-[11px] text-faint">
              {e.personas} {e.personas === 1 ? "persona" : "personas"}
              {e.ultimoMovimiento ? ` · se movió el ${fechaCorta(e.ultimoMovimiento)}` : " · quieto"}
            </p>
          </Link>
        ))}
      </div>
    </Seccion>
  );
}

/**
 * Crear un espacio, y entrar directo a su canal general.
 *
 * No devuelve a esta lista: quien acaba de crear un espacio quiere escribir en
 * él, no volver a elegirlo de una lista donde ahora hay uno más. El canal
 * general se siembra al crearlo, así que hay dónde aterrizar desde el primer
 * segundo.
 */
function NuevoEspacio({ orgId, onCreado }: { orgId: string; onCreado: () => void }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [visibility, setVisibility] = useState<"shared" | "personal">("shared");
  const [creando, setCreando] = useState(false);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="presionable flex w-full items-center gap-2.5 rounded-2xl border border-dashed
          border-line px-4 py-3.5 text-sm text-faint hover:border-accent/40 hover:bg-accent-soft/20 hover:text-muted"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-dashed border-line">
          <Plus size={15} />
        </span>
        Nuevo espacio de trabajo
      </button>
    );
  }

  return (
    <Tarjeta className="p-4">
      <Rotulo>Nuevo espacio</Rotulo>
      <p className="mb-3 mt-1 text-xs leading-relaxed text-muted">
        Un proyecto con lo suyo dentro: canales, archivos, tablero y repositorio.
      </p>

      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const limpio = nombre.trim();
          if (!limpio) return;
          setCreando(true);
          try {
            const { workspace, generalChannelId } = await api.post<{
              workspace: { id: string };
              generalChannelId: string;
            }>(`/organizations/${orgId}/workspaces`, { name: limpio, visibility });
            toast.success(`Espacio «${limpio}» creado`);
            onCreado();
            router.push(`/app/w/${workspace.id}/c/${generalChannelId}`);
          } catch (caught) {
            toast.error(caught instanceof ApiError ? caught.message : "no se pudo crear el espacio");
            setCreando(false);
          }
        }}
      >
        <Field label="Nombre" value={nombre} onChange={setNombre} autoFocus maxLength={60} />

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["shared", "Compartido", "Lo ve toda la organización"],
              ["personal", "Solo mío", "No lo ve nadie más"],
            ] as const
          ).map(([valor, texto, pista]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setVisibility(valor)}
              aria-pressed={visibility === valor}
              title={pista}
              className={`presionable rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
                visibility === valor
                  ? "border-accent/50 bg-accent-soft/60 text-accent-bright"
                  : "border-line text-muted hover:border-line-strong"
              }`}
            >
              {texto}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <Boton type="submit" disabled={!nombre.trim() || creando}>
            {creando ? <Loader2 size={14} className="animate-spin" /> : null}
            Crear y entrar
          </Boton>
          <Boton type="button" variante="fantasma" onClick={() => setAbierto(false)}>
            Cancelar
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
