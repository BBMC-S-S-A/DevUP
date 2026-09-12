import { z } from "zod";
import type { ClienteApi } from "../api.js";
import { resolverEspacio } from "../espacios.js";
import { resolverOrganizacion } from "../organizaciones.js";
import { resolverPersona } from "./escribir.js";

/**
 * «¿Qué ha pasado aquí desde…?»
 *
 * LA PREGUNTA QUE EL PRODUCTO NO PODÍA CONTESTAR. Hasta la 0038, una tarea
 * guardaba su estado y no su recorrido: se podía saber que algo estaba en
 * «Hecho», nunca quién lo movió ni cuándo. `auditoria.ts` lo decía en su propia
 * cabecera. Esta herramienta es el lado del agente de eso mismo — la pregunta
 * que hace alguien que vuelve el lunes, o que se incorpora a un proyecto que
 * lleva tres semanas andando, y cuya respuesta hoy es abrir el tablero y
 * deducirla mirando tarjetas.
 *
 * ES DE LECTURA Y NO ESCRIBE NADA, así que no lleva la etiqueta `agente` ni
 * ninguna otra marca: no hay nada que revisar después. El aislamiento tampoco
 * lo pone esto — va por la sesión de quien conectó y por la política de la
 * 0038, igual que el resto.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * TRES DECISIONES QUE DEFINEN SI LA RESPUESTA SIRVE O NO:
 *
 * 1. SE AGRUPA POR DÍA Y SE CUENTA HACIA ADELANTE. La API devuelve lo más
 *    reciente primero, que es lo correcto para una pantalla donde se mira
 *    arriba. Para leer no: una historia se lee en el orden en que ocurrió. Un
 *    volcado invertido obliga a quien lee a reconstruir la secuencia mentalmente,
 *    y es justo el trabajo que veníamos a ahorrar.
 *
 * 2. LO QUE SE DEVUELVE SON HECHOS, NO UN RESUMEN. La tentación era contestar
 *    en prosa —«esta semana el equipo se centró en…»—, y es un error: quien
 *    llama a esta herramienta ES un modelo, y resumir es lo que él sabe hacer
 *    con el contexto de la conversación, que nosotros no tenemos. Si
 *    resumiéramos aquí, el resumen de arriba sería el resumen de un resumen, y
 *    lo que se pierde en ese segundo paso son exactamente los detalles por los
 *    que se preguntó. Devolvemos la línea de tiempo entera y bien ordenada.
 *
 * 3. EL ORIGEN SE DICE SIEMPRE QUE NO SEA UNA PERSONA. «Ana cerró cuatro
 *    tareas» y «el asistente de Ana cerró cuatro tareas» no son la misma frase,
 *    y la diferencia importa justo cuando alguien está poniéndose al día. Que
 *    lo marque la columna `origen` de la 0038 es el motivo de que exista.
 */

/** Lo que devuelve `/organizations/:id/activity`. */
type Hecho = {
  verbo: string;
  origen: "persona" | "regla" | "agente";
  resumen: string;
  actorNombre: string | null;
  workspaceNombre: string | null;
  ocurridoEn: string;
};

/** Tope de la API. Pedir más devolvería un error de validación, no más filas. */
const TOPE_API = 200;

/**
 * Traduce «desde cuándo» a días.
 *
 * SE ACEPTA COMO SE DICE, no como se calcula. Quien pregunta escribe «ayer»,
 * «la semana pasada» o «desde el 1 de septiembre»; exigirle un número de días
 * es pedirle que haga la resta para que la haga la máquina. Y un modelo al que
 * se le exige un formato rígido acaba inventándoselo.
 *
 * Devuelve null cuando no lo entiende, para que quien llama pueda decirlo en
 * vez de elegir un periodo por su cuenta: contestar «no ha pasado nada» porque
 * se interpretó mal la fecha es peor que preguntar.
 */
