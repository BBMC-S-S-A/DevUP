import type { ClienteApi } from "./api.js";
import { resolverOrganizacion } from "./organizaciones.js";

export type Espacio = { id: string; name: string };

/**
 * Resuelve «de qué espacio de trabajo hablamos», con el mismo criterio que las
 * organizaciones: se acepta un nombre, cuando no hay ambigüedad no se pide
 * nada, y cuando la hay se contesta con la lista en vez de elegir por su
 * cuenta. Ver `organizaciones.ts` para el porqué.
 */
export async function resolverEspacio(
  cliente: ClienteApi,
  nombre?: string,
  organizacion?: string,
): Promise<Espacio> {
  const org = await resolverOrganizacion(cliente, organizacion);
  const { workspaces } = await cliente.get<{ workspaces: Espacio[] }>(
    `/organizations/${org.id}/workspaces`,
  );

  if (workspaces.length === 0) {
    throw new Error(`${org.name} no tiene ningún espacio de trabajo todavía.`);
  }

  const primero = workspaces[0];
  if (!nombre) {
    if (workspaces.length === 1 && primero) return primero;
    throw new Error(
      `Hay ${workspaces.length} espacios en ${org.name} y no dijiste cuál: ` +
        `${workspaces.map((w) => w.name).join(", ")}.`,
    );
  }

  const buscado = nombre.trim().toLowerCase();
  const exacto = workspaces.find((w) => w.name.toLowerCase() === buscado);
  if (exacto) return exacto;

  const parciales = workspaces.filter((w) => w.name.toLowerCase().includes(buscado));
  const unico = parciales[0];
  if (parciales.length === 1 && unico) return unico;

  throw new Error(
    parciales.length === 0
      ? `No hay ningún espacio que se llame «${nombre}» en ${org.name}. Hay: ` +
        `${workspaces.map((w) => w.name).join(", ")}.`
      : `«${nombre}» encaja con varios: ${parciales.map((w) => w.name).join(", ")}.`,
  );
}

/** Todos los espacios a los que llega esta persona, para recorrerlos cuando la
 *  pregunta no menciona ninguno («¿qué tareas tengo?» no dice dónde). */
export async function todosLosEspacios(
  cliente: ClienteApi,
  organizacion?: string,
): Promise<{ org: string; espacios: Espacio[] }> {
  const org = await resolverOrganizacion(cliente, organizacion);
  const { workspaces } = await cliente.get<{ workspaces: Espacio[] }>(
    `/organizations/${org.id}/workspaces`,
  );
  return { org: org.name, espacios: workspaces };
}
