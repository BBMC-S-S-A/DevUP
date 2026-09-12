import { z } from "zod";
import type { ClienteApi } from "../api.js";

/**
 * Decir en qué anda el agente, para que se vea en DevVerse.
 *
 * NO HACE NADA EN EL PROYECTO, y por eso está separada de las demás: no crea,
 * no mueve y no lee nada. Lo único que produce es la frase que el muñeco de la
 * sala «Agente IA» dice encima de la cabeza.
 *
 * POR QUÉ HACE FALTA PEDÍRSELO AL MODELO. El nombre de una herramienta solo
 * sostiene «anotando una tarea»; la frase que la gente quiere leer —«estoy
 * migrando la base de datos»— describe la TAREA, y eso no se puede deducir de
 * `crear_tarea`. La migración 0022 ya zanjó este debate para la presencia de
 * las personas: «ES UNA ELECCIÓN, NO UNA DEDUCCIÓN… Un estado que el sistema
 * adivina acaba mintiendo». Aquí igual: el agente lo declara.
 */

export const esquemaEstoyHaciendo = {
  texto: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .describe(
      "En qué andas, en primera persona y en una frase corta: " +
        "«migrando la base de datos», «revisando el embudo de ventas». " +
        "Sin comillas y sin punto final.",
    ),
};

export const descripcionEstoyHaciendo = [
  "Cuenta en qué estás trabajando ahora mismo, para que el equipo lo vea en la",
  "oficina de DevVerse: un personaje en la sala «Agente IA» dice esta frase.",
  "",
  "ÚSALA AL EMPEZAR algo que vaya a llevarte varias llamadas —una migración,",
  "revisar un módulo entero, preparar un informe— y vuelve a llamarla si",
  "cambias de asunto. No hace falta para una consulta sola y rápida: eso ya se",
  "ve solo.",
  "",
  "No modifica nada del proyecto y no necesita que digas el espacio: es solo la",
  "frase. Si no la llamas, el personaje dirá algo genérico deducido de la última",
  "herramienta que usaste, que es bastante peor.",
].join("\n");

export async function estoyHaciendo(
  cliente: ClienteApi,
  entrada: { texto: string },
): Promise<string> {
  await cliente.post("/me/agente/latido", { origen: "declarada", frase: entrada.texto });
  return `Anotado: el equipo verá «${entrada.texto}» en la oficina.`;
}
