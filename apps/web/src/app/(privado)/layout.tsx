import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { ProveedorConfirmar } from "@/components/ui/Confirmar";
import { SessionProvider } from "@/lib/session";

/**
 * El armazón del producto.
 *
 * POR QUÉ ESTO NO ESTÁ EN EL LAYOUT RAÍZ, que es de donde se ha bajado:
 * `SessionProvider` pide `/auth/me` en cuanto monta. Mientras la aplicación era
 * lo único que había, daba igual. Con una landing pública en `/`, tenerlo
 * arriba significa una petición a la API —y un 401 previsible— en cada visita
 * anónima, incluidas las de los rastreadores. Aquí abajo solo corre para quien
 * ya está entrando al producto.
 *
 * El grupo `(privado)` no cambia ninguna URL: `/app`, `/login`, `/invitacion`,
 * `/recuperar` y `/verificar` siguen donde estaban.
 */
export const metadata: Metadata = {
  title: { absolute: "DevUP" },
  description: "Centro de mando para la operación comercial y la infraestructura técnica",
  // El producto no se indexa. Solo la landing.
  robots: { index: false, follow: false },
};

export default function LayoutPrivado({ children }: { children: ReactNode }) {
  return (
    <>
      <SessionProvider>
        <ProveedorConfirmar>{children}</ProveedorConfirmar>
      </SessionProvider>
      {/* Los avisos siguen al tema en vez de quedarse oscuros: un toast negro
          sobre una interfaz clara se lee como un error del navegador. */}
      <Toaster
        theme="system"
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: "!bg-elevated/90 !backdrop-blur-xl !border-line-strong !text-ink !font-sans",
            description: "!text-muted",
            actionButton: "!bg-accent !text-canvas",
          },
        }}
      />
    </>
  );
}
