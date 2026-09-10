import { z } from "zod";
import type { ClienteDevUP } from "../api.js";
import { resolverOrganizacion } from "../organizaciones.js";

/**
 * `buscar`: la primera herramienta de la puerta MCP.
 *
 * Va contra `global_search` (migración 0014), que ya cruza mensajes, archivos,
 * tareas, clientes, servicios y oportunidades en una sola consulta. El
 * aislamiento entre organizaciones no lo pone esta herramienta ni la ruta: lo
 * ponen las políticas RLS de cada tabla, porque `global_search` NO es
 * `security definer` y corre con la identidad de quien conectó su sesión.
 *
 * SOBRE LA DESCRIPCIÓN DE ABAJO. Es la documentación que lee el modelo para
 * decidir si usar esto, y por eso está escrita para él: dice qué encuentra,
 * qué NO encuentra, y qué hacer después con lo que devuelve. Una descripción
 * de una línea produce una herramienta que se usa mal.
 */

export const ENTIDADES = {
  message: "mensaje",
  file: "archivo",
  task: "tarea",
  client: "cliente",
  service: "servicio",
  opportunity: "oportunidad",
} as const;

export type Resultado = {
  entity: string;
  id: string;
  title: string | null;
  snippet: string | null;
  workspaceId: string | null;
  channelId: string | null;
  createdAt: string;
};

export const esquemaBuscar = {
  texto: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("Lo que se busca. Palabras sueltas, no una pregunta entera."),
  organizacion: z
    .string()
    .optional()
    .describe(
      "Nombre de la organización. Omitir si la persona solo pertenece a una, " +
        "que es lo normal.",
    ),
  limite: z.number().int().min(1).max(100).optional().describe("Cuántos resultados. Por defecto 30."),
};

export const descripcionBuscar = [
  "Busca por texto en todo el contenido de una organización de DevUP a la vez:",
  "mensajes de canales, archivos, tareas del tablero, clientes, servicios y",
  "oportunidades de venta.",
  "",
  "Úsala como primer paso cuando la pregunta menciona algo por su nombre —un",
  "cliente, un proyecto, un archivo, una conversación— y todavía no se sabe",
  "dónde vive. Devuelve el tipo y el identificador de cada resultado, que",
  "sirven para pedir el detalle después.",
  "",
  "NO busca dentro de repositorios de código ni en el historial de commits, y",
  "no entiende preguntas: se le pasan palabras. Si no encuentra nada, probar",
  "con menos palabras o con el nombre tal como lo escribiría una persona del",
  "equipo.",
].join("\n");

export async function buscar(
  cliente: ClienteDevUP,
  entrada: { texto: string; organizacion?: string; limite?: number },
): Promise<string> {
  const organizacion = await resolverOrganizacion(cliente, entrada.organizacion);
  const parametros = new URLSearchParams({
    q: entrada.texto,
    limit: String(entrada.limite ?? 30),
  });

  const { results } = await cliente.get<{ results: Resultado[] }>(
    `/organizations/${organizacion.id}/search?${parametros.toString()}`,
  );

  return formatear(results, entrada.texto, organizacion.name);
}

/**
 * El resultado se devuelve como texto agrupado por tipo, no como JSON crudo.
 *
 * Un modelo lee mejor «TAREAS (3)» seguido de tres líneas que un array de
 * objetos con seis campos cada uno, y de paso ocupa bastante menos contexto.
 * Los identificadores van al final de cada línea, que es lo que hace falta
 * para poder pedir el detalle en la llamada siguiente.
 */
export function formatear(
  resultados: readonly Resultado[],
  texto: string,
  organizacion: string,
): string {
  if (resultados.length === 0) {
    return `Sin resultados para «${texto}» en ${organizacion}.`;
  }

  const porTipo = new Map<string, Resultado[]>();
  for (const resultado of resultados) {
    const lista = porTipo.get(resultado.entity);
    if (lista) lista.push(resultado);
    else porTipo.set(resultado.entity, [resultado]);
  }

  const lineas = [`${resultados.length} resultado(s) para «${texto}» en ${organizacion}.`];

  for (const [tipo, lista] of porTipo) {
    const nombre = ENTIDADES[tipo as keyof typeof ENTIDADES] ?? tipo;
    lineas.push("", `${nombre.toUpperCase()} (${lista.length})`);
    for (const r of lista) {
      const titulo = r.title?.trim() || "(sin título)";
      const contexto = r.snippet?.trim().replace(/\s+/g, " ");
      lineas.push(
        `- ${titulo}${contexto ? ` — ${recortar(contexto, 160)}` : ""}` +
          `  [${tipo} ${r.id}${r.workspaceId ? `, espacio ${r.workspaceId}` : ""}]`,
      );
    }
  }

  return lineas.join("\n");
}

function recortar(texto: string, tope: number): string {
  return texto.length <= tope ? texto : `${texto.slice(0, tope - 1)}…`;
}
