"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ActiveCallBar } from "@/components/voice/ActiveCallBar";
import { Logo } from "@/components/ui/Logo";
import { Rotulo } from "@/components/ui/Superficies";
import { useSession } from "@/lib/session";
import { VoiceCallProvider } from "@/lib/voice/VoiceCallProvider";

/**
 * Guarda de sesión del lado del cliente.
 *
 * No es una medida de seguridad y no pretende serlo: quien quiera puede
 * saltársela con las herramientas del navegador. Lo que protege los datos es
 * RLS en Postgres, que devuelve cero filas a quien no tiene permiso. Esto solo
 * evita enseñar una interfaz vacía a quien no ha entrado.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    // Esta pantalla es también la que ve quien no ha entrado, justo antes de
    // que el efecto de arriba lo mande al acceso. Por eso dice qué está
    // pasando en vez de girar en silencio: un giro eterno y un redirección
    // instantánea se ven igual durante el primer segundo, y solo uno de los
    // dos merece que se espere.
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="flex flex-col items-center gap-3.5">
          <Logo size={44} animated />
          <Rotulo className="flex items-center gap-2">
            <Loader2 size={11} className="animate-spin" />
            Comprobando sesión
          </Rotulo>
        </div>
      </div>
    );
  }

  return (
    <VoiceCallProvider>
      {children}
      <ActiveCallBar />
    </VoiceCallProvider>
  );
}
