import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { badRequest, parseParams, parseQuery, requireUser } from "../lib/http.js";
import { asientosDe, marcadorDeOrganizacion } from "../lib/puntos.js";

/**
 * Los puntos: qué se ha ganado y de dónde sale cada uno.
 *
 * NO HAY RUTA PARA DAR PUNTOS, Y ESO ES EL DISEÑO. Se ganan en la base, al
 * entrar una tarea en una columna final (0055). Una ruta que reparta puntos
 * los convierte en algo que se puede pedir, y entonces dejan de medir nada.
 *
 * Las dos que hay son de LECTURA y van juntas a propósito: el marcador dice
 * cuánto, y los asientos dicen de qué. Publicar el primero sin el segundo es
 * publicar un número que hay que creerse.
 */

const uuid = z.string().uuid();

export async function puntosRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/organizations/:orgId/puntos", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const { dias } = parseQuery(
      z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }),
      request.query,
    );

    return withUser(userId, async (db) => ({
      dias,
      gente: await marcadorDeOrganizacion(db, { organizationId: orgId, dias }),
    }));
  });

  /**
   * Los asientos de una persona.
   *
   * De cualquiera de la organización, no solo los propios: las políticas de la
   * 0055 ya abren los puntos a quien comparte organización, y esconder aquí lo
   * que allí está abierto no protegería nada — solo haría imposible contrastar
   * un total, que es para lo que existe.
   */
  app.get("/organizations/:orgId/puntos/:personaId", async (request) => {
    const userId = requireUser(request);
    const { orgId, personaId } = parseParams(
      z.object({ orgId: uuid, personaId: uuid }),
      request.params,
    );
    const { dias, limite } = parseQuery(
      z.object({
        dias: z.coerce.number().int().min(1).max(365).default(30),
        limite: z.coerce.number().int().min(1).max(200).default(50),
      }),
      request.query,
    );

    return withUser(userId, async (db) => ({
      dias,
      asientos: await asientosDe(db, {
        userId: personaId,
        organizationId: orgId,
        dias,
        limite,
      }),
    }));
  });
  /**
   * La tienda: qué se vende, qué tengo y con cuánto cuento.
   *
   * LAS TRES COSAS EN UNA RESPUESTA porque las tres se enseñan juntas y por
   * separado no significan nada: un precio sin saldo no dice si te alcanza, y
   * un saldo sin catálogo no dice para qué sirve.
   *
   * EL SALDO SE SUMA, NO SE GUARDA. Es la misma cuenta que hace la función de
   * comprar, y lo es a propósito: dos formas distintas de calcular el mismo
   * número son dos números que acaban discrepando. Ver el porqué largo en la
   * migración 0069.
   */
  app.get("/tienda", async (request) => {
    const userId = requireUser(request);

    return withUser(userId, async (db) => {
      const { rows: articulos } = await db.query(
        `select a.clave, a.nombre, a.descripcion, a.tipo, a.precio,
                (c.id is not null) as tengo
           from tienda_articulos a
           left join compras c on c.articulo_id = a.id and c.user_id = $1
          where a.activo
          order by a.orden, a.precio`,
        [userId],
      );

      const { rows: saldo } = await db.query<{ saldo: number }>(
        "select coalesce(sum(cantidad),0)::int as saldo from puntos where user_id = $1",
        [userId],
      );

      return { saldo: saldo[0]?.saldo ?? 0, articulos };
    });
  });

  /**
   * Comprar.
   *
   * LA RUTA NO DECIDE NADA: llama a `comprar_articulo` y traduce su negativa.
   * Las tres reglas —que exista, que no lo tengas ya, que no te deje en
   * negativo— viven en la función porque es lo único que corre dentro de la
   * transacción con el cerrojo puesto. Comprobarlas aquí antes sería mirar un
   * saldo que puede cambiar entre la comprobación y la escritura, que es el
   * fallo clásico de las tiendas y se paga en puntos que no existían.
   */
  app.post("/tienda/:clave/comprar", async (request, reply) => {
    const userId = requireUser(request);
    const { clave } = parseParams(
      z.object({ clave: z.string().regex(/^[a-z]+:[0-9]+$/) }),
      request.params,
    );

    try {
      const compra = await withUser(userId, async (db) => {
        const { rows } = await db.query("select public.comprar_articulo($1)", [clave]);
        return rows[0];
      });
      return reply.status(201).send({ compra });
    } catch (fallo) {
      // Lo que la función levanta ya está escrito para leerse —«ya tienes eso»,
      // «te faltan 40 puntos»— así que se pasa tal cual en vez de taparlo con
      // un «no se pudo comprar» que obligaría a adivinar cuál de las tres fue.
      const mensaje = fallo instanceof Error ? fallo.message : "no se pudo comprar";
      throw badRequest(mensaje);
    }
  });
}
