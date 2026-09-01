import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { parseBody, parseParams, requireUser } from "../lib/http.js";

/**
 * Cómo quiere cada persona su panel.
 *
 * Vive en su propia tabla y con sus propias políticas (0019): es la única
 * pieza de esta ronda que no cuelga de una organización, sino de la persona —
 * nadie más en el equipo puede leerla ni tocarla, ni siquiera quien administra.
 *
 * El catálogo de widgets vive aquí y no en la base: añadir uno nuevo el día de
 * mañana no pide migración, solo ampliar esta lista y el código del cliente
 * que sabe pintarlo. Lo que la base guarda es solo el orden y qué modo usa
 * Spotify.
 */
/**
 * Las herramientas que caben en una zona de la mesa.
 *
 * El catálogo vive aquí y no en la base por el mismo motivo que el de widgets:
 * añadir una mañana no debería pedir una migración. Lo que la base guarda es
 * cuál y con qué parámetro.
 */
const HERRAMIENTAS = ["chat", "tablero", "archivos", "noticias", "notificaciones"] as const;

/** Tres es un tope de diseño, no de implementación: en un portátil, cuatro
 *  columnas dejan cada herramienta en un carril donde no se puede trabajar. */
const ZONAS_MAX = 3;

const zona = z.object({
  herramienta: z.enum(HERRAMIENTAS),
  /** El canal, para el chat. El resto de herramientas no necesitan objetivo:
   *  ya saben de qué espacio son. */
  objetivo: z.string().uuid().nullable().default(null),
});

type Zona = z.infer<typeof zona>;
const WIDGETS = ["spotify", "noticias", "notificaciones", "enlaces"] as const;
type Widget = (typeof WIDGETS)[number];

/**
 * La rejilla tiene cuatro columnas y las posiciones se miden en celdas, no en
 * píxeles: el ancho real lo decide la pantalla de cada uno. Los topes de aquí
 * son la única defensa contra un cliente que mande basura — sin ellos, un
 * ancho de 999 rompería la rejilla de quien lo guardase.
 */
const COLUMNAS = 4;
const FILAS_MAX = 24;

const casilla = z.object({
  x: z.number().int().min(0).max(COLUMNAS - 1),
  y: z.number().int().min(0).max(FILAS_MAX - 1),
  w: z.number().int().min(1).max(COLUMNAS),
  h: z.number().int().min(1).max(6),
});

type Casilla = z.infer<typeof casilla>;
type Layout = Partial<Record<Widget, Casilla>>;

const DEFECTO: {
  widgets: Widget[];
  spotifyMode: "boton" | "expandido";
  layout: Layout;
} = {
  widgets: [...WIDGETS],
  spotifyMode: "boton",
  // Vacío a propósito: que el cliente lo derive del orden. Repartir aquí una
  // rejilla concreta obligaría a que el servidor supiera el tamaño natural de
  // cada widget, que es justo lo que se decidió dejar en el cliente.
  layout: {},
};

