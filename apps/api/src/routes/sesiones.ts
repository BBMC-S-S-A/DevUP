import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { badRequest, notFound, parseBody, parseParams, parseQuery, requireUser } from "../lib/http.js";

const uuid = z.string().uuid();

/**
 * Las sesiones de trabajo: qué se hizo en una sentada, y por qué.
 *
 * LO QUE SE ESCRIBE ES SOLO LO QUE DEVUP NO SABE. El resumen, las decisiones,
 * los PRs y los pendientes llegan en el cuerpo. Los hechos —tareas movidas,
 * archivos subidos a la biblioteca— se leen al pedir el detalle, del registro
 * de actividad y de `files`, entre el inicio y el fin de la sesión y de esa
 * persona. Ver la cabecera de `0072_sesiones.sql`.
 *
 * PARA QUE OTRA IA RECOJA EL CONTEXTO. La consulta pensada es «dame las
 * últimas sesiones de este espacio», que es lo que hace `ver_sesiones` desde
 * el MCP: con eso, una conversación nueva arranca sabiendo lo que se decidió
 * en las anteriores.
 */

const texto = (max: number) => z.string().trim().min(1).max(max);

const esquemaSesion = z.object({
  titulo: texto(160),
  resumen: z.string().trim().max(8000).default(""),
  decisiones: z.array(texto(500)).max(40).default([]),
  pendientes: z.array(texto(500)).max(40).default([]),
  prs: z
    .array(
      z.object({
        repo: texto(200),
        numero: z.number().int().positive().optional(),
        url: z.string().url().max(500).optional(),
        titulo: z.string().trim().max(200).optional(),
        estado: z.string().trim().max(40).optional(),
      }),
    )
    .max(30)
    .default([]),
  archivos: z.array(texto(300)).max(60).default([]),
  inicio: z.string().datetime({ offset: true }),
  fin: z.string().datetime({ offset: true }).optional(),
  procedencia: z.enum(["persona", "agente"]).default("persona"),
});

const COLUMNAS = `
  s.id, s.workspace_id as "espacioId", s.title as "titulo", s.summary as "resumen",
  s.decisions as "decisiones", s.pending as "pendientes", s.pull_requests as "prs",
  s.files_touched as "archivos", s.source as "procedencia",
  s.started_at as "inicio", s.ended_at as "fin", s.created_at as "creada",
  s.author_id as "autorId", p.display_name as "autorNombre", p.avatar_url as "autorAvatar"`;

/** Tope de hechos en el detalle: una sesión de una semana puede tener cientos. */
const TOPE_HECHOS = 200;

export async function sesionesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/workspaces/:workspaceId/sesiones", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const { antes, limite } = parseQuery(
      z.object({
        antes: z.string().datetime().optional(),
        limite: z.coerce.number().int().min(1).max(50).default(20),
      }),
      request.query,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `select ${COLUMNAS}
           from work_sessions s
           left join profiles p on p.id = s.author_id
          where s.workspace_id = $1
            and ($2::timestamptz is null or s.ended_at < $2::timestamptz)
          order by s.ended_at desc
          limit $3`,
        [workspaceId, antes ?? null, limite],
      );
      return { sesiones: rows, hayMas: rows.length === limite };
    });
  });

  app.post("/workspaces/:workspaceId/sesiones", async (request, reply) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const body = parseBody(esquemaSesion, request.body);

    const fin = body.fin ? new Date(body.fin) : new Date();
    const inicio = new Date(body.inicio);
    if (inicio > fin) throw badRequest("la sesión no puede terminar antes de empezar");
    if (fin.getTime() - inicio.getTime() > 7 * 24 * 60 * 60 * 1000) {
      throw badRequest("una sesión dura como mucho una semana");
    }

    const sesion = await withUser(userId, async (db) => {
      const { rows: espacio } = await db.query<{ organization_id: string }>(
        "select organization_id from workspaces where id = $1",
        [workspaceId],
      );
      if (!espacio[0]) throw notFound("espacio no encontrado");

      const { rows } = await db.query<{ id: string }>(
        `insert into work_sessions
           (workspace_id, organization_id, author_id, source, title, summary,
            decisions, pending, pull_requests, files_touched, started_at, ended_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         returning id`,
        [
          workspaceId,
          espacio[0].organization_id,
          userId,
          body.procedencia,
          body.titulo,
          body.resumen,
          JSON.stringify(body.decisiones),
          JSON.stringify(body.pendientes),
          JSON.stringify(body.prs),
          JSON.stringify(body.archivos),
          inicio.toISOString(),
          fin.toISOString(),
        ],
      );
      const { rows: completa } = await db.query(
        `select ${COLUMNAS} from work_sessions s left join profiles p on p.id = s.author_id where s.id = $1`,
        [rows[0]!.id],
      );
      return completa[0];
    });

    return reply.status(201).send({ sesion });
  });

  /**
   * El detalle: lo escrito, más lo que DevUP registró de esa persona en esa
   * ventana. Los hechos van del más viejo al más nuevo, que es como se cuenta
   * una sesión.
   */
  app.get("/sesiones/:sesionId", async (request) => {
    const userId = requireUser(request);
    const { sesionId } = parseParams(z.object({ sesionId: uuid }), request.params);

    return withUser(userId, async (db) => {
      const { rows } = await db.query<Record<string, unknown> & {
        espacioId: string;
        autorId: string;
        inicio: string;
        fin: string;
      }>(
        `select ${COLUMNAS} from work_sessions s left join profiles p on p.id = s.author_id where s.id = $1`,
        [sesionId],
      );
      const sesion = rows[0];
      if (!sesion) throw notFound("sesión no encontrada");

      const [hechos, subidos] = await Promise.all([
        db.query(
          `select a.id, a.verb as "verbo", a.subject_type as "sujeto", a.subject_id as "sujetoId",
                  a.subject_label as "sujetoNombre", a.detail as "detalle", a.source as "procedencia",
                  a.at as "cuando", a.actor_id as "actorId", p.display_name as "actorNombre",
                  p.avatar_url as "actorAvatar"
             from activity a
             left join profiles p on p.id = a.actor_id
            where a.workspace_id = $1 and a.actor_id = $2
              and a.at between $3 and $4
            order by a.at
            limit ${TOPE_HECHOS}`,
          [sesion.espacioId, sesion.autorId, sesion.inicio, sesion.fin],
        ),
        db.query(
          `select id, name as "nombre", mime_type as "mimeType", size_bytes as "tamano",
                  created_at as "cuando"
             from files
            where workspace_id = $1 and uploaded_by = $2 and status = 'ready'
              and deleted_at is null and created_at between $3 and $4
            order by created_at`,
          [sesion.espacioId, sesion.autorId, sesion.inicio, sesion.fin],
        ),
      ]);

      return { sesion: { ...sesion, hechos: hechos.rows, archivosSubidos: subidos.rows } };
    });
  });

  app.delete("/sesiones/:sesionId", async (request, reply) => {
    const userId = requireUser(request);
    const { sesionId } = parseParams(z.object({ sesionId: uuid }), request.params);
    // RLS solo deja borrar las propias: si no es tuya, para ti no existe.
    const { rowCount } = await withUser(userId, (db) =>
      db.query("delete from work_sessions where id = $1", [sesionId]),
    );
    if (!rowCount) throw notFound("sesión no encontrada");
    return reply.status(204).send();
  });
}
