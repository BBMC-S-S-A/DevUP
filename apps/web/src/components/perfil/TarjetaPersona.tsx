"use client";

import { CircleDot, ClipboardList, History } from "lucide-react";
import Link from "next/link";
import { type BoardColumn, type OrganizationMember } from "@/lib/api";
import { Dialogo, Rotulo } from "@/components/ui/Superficies";
import { fechaLarga, iniciales } from "@/lib/fechas";
import { Avatar } from "@/components/perfil/Avatar";
import { useRecurso } from "@/lib/datos";
import { useOrgIdOpcional } from "@/lib/workspace-context";
import { fraseDeRenglon, type Renglon } from "@/lib/actividad";

/**
 * Quién es alguien, al hacer clic en su nombre.
 *
 * DE DÓNDE VIENE LA IDEA. De Discord: pulsas a alguien y sale quién es sin
 * tener que ir a ninguna parte. Lo que se copia es **el gesto**, no la
 * disposición — el contenido aquí es otro. Discord contesta «¿a qué juega?»;
 * lo que hace falta en un equipo es **«¿en qué anda y le puedo interrumpir?»**,
 * que es la mitad del tiempo que se pierde preguntando a quién preguntar.
 *
 * QUÉ ENSEÑA, Y POR QUÉ ESTO Y NO MÁS:
 *  - Quién es: nombre, cargo —que lo escribe cada cual en su perfil— y su
 *    presencia, que también la pone él.
 *  - En qué anda: sus tareas sin terminar en este espacio. Se puede desde la
 *    migración 0037; antes «sin terminar» no existía como dato.
 *  - Desde cuándo está en la organización y con qué papel.
 *  - **Lo último que ha tocado aquí**, leído del registro de actividad.
 *
 * LO ÚLTIMO QUE HA TOCADO ES LO QUE MÁS CERCA ESTÁ DE CRUZAR LA LÍNEA, así que
 * va dicho: son hechos que YA se ven en el tablero —movió esta tarjeta, cerró
 * aquella—, contados en orden. Lo que NO se trae de esa ruta es el recuento por
 * verbo que también devuelve. Un «cerró 4, creó 12» al lado de la cara de
 * alguien es un marcador de rendimiento, y en cuanto un número así aparece en
 * una ficha personal ya no se puede quitar. En la auditoría ese desglose sí
 * está, y ahí tiene otro significado: se abre para revisar el trabajo, no para
 * decidir si interrumpir a alguien.
 *
 * LO QUE NO ENSEÑA, A PROPÓSITO. Nada de lo que la persona no haya puesto ella
 * misma o no sea ya visible en el tablero. Una ficha de alguien es el sitio más
 * fácil del producto para convertir una herramienta de trabajo en una de
 * vigilancia, y la diferencia está exactamente ahí: lo que hace y decidió
 * compartir, sí; cuánto tarda, cuándo se conecta y cuánto rinde, no.
 *
 * EL TABLERO SE LE PASA YA CARGADO. Quien abre esta tarjeta suele estar en una
 * pantalla que ya lo tiene —el panel, el propio tablero—, y volver a pedirlo
 * sería una consulta por cada clic para enseñar lo mismo. Si no llega, se pide.
 */
