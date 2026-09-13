import { z } from "zod";
import type { ClienteApi } from "../api.js";
import { resolverEspacio } from "../espacios.js";

/**
 * El diario del proyecto: qué pasó cada semana.
 *
 * EN QUÉ SE DIFERENCIA DE `que_ha_pasado`, que es la pregunta que se hace
 * cualquiera al ver las dos. `que_ha_pasado` contesta «¿qué me he perdido?» —es
 * puntual, mira hacia atrás un rato corto y enseña los hechos uno a uno.
 * Esto contesta «¿cómo ha ido este proyecto?»: mira meses, no enseña hechos
 * sueltos y resume cada semana en tres cosas —cuánto, quién y qué quedó
 * terminado—.
 *
 * Si las dos hicieran lo mismo con distinto formato, sobraría una. Lo que las
 * separa no es el tamaño de la ventana: es que una cuenta lo que pasó y la otra
 * cuenta cómo fue.
 *
 * LAS SEMANAS EN BLANCO SE ENSEÑAN, y aquí está la mitad del valor. La API las
 * devuelve a propósito (ver `lib/actividad.ts`) y saltárselas al redactar
 * desharía justo lo que se ganó: dos semanas seguidas en el texto parecerían
 * consecutivas con un mes de silencio entre medias. Un parón es de lo que más
 * se mira en un diario, y normalmente nadie lo dijo en voz alta.
 *
 * LA PROSA VENDRÁ DESPUÉS Y NECESITA AL AGENTE. Esto es la materia prima
 * ordenada, no el relato. Escribir «la semana que se atascó la pasarela» a
 * partir de esto es trabajo de modelo; lo que no puede es inventarse los
 * hechos, y para eso tiene que recibirlos así.
 */

/** Cuántas semanas se miran si nadie lo dice: un trimestre corto. */
const SEMANAS_POR_DEFECTO = 8;

export const esquemaDiario = {
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
  semanas: z
    .number()
    .int()
    .min(1)
    .max(52)
    .optional()
    .describe(`Cuántas semanas hacia atrás. Por defecto ${SEMANAS_POR_DEFECTO}.`),
  huso: z
    .string()
    .optional()
    .describe(
      "Huso horario IANA, como «America/Bogota». Importa: en UTC, lo cerrado " +
        "un domingo por la tarde en Colombia cuenta en la semana siguiente.",
    ),
};

export const descripcionDiario = [
  "El diario de un proyecto de DevUP, semana a semana: cuánta actividad hubo,",
  "quién participó y qué quedó terminado en cada una.",
  "",
  "ÚSALA PARA «¿CÓMO HA IDO ESTE PROYECTO?», para preparar una reunión de",
  "seguimiento o para contar qué se hizo en un mes. Es la vista de lejos.",
  "",
  "NO la uses para «¿qué me he perdido?» ni «¿qué ha cambiado desde ayer?»:",
  "para eso está «que_ha_pasado», que enseña los hechos uno a uno. Esta resume",
  "y no lista.",
  "",
  "Los hitos de cada semana son las tareas CERRADAS, no los movimientos: es lo",
  "que de verdad quedó hecho.",
  "",
  "Las semanas sin nada se enseñan en blanco a propósito. Saltárselas haría",
  "parecer constante un proyecto que estuvo parado — si ves un parón, es real.",
].join("\n");

type Semana = {
  inicia: string;
  termina: string;
  hechos: number;
  porVerbo: Record<string, number>;
  personas: { id: string; nombre: string | null; veces: number }[];
  cerradas: string[];
};

/** «7 de septiembre», sin año: la cabecera ya sitúa el periodo. */
function dia(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
  });
}

export async function diarioDelProyecto(
  cliente: ClienteApi,
  entrada: { espacio?: string; organizacion?: string; semanas?: number; huso?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const semanas = entrada.semanas ?? SEMANAS_POR_DEFECTO;

  const parametros = new URLSearchParams({ semanas: String(semanas) });
  if (entrada.huso) parametros.set("tz", entrada.huso);

  const datos = await cliente.get<{ semanas: Semana[] }>(
    `/workspaces/${espacio.id}/diario?${parametros.toString()}`,
  );

  const lineas: string[] = [`Diario de «${espacio.name}», últimas ${semanas} semana(s):`];

  /**
   * Las semanas seguidas sin nada se juntan en una sola línea.
   *
   * Enseñarlas es obligatorio —ver la cabecera— pero seis renglones idénticos
   * que dicen «nada» empujan fuera de la vista lo que sí pasó. «Cinco semanas
   * sin movimiento» dice exactamente lo mismo y cabe.
   */
  let silencio = 0;
  const cerrarSilencio = (): void => {
    if (silencio === 0) return;
    lineas.push("", silencio === 1 ? "· Una semana sin movimiento." : `· ${silencio} semanas seguidas sin movimiento.`);
    silencio = 0;
  };

  for (const s of datos.semanas) {
    if (s.hechos === 0) {
      silencio += 1;
      continue;
    }
    cerrarSilencio();

    lineas.push("", `Semana del ${dia(s.inicia)} al ${dia(s.termina)} — ${s.hechos} hecho(s)`);

    const quienes = s.personas
      .map((p) => `${p.nombre ?? "alguien"} (${p.veces})`)
      .join(", ");
    if (quienes) lineas.push(`  Participaron: ${quienes}`);

    if (s.cerradas.length > 0) {
      lineas.push(`  Se terminó: ${s.cerradas.join("; ")}`);
    } else {
      // Decirlo, y no callarlo: una semana con mucho movimiento y nada cerrado
      // es una señal, y es justo la que se pierde si solo se enseña lo que hay.
      lineas.push("  No se terminó nada.");
    }
  }
  cerrarSilencio();

  if (lineas.length === 1) {
    return `No hay nada anotado en «${espacio.name}» en las últimas ${semanas} semana(s).`;
  }

  return lineas.join("\n");
}
