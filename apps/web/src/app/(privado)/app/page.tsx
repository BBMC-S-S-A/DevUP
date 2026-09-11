"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { toast } from "sonner";
import { LogoAnimado } from "@/components/marca/LogoAnimado";
import { Rotulo } from "@/components/ui/Superficies";
import { type Organization, type Workspace, api } from "@/lib/api";
import { leerUltimoEspacio } from "@/lib/ultimo-espacio";

/**
 * `/app` ya no es una pantalla: es la puerta.
 *
 * ANTES ERA UN MENÚ DE MENÚS. Lo primero que veía quien entraba era una lista de
 * organizaciones, cada una repitiendo los mismos seis botones — con tres
 * organizaciones, dieciocho botones con seis nombres. Una lista de sitios a los
 * que ir, en vez del trabajo. Y como era el aterrizaje obligatorio, cambiar de
 * espacio de trabajo pasaba siempre por aquí: volver al principio y volver a
 * entrar, que es la ventana dentro de la ventana.
 *
 * Ahora entrar te deja donde estabas. La lista sigue existiendo, con nombre
 * propio, en `/app/organizaciones`: es donde se crean organizaciones y espacios
 * y se invita a gente, y ahí sí es el contenido correcto.
 *
 * POR QUÉ LA DECISIÓN SE TOMA AQUÍ Y NO EN EL SERVIDOR. Lo último que se abrió
 * es de este navegador, no de la cuenta: la misma persona en el portátil y en
 * el ordenador de la oficina está en cosas distintas, y guardarlo en el
 * servidor haría que uno mandara sobre el otro. Por eso vive en el navegador.
 * Y por eso no se valida antes de usarlo: validar cuesta una ronda de
 * peticiones en el gesto más repetido de la aplicación, y el caso raro ya está
 * cubierto río abajo.
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
    let vigente = true;

    // Con recuerdo se va directo, SIN PREGUNTAR NADA. Comprobar antes que ese
    // espacio sigue siendo tuyo cuesta una petición más otra por organización,
    // y eso es un giro visible cada vez que se abre la aplicación — el gesto
    // más repetido que hay. El caso raro —te sacaron del espacio, o se borró—
    // no queda desatendido: el armazón del espacio ya lo cuenta con su salida
    // a la lista. Se paga la vez que falla, no todas las que funciona.
    const recordado = leerUltimoEspacio();
    if (recordado) {
      router.replace(`/app/w/${recordado}`);
      return;
    }

    void (async () => {
      const { organizations } = await api
        .get<{ organizations: Organization[] }>("/organizations")
        .catch(() => ({ organizations: [] as Organization[] }));

      // Sin organizaciones no hay nada que abrir: la lista es, esta vez sí, lo
      // que hay que ver — es donde se crea la primera.
      if (!organizations.length) {
        if (vigente) router.replace("/app/organizaciones");
        return;
      }

      const listas = await Promise.all(
        organizations.map((o) =>
          api
            .get<{ workspaces: Workspace[] }>(`/organizations/${o.id}/workspaces`)
            .catch(() => ({ workspaces: [] as Workspace[] })),
        ),
      );
      const espacios = listas.flatMap((l) => l.workspaces);
      if (!vigente) return;

      // Sin recuerdo —primera vez, o navegador nuevo— se entra al primero que
      // haya. Y si no hay ninguno, a la lista: ahí es donde se crea.
      const destino = espacios[0] ?? null;
      router.replace(destino ? `/app/w/${destino.id}` : "/app/organizaciones");
    })();

    return () => {
      vigente = false;
    };
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