export function diasDesde(texto: string, ahora = new Date()): number | null {
  const t = texto.trim().toLowerCase();

  if (/^(hoy|today)$/.test(t)) return 1;
  if (/^ayer$/.test(t)) return 2;
  if (/^anteayer|antes de ayer$/.test(t)) return 3;
  if (/^(esta semana|la semana|última semana|ultima semana|last week|la semana pasada)$/.test(t)) {
    return 7;
  }
  if (/^(este mes|último mes|ultimo mes|el mes pasado)$/.test(t)) return 30;

  // LA FECHA VA ANTES QUE EL NÚMERO, y no es cuestión de gusto: «2026-09-01»
  // termina en dígitos, así que un patrón de «N días» sin anclar por la
  // izquierda se queda con el «01» del final y contesta «un día». El error es
  // perfecto —devuelve una respuesta plausible, con hechos de verdad, solo que
  // del periodo equivocado— y no hay nada que lo delate.
  //
  // Se cuentan los días hasta hoy redondeando HACIA ARRIBA, porque el filtro de
  // la API es `now() - N días`: con redondeo hacia abajo, «desde el día 1»
  // empezaría a contar a la hora que sea ahora del día 1 y se dejaría fuera
  // media jornada de ese mismo día.
  const fecha = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (fecha) {
    const cuando = Date.parse(`${fecha[1]}-${fecha[2]}-${fecha[3]}T00:00:00Z`);
    if (Number.isNaN(cuando)) return null;
    const dias = Math.ceil((ahora.getTime() - cuando) / 86_400_000);
    if (dias < 1) return 1;
    if (dias > 365) return null;
    return dias;
  }

  // «3 días», «hace 3 días», «3d», «3». Anclado por los dos lados: lo que lleve
  // algo delante que no sea «hace» no es un periodo, es otra cosa.
  const relativo = t.match(/^(?:hace\s+)?(\d+)\s*(?:d|días|dias|day|days)?$/);
  if (relativo?.[1]) {
    const n = Number(relativo[1]);
    // Un número suelto grande casi siempre es un año mal escrito («2026»), no
    // un periodo. Se rechaza en vez de traer 365 días y llamarlo respuesta.
    if (n >= 1 && n <= 365) return n;
    return null;
  }

  return null;
}

