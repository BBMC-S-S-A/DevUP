"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/ui/Logo";
import { useSession } from "@/lib/session";

export default function Home() {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/app" : "/login");
  }, [user, loading, router]);

  // Esta pantalla solo existe el tiempo de resolver la sesión, pero es el
  // primer fotograma del producto: una línea de texto suelta en negro se lee
  // como una página rota, la marca encendida se lee como algo arrancando.
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-6">
      <div className="rejilla pointer-events-none absolute inset-0" />
      <div className="relative flex flex-col items-center gap-4">
        <Logo size={44} animated />
        <p className="flex items-center gap-2 font-mono text-xs text-faint">
          <span className="animate-pulse-slow size-1.5 rounded-full bg-accent" />
          cargando…
        </p>
      </div>
    </main>
  );
}
