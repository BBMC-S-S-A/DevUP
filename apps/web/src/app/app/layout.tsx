"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ActiveCallBar } from "@/components/voice/ActiveCallBar";
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
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="animate-spin text-faint" size={20} />
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