/** Un día en el formato que se lee, no en el que se guarda. */
function dia(iso: string): string {
  return iso.slice(0, 10);
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** «2026-09-12» → «12 de septiembre». El año solo si no es el de hoy. */
function diaLegible(clave: string, ahora = new Date()): string {
  const [anyo, mes, d] = clave.split("-");
  const nombre = MESES[Number(mes) - 1] ?? mes;
  const sufijo = Number(anyo) === ahora.getFullYear() ? "" : ` de ${anyo}`;
  return `${Number(d)} de ${nombre}${sufijo}`;
}

/** La hora, que es lo que separa dos hechos del mismo día. */
function hora(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

/**
 * Quién hizo algo, diciendo cuándo no fue una persona.
 *
 * El asistente de alguien y ese alguien tecleando no son lo mismo, y esta es la
 * única línea del producto donde esa distinción se lee sin buscarla.
 */
function quien(h: Hecho): string {
  const nombre = h.actorNombre ?? "alguien que ya no está";
  if (h.origen === "agente") return `el asistente de ${nombre}`;
  if (h.origen === "regla") return "una regla automática";
  return nombre;
}

export const esquemaQueHaPasado = {
  desde: z
    .string()
    .optional()
    .describe(
      "Desde cuándo, como se diga: «ayer», «la semana pasada», «7 días» o una " +
        "fecha 2026-09-01. Por defecto, los últimos 7 días.",
    ),
  espacio: z
    .string()
    .optional()
    .describe("Nombre del espacio de trabajo. Omitir para ver toda la organización."),
  organizacion: z.string().optional().describe("Solo si pertenece a varias organizaciones."),
  quien: z
    .string()
    .optional()
    .describe("Nombre de una persona, para ver solo lo suyo. Omitir para ver el de todos."),
  solo: z
    .string()
    .optional()
    .describe(
      "Filtrar por tipo de hecho: una familia («tarea») o un verbo entero " +
        "(«tarea.cerrada»). Omitir para verlo todo.",
    ),
};

export const descripcionQueHaPasado = [
  "La historia de lo que ha ocurrido en un espacio de trabajo o en toda la",
  "organización: quién creó, movió, cerró, reabrió, asignó o reclasificó qué, y",
  "cuándo.",
  "",
  "Es la herramienta para «¿qué me he perdido?», «¿qué ha pasado esta semana?»,",
  "«¿en qué ha andado el equipo?», «¿qué cerró Ana?» y «¿cómo va esto desde que",
  "lo dejamos?». Devuelve los hechos agrupados por día y en el orden en que",
  "ocurrieron, para poder leerlos como lo que son: una historia.",
  "",
  "Distingue lo que hizo una persona de lo que hizo su asistente, porque no es",
  "lo mismo y al ponerse al día importa.",
  "",
  "No resume ni saca conclusiones a propósito: devuelve los hechos para que se",
  "resuman aquí, con el contexto de esta conversación. Para el estado actual del",
  "tablero —qué hay pendiente ahora— la herramienta es `ver_tablero`; esta",
  "cuenta el recorrido, no la foto.",
].join("\n");

export async function queHaPasado(
  cliente: ClienteApi,
  entrada: {
    desde?: string;
    espacio?: string;
    organizacion?: string;
    quien?: string;
    solo?: string;
  },
): Promise<string> {
  const dias = entrada.desde ? diasDesde(entrada.desde) : 7;
  if (dias === null) {
    return (
      `No entendí «${entrada.desde}» como un periodo de tiempo. Vale «ayer», ` +
      `«la semana pasada», «14 días» o una fecha como 2026-09-01.`
    );
  }

  const org = await resolverOrganizacion(cliente, entrada.organizacion);
  const espacio = entrada.espacio
    ? await resolverEspacio(cliente, entrada.espacio, entrada.organizacion)
    : null;
  const actorId = entrada.quien
    ? await resolverPersona(cliente, entrada.quien, entrada.organizacion)
    : null;

  const parametros = new URLSearchParams({ dias: String(dias), limite: String(TOPE_API) });
  if (espacio) parametros.set("workspaceId", espacio.id);
  if (actorId) parametros.set("actorId", actorId);
  if (entrada.solo) parametros.set("verbo", entrada.solo.trim());

  const { actividad } = await cliente.get<{ actividad: Hecho[] }>(
    `/organizations/${org.id}/activity?${parametros.toString()}`,
  );

  const donde = espacio ? espacio.name : org.name;
  const periodo = dias === 1 ? "hoy" : `los últimos ${dias} días`;
  const deQuien = entrada.quien ? ` de ${entrada.quien}` : "";

  if (actividad.length === 0) {
    // Un «no hay nada» tiene que decir dónde se miró y desde cuándo, o se lee
    // como «esto no funciona». La mitad de las veces lo que falla es que se
    // preguntó por el espacio equivocado.
    return `No hay actividad${deQuien} en ${donde} en ${periodo}.`;
  }

  // La API contesta lo más reciente primero, que es el orden de una pantalla.
  // Para leerlo hay que darle la vuelta: una historia se cuenta hacia adelante.
  const cronologico = [...actividad].reverse();

  const porDia = new Map<string, Hecho[]>();
  for (const hecho of cronologico) {
    const clave = dia(hecho.ocurridoEn);
    const lista = porDia.get(clave);
    if (lista) lista.push(hecho);
    else porDia.set(clave, [hecho]);
  }

  const lineas: string[] = [
    `${actividad.length}${actividad.length === TOPE_API ? "+" : ""} ` +
      `${actividad.length === 1 ? "hecho" : "hechos"}${deQuien} en ${donde}, en ${periodo}:`,
  ];

  for (const [clave, hechos] of porDia) {
    lineas.push("", `**${diaLegible(clave)}**`);
    for (const h of hechos) {
      // El espacio solo cuando se está mirando la organización entera: dentro
      // de uno, repetir su nombre en cada línea es ruido que tapa lo demás.
      const sitio = espacio || !h.workspaceNombre ? "" : ` · ${h.workspaceNombre}`;
      lineas.push(`- ${hora(h.ocurridoEn)} — ${quien(h)} ${h.resumen}${sitio}`);
    }
  }

  if (actividad.length === TOPE_API) {
    // Si se llegó al tope, lo que falta es lo MÁS ANTIGUO —la lista viene
    // recortada por arriba—, así que decirlo evita la conclusión falsa de que
    // la historia empieza ahí.
    lineas.push(
      "",
      `(Hay más: esto son los ${TOPE_API} hechos más recientes del periodo. ` +
        `Para ver lo anterior, acotar con \`desde\`, \`espacio\` o \`quien\`.)`,
    );
  }

  return lineas.join("\n");
}
