import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { notFound, parseBody, parseParams, requireUser } from "../lib/http.js";

const uuid = z.string().uuid();
const cents = z.number().int().min(0).max(1_000_000_000);
const STAGES = ["lead", "qualified", "proposal", "won", "lost"] as const;

/**
 * Servicios, clientes y embudo de ventas.
 *
 * Ninguna consulta lleva `where organization_id = ...`: el filtrado lo hace
 * RLS a partir de `app.user_id`, igual que en el resto de la aplicación.
 * Añadirlo a mano daría la impresión de que es él quien protege, y el día que
 * alguien lo olvide en una consulta nueva el aislamiento tiene que seguir en
 * pie.
 *
 * Los importes viajan en céntimos enteros de punta a punta. Convertirlos a
 * decimal en el camino es cómo se acaba con una cotización que suma un céntimo
 * de más: 0,1 + 0,2 no da 0,3 en coma flotante, y en dinero eso se nota.
 */
export async function salesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  // --- Servicios -------------------------------------------------------------
  app.get("/organizations/:orgId/services", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select id, name, description, unit, active,
                unit_price_cents as "unitPriceCents", currency,
                created_at as "createdAt"
           from services
          where organization_id = $1
          order by active desc, name`,
        [orgId],
      );
      return { services: rows };
    });
  });

  app.post("/organizations/:orgId/services", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().max(2000).default(""),
        unitPriceCents: cents.default(0),
        unit: z.string().trim().min(1).max(24).default("unidad"),
      }),
      request.body,
    );

    const service = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into services (organization_id, name, description, unit_price_cents, unit, created_by)
         values ($1,$2,$3,$4,$5,$6)
         returning id, name, description, unit, active,
                   unit_price_cents as "unitPriceCents", currency, created_at as "createdAt"`,
        [orgId, body.name, body.description, body.unitPriceCents, body.unit, userId],
      );
      return rows[0];
    });
    return reply.status(201).send({ service });
  });

  // --- Clientes --------------------------------------------------------------
  app.get("/organizations/:orgId/clients", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select id, name, contact_name as "contactName", contact_email as "contactEmail",
                notes, created_at as "createdAt"
           from clients
          where organization_id = $1
          order by name`,
        [orgId],
      );
      return { clients: rows };
    });
  });

  app.post("/organizations/:orgId/clients", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(160),
        contactName: z.string().max(160).default(""),
        contactEmail: z.string().max(200).default(""),
        notes: z.string().max(4000).default(""),
      }),
      request.body,
    );

    const client = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into clients (organization_id, name, contact_name, contact_email, notes, created_by)
         values ($1,$2,$3,$4,$5,$6)
         returning id, name, contact_name as "contactName", contact_email as "contactEmail",
                   notes, created_at as "createdAt"`,
        [orgId, body.name, body.contactName, body.contactEmail, body.notes, userId],
      );
      return rows[0];
    });
    return reply.status(201).send({ client });
  });

  // --- Embudo ----------------------------------------------------------------
  /**
   * El embudo entero, con el importe de cada oportunidad.
   *
   * El importe sale de `opportunity_amount_cents`, que suma el desglose, y no
   * de una columna guardada. Una columna exigiría mantenerla en cada alta,
   * baja y cambio de línea, y basta con que un camino se la salte para que el
   * embudo enseñe cifras que no cuadran con su propio detalle.
   */
  app.get("/organizations/:orgId/pipeline", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select o.id, o.title, o.stage, o.expected_close as "expectedClose",
                o.closed_at as "closedAt", o.created_at as "createdAt",
                o.client_id as "clientId", c.name as "clientName",
                o.owner_id as "ownerId", p.display_name as "ownerName",
                public.opportunity_amount_cents(o.id)::text as "amountCents"
           from opportunities o
           join clients c on c.id = o.client_id
           left join profiles p on p.id = o.owner_id
          where o.organization_id = $1
          order by o.created_at desc`,
        [orgId],
      );
      // El importe llega como texto: un bigint en céntimos cabe de sobra en un
      // número de JavaScript, pero `pg` devuelve bigint como cadena y
      // convertirlo aquí, una vez, es mejor que confiar en que cada consumidor
      // se acuerde.
      return {
        opportunities: rows.map((row) => ({
          ...(row as Record<string, unknown>),
          amountCents: Number((row as { amountCents: string }).amountCents),
        })),
      };
    });
  });

  app.post("/organizations/:orgId/opportunities", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        clientId: uuid,
        title: z.string().trim().min(1).max(200),
        stage: z.enum(STAGES).default("lead"),
        expectedClose: z.string().date().nullable().default(null),
      }),
      request.body,
    );

    const opportunity = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into opportunities (organization_id, client_id, title, stage, expected_close, owner_id, created_by)
         values ($1,$2,$3,$4,$5,$6,$6)
         returning id, title, stage, expected_close as "expectedClose", created_at as "createdAt"`,
        [orgId, body.clientId, body.title, body.stage, body.expectedClose, userId],
      );
      return rows[0];
    });
    return reply.status(201).send({ opportunity });
  });

  /** Mover una venta por el embudo. La fecha de cierre la pone el disparador. */
  app.patch("/opportunities/:dealId", async (request) => {
    const userId = requireUser(request);
    const { dealId } = parseParams(z.object({ dealId: uuid }), request.params);
    const body = parseBody(
      z.object({
        stage: z.enum(STAGES).optional(),
        title: z.string().trim().min(1).max(200).optional(),
        expectedClose: z.string().date().nullable().optional(),
      }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `update opportunities
            set stage          = coalesce($2, stage),
                title          = coalesce($3, title),
                expected_close = coalesce($4, expected_close)
          where id = $1
      returning id, title, stage, expected_close as "expectedClose", closed_at as "closedAt"`,
        [dealId, body.stage ?? null, body.title ?? null, body.expectedClose ?? null],
      );
      if (rows.length === 0) throw notFound("oportunidad no encontrada");
      return { opportunity: rows[0] };
    });
  });

  // --- Objetivos --------------------------------------------------------------
  /**
   * Los objetivos con su avance.
   *
   * El avance no es una columna: se calcula sumando las ventas ganadas cuya
   * fecha de cierre cae en el periodo. Por eso un objetivo «avanza solo» —
   * nadie lo toca al cerrarse una venta, y reabrirla lo devuelve sin ningún
   * trabajo de compensación.
   */
  app.get("/organizations/:orgId/goals", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select g.id, g.name, g.target_cents::text as "targetCents",
                g.starts_on as "startsOn", g.ends_on as "endsOn",
                public.goal_progress_cents(g.id)::text as "progressCents",
                public.goal_deal_count(g.id) as "dealCount"
           from goals g
          where g.organization_id = $1
          order by g.starts_on desc`,
        [orgId],
      );
      return {
        goals: rows.map((row) => {
          const goal = row as Record<string, unknown> & {
            targetCents: string;
            progressCents: string;
          };
          return {
            ...goal,
            targetCents: Number(goal.targetCents),
            progressCents: Number(goal.progressCents),
          };
        }),
      };
    });
  });

  app.post("/organizations/:orgId/goals", async (request, reply) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: uuid }), request.params);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(120),
        targetCents: z.number().int().positive().max(1_000_000_000_000),
        startsOn: z.string().date(),
        endsOn: z.string().date(),
      }),
      request.body,
    );

    const goal = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into goals (organization_id, name, target_cents, starts_on, ends_on, created_by)
         values ($1,$2,$3,$4,$5,$6)
         returning id, name, target_cents::text as "targetCents",
                   starts_on as "startsOn", ends_on as "endsOn"`,
        [orgId, body.name, body.targetCents, body.startsOn, body.endsOn, userId],
      );
      // Sin filas es que RLS lo denegó: fijar objetivos es de quien administra.
      if (rows.length === 0) throw notFound("no se pudo crear el objetivo");
      return rows[0];
    });
    return reply.status(201).send({ goal });
  });

  // --- Líneas de la cotización ------------------------------------------------
  app.get("/opportunities/:dealId/items", async (request) => {
    const userId = requireUser(request);
    const { dealId } = parseParams(z.object({ dealId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select id, service_id as "serviceId", name, quantity,
                unit_price_cents as "unitPriceCents"
           from opportunity_items
          where opportunity_id = $1
          order by created_at`,
        [dealId],
      );
      return { items: rows };
    });
  });

  /**
   * Añadir un servicio a una cotización.
   *
   * El nombre y el precio se copian del servicio en este momento y no se
   * referencian. Subir la tarifa mañana no puede cambiar lo que se le cotizó
   * hoy a un cliente: con una referencia viva, revisar precios reescribiría el
   * historial de ventas sin que nadie lo pidiera.
   */
  app.post("/opportunities/:dealId/items", async (request, reply) => {
    const userId = requireUser(request);
    const { dealId } = parseParams(z.object({ dealId: uuid }), request.params);
    const body = parseBody(
      z.object({
        serviceId: uuid.nullable().default(null),
        name: z.string().trim().min(1).max(120).optional(),
        unitPriceCents: cents.optional(),
        quantity: z.number().positive().max(100_000).default(1),
      }),
      request.body,
    );

    const item = await withUser(userId, async (db) => {
      let name = body.name;
      let price = body.unitPriceCents;

      if (body.serviceId) {
        const { rows } = await db.query<{ name: string; unit_price_cents: string }>(
          "select name, unit_price_cents from services where id = $1",
          [body.serviceId],
        );
        // Si RLS no deja ver el servicio, esto no encuentra nada — y una línea
        // sin nombre ni precio no tiene sentido, así que se para aquí.
        if (rows.length === 0) throw notFound("servicio no encontrado");
        name ??= rows[0]!.name;
        price ??= Number(rows[0]!.unit_price_cents);
      }

      if (name === undefined || price === undefined) {
        throw notFound("hace falta un servicio, o un nombre y un precio");
      }

      const { rows } = await db.query(
        `insert into opportunity_items (opportunity_id, service_id, name, unit_price_cents, quantity)
         values ($1,$2,$3,$4,$5)
         returning id, service_id as "serviceId", name, quantity,
                   unit_price_cents as "unitPriceCents"`,
        [dealId, body.serviceId, name, price, body.quantity],
      );
      return rows[0];
    });
    return reply.status(201).send({ item });
  });

  app.delete("/opportunity-items/:itemId", async (request, reply) => {
    const userId = requireUser(request);
    const { itemId } = parseParams(z.object({ itemId: uuid }), request.params);
    await withUser(userId, (db) =>
      db.query("delete from opportunity_items where id = $1", [itemId]),
    );
    return reply.status(204).send();
  });
}
