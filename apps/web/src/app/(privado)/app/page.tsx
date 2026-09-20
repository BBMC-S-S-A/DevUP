"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { toast } from "sonner";
import { LogoAnimado } from "@/components/marca/LogoAnimado";
import { Rotulo } from "@/components/ui/Superficies";

/**
 * `/app` no es una pantalla: es la puerta. Y la puerta da a tu casa.
 *
 * ANTES ERA UN MENÚ DE MENÚS —una lista de organizaciones repitiendo seis
 * botones cada una—, y de ahí se pasó al otro extremo: entrar te metía directo
 * en el último espacio que hubieras abierto, leyéndolo del navegador. Era
 * cómodo para SEGUIR y no servía para EMPEZAR, y además se saltaba los dos
 * niveles de arriba: la portada personal y la organización solo se veían si
 * las buscabas.
 *
 * DEVUP ANIDA: persona, organización, espacio. Una carpeta que se abre enseña
 * lo que tiene dentro, y se entra por la raíz. Así que entrar aterriza en tu
 * casa —tus organizaciones, tu gente, lo que te espera— y desde ahí se baja.
 *
 * LO QUE ESO CUESTA, DICHO: dos clics más cuando lo que querías era seguir
 * donde estabas, en el gesto más repetido de la aplicación. Se paga con el
 * atajo de la portada: «seguir donde estabas» sigue leyendo el mismo recuerdo
 * del navegador, así que el camino rápido no desaparece — deja de ser
 * obligatorio.
 *
 * Y YA NO SE PREGUNTA NADA ANTES DE REDIRIGIR. La versión anterior pedía las
 * organizaciones y sus espacios para decidir a dónde ir: una ronda de
 * peticiones por organización en cada apertura. La portada ya pide lo suyo al
 * montarse, y el caso de quien no tiene ninguna organización lo contesta ella
 * con su propio hueco vacío, que es donde se crea la primera.
 */
export default function PuertaApp() {
  return (
    <Suspense fallback={<Esperando />}>
      <Puerta />
    </Suspense>
  );
}

function Puerta() {
  const router = useRouter();
  const params = useSearchParams();

  // El callback de Spotify vuelve a `/app?spotify=…`. Se atiende aquí porque
  // aquí es donde vuelve: antes vivía en la lista de organizaciones porque la
  // lista era esta ruta, no porque tuviera nada que ver con ella.
  useEffect(() => {
    const spotify = params.get("spotify");
    if (!spotify) return;
    if (spotify === "conectado") {
      toast.success("Spotify conectado");
    } else if (spotify === "denegado") {
      toast.error("No diste permiso a Spotify");
    } else if (spotify === "estado-invalido") {
      toast.error("La conexión con Spotify caducó. Vuelve a intentarlo.");
    } else if (spotify === "fallo-canje") {
      toast.error("Spotify rechazó la conexión. Vuelve a intentarlo desde el reproductor.", {
        // El código de autorización es de un solo uso: recargar la página del
        // callback falla siempre, y hay que empezar la conexión otra vez.
        description: "Si acabas de recargar la página, empieza el proceso de nuevo.",
      });
    } else {
      toast.error("No se pudo conectar Spotify");
    }
  }, [params]);

  useEffect(() => {
    router.replace("/app/inicio");
  }, [router]);

  return <Esperando />;
}

/**
 * La espera dice qué pasa en vez de girar en silencio.
 *
 * Es la misma decisión —y la misma marca encendiéndose— que la guarda de sesión
 * de `layout.tsx`: una redirección instantánea y un giro eterno se ven igual
 * durante el primer segundo, y solo uno de los dos merece que se espere.
 */
function Esperando() {
  return (
    <div className="grid min-h-[100svh] place-items-center px-6">
      <div className="flex flex-col items-center gap-7">
        <LogoAnimado tamano={148} />
        <Rotulo>Abriendo tu espacio</Rotulo>
      </div>
    </div>
  );
}

