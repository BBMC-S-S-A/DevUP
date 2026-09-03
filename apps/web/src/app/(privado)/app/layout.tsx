"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { LogoAnimado } from "@/components/marca/LogoAnimado";
import { MusicaBar } from "@/components/spotify/MusicaBar";
import { ActiveCallBar } from "@/components/voice/ActiveCallBar";
import { Rotulo } from "@/components/ui/Superficies";
import { useSession } from "@/lib/session";
import { SpotifyProvider } from "@/lib/spotify/SpotifyProvider";
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
      <div className="grid min-h-[100svh] place-items-center px-6">
        <div className="flex flex-col items-center gap-7">
          {/* La marca encendiéndose hace de espera. Sustituye al logo quieto con
              un girador al lado, y no por vistosidad: el girador giraba a su
              ritmo y la marca a otro, así que eran dos relojes distintos
              diciendo lo mismo. Esta animación ya lleva su propio latido —los
              tres puntos avanzan con el recorrido de la luz—, de modo que lo que
              se mira es una sola cosa progresando. */}
          <LogoAnimado tamano={148} />
          <Rotulo>Comprobando sesión</Rotulo>
        </div>
      </div>
    );
  }

  // Los dos proveedores viven aquí y no en ninguna página: son lo que hace que
  // la llamada y la música sobrevivan a navegar por la aplicación. La música va
  // por dentro porque su barra se apoya en si hay llamada abierta para saber
  // dónde colocarse y no taparla.
  return (
    <VoiceCallProvider>
      <SpotifyProvider>
        {children}
        <ActiveCallBar />
        <MusicaBar />
      </SpotifyProvider>
    </VoiceCallProvider>
  );
}
