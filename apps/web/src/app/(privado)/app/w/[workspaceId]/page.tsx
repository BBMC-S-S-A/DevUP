"use client";

import { Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type Channel, api } from "@/lib/api";
import { useViewMode } from "@/lib/view-mode";

/**
 * La raíz de un workspace. No es una pantalla: es un cruce.
 *
 * ANTES ERA LA BIBLIOTECA DE ARCHIVOS, y por accidente de orden de
 * construcción, no por decisión — se movió a `./archivos`. El estudio de
 * flujo del 5 de septiembre de 2026 encontró que crear un workspace no
 * siembra ningún canal (ver `workspaces.ts`, antes de esta misma corrección),
 * así que aterrizar aquí era aterrizar en una pantalla vacía sin nada que
 * hacer, en el tercer elemento del menú cuando el propio menú dice que el
 * primero es el Panel.
 *
 * Ahora la raíz manda al canal general recién sembrado — o al primero de
 * texto que encuentre, para los workspaces creados antes de esta corrección,
 * que no tienen ninguno sembrado.
 *
 * NO decide nada cuando el modo es «immersive»: ese caso ya lo resuelve el
 * layout un nivel arriba (`WorkspaceLayout`), que redirige a DevVerse desde
 * esta misma ruta raíz. Decidir aquí también sería una carrera entre dos
 * redirecciones sobre la misma URL.
 */
export default function WorkspaceHome() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const { mode, ready: modeReady } = useViewMode();
  const [sinCanales, setSinCanales] = useState(false);

  useEffect(() => {
    if (!modeReady) return;
    // El layout ya se encarga de mandar a DevVerse cuando el modo es
    // inmersivo; decidir aquí también duplicaría la redirección.
    if (mode === "immersive") return;

    let cancelado = false;

    void api
      .get<{ channels: Channel[] }>(`/workspaces/${workspaceId}/channels`)
      .then(({ channels }) => {
        if (cancelado) return;

        const texto = channels
          .filter((canal) => canal.kind === "text")
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        // El canal «general» —si sigue llamándose así— es el destino natural;
        // si alguien lo renombró o lo borró, el más antiguo de texto es la
        // mejor apuesta siguiente.
        const destino = texto.find((canal) => canal.name === "general") ?? texto[0];

        if (destino) {
          router.replace(`/app/w/${workspaceId}/c/${destino.id}`);
        } else {
          // Solo pasa en un workspace creado antes de que se sembrara el
          // canal general, y que además no tiene ningún canal de texto
          // propio. El Panel es mejor destino que una biblioteca vacía.
          setSinCanales(true);
        }
      })
      .catch(() => setSinCanales(true));

    return () => {
      cancelado = true;
    };
  }, [workspaceId, mode, modeReady, router]);

  useEffect(() => {
    if (sinCanales) router.replace(`/app/w/${workspaceId}/panel`);
  }, [sinCanales, workspaceId, router]);

  return (
    <div className="grid min-h-[100svh] place-items-center">
      <Loader2 className="animate-spin text-faint" size={20} />
    </div>
  );
}
