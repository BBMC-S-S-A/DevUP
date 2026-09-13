import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { WIDGETS_CON_DATOS, datosDeWidgets } from "../lib/widgets.js";
import { notFound, parseBody, parseParams, parseQuery, requireUser } from "../lib/http.js";

/**
 * La lista CERRADA de la 0052. Se escribe aquí además de en la base porque zod
 * tiene que poder rechazar un valor inventado ANTES de llegar a Postgres: sin
 * esto, un rol que no existe llega como un error de tipo del motor, que es un
 * 500 donde debería haber un 400.
 */
const ROLES_DE_EQUIPO = [
  "producto",
  "gestion",
  "direccion",
  "frontend",
  "backend",
  "fullstack",
  "movil",
  "diseno",
  "qa",
  "datos",
  "ia",
  "plataforma",
  "seguridad",
] as const;

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

  /**
   * El panel que toca.
   *
   * CON `espacio`, EL DE ESE ESPACIO; SIN ÉL, EL DE PARTIDA. La regla de cuál
   * gana no está aquí sino en `panel_de` (0049), y a propósito: escrita en cada
   * cliente estaría repetida, y la segunda copia es la que se queda atrás. El
   * síntoma de que divergieran sería que la misma persona ve un panel distinto
   * según por dónde entre, y eso no se parece a un fallo.
   */
  app.get("/me/dashboard", async (request) => {
    const userId = requireUser(request);
    const { espacio } = parseQuery(
      z.object({ espacio: z.string().uuid().optional() }),
      request.query,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{
        widgets: Widget[];
        spotifyMode: "boton" | "expandido";
        layout: Layout;
        esDePartida: boolean;
      }>(
        espacio
          ? `select widgets, spotify_mode as "spotifyMode", layout,
                    es_de_partida as "esDePartida"
               from public.panel_de($2::uuid)`
          : `select widgets, spotify_mode as "spotifyMode", layout, true as "esDePartida"
               from user_dashboard_prefs
              where user_id = $1 and workspace_id is null`,
        espacio ? [userId, espacio] : [userId],
      );
      // Sin fila todavía: nadie ha tocado el panel. Se devuelve el catálogo
      // entero en el orden por defecto en vez de una lista vacía, que se leería
      // como «sin widgets» y no como «sin personalizar».
      return rows[0] ?? DEFECTO;
    });
  });

  /**
   * Los datos de los widgets de un espacio, de una vez.
   *
   * SE PIDEN LOS WIDGETS EN LA URL en vez de deducirlos del panel guardado, y
   * no es por comodidad: quien pide esto acaba de leer su panel, así que ya
   * sabe cuáles tiene. Deducirlos aquí obligaría a leer `panel_de` otra vez y,
   * peor, a servir los widgets guardados aunque la pantalla esté enseñando
   * otros —al colocar uno nuevo, antes de guardar—.
   *
   * Un nombre que no esté en el catálogo se RECHAZA en vez de ignorarse. Es una
   * lista cerrada de seis: que una errata devuelva un panel a medias sin decir
   * nada es justo la clase de fallo que luego se busca en el sitio equivocado.
   */
  app.get("/workspaces/:workspaceId/panel", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(
      z.object({ workspaceId: z.string().uuid() }),
      request.params,
    );
    const { widgets, dias } = parseQuery(
      z.object({
        widgets: z
          .string()
          .transform((texto) => texto.split(",").map((w) => w.trim()).filter(Boolean))
          .pipe(z.array(z.enum(WIDGETS_CON_DATOS)).min(1).max(WIDGETS_CON_DATOS.length)),
        dias: z.coerce.number().int().min(1).max(90).default(7),
      }),
      request.query,
    );

    return withUser(userId, async (db) => ({
      dias,
      datos: await datosDeWidgets(db, { workspaceId, widgets, dias }),
    }));
  });

  /**
   * Guardar el panel.
   *
   * CON `espacio` SE GUARDA EL DE ESE ESPACIO, y si no había, se crea — es el
   * momento en que ese espacio deja de usar el de partida. Sin `espacio` se
   * guarda el de partida, que es el que vale donde no haya uno propio.
   */
  app.put("/me/dashboard", async (request) => {
    const userId = requireUser(request);
    const body = parseBody(
      z.object({
        espacio: z.string().uuid().nullish(),
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
      // (ver la migración 0016).
      const { rows } = await db.query<{
        widgets: Widget[];
        spotifyMode: "boton" | "expandido";
        layout: Layout;
      }>(
        // `on conflict (user_id, workspace_id)` y no `(user_id)`: la 0049 soltó
        // la clave primaria de `user_id` para que pueda haber un panel por
        // espacio. Dejar aquí el destino viejo no habría dado ningún error de
        // tipos — habría dado un 500 en el primer guardado, porque el destino
        // de un `on conflict` tiene que coincidir con un índice único que ya no
        // existe. El índice de la 0049 es `nulls not distinct`, que es lo que
        // hace que el de partida (workspace_id nulo) sea uno solo.
        `insert into user_dashboard_prefs (user_id, workspace_id, widgets, spotify_mode, layout)
         values ($1, $5::uuid, $2::jsonb, $3, coalesce($4::jsonb, '{}'::jsonb))
         on conflict (user_id, workspace_id) do update
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
          body.espacio ?? null,
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
        /**
         * El nombre con el que te ve el resto.
         *
         * No se podía cambiar. Se fijaba al registrarse —o lo ponía Google— y
         * a partir de ahí era para siempre: quien se registró con un apodo, o
         * con el nombre mal escrito, no tenía forma de arreglarlo.
         *
         * Aquí NO admite vacío, al contrario que `title`. Un cargo en blanco
         * es «no tengo cargo» y se entiende; un nombre en blanco deja a una
         * persona sin forma de ser nombrada en toda la aplicación —menciones,
         * responsables de tarea, quién subió un archivo— y todas esas
         * pantallas tendrían que inventarse un texto de relleno.
         */
        displayName: z.string().trim().min(1).max(80).optional(),
      }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{
        presence: string;
        title: string | null;
        displayName: string;
      }>(
        `update profiles
            set presence = coalesce($2::presence_state, presence),
                title    = case
                             when $3::text is null then title
                             when btrim($3) = '' then null
                             else btrim($3)
                           end,
                display_name = coalesce(nullif(btrim($4), ''), display_name)
          where id = $1
      returning presence, title, display_name as "displayName"`,
        [userId, body.presence ?? null, body.title ?? null, body.displayName ?? null],
      );
      return rows[0]!;
    });
  });

  /**
   * Lo mío EN UNA ORGANIZACIÓN CONCRETA: mi oficio aquí y mi rol.
   *
   * POR QUÉ NO CABE EN `/me/profile`. Porque `/me/profile` es la persona en
   * general —un solo nombre, un solo estado— y esto cambia de organización a
   * organización: la misma persona es «backend» en un proyecto y «plataforma»
   * en otro (0048, 0052). Meterlo allí obligaría a que la ruta de «me pongo en
   * no molestar» supiera en qué organización está mirando quien la llama.
   *
   * TRES COSAS QUE SE LLAMAN PARECIDO Y NO SON LA MISMA:
   *
   *   · `role` (owner/admin/member) es el PERMISO. No se elige: lo da quien
   *     administra, y por eso no se toca desde aquí.
   *   · `title` es el OFICIO en texto libre, lo que se le enseña a los demás.
   *     Vacío aquí = se enseña el general de `profiles`.
   *   · `rol` es una lista CERRADA y solo sirve para elegir qué tutorial se
   *     ofrece. Nulo = el tutorial base, que vale para todos.
   *
   * Las dos funciones de la base no admiten un `_user`: decir a qué me dedico,
   * o qué tutorial quiero ver, no puede convertirse en decidírselo a otro.
   */
  app.get("/organizations/:orgId/me", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: z.string().uuid() }), request.params);

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{
        role: string;
        title: string | null;
        tituloGeneral: string | null;
        rol: string | null;
      }>(
        `select m.role, m.title, p.title as "tituloGeneral", m.rol::text as rol
           from organization_members m
           join profiles p on p.id = m.user_id
          where m.organization_id = $1 and m.user_id = $2`,
        [orgId, userId],
      );
      // Las políticas ya deciden qué filas existen: si no sale ninguna, o no
      // pertenece o la organización no está a su alcance, y son la misma
      // respuesta a propósito.
      if (!rows[0]) throw notFound("no perteneces a esa organización");
      return rows[0];
    });
  });

  app.patch("/organizations/:orgId/me", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: z.string().uuid() }), request.params);
    const body = parseBody(
      z.object({
        /** Vacío lo borra, y entonces vuelve a enseñarse el general. */
        title: z.string().trim().max(40).optional(),
        /** `null` explícito vuelve al tutorial base. */
        rol: z.enum(ROLES_DE_EQUIPO).nullish(),
      }),
      request.body,
    );
    const enviado = body as Record<string, unknown>;

    return withUser(userId, async (db) => {
      if (body.title !== undefined) {
        await db.query("select public.set_my_title($1,$2)", [orgId, body.title]);
      }
      if ("rol" in enviado) {
        await db.query("select public.set_my_rol($1,$2::public.rol_de_equipo)", [
          orgId,
          body.rol ?? null,
        ]);
      }
      const { rows } = await db.query(
        `select m.role, m.title, p.title as "tituloGeneral", m.rol::text as rol
           from organization_members m
           join profiles p on p.id = m.user_id
          where m.organization_id = $1 and m.user_id = $2`,
        [orgId, userId],
      );
      return rows[0];
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
