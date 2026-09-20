"use client";

import { Server } from "lucide-react";
import { EstadoTecnico } from "@/components/ajustes/EstadoTecnico";
import { Pagina } from "@/components/ui/Pagina";
import { useOrgId } from "@/lib/workspace-context";

/**
 * La instalación: si el despliegue está al día, si el almacén responde, si el
 * correo sale de verdad.
 *
 * ESTABA DENTRO DE AJUSTES, AL FINAL. El sitio no era un descuido —su propio
 * comentario explicaba que iba al final porque nadie entra en Ajustes buscando
 * esto— pero seguía estando en la misma pantalla que la foto de la
 * organización y la lista de miembros. Y es información de otro oficio: bóveda,
 * almacén, TURN, y «0 migraciones aplicadas» con un párrafo explicando por qué
 * ese número no significa lo que parece.
 *
 * Cuando una pantalla necesita un párrafo para explicar su propio número, el
 * número está en la pantalla equivocada.
 *
 * QUIÉN LA VE. Solo quien administra, igual que antes, y por el mismo motivo:
 * es lo que el servidor contesta —`/salud` lo pide con `is_org_admin`— así que
 * pintarla a los demás sería enseñar un 403 con forma de tarjeta. La entrada
 * del menú tampoco se pinta: un menú que lleva a un error parece una avería.
 *
 * LAS REGLAS SIGUEN EN `lib/salud.ts` y el componente sigue siendo el mismo.
 * Esto es una mudanza, no una reescritura: decidir que «sin TURN» es un aviso
 * y «sin Spotify» no lo es es lo único que se puede equivocar de verdad, y eso
 * no se toca al cambiar de sitio.
 */
export default function InstalacionPage() {
  const orgId = useOrgId();

  return (
    <Pagina
      titulo="Instalación"
      rotulo="cómo está montada esta instancia de DevUP"
      icono={<Server size={20} />}
      // Filas de servicios con su estado: se llena de contenido, no de línea.
      ancho="trabajo"
    >
      <EstadoTecnico orgId={orgId} />
    </Pagina>
  );
}
