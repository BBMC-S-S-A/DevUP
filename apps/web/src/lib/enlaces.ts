/**
 * A dónde lleva cada cosa. Una sola vez, y probado.
 *
 * ESTABA ESCRITO DOS VECES. `destino()` vivía igual —casi— en la paleta de
 * comandos y en la pantalla de buscar, y «casi» es la palabra que importa: la
 * de la paleta sabía quedarse dentro del armazón del espacio de trabajo y la de
 * buscar no. Dos copias de una regla de navegación se separan sin que nadie lo
 * note, porque el síntoma —aterrizar en el sitio equivocado— no se parece a un
 * error.
 *
 * Y AQUÍ SE PUEDE PROBAR. Esta es la otra mitad del motivo de que sea un módulo
 * aparte y no un par de funciones dentro de un componente: sin React ni rutas
 * de Next de por medio, se ejecuta con `tsx` como las pruebas de la API. Es la
 * primera prueba que tiene `apps/web`, que hasta ahora no tenía ninguna.
 *
 * Ver `enlaces.test.ts`.
 */

/** Lo mínimo que hace falta de un resultado de búsqueda para saber a dónde va. */
export type Destinable = {
  entity: "message" | "file" | "task" | "client" | "service" | "opportunity";
  organizationId: string | null;
  workspaceId: string | null;
  channelId: string | null;
};

/**
 * Dónde se abre un resultado de búsqueda.
 *
 * `workspaceId` es desde dónde se está mirando, no el del resultado: cuando se
 * busca desde dentro de un espacio de trabajo, las pantallas de la organización
 * se abren en su versión `/app/w/…` para no cambiar de armazón.
 *
 * Pero solo si el resultado es de la misma organización. Desde que la búsqueda
 * cruza organizaciones (migración 0036), un cliente puede salir de otra, y
 * quedarse en el armazón de aquí llevaría a un embudo de ventas que no es el
 * suyo — sin dar error, enseñando lo que no se buscaba.
 */
export function destinoDeResultado(
  resultado: Destinable,
  desde: { orgId: string; workspaceId?: string },
): string {
  switch (resultado.entity) {
    case "message":
      return resultado.workspaceId && resultado.channelId
        ? `/app/w/${resultado.workspaceId}/c/${resultado.channelId}`
        : "/app";
    case "file":
      // La raíz del espacio dejó de ser la biblioteca, así que un archivo tiene
      // que decir «archivos» explícitamente o aterriza en un canal de chat.
      return resultado.workspaceId ? `/app/w/${resultado.workspaceId}/archivos` : "/app";
    case "task":
      return resultado.workspaceId ? `/app/w/${resultado.workspaceId}/board` : "/app";
    case "client":
    case "service":
    case "opportunity": {
      const suya = resultado.organizationId ?? desde.orgId;
      return desde.workspaceId && suya === desde.orgId
        ? `/app/w/${desde.workspaceId}/ventas`
        : `/app/o/${suya}/ventas`;
    }
  }
}

/**
 * Las herramientas de la organización viven en las dos URLs: `/app/o/[orgId]/x`
 * y `/app/w/[workspaceId]/x`, con el mismo componente detrás. Lo que cambia es
 * el armazón — la de espacio conserva la barra del espacio.
 *
 * Una notificación la escribe el servidor, que no sabe en qué espacio estará
 * quien la lea, ni puede averiguarlo: el aislamiento le impide ver a qué
 * espacios pertenece otra persona. Así que guarda la forma larga y se traduce
 * aquí, con el contexto de quien lee delante.
 *
 * Ese era el fallo de «Noticias te saca del espacio».
 */
const HERRAMIENTAS_DE_ORGANIZACION = new Set(["noticias", "ventas"]);

export function enlaceDentroDelEspacio(link: string, workspaceId: string | null): string {
  if (!workspaceId) return link;
  const partes = link.split("/");
  // ["", "app", "o", orgId, herramienta, ...resto]
  if (partes[1] !== "app" || partes[2] !== "o" || !partes[4]) return link;
  if (!HERRAMIENTAS_DE_ORGANIZACION.has(partes[4])) return link;
  return ["", "app", "w", workspaceId, ...partes.slice(4)].join("/");
}
