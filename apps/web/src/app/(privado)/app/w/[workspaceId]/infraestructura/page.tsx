"use client";

import { Server } from "lucide-react";
import { DiagramaArquitectura } from "@/components/arquitectura/Diagrama";
import { Pagina } from "@/components/ui/Pagina";
import { useWorkspaceId } from "@/lib/workspace-context";

/**
 * Infraestructura: por ahora, solo arquitectura.
 *
 * HUBO UNA PESTAÑA «ENTORNOS» AQUÍ Y SE QUITÓ A PROPÓSITO (0063 la trajo,
 * esto la retira). Desplegar y migrar de verdad necesitaba conectar Railway
 * o AWS con IDs concretos por servicio desde «Configurar» — un paso que no
 * quedaba claro con solo mirar la pantalla, y que se pidió simplificar: por
 * ahora este apartado gestiona arquitectura —lo real de un repositorio
 * conectado, y el simulacro de AWS— y no despliegues. Las rutas de la API
 * (`environments`, `deployments`, `/deploy`, `/migrate`) siguen existiendo
 * sin tocar: lo que se quitó es la pantalla, no los datos ni el camino de
 * vuelta si hace falta.
 */
export default function InfraestructuraPage() {
  const workspaceId = useWorkspaceId();

  return (
    <Pagina
      titulo="Infraestructura"
      rotulo="La arquitectura del proyecto"
      icono={<Server size={20} />}
      ancho="trabajo"
    >
      <DiagramaArquitectura workspaceId={workspaceId} />
    </Pagina>
  );
}
