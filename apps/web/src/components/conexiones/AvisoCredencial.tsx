"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRecurso } from "@/lib/datos";

/**
 * «La conexión con GitHub ya no vale».
 *
 * POR QUÉ EXISTE. Cuando el token de GitHub deja de valer, las pantallas que
 * leen un repositorio —Auditoría, Base de datos— enseñan sus errores de
 * siempre: uno por bloque, todos iguales, y ninguno dice que lo que hay que
 * hacer es reconectar. Pasó de verdad el 16 de septiembre y la salida fue
 * deducirlo y volver a autenticarse a ciegas.
 *
 * LA API YA SABÍA CONTESTARLO: `/connections/health` comprueba cada credencial
 * contra su proveedor, y existía sin que la llamara nadie en todo el web.
 *
 * ES UNA PIEZA Y NO TRES COPIAS a propósito. Son dos las pantallas que lo
 * necesitan hoy y serán tres mañana; tres copias de «pregunta la salud y pinta
 * el aviso» divergen a la tercera semana, y la que se queda vieja es la que
 * deja de avisar — que es justo el fallo que esto viene a cerrar.
 *
 * SOLO PREGUNTA CUANDO ALGO HA FALLADO. Comprobar una credencial es una llamada
 * saliente a GitHub: hacerla en cada visita sería gastar cupo para contestar
 * casi siempre que sí.
 */
export function AvisoCredencialGithub({
  workspaceId,
  /** Algo que lee GitHub acaba de fallar. Sin esto no se pregunta nada. */
  activo,
  className = "",
}: {
  workspaceId: string;
  activo: boolean;
  className?: string;
}) {
  const salud = useRecurso<{ health: Record<string, { ok: boolean; detalle?: string }> }>(
    activo ? `/workspaces/${workspaceId}/connections/health` : null,
    { frescura: 60_000 },
  );

  const rota = Object.values(salud.datos?.health ?? {}).some((estado) => estado && !estado.ok);
  if (!activo || !rota) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn/10
        px-3.5 py-3 ${className}`}
    >
      <TriangleAlert size={16} className="shrink-0 text-warn" />
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-warn">
        La conexión con GitHub ya no vale. {/* Lo que no es obvio, dicho: */}
        No caduca sola —la revoca GitHub, o alguien desde su cuenta— así que no hay que esperar a
        que se arregle. Hasta que se reconecte, no se puede leer el repositorio.
      </p>
      <Link
        href={`/app/w/${workspaceId}/github`}
        className="presionable shrink-0 rounded-lg border border-warn/40 px-2.5 py-1 text-xs
          font-medium text-warn hover:bg-warn/15"
      >
        Reconectar GitHub
      </Link>
    </div>
  );
}
