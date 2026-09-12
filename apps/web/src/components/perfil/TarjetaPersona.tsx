"use client";

import { CircleDot, ClipboardList } from "lucide-react";
import Link from "next/link";
import { type BoardColumn, type OrganizationMember } from "@/lib/api";
import { Dialogo, Rotulo } from "@/components/ui/Superficies";
import { fechaLarga, iniciales } from "@/lib/fechas";
import { useRecurso } from "@/lib/datos";

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
        <span
          aria-hidden
          className="grid size-14 shrink-0 place-items-center rounded-2xl border border-line-strong
            bg-accent-soft/70 font-display text-lg font-semibold text-accent-bright"
        >
          {iniciales(miembro.displayName)}
        </span>

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
    </Dialogo>
  );
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
