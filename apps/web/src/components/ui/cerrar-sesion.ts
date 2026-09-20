"use client";

import { useConfirmar } from "@/components/ui/Confirmar";
import { useSession } from "@/lib/session";

/**
 * Cerrar sesión, preguntando antes. Una sola vez, para toda la aplicación.
 *
 * POR QUÉ EXISTE ESTE FICHERO. La confirmación se escribió dentro de
 * `MenuDeUsuario`, que es el pie del armazón de un espacio de trabajo. Los
 * otros dos sitios desde los que se puede salir —el pie del armazón de
 * organización y la cabecera de `/app/organizaciones`— llamaban a `signOut()`
 * directo: **un clic, sin preguntar nada**. Y en el de organización el icono
 * estaba pegado al nombre del espacio, donde una puerta no dice «cerrar
 * sesión», dice «salir de aquí».
 *
 * Así que la regla vivía en uno de los tres caminos que llevan al mismo sitio.
 * Eso no es una incoherencia de interfaz: es que en dos tercios de la
 * aplicación una acción irreversible no pedía confirmación. Sacarla aquí la
 * pone donde no se puede olvidar al añadir el cuarto.
 *
 * EL TEXTO TAMBIÉN VIVE AQUÍ, y no es un detalle: lo que hace que la pregunta
 * valga la pena es que diga qué NO se pierde. Quien duda al pulsar duda por
 * las llaves de agente y la clave de IA, y la respuesta es que siguen donde
 * estaban.
 */
export function useCerrarSesion(): () => Promise<void> {
  const { signOut } = useSession();
  const confirmar = useConfirmar();

  return async () => {
    const ok = await confirmar({
      titulo: "¿Cerrar sesión?",
      descripcion:
        "Se cierra en este navegador. Tus llaves de agente y tu clave de IA siguen donde estaban.",
      accion: "Cerrar sesión",
      peligro: true,
    });
    if (ok) await signOut();
  };
}
