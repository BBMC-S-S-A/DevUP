import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError, type ZodTypeAny, type output } from "zod";

/** Error con código HTTP. Lo traduce el manejador global de server.ts. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "error",
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (m: string) => new HttpError(400, m, "solicitud_invalida");
export const unauthorized = (m = "sin sesión") => new HttpError(401, m, "sin_sesion");
export const forbidden = (m = "sin permiso") => new HttpError(403, m, "sin_permiso");
export const notFound = (m = "no encontrado") => new HttpError(404, m, "no_encontrado");
export const conflict = (m: string) => new HttpError(409, m, "conflicto");

/**
 * Traduce los errores de Postgres a respuestas HTTP.
 *
 * El detalle que importa: cuando RLS deniega una lectura, Postgres no lanza
 * ningún error — devuelve cero filas. Así que la ausencia de datos y la falta
 * de permiso llegan aquí indistinguibles, y las rutas responden 404 en ambos
 * casos. Es lo correcto: decir «existe pero no puedes verlo» ya filtra que
 * existe.
 */
export function translateDbError(error: unknown): HttpError | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const pgCode = String((error as { code: unknown }).code);
  const detail = error instanceof Error ? error.message : "";

  switch (pgCode) {
    case "23505": // unique_violation
      return conflict(
        detail.includes("slug")
          ? "ya existe una organización con ese identificador"
          : detail.includes("email")
            ? "ya hay una cuenta con ese correo"
            : "ese valor ya existe",
      );
    case "23503": // foreign_key_violation
      return badRequest("hace referencia a algo que no existe");
    case "23514": // check_violation
      return badRequest("algún valor no cumple el formato exigido");
    case "42501": // insufficient_privilege — lo lanzan nuestras funciones
      return forbidden(detail.replace(/^.*?:\s*/, "") || "sin permiso");
    case "P0002": // no_data_found
      return notFound(detail.replace(/^.*?:\s*/, "") || "no encontrado");
    default:
      // Las políticas RLS que deniegan una escritura llegan como 42501 arriba;
      // el resto es un fallo nuestro y debe verse como 500 en los registros.
      return null;
  }
}

/**
 * Valida el cuerpo con un esquema de Zod y devuelve 400 con el detalle.
 *
 * El genérico va sobre el esquema y no sobre el resultado a propósito: con
 * `ZodType<T>`, TypeScript hace coincidir T con el tipo de *entrada*, y todo
 * campo con `.default()` sale como opcional aunque tras validar nunca lo sea.
 */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): output<S> {
  try {
    return schema.parse(body) as output<S>;
  } catch (error) {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      throw badRequest(
        first ? `${first.path.join(".") || "cuerpo"}: ${first.message}` : "cuerpo inválido",
      );
    }
    throw error;
  }
}

export function parseParams<S extends ZodTypeAny>(schema: S, params: unknown): output<S> {
  return parseBody(schema, params);
}

/** Extrae el id de usuario de la petición, o falla con 401. */
export function requireUser(request: FastifyRequest): string {
  if (!request.userId) throw unauthorized();
  return request.userId;
}

export function noContent(reply: FastifyReply): void {
  void reply.status(204).send();
}

/**
 * Límite estricto para lo que se puede probar por fuerza bruta: acceso, alta y
 * los enlaces de un solo uso.
 *
 * Va en la definición de cada ruta y no en un hook `onRoute` común. Motivo: el
 * hook del propio plugin de límites corre en el orden en que se registró —
 * antes que cualquiera que se añada después—, así que una configuración puesta
 * más tarde nunca llega a leerse y el límite parece aplicado sin estarlo.
 *
 * Diez por minuto y dirección: sobra para quien escribe mal su contraseña, y no
 * llega a ningún sitio con un diccionario.
 */
export const limiteEstricto = {
  config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
} as const;