export function TarjetaPersona({
  miembro,
  workspaceId,
  columnas,
  onCerrar,
}: {
  miembro: OrganizationMember;
  /**
   * El espacio desde el que se mira, si se mira desde uno. Sin él la tarjeta
   * enseña quién es y calla lo que hace: «en qué anda» es una pregunta de
   * espacio de trabajo, y contestarla con el de otro sitio sería mentir.
   */
  workspaceId?: string;
  /** El tablero, si quien abre la tarjeta ya lo tenía a mano. */
  columnas?: BoardColumn[];
  onCerrar: () => void;
}) {
  // Solo se pide si no vino dado. `useRecurso` con clave nula no llama a nada.
  const tablero = useRecurso<{ columns: BoardColumn[] }>(
    !columnas && workspaceId ? `/workspaces/${workspaceId}/board` : null,
  );
  const disponibles = columnas ?? tablero.datos?.columns ?? [];

  const suyas = disponibles
    .filter((c) => !c.isTerminal)
    .flatMap((c) => c.tasks.filter((t) => t.assigneeId === miembro.userId).map((t) => ({ t, c })));

  return (
    <Dialogo titulo={miembro.displayName} descripcion={miembro.title ?? undefined} onCerrar={onCerrar}>
      <div className="flex items-start gap-3.5">
        {/* Redonda aquí también: una chapa que cambia de forma según la
            pantalla se lee como dos cosas distintas. */}
        <Avatar userId={miembro.userId} nombre={miembro.displayName} tamano={56} />

        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <CircleDot size={11} className="shrink-0 text-faint" />
            {ESTADO[miembro.presence]}
          </p>
          <p className="text-[11px] capitalize text-faint">{PAPEL[miembro.role]}</p>
          <p className="text-[11px] text-faint">
            En la organización desde {fechaLarga(miembro.joinedAt)}
          </p>
        </div>
      </div>

      {workspaceId && (
      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-center gap-2">
          <Rotulo>En qué anda</Rotulo>
          <span className="ml-auto font-mono text-[11px] text-faint">{suyas.length}</span>
        </div>

        {suyas.length === 0 ? (
          // Vacío honesto: puede no tener nada asignado, o tenerlo en otro
          // espacio. Decir «no está haciendo nada» sería afirmar de más.
          <p className="mt-2 text-xs leading-relaxed text-faint">
            Sin tareas sin terminar en este espacio. Puede tenerlas en otro.
          </p>
        ) : (
          <ul className="mt-2.5 space-y-1.5">
            {suyas.slice(0, 8).map(({ t, c }) => (
              <li key={t.id}>
                <Link
                  href={`/app/w/${workspaceId}/board`}
                  onClick={onCerrar}
                  className="presionable flex items-baseline gap-2 rounded-lg px-2 py-1.5 hover:bg-raised/60"
                >
                  <ClipboardList size={11} className="shrink-0 translate-y-0.5 text-faint" />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{t.title}</span>
                  <Rotulo className="shrink-0">{c.name}</Rotulo>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      <Rastro personaId={miembro.userId} />
    </Dialogo>
  );
}

/**
 * Lo último que ha tocado, del registro de actividad.
 *
 * VA A NIVEL DE ORGANIZACIÓN y no de espacio, al revés que «en qué anda». No es
 * un descuido: la ruta ya recorta por lo que quien mira puede ver —si alguien
 * trabaja en un proyecto al que yo no llego, su trabajo de ahí no aparece— y
 * contestar «¿qué ha estado haciendo?» mirando un solo espacio daría la
 * impresión de que no ha hecho nada los días que estuvo en el de al lado.
 *
 * SI FALLA NO SE DICE NADA. Es contexto al lado de lo que la ficha ya contesta;
 * una franja roja aquí estropearía la tarjeta entera por no haber podido pintar
 * un extra.
 */
function Rastro({ personaId }: { personaId: string }) {
  // Del contexto y no de una prop: la tarjeta se pinta desde seis sitios y
  // añadirle un parámetro obligatorio a todos por un bloque opcional es como
  // se propaga una firma. Sin organización —no debería pasar— no se pinta.
  const orgId = useOrgIdOpcional();
  const registro = useRecurso<{ actividad: Renglon[] }>(
    orgId ? `/organizations/${orgId}/actividad/${personaId}?dias=14` : null,
  );
  const ultimos = (registro.datos?.actividad ?? []).slice(0, 6);

  if (registro.cargando || registro.error || ultimos.length === 0) return null;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex items-center gap-2">
        <Rotulo>Lo último que ha tocado</Rotulo>
        <span className="ml-auto font-mono text-[10px] text-faint">últimos 14 días</span>
      </div>

      <ul className="mt-2.5 space-y-1.5">
        {ultimos.map((renglon) => (
          <li key={renglon.id} className="flex items-baseline gap-2 px-2">
            <History size={11} className="shrink-0 translate-y-0.5 text-faint" />
            <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
              {fraseDeRenglon(renglon)}
            </span>
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
              {fechaCorta(renglon.cuando)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Día y mes, que es lo que sitúa un hecho de hace dos semanas. */
function fechaCorta(iso: string): string {
  const cuando = new Date(iso);
  if (Number.isNaN(cuando.getTime())) return "";
  return cuando.toLocaleDateString("es", { day: "numeric", month: "short" });
}

/** Lo que la persona dijo de sí misma, en palabras y no en un punto de color. */
const ESTADO: Record<OrganizationMember["presence"], string> = {
  available: "Disponible",
  busy_open: "Ocupado, pero se le puede escribir",
  do_not_disturb: "No molestar",
};

const PAPEL: Record<OrganizationMember["role"], string> = {
  owner: "Propietario de la organización",
  admin: "Administra la organización",
  member: "Miembro",
};
