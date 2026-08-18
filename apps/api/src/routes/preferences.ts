import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { parseBody, requireUser } from "../lib/http.js";

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
const WIDGETS = ["spotify", "noticias", "notificaciones", "enlaces"] as const;
type Widget = (typeof WIDGETS)[number];

const DEFECTO: { widgets: Widget[]; spotifyMode: "boton" | "expandido" } = {
  widgets: [...WIDGETS],
  spotifyMode: "boton",
};

export async function preferenceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/me/dashboard", async (request) => {
    const userId = requireUser(request);
    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ widgets: Widget[]; spotifyMode: "boton" | "expandido" }>(
        `select widgets, spotify_mode as "spotifyMode"
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
      }),
      request.body,
    );

    return withUser(userId, async (db) => {
      // jsonb quiere el texto ya serializado, no el array de JS tal cual — el
      // mismo tropiezo que ya costó una migración entera en `github_repos`
      // (ver 0016 y la trampa correspondiente en docs/CONTINUAR-AQUI.md).
      const { rows } = await db.query<{ widgets: Widget[]; spotifyMode: "boton" | "expandido" }>(
        `insert into user_dashboard_prefs (user_id, widgets, spotify_mode)
         values ($1, $2::jsonb, $3)
         on conflict (user_id) do update
           set widgets = excluded.widgets,
               spotify_mode = excluded.spotify_mode,
               updated_at = now()
         returning widgets, spotify_mode as "spotifyMode"`,
        [userId, JSON.stringify(body.widgets), body.spotifyMode],
      );
      return rows[0]!;
    });
  });
}
