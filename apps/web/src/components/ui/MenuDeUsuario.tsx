"use client";

import { KeyRound, LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SelectorPresencia } from "@/components/ui/SelectorPresencia";
import { SelectorTema } from "@/components/ui/SelectorTema";
import { Rotulo } from "@/components/ui/Superficies";
import { useConfirmar } from "@/components/ui/Confirmar";
import { useSession } from "@/lib/session";

/**
 * Todo lo tuyo en un sitio: quién eres, cómo se ve, y cómo salir.
 *
 * POR QUÉ EL BOTÓN DE SALIR NO PUEDE ESTAR SUELTO. Estaba a la intemperie en el
 * pie de la barra, al lado del nombre de la organización y del espacio, y ahí
 * un icono de puerta no dice «cerrar sesión»: **dice «salir de aquí»**. Puesto
 * junto a un workspace, lo que parece es que te saca del workspace. Es un botón
 * irreversible —te deja fuera de la aplicación— disfrazado de navegación.
 *
 * Guardado dentro del menú de tu propia cuenta ya no puede confundirse: para
 * llegar a él hay que abrir tu perfil, que es donde se busca cerrar sesión en
 * cualquier aplicación.
 *
 * Y ADEMÁS PIDE CONFIRMACIÓN, por lo mismo: cerrar sesión con las llaves de
 * agente y la clave de IA dentro no es «volver atrás», y quien lo pulsa por
 * error tiene que volver a entrar. Es barato preguntarlo una vez.
 *
 * EL ESTADO Y EL TEMA SE MUDAN AQUÍ. Estaban en el pie ocupando dos filas fijas
 * de una barra que ya tiene diecisiete destinos, y son cosas que se tocan una
 * vez al día como mucho.
 */
export function MenuDeUsuario({ orgId }: { orgId?: string }) {
  const { user, signOut } = useSession();
  const confirmar = useConfirmar();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  const salir = async () => {
    setAbierto(false);
    const ok = await confirmar({
      titulo: "¿Cerrar sesión?",
      descripcion:
        "Se cierra en este navegador. Tus llaves de agente y tu clave de IA siguen donde estaban.",
      accion: "Cerrar sesión",
      peligro: true,
    });
    if (ok) await signOut();
  };

  return (
    <div ref={caja} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        aria-haspopup="menu"
        className="presionable -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-xl px-1 py-1 text-left hover:bg-raised/60"
      >
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong
            bg-raised font-display text-[11px] font-semibold text-muted"
        >
          {(user?.displayName ?? "?").trim().charAt(0).toUpperCase()}
        </span>
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

      {abierto && (
        <div
          role="menu"
          // Hacia arriba: este menú vive pegado al borde inferior de la barra,
          // y abriéndolo hacia abajo se saldría de la pantalla entero.
          className="devup-emerge panel-emergente absolute bottom-full left-0 right-0 z-50 mb-2 rounded-xl p-2"
        >
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <Rotulo>Estado</Rotulo>
            <SelectorPresencia />
          </div>
          <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
            <Rotulo>Tema</Rotulo>
            <SelectorTema />
          </div>

          <span aria-hidden className="my-1 block h-px bg-line" />

          {orgId && (
            <>
              <Link
                href={`/app/o/${orgId}/cuenta`}
                onClick={() => setAbierto(false)}
                className="presionable flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink hover:bg-raised/70"
              >
                <UserRound size={13} className="shrink-0 text-faint" />
                Mi perfil
              </Link>
              <Link
                href={`/app/o/${orgId}/cuenta`}
                onClick={() => setAbierto(false)}
                className="presionable flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink hover:bg-raised/70"
              >
                <KeyRound size={13} className="shrink-0 text-faint" />
                Conexiones de agente
              </Link>
              <span aria-hidden className="my-1 block h-px bg-line" />
            </>
          )}

          <button
            type="button"
            onClick={() => void salir()}
            className="presionable flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted hover:bg-danger/10 hover:text-danger"
          >
            <LogOut size={13} className="shrink-0" />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
