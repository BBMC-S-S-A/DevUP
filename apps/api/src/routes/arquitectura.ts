import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { notFound, parseBody, parseParams, requireUser } from "../lib/http.js";

/**
 * El diagrama de arquitectura: nodos y enlaces, a mano.
 *
 * QUÉ RESUELVE. Infraestructura (0021) enseña despliegues, pero no deja
 * dibujar cómo está montado el sistema. Esto es esa pieza: un nodo por
 * componente —servicio, base de datos, cola— y un enlace por relación entre
 * dos. Traer una arquitectura ya escrita en Terraform queda para después.
 *
 * SE DEVUELVE TODO JUNTO. El diagrama se pinta entero o no se pinta: no hay
 * paginación de nodos que tenga sentido para un lienzo, así que una sola
 * llamada trae nodos y enlaces a la vez.
 */

const uuid = z.string().uuid();
const KIND = z.enum(["servicio", "base_datos", "cola", "cache", "almacenamiento", "api_externa", "otro"]);

const NODE_COLUMNS = `
  id, kind, name, description, pos_x as "posX", pos_y as "posY", created_at as "createdAt"`;

const LINK_COLUMNS = `id, source_id as "sourceId", target_id as "targetId", label`;
const LINK_COLUMNS_L = `l.id, l.source_id as "sourceId", l.target_id as "targetId", l.label`;

export async function arquitecturaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/organizations/:orgId/architecture", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const [nodes, links] = await Promise.all([
        db.query(
          `select ${NODE_COLUMNS} from architecture_nodes where organization_id = $1 order by created_at`,
          [orgId],
        ),
        db.query(
          `select ${LINK_COLUMNS_L}
             from architecture_links l
             join architecture_nodes n on n.id = l.source_id
            where n.organization_id = $1
            order by l.created_at`,
          [orgId],
        ),
      ]);
      return { nodes: nodes.rows, links: links.rows };
    });
  });

  app.post("/organizations/:orgId/architecture/nodes", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        kind: KIND.default("servicio"),
        name: z.string().trim().min(1).max(60),
        description: z.string().trim().max(2000).optional(),
        posX: z.number().finite(),
        posY: z.number().finite(),
      }),
      request.body,
    );

    const node = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into architecture_nodes
           (organization_id, kind, name, description, pos_x, pos_y, created_by)
         values ($1,$2::architecture_node_kind,$3,$4,$5,$6,$7)
         returning ${NODE_COLUMNS}`,
        [orgId, body.kind, body.name, body.description ?? "", body.posX, body.posY, userId],
      );
      return rows[0];
    });

    return reply.status(201).send({ node });
  });

  app.patch("/architecture/nodes/:nodeId", async (request) => {
    const userId = requireUser(request);
    const { nodeId } = parseParams(z.object({ nodeId: uuid }), request.params);
    const body = parseBody(
      z.object({
        kind: KIND.optional(),
        name: z.string().trim().min(1).max(60).optional(),
        description: z.string().trim().max(2000).optional(),
        posX: z.number().finite().optional(),
        posY: z.number().finite().optional(),
      }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `update architecture_nodes set
           kind        = coalesce($2::architecture_node_kind, kind),
           name        = coalesce($3, name),
           description = coalesce($4, description),
           pos_x       = coalesce($5, pos_x),
           pos_y       = coalesce($6, pos_y)
         where id = $1
         returning ${NODE_COLUMNS}`,
        [nodeId, body.kind ?? null, body.name ?? null, body.description ?? null, body.posX ?? null, body.posY ?? null],
      );
      // Cero filas con RLS no distingue «no existe» de «no te deja»: se
      // responde igual a propósito, ver infraestructura.ts.
      if (!rows[0]) throw notFound("nodo no encontrado");
      return { node: rows[0] };
    });
  });

  app.delete("/architecture/nodes/:nodeId", async (request, reply) => {
    const userId = requireUser(request);
    const { nodeId } = parseParams(z.object({ nodeId: uuid }), request.params);
    await withUser(userId, async (db) => {
      const { rowCount } = await db.query("delete from architecture_nodes where id = $1", [nodeId]);
      if (!rowCount) throw notFound("nodo no encontrado");
    });
    return reply.status(204).send();
  });

  /**
   * Sin `:orgId` en la ruta a propósito: un enlace no tiene organización
   * propia (ver la migración), y validarla aquí sería repetir lo que ya hace
   * la política de RLS al comprobar que los dos nodos son de la misma.
   */
  app.post("/architecture/links", async (request, reply) => {
    const userId = requireUser(request);
    const body = parseBody(
      z.object({
        sourceId: uuid,
        targetId: uuid,
        label: z.string().trim().max(60).optional(),
      }),
      request.body,
    );

    if (body.sourceId === body.targetId) throw notFound("un nodo no se enlaza consigo mismo");

    const link = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into architecture_links (source_id, target_id, label, created_by)
         values ($1,$2,$3,$4)
         returning ${LINK_COLUMNS}`,
        [body.sourceId, body.targetId, body.label ?? "", userId],
      );
      return rows[0];
    });

    return reply.status(201).send({ link });
  });

  app.delete("/architecture/links/:linkId", async (request, reply) => {
    const userId = requireUser(request);
    const { linkId } = parseParams(z.object({ linkId: uuid }), request.params);
    await withUser(userId, async (db) => {
      const { rowCount } = await db.query("delete from architecture_links where id = $1", [linkId]);
      if (!rowCount) throw notFound("enlace no encontrado");
    });
    return reply.status(204).send();
  });
}
