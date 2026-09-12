import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { TIPOS_DE_NODO, tejer, vecinosDe, type TipoDeNodo } from "../lib/grafo.js";
import { badRequest, notFound, parseBody, parseParams, parseQuery, requireUser } from "../lib/http.js";

/**
 * El grafo del proyecto: leer los enlaces de una cosa, y poner uno a mano.
 *
 * QUÉ DESBLOQUEA. La 0043 dejó la tabla `graph_links` y su guardián
 * `puede_ver_nodo`, y **no las usaba nadie**: ni una sola ruta escribía o leía
 * enlaces. Esto es la puerta. Sin ella, la red de trabajo sigue dibujando las
 * tres aristas que puede deducir del tablero —persona↔tarea, tarea↔categoría,
 * tarea↔columna— y ninguna de las que de verdad se piden: qué PR cierra esta
 * tarea, de qué conversación salió, dónde se desplegó.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * EL AISLAMIENTO SIGUE SIENDO DE LAS POLÍTICAS, NO DE ESTAS RUTAS, y aquí es
 * donde más fácil sería equivocarse. La regla de la 0043 —hacen falta **los dos
 * extremos**— ya está en `select`, `insert` y `delete`. Repetirla aquí en un
 * `if` daría una segunda copia, y la segunda copia es la que se queda atrás el
 * día que se añada un tipo de nodo.
 *
 * Lo que sí hace esta capa es TRADUCIR la negativa. Cuando una política rechaza
 * un insert, Postgres contesta «new row violates row-level security policy for
 * table graph_links», que no le dice nada a nadie y encima suena a fallo del
 * servidor. Aquí se convierte en lo que de verdad pasó: uno de los dos extremos
 * no existe, o no se puede ver.
 *
 * Y ESA RESPUESTA ES LA MISMA PARA LAS DOS COSAS, A PROPÓSITO. Distinguir «no
 * existe» de «existe pero no lo ves» convierte esta ruta en un detector: se
 * prueban identificadores hasta que uno conteste distinto, y así se averigua
 * qué hay en un canal privado sin entrar nunca. Es la misma fuga que el
 * producto ya evita en las menciones.
 *
 * NO HAY RUTA DE EDITAR, porque no hay política de UPDATE. Un enlace es un
 * hecho: dice que esto y aquello están relacionados. Cambiarle un extremo no es
 * editarlo, es otro enlace — y permitirlo dejaría mover una punta hacia algo que
 * quien edita no puede ver, saltándose la comprobación por la puerta de atrás.
 */

const uuid = z.string().uuid();
const tipoZ = z.enum(TIPOS_DE_NODO);

/** Lo que Postgres devuelve cuando una política rechaza la escritura. */
const RECHAZADO_POR_POLITICA = "42501";

/**
 * La misma frase para «no existe» y para «no lo ves». Ver la cabecera: separar
 * los dos casos convierte la ruta en un detector de lo que hay al otro lado.
 */
const NO_SE_PUEDE_ENLAZAR =
  "uno de los dos extremos no existe o no está a tu alcance, así que no se puede enlazar";

export async function grafoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  /**
   * Los vecinos de un nodo, en las dos direcciones.
   *
   * `/grafo/tarea/<id>` y no `/tasks/<id>/grafo`: el grafo es de ocho tipos de
   * nodo y colgarlo de cada uno sería la misma ruta escrita ocho veces, con
   * ocho oportunidades de que una se quede sin la comprobación de la siguiente.
   */
  app.get("/grafo/:tipo/:id", async (request) => {
    const userId = requireUser(request);
    const { tipo, id } = parseParams(z.object({ tipo: tipoZ, id: uuid }), request.params);
    const { limite } = parseQuery(
      z.object({ limite: z.coerce.number().int().min(1).max(500).default(200) }),
      request.query,
    );

    return withUser(userId, async (db) => {
      const vecinos = await vecinosDe(db, tipo as TipoDeNodo, id, limite);

      /**
       * Una lista vacía no distingue «este nodo no tiene enlaces» de «este nodo
       * no existe», y está bien que no lo distinga: es la misma decisión de
       * arriba. Preguntar por el id de una tarea de otra organización devuelve
       * lo mismo que preguntar por una tuya recién creada — nada.
       */
      return { tipo, id, vecinos };
    });
  });

  /**
   * Poner un enlace a mano.
   *
   * `persona` y no `regla` como procedencia: lo que llega por aquí lo escribió
   * alguien. La distinción importa el día que haya que recalcular el grafo —lo
   * que tejió una regla se puede rehacer desde los hechos; lo que puso una
   * persona, no, y borrarlo sería perder lo único que no estaba en ningún sitio.
   */
  app.post("/grafo/enlaces", async (request, reply) => {
    const userId = requireUser(request);
    const body = parseBody(
      z.object({
        origenTipo: tipoZ,
        origenId: uuid,
        destinoTipo: tipoZ,
        destinoId: uuid,
        etiqueta: z.string().trim().max(60).default(""),
      }),
      request.body,
    );

    // Enlazar algo consigo mismo no es una relación, y la base ya lo rechaza
    // con un `check`. Se comprueba también aquí para poder decir por qué, en
    // vez de devolver una violación de restricción.
    if (body.origenTipo === body.destinoTipo && body.origenId === body.destinoId) {
      throw badRequest("una cosa no se enlaza consigo misma");
    }

    return withUser(userId, async (db) => {
      try {
        await tejer(db, {
          origenTipo: body.origenTipo,
          origenId: body.origenId,
          destinoTipo: body.destinoTipo,
          destinoId: body.destinoId,
          etiqueta: body.etiqueta,
          procedencia: "persona",
          autorId: userId,
        });
      } catch (fallo) {
        if ((fallo as { code?: string }).code === RECHAZADO_POR_POLITICA) {
          throw badRequest(NO_SE_PUEDE_ENLAZAR);
        }
        throw fallo;
      }

      // Se devuelven los vecinos del origen y no solo el enlace: quien acaba de
      // enlazar algo está mirando esa lista, y devolverla evita la segunda
      // petición que haría cualquier pantalla justo después.
      return reply.status(201).send({
        vecinos: await vecinosDe(db, body.origenTipo as TipoDeNodo, body.origenId),
      });
    });
  });

  /**
   * Quitar un enlace.
   *
   * Sin `if` de permisos, otra vez: la política de `delete` exige los dos
   * extremos igual que la de `select`, así que un enlace que no se puede ver
   * tampoco se puede borrar — y borrar algo invisible afecta a cero filas, que
   * es lo que se comprueba abajo.
   */
  app.delete("/grafo/enlaces/:enlaceId", async (request, reply) => {
    const userId = requireUser(request);
    const { enlaceId } = parseParams(z.object({ enlaceId: uuid }), request.params);

    await withUser(userId, async (db) => {
      const { rowCount } = await db.query("delete from graph_links where id = $1", [enlaceId]);
      // `rowCount` a cero puede ser «ya no estaba» o «no es tuyo», y la
      // respuesta es la misma por el mismo motivo que arriba.
      if (rowCount === 0) throw notFound("ese enlace no existe o no está a tu alcance");
    });

    return reply.status(204).send();
  });
}