export async function preferenceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/me/dashboard", async (request) => {
    const userId = requireUser(request);
    return withUser(userId, async (db) => {
      const { rows } = await db.query<{
        widgets: Widget[];
        spotifyMode: "boton" | "expandido";
        layout: Layout;
      }>(
        `select widgets, spotify_mode as "spotifyMode", layout
           from user_dashboard_prefs where user_id = $1`,
        [userId],
      );
      // Sin fila todavía: nadie ha tocado el panel. Se devuelve el catálogo
      // entero en el orden por defecto en vez de una lista vacía, que se leería
      // como «sin widgets» y no como «sin personalizar».
      return rows[0] ?? DEFECTO;
    });
  });

  app.put("/me/dashboard", async (request) => {
    const userId = requireUser(request);
    const body = parseBody(
      z.object({
        widgets: z.array(z.enum(WIDGETS)).max(WIDGETS.length),
        spotifyMode: z.enum(["boton", "expandido"]),
        // Opcional: un cliente viejo que solo sepa de orden sigue funcionando y
        // deja el layout como estaba, en vez de borrárselo a quien sí lo tenga.
        layout: z.record(z.enum(WIDGETS), casilla).optional(),
      }),
      request.body,
    );

    return withUser(userId, async (db) => {
      // jsonb quiere el texto ya serializado, no el array de JS tal cual — el
      // mismo tropiezo que ya costó una migración entera en `github_repos`
      // (ver 0016 y la trampa correspondiente en docs/CONTINUAR-AQUI.md).
      const { rows } = await db.query<{
        widgets: Widget[];
        spotifyMode: "boton" | "expandido";
        layout: Layout;
      }>(
        `insert into user_dashboard_prefs (user_id, widgets, spotify_mode, layout)
         values ($1, $2::jsonb, $3, coalesce($4::jsonb, '{}'::jsonb))
         on conflict (user_id) do update
           set widgets = excluded.widgets,
               spotify_mode = excluded.spotify_mode,
               -- Sin layout en el cuerpo se CONSERVA el que hubiera. Ponerlo a
               -- '{}' aquí le borraría la rejilla a quien guardase desde una
               -- pantalla que solo sabe de orden.
               layout = coalesce($4::jsonb, user_dashboard_prefs.layout),
               updated_at = now()
         returning widgets, spotify_mode as "spotifyMode", layout`,
        [
          userId,
          JSON.stringify(body.widgets),
          body.spotifyMode,
          body.layout ? JSON.stringify(body.layout) : null,
        ],
      );
      return rows[0]!;
    });
  });

  /**
   * El perfil visible: el rol y el estado de presencia.
   *
   * PATCH y no PUT porque los dos campos se cambian por separado y desde
   * sitios distintos: el rol se escribe una vez en ajustes, y el estado varias
   * veces al día desde la barra. Un PUT obligaría a mandar el rol entero cada
   * vez que alguien se pone «no molestar», y a que la barra lo conociera para
   * no borrarlo sin querer.
   *
   * `title` acepta cadena vacía para borrarlo. La alternativa —mandar null—
   * obligaría a distinguir «no lo toco» de «lo dejo en blanco», y `undefined`
   * ya significa lo primero.
   */
  app.patch("/me/profile", async (request) => {
    const userId = requireUser(request);
    const body = parseBody(
      z.object({
        presence: z.enum(["available", "busy_open", "do_not_disturb"]).optional(),
        title: z.string().trim().max(40).optional(),
      }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ presence: string; title: string | null }>(
        `update profiles
            set presence = coalesce($2::presence_state, presence),
                title    = case
                             when $3::text is null then title
                             when btrim($3) = '' then null
                             else btrim($3)
                           end
          where id = $1
      returning presence, title`,
        [userId, body.presence ?? null, body.title ?? null],
      );
      return rows[0]!;
    });
  });

  /**
   * La mesa de trabajo: qué herramientas hay abiertas y con qué anchos.
   *
   * POR ESPACIO DE TRABAJO, y esa es la diferencia con el panel. El panel
   * guarda una preferencia que vale en todas partes; la mesa guarda con qué
   * estás trabajando AQUÍ, y eso cambia de un espacio a otro — el canal de un
   * proyecto no existe en el siguiente.
   *
   * Devuelve una mesa vacía cuando no hay nada guardado en vez de un 404: para
   * quien entra por primera vez, «no tienes mesa» y «tu mesa está vacía» son lo
   * mismo, y distinguirlos obliga al cliente a tratar dos casos que se pintan
   * igual.
   */
  app.get("/me/mesa/:workspaceId", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(
      z.object({ workspaceId: z.string().uuid() }),
      request.params,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ zonas: Zona[]; fracciones: number[] }>(
        "select zonas, fracciones from user_workbench_prefs where user_id = $1 and workspace_id = $2",
        [userId, workspaceId],
      );
      return rows[0] ?? { zonas: [], fracciones: [] };
    });
  });

  app.put("/me/mesa/:workspaceId", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(
      z.object({ workspaceId: z.string().uuid() }),
      request.params,
    );
    const body = parseBody(
      z
        .object({
          zonas: z.array(zona).max(ZONAS_MAX),
          fracciones: z.array(z.number().min(0.1).max(0.8)).max(ZONAS_MAX),
        })
        // Una fracción por zona, o la mesa se pinta con columnas que no
        // corresponden a lo que hay dentro. La base no puede comprobar esto
        // —son dos jsonb sueltos— así que se comprueba aquí.
        .refine((v) => v.zonas.length === v.fracciones.length, {
          message: "hace falta un ancho por zona",
        }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ zonas: Zona[]; fracciones: number[] }>(
        `insert into user_workbench_prefs (user_id, workspace_id, zonas, fracciones)
         values ($1, $2, $3::jsonb, $4::jsonb)
         on conflict (user_id, workspace_id) do update
           set zonas = excluded.zonas,
               fracciones = excluded.fracciones,
               updated_at = now()
         returning zonas, fracciones`,
        [userId, workspaceId, JSON.stringify(body.zonas), JSON.stringify(body.fracciones)],
      );
      return rows[0]!;
    });
  });
}
