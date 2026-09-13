import { z } from "zod";
import type { ClienteApi } from "../api.js";
import { resolverOrganizacion } from "../organizaciones.js";

/**
 * El marcador: qué ha ganado cada quien, y de dónde sale.
 *
 * POR QUÉ ESTO ENSEÑA «A SOLAS» AUNQUE NADIE LO PIDA. Los puntos se ganan al
 * cerrar una tarea (0055) y la objeción que diseñó esa tabla fue la del farmeo:
 * quien quiera inflar su número puede crear tareas fáciles y cerrárselas. La
 * respuesta no fue prohibirlo —alguien puede montar su proyecto aquí él solo, y
 * eso es lo que atrae— sino decirlo. Un marcador que enseña el total y se calla
 * cuánto de ese total pasó por una sola persona deshace la única defensa que
 * tiene el sistema, y la deshace en el sitio donde más se mira.
 *
 * NO ES UN RANKING DE PRODUCTIVIDAD, y conviene no redactarlo como si lo fuera.
 * Cuenta tareas cerradas, que no es lo mismo que trabajo hecho: quien pasa un
 * mes con una sola tarea difícil sale último. Sirve para ver participación y
 * para detectar números que no cuadran, no para comparar a dos personas.
 */

const DIAS_POR_DEFECTO = 30;

export const esquemaPuntos = {
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
  persona: z
    .string()
    .optional()
    .describe(
      "Nombre de una persona para ver SUS asientos uno a uno —de qué tarea " +
        "salió cada punto— en vez del marcador de todos.",
    ),
  dias: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe(`Cuántos días hacia atrás. Por defecto ${DIAS_POR_DEFECTO}.`),
};

export const descripcionPuntos = [
  "Los puntos de una organización de DevUP: cuánto lleva ganado cada persona y",
  "de qué tarea salió cada punto.",
  "",
  "Se ganan al CERRAR una tarea (10) y por dejar prueba escrita de cómo se hizo",
  "(5 más). No dependen de la prioridad ni de ningún campo que ponga quien los",
  "gana — eso sería dejar que el precio lo ponga quien cobra.",
  "",
  "«A solas» dice cuánto de ese total se ganó en tareas por las que no pasó",
  "nadie más. No vale menos: se sabe, que es distinto. ENSÉÑALO siempre que",
  "enseñes el total; callarlo deshace la única defensa que hay contra inflar el",
  "número a base de tareas fáciles cerradas por uno mismo.",
  "",
  "NO es un ranking de productividad. Cuenta tareas cerradas, no trabajo hecho:",
  "quien pasa un mes con una sola tarea difícil sale último. Sirve para ver",
  "participación y para detectar números que no cuadran.",
  "",
  "Con «persona» enseña sus asientos uno a uno, que es lo que permite",
  "comprobar un total en vez de creérselo.",
].join("\n");

type Marcador = {
  id: string;
  nombre: string | null;
  total: number;
  aSolas: number;
  tareas: number;
  porMotivo: Record<string, number>;
};

type Asiento = {
  id: string;
  tarea: string | null;
  titulo: string;
  motivo: string;
  cantidad: number;
  aSolas: boolean;
  cuando: string;
};

/** «13 sep, 14:02». Sin año: la cabecera ya dice el periodo. */
function cuando(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const MOTIVOS: Record<string, string> = {
  cerro_tarea: "cerró la tarea",
  dejo_prueba: "dejó prueba de cómo se hizo",
};

export async function verPuntos(
  cliente: ClienteApi,
  entrada: { organizacion?: string; persona?: string; dias?: number },
): Promise<string> {
  const organizacion = await resolverOrganizacion(cliente, entrada.organizacion);
  const dias = entrada.dias ?? DIAS_POR_DEFECTO;

  const { gente } = await cliente.get<{ gente: Marcador[] }>(
    `/organizations/${organizacion.id}/puntos?dias=${dias}`,
  );

  if (entrada.persona) {
    // Se busca dentro del marcador en vez de resolver la persona aparte: quien
    // no ha ganado nada no tiene asientos que enseñar, y decir «no ha ganado
    // puntos» es mejor respuesta que una lista vacía sin explicación.
    const buscado = entrada.persona.trim().toLowerCase();
    const encontradas = gente.filter((p) => (p.nombre ?? "").toLowerCase().includes(buscado));
    if (encontradas.length === 0) {
      return `Nadie que se llame «${entrada.persona}» ha ganado puntos en ${organizacion.name} en los últimos ${dias} día(s).`;
    }
    if (encontradas.length > 1) {
      const nombres = encontradas.map((p) => p.nombre ?? "sin nombre").join(", ");
      return `«${entrada.persona}» encaja con varias: ${nombres}. Concreta cuál.`;
    }

    const quien = encontradas[0]!;
    const { asientos } = await cliente.get<{ asientos: Asiento[] }>(
      `/organizations/${organizacion.id}/puntos/${quien.id}?dias=${dias}`,
    );

    const lineas = [
      `${quien.nombre ?? "Alguien"} · ${quien.total} punto(s) en ${dias} día(s), ` +
        `${quien.aSolas} de ellos a solas.`,
      "",
    ];
    for (const a of asientos) {
      const marca = a.aSolas ? "  (a solas)" : "";
      lineas.push(
        `· +${a.cantidad}  ${MOTIVOS[a.motivo] ?? a.motivo} — «${a.titulo || "sin título"}»  ` +
          `${cuando(a.cuando)}${marca}`,
      );
    }
    // Los asientos vienen acotados por la API. Decirlo, para que no se lea como
    // «esto es todo» cuando es «esto es lo último».
    if (asientos.length > 0 && asientos.reduce((s, a) => s + a.cantidad, 0) < quien.total) {
      lineas.push("", "(solo los últimos; hay más puntos de los que caben aquí)");
    }
    return lineas.join("\n");
  }

  if (gente.length === 0) {
    return `Nadie ha ganado puntos en ${organizacion.name} en los últimos ${dias} día(s). Se ganan al cerrar tareas.`;
  }

  const lineas = [`Puntos de ${organizacion.name}, últimos ${dias} día(s):`, ""];
  for (const p of gente) {
    const cierres = Number(p.porMotivo.cerro_tarea ?? 0);
    const pruebas = Number(p.porMotivo.dejo_prueba ?? 0);
    // «A solas» va en la misma línea que el total, no debajo ni en otra lista:
    // un dato que hay que ir a buscar es un dato que nadie mira.
    const solas = p.aSolas > 0 ? `, ${p.aSolas} a solas` : "";
    lineas.push(
      `· ${p.nombre ?? "alguien"} — ${p.total} punto(s)${solas}  ` +
        `[${p.tareas} tarea(s); ${cierres} por cerrar, ${pruebas} por dejar prueba]`,
    );
  }

  const todo = gente.reduce((s, p) => s + p.total, 0);
  const solas = gente.reduce((s, p) => s + p.aSolas, 0);
  if (solas === todo && todo > 0) {
    // El caso que hay que nombrar en voz alta: nadie ha revisado nada de nadie.
    lineas.push("", "Todos los puntos de este periodo se ganaron a solas: ninguna tarea pasó por dos personas.");
  }

  return lineas.join("\n");
}
