import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { withUser } from "../db/pool.js";
import { WIDGETS_CON_DATOS, datosDeWidgets } from "../lib/widgets.js";
import {
  badRequest,
  forbidden,
  notFound,
  parseBody,
  parseParams,
  parseQuery,
  requireUser,
} from "../lib/http.js";
import { saludDeLaInstalacion } from "../lib/salud.js";
import { env } from "../env.js";
import {
  buildUserAssetKey,
  deleteObject,
  headObject,
  signDownload,
  signUpload,
  userOfKey,
} from "../storage/s3.js";

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
        /**
         * El huso, en nombre IANA («America/Bogota»). Cadena vacía lo borra y
         * vuelve a UTC, igual que `title`.
         *
         * Va aquí y no en `/organizations/:id/me` porque una persona está donde
         * está: no cambia de huso al cambiar de proyecto. Lo que sí cambia de
         * una organización a otra es el oficio, y eso vive allí.
         */
        timezone: z.string().trim().max(60).optional(),
      }),
      request.body,
    );

    return withUser(userId, async (db) => {
      // Por su función y no con un UPDATE aquí: la validación contra la lista
      // de husos de Postgres vive dentro (0056), y meterla también aquí sería
      // una segunda copia de la misma regla, que es como acaban discrepando.
      if (body.timezone !== undefined) {
        await db.query("select public.set_my_timezone($1)", [body.timezone]);
      }

      const { rows } = await db.query<{
        presence: string;
        title: string | null;
        displayName: string;
        timezone: string | null;
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
      returning presence, title, display_name as "displayName", timezone`,
        [userId, body.presence ?? null, body.title ?? null, body.displayName ?? null],
      );
      return rows[0]!;
    });
  });

  /**
   * El estado de esta instalación.
   *
   * SOLO QUIEN ADMINISTRA, y se comprueba con `is_org_admin` y no mirando el
   * rol en la sesión: la regla de quién administra vive en la base y consultarla
   * ahí es lo que impide que una copia se quede vieja.
   *
   * VA COLGADO DE UNA ORGANIZACIÓN aunque lo que cuenta sea de la instalación
   * entera, y conviene saber por qué: en DevUP no existe un «administrador del
   * sistema» — el permiso más alto que hay es administrar una organización. Así
   * que la pregunta que se puede contestar no es «¿eres superusuario?» sino
   * «¿administras esto?», y eso obliga a nombrar cuál.
   *
   * No devuelve ni una clave ni una dirección: ver `lib/salud.ts`. Una pantalla
   * de diagnóstico que enseña la mitad de un secreto es una filtración con
   * buena intención.
   */
  app.get("/organizations/:orgId/salud", async (request) => {
    const userId = requireUser(request);
    const { orgId } = parseParams(z.object({ orgId: z.string().uuid() }), request.params);

    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ ok: boolean }>("select public.is_org_admin($1) as ok", [
        orgId,
      ]);
      if (!rows[0]?.ok) throw forbidden("solo quien administra puede ver el estado técnico");
      return saludDeLaInstalacion(db);
    });
  });

  /**
   * De qué no quieres que te avisen.
   *
   * SE MANDA LA LISTA ENTERA y no «silencia esto» / «quita esto», al revés que
   * los gerentes de una rama. Aquí sí es correcto: esto lo edita una sola
   * persona —tú— en un formulario que se ve completo, así que no hay dos
   * ediciones simultáneas que puedan pisarse. La regla no es «lotes malos, uno
   * a uno bueno»: es que la forma del gesto siga a quién lo hace.
   *
   * Las clases válidas las decide la base (0060), no esta ruta. Repetir la
   * lista aquí sería una segunda copia que algún día discrepará — y el día que
   * discrepe, lo hará dejando pasar algo que la base rechaza, o rechazando algo
   * que la base admite.
   */
  app.get("/me/avisos", async (request) => {
    const userId = requireUser(request);
    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ silenciados: string[] }>(
        "select avisos_silenciados as silenciados from profiles where id = $1",
        [userId],
      );
      return { silenciados: rows[0]?.silenciados ?? [] };
    });
  });

  app.put("/me/avisos", async (request) => {
    const userId = requireUser(request);
    const { silenciados } = parseBody(
      z.object({ silenciados: z.array(z.string().trim().min(1).max(40)).max(10) }),
      request.body,
    );

    await withUser(userId, (db) =>
      db.query("select public.set_my_avisos_silenciados($1::text[])", [silenciados]),
    );
    return { silenciados };
  });

  /**
   * Dar el recorrido por visto, o volver a pedirlo.
   *
   * SALTARLO CUENTA COMO VERLO. Quien lo cierra ha tomado una decisión —«esto
   * no me hace falta»— y ponérselo delante otra vez mañana es no haberla
   * respetado. Se vuelve a pedir desde ajustes, que es donde se busca algo que
   * se cerró queriendo.
   */
  app.put("/me/recorrido", async (request) => {
    const userId = requireUser(request);
    const { visto } = parseBody(z.object({ visto: z.boolean() }), request.body);

    await withUser(userId, (db) => db.query("select public.set_my_recorrido($1)", [visto]));
    return { recorridoVisto: visto };
  });

  /**
   * La foto de perfil, en tres pasos: pedir, confirmar, y quitarla.
   *
   * POR QUÉ TRES PASOS Y NO UNO. El archivo NO pasa por la API: se firma una
   * URL y el navegador sube contra el almacén. Es lo mismo que hacen los
   * archivos y el logo de una organización, y el motivo es que una foto de
   * cinco megas atravesando el servidor lo ocupa entero durante la subida.
   *
   * EL PASO DE CONFIRMAR ES DONDE ESTÁ LA SEGURIDAD, no un trámite. Sin él,
   * cualquiera con sesión podría decir «mi foto es esta clave» apuntando a la
   * de otro. Se comprueban dos cosas: que la clave sea SUYA —empieza por
   * `users/<su id>/`— y que el objeto exista de verdad en el almacén, porque
   * una subida que se cortó a medias dejaría el perfil apuntando a nada.
   */
  app.post("/me/avatar", async (request) => {
    const userId = requireUser(request);
    const body = parseBody(
      z.object({
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().max(255).default("application/octet-stream"),
      }),
      request.body,
    );

    // Solo imágenes. No es por gusto: lo que se suba aquí se va a pintar en un
    // `<img>` en todas las pantallas, y un SVG es un documento que puede traer
    // guion dentro — por eso tampoco vale.
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(body.mimeType)) {
      throw badRequest("la foto tiene que ser una imagen (PNG, JPG, WEBP, GIF o AVIF)");
    }

    const avatarKey = buildUserAssetKey(userId, body.fileName);
    return {
      avatarKey,
      uploadUrl: await signUpload(avatarKey, body.mimeType),
      expiresIn: env.S3_SIGNED_URL_TTL,
    };
  });

  app.post("/me/avatar/confirm", async (request) => {
    const userId = requireUser(request);
    const body = parseBody(z.object({ avatarKey: z.string().min(1).max(500) }), request.body);

    if (userOfKey(body.avatarKey) !== userId) {
      throw badRequest("esa clave no es tuya");
    }
    const head = await headObject(body.avatarKey);
    if (!head) throw badRequest("la subida no llegó a completarse");

    const anterior = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ set_my_avatar_key: string | null }>(
        "select public.set_my_avatar_key($1)",
        [body.avatarKey],
      );
      return rows[0]?.set_my_avatar_key ?? null;
    });

    // La anterior se borra del almacén DESPUÉS de que la base apunte a la
    // nueva. Al revés, un fallo entre medias dejaría el perfil apuntando a un
    // objeto ya borrado — una foto rota en todas las pantallas.
    if (anterior) await deleteObject(anterior);

    return { url: await signDownload(body.avatarKey, "foto", "inline") };
  });

  /**
   * Quitarse la foto.
   *
   * NO TOCA LA DE GOOGLE, y eso es lo que hace que esto se sienta como
   * deshacer: quien entró con Google vuelve a la suya, y quien no, a la
   * inicial. Borrar las dos convertiría «quitar mi foto» en «quedarme sin
   * ninguna para siempre», que no es lo que nadie pide.
   */
  app.delete("/me/avatar", async (request, reply) => {
    const userId = requireUser(request);

    const anterior = await withUser(userId, async (db) => {
      const { rows } = await db.query<{ set_my_avatar_key: string | null }>(
        "select public.set_my_avatar_key(null)",
      );
      return rows[0]?.set_my_avatar_key ?? null;
    });

    if (anterior) await deleteObject(anterior);
    return reply.status(204).send();
  });

  /**
   * Las fotos de varias personas de golpe.
   *
   * POR QUÉ EN LOTE. Un tablero enseña veinte tarjetas con su responsable, y
   * una petición por cara son veinte peticiones para pintar una pantalla. Y
   * meterlas en cada listado tampoco vale: se firmarían en cada recarga, las
   * gaste quien las gaste.
   *
   * SE DEVUELVE SOLO LO QUE SE PUEDE VER, y no es una comprobación aparte: es
   * el mismo SELECT. `profiles` solo deja ver a quien comparte organización
   * (0001), así que preguntar por un desconocido no devuelve un error que
   * confirme que existe — devuelve un hueco, igual que un identificador
   * inventado.
   */
  app.post("/avatars/urls", async (request) => {
    const userId = requireUser(request);
    const { ids } = parseBody(
      z.object({ ids: z.array(z.string().uuid()).min(1).max(60) }),
      request.body,
    );

    const gente = await withUser(userId, async (db) => {
      const { rows } = await db.query<{
        id: string;
        avatarKey: string | null;
        avatarUrl: string | null;
        usaPersonaje: boolean;
        look: Record<string, number> | null;
      }>(
        `select p.id,
                p.avatar_key as "avatarKey",
                p.avatar_url as "avatarUrl",
                p.usa_personaje as "usaPersonaje",
                -- El personaje va como los dieciséis números que es, no como
                -- una imagen: lo dibuja el navegador con el mismo atlas del
                -- mundo. Un PNG guardado habría que regenerarlo cada vez que
                -- alguien se cambia el gorro, y el día que se olvide, la cara
                -- se queda vieja sin que nada falle.
                case when p.usa_personaje and w.user_id is not null then
                  json_build_object(
                    'body', w.body, 'hair', w.hair, 'top', w.top, 'bottom', w.bottom,
                    'skinTone', w.skin_tone, 'hairTone', w.hair_tone,
                    'topTone', w.top_tone, 'bottomTone', w.bottom_tone,
                    'hat', w.hat, 'glasses', w.glasses, 'beard', w.beard,
                    'shoes', w.shoes, 'hatTone', w.hat_tone, 'shoesTone', w.shoes_tone
                  )
                end as look
           from profiles p
           left join world_avatars w on w.user_id = p.id
          where p.id = any($1::uuid[])`,
        [ids],
      );
      return rows;
    });

    /**
     * Cómo se pinta cada quien, resuelto AQUÍ y no en las pantallas.
     *
     * El orden —personaje si lo eligió, foto subida, foto de Google, y si no,
     * nada— se decide en un solo sitio a propósito. Repartido por cada vista
     * que dibuja una chapa, la que se lo saltara enseñaría la foto de Google a
     * quien acaba de elegir su personaje, y se vería perfectamente normal.
     */
    const caras: Record<string, { tipo: "foto"; url: string } | { tipo: "personaje"; look: unknown }> =
      {};
    for (const persona of gente) {
      if (persona.usaPersonaje && persona.look) {
        caras[persona.id] = { tipo: "personaje", look: persona.look };
      } else if (persona.avatarKey) {
        caras[persona.id] = {
          tipo: "foto",
          url: await signDownload(persona.avatarKey, "foto", "inline"),
        };
      } else if (persona.avatarUrl) {
        caras[persona.id] = { tipo: "foto", url: persona.avatarUrl };
      }
      // Sin entrada = la inicial. Un hueco es una respuesta, no un fallo.
    }

    return { caras, expiresIn: env.S3_SIGNED_URL_TTL };
  });

  /**
   * Elegir entre la foto y el personaje.
   *
   * Ruta propia y no un campo de `/me/profile` porque no es un dato del
   * perfil: es qué se pinta con los datos que ya hay. Y porque el gesto es un
   * interruptor —lo enciendes desde la propia chapa— y no un formulario que se
   * guarda entero.
   */
  app.put("/me/avatar/personaje", async (request) => {
    const userId = requireUser(request);
    const { usar } = parseBody(z.object({ usar: z.boolean() }), request.body);

    await withUser(userId, (db) =>
      db.query("select public.set_my_usa_personaje($1)", [usar]),
    );
    return { usaPersonaje: usar };
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
