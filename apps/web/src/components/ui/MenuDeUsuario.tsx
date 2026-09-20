"use client";

import { KeyRound, LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SelectorPresencia } from "@/components/ui/SelectorPresencia";
import { SelectorTema } from "@/components/ui/SelectorTema";
import { Dialogo, Rotulo } from "@/components/ui/Superficies";
import { useCerrarSesion } from "@/components/ui/cerrar-sesion";
import { Avatar } from "@/components/perfil/Avatar";
import { TarjetaPersona } from "@/components/perfil/TarjetaPersona";
import { useRecurso } from "@/lib/datos";
import { type OrganizationMember } from "@/lib/api";
import { useSession } from "@/lib/session";

/**
 * Tu cara en el pie de la barra, y lo que pasa al pulsarla.
 *
 * PULSARLA ABRE TU FICHA, NO UN MENÚ DE AJUSTES. Es lo que se pidió y es lo
 * correcto: al pulsar a un compañero sale quién es y en qué anda —`TarjetaPersona`,
 * la misma que se abre desde el tablero, desde la actividad y desde su muñeco
 * en DevVerse—, y al pulsarte a ti mismo salía una lista de opciones. Dos
 * gestos iguales con dos resultados distintos, y encima el que no enseñaba
 * nada era el tuyo: no había forma de ver tu propio perfil **como lo ve la
 * gente**, que es justo lo que uno quiere comprobar antes de que lo vea nadie.
 *
 * NO SE CONSTRUYÓ NADA PARA ESTO. La tarjeta ya existía y ya se usaba en ocho
 * sitios; lo único que le faltaba era un hueco para lo que se puede hacer
 * cuando la ficha es la de uno mismo (`pie`). Una segunda tarjeta «pero mía»
 * habría empezado igual y se habría separado en dos versiones al primer
 * cambio.
 *
 * QUÉ VA EN ESE HUECO, Y POR QUÉ ESTO Y NO MÁS. El estado y el tema, que se
 * tocan una vez al día y estaban ocupando dos filas fijas de una barra con
 * diecisiete destinos. La entrada a la configuración de la cuenta, que es
 * donde viven la foto, el personaje, las conexiones de agente y las
 * contraseñas. Y la salida.
 *
 * LA SALIDA SIGUE AQUÍ DENTRO Y SIGUE PREGUNTANDO. Estuvo suelta en el pie, al
 * lado del nombre del espacio, y ahí un icono de puerta no dice «cerrar
 * sesión»: dice «salir de aquí». La confirmación vive en `useCerrarSesion`,
 * compartida con los otros dos caminos que llevan al mismo sitio.
 *
 * SIN `orgId` NO HAY FICHA, y no es un fallo que haya que disculpar: la ficha
 * cuenta desde cuándo estás en la organización y con qué papel. Sin
 * organización esos dos datos no existen, y rellenarlos a ojo sería inventarse
 * la única parte que nadie puede comprobar. En ese caso salen solo las
 * acciones.
 */
export function MenuDeUsuario({ orgId, workspaceId }: { orgId?: string; workspaceId?: string }) {
  const { user } = useSession();
  const cerrarSesion = useCerrarSesion();
  const [abierto, setAbierto] = useState(false);

  // Solo al abrir: la barra está en todas las pantallas y la lista de miembros
  // no hace falta hasta que alguien se pulsa a sí mismo. `useRecurso` con clave
  // nula no llama a nada.
  const equipo = useRecurso<{ members: OrganizationMember[] }>(
    abierto && orgId ? `/organizations/${orgId}/members` : null,
  );
  const yo = equipo.datos?.members.find((m) => m.userId === user?.id) ?? null;

  const cerrar = () => setAbierto(false);

  const acciones = (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 px-1">
        <Rotulo>Estado</Rotulo>
        <SelectorPresencia />
      </div>
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <Rotulo>Tema</Rotulo>
        <SelectorTema />
      </div>

      {orgId && (
        <>
          <Link
            href={`/app/o/${orgId}/cuenta`}
            onClick={cerrar}
            className="presionable flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink hover:bg-raised/70"
          >
            <UserRound size={13} className="shrink-0 text-faint" />
            Configurar mi cuenta
          </Link>
          {/* Lleva al mismo sitio que la de arriba —las llaves viven dentro de
              la cuenta— y se queda porque es lo que se busca por su nombre:
              quien viene a revocar una llave no piensa «configuración». */}
          <Link
            href={`/app/o/${orgId}/cuenta`}
            onClick={cerrar}
            className="presionable flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink hover:bg-raised/70"
          >
            <KeyRound size={13} className="shrink-0 text-faint" />
            Conexiones de agente
          </Link>
        </>
      )}

      <button
        type="button"
        onClick={() => {
          cerrar();
          void cerrarSesion();
        }}
        className="presionable flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted hover:bg-danger/10 hover:text-danger"
      >
        <LogOut size={13} className="shrink-0" />
        Cerrar sesión
      </button>
    </div>
  );

  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-haspopup="dialog"
        className="presionable -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-xl px-1 py-1 text-left hover:bg-raised/60"
      >
        <Avatar userId={user?.id ?? ""} nombre={user?.displayName ?? "?"} tamano={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-ink" title={user?.displayName}>
            {user?.displayName}
          </span>
          <span className="block truncate text-[10px] text-faint" title={user?.email}>
            {user?.email}
          </span>
        </span>
        <Settings size={14} className="shrink-0 text-faint" />
      </button>

      {abierto &&
        (yo ? (
          <TarjetaPersona
            miembro={yo}
            workspaceId={workspaceId}
            pie={acciones}
            onCerrar={cerrar}
          />
        ) : (
          // Mientras llega la lista, y también cuando no hay organización de la
          // que contar nada. Las acciones no dependen de esa petición, así que
          // no se hacen esperar por ella.
          <Dialogo titulo={user?.displayName ?? "Tu cuenta"} descripcion={user?.email} onCerrar={cerrar}>
            {acciones}
          </Dialogo>
        ))}
    </div>
  );
}
