import type { ClienteDevUP } from "./api.js";

export type Organizacion = { id: string; name: string; slug: string };

/**
 * Resuelve «de qué organización hablamos» sin pedirle un uuid al modelo.
 *
 * A un modelo al que se le exige un identificador se lo inventa, y una
 * herramienta que falla con «uuid inválido» no la vuelve a usar. Así que se
 * acepta un nombre, y cuando no hay ambigüedad no se acepta nada: la mayoría
 * de la gente pertenece a una sola organización.
 *
 * Cuando de verdad hay ambigüedad no se elige por él: se devuelve un error que
 * dice cuáles hay. Un error que explica cómo acertar es una herramienta que se
 * usa bien al segundo intento; uno que solo dice «ambiguo» es una que se
 * abandona.
 */
export async function resolverOrganizacion(
  cliente: ClienteDevUP,
  nombre?: string,
): Promise<Organizacion> {
  const { organizations } = await cliente.get<{ organizations: Organizacion[] }>("/organizations");

  if (organizations.length === 0) {
    throw new Error("Esta cuenta no pertenece a ninguna organización de DevUP.");
  }

  if (!nombre) {
    const unica = organizations[0];
    if (organizations.length === 1 && unica) return unica;
    throw new Error(
      `Hay ${organizations.length} organizaciones y no dijiste cuál: ` +
        `${organizations.map((o) => o.name).join(", ")}.`,
    );
  }

  const buscado = nombre.trim().toLowerCase();
  const exacta = organizations.find(
    (o) => o.name.toLowerCase() === buscado || o.slug.toLowerCase() === buscado,
  );
  if (exacta) return exacta;

  const parciales = organizations.filter((o) => o.name.toLowerCase().includes(buscado));
  const primera = parciales[0];
  if (parciales.length === 1 && primera) return primera;

  throw new Error(
    parciales.length === 0
      ? `No hay ninguna organización que se llame «${nombre}». Hay: ` +
        `${organizations.map((o) => o.name).join(", ")}.`
      : `«${nombre}» encaja con varias: ${parciales.map((o) => o.name).join(", ")}.`,
  );
}
