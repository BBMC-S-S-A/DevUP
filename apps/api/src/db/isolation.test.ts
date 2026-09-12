/**
 * Prueba de aislamiento entre organizaciones.
 *
 * No comprueba que la aplicación filtre bien: comprueba que la base de datos
 * filtra aunque la aplicación no lo haga. Por eso todas las consultas van sin
 * un solo `where organization_id = ...` — si RLS funciona, sobra; si alguna
 * política se rompe, esto se pone rojo.
 *
 * Cada tabla nueva con `organization_id` debería añadir su caso aquí. Es la
 * mitad barata de la disciplina que impone elegir RLS; la otra mitad es
 * acordarse de escribir la política.
 *
 *   npm run test:rls
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { env } from "../env.js";
import { decryptSecret, encryptSecret } from "../security/vault.js";
import { closePool, withUser } from "./pool.js";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Espera que la operación sea rechazada por la base de datos. */
async function denied(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    check(name, false, "la operación se permitió y debería haberse denegado");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, true);
    void message;
  }
}

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error("Falta DATABASE_ADMIN_URL: la prueba necesita crear usuarios.");
  process.exit(1);
}

async function main(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();

  const mkUser = async (label: string): Promise<string> => {
    const { rows } = await admin.query<{ register_user: string }>(
      "select public.register_user($1, $2, $3)",
      [`${label}-${suffix}@devup.test`, "hash-de-prueba", label],
    );
    return rows[0]!.register_user;
  };

  // Ana y Carla comparten organización; Bruno está en otra. Carla existe para
  // probar los canales privados: mismo tenant, distinto acceso.
  const ana = await mkUser("ana");
  const bruno = await mkUser("bruno");
  const carla = await mkUser("carla");
  // Diego entra invitado a UN workspace, no a la organización entera: es el
  // caso que separa «estás en el equipo» de «ves todo lo del equipo».
  const diego = await mkUser("diego");

  try {
    // --- Montaje: cada uno crea su mundo -----------------------------------
    const acme = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ create_organization: string }>(
          "select public.create_organization($1, $2)",
          ["Acme", `acme-${suffix}`],
        )
      ).rows[0]!.create_organization;

      const ws = (
        await db.query<{ id: string }>(
          "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
          [org, "Producto", ana],
        )
      ).rows[0]!.id;

      const publicChannel = (
        await db.query<{ create_channel: string }>(
          "select public.create_channel($1,$2,$3,$4)",
          [ws, "general", "voice", false],
        )
      ).rows[0]!.create_channel;

      const privateChannel = (
        await db.query<{ create_channel: string }>(
          "select public.create_channel($1,$2,$3,$4)",
          [ws, "dirección", "text", true],
        )
      ).rows[0]!.create_channel;

      await db.query(
        "insert into tags (organization_id, name, created_by) values ($1,$2,$3)",
        [org, "diseño", ana],
      );
      await db.query(
        `insert into files (organization_id, workspace_id, channel_id, storage_key, name, uploaded_by, status)
         values ($1,$2,$3,$4,$5,$6,'ready')`,
        [org, ws, publicChannel, `${org}/${ws}/${randomUUID()}.png`, "secreto-de-ana.png", ana],
      );
      await db.query("select public.add_member_by_email($1,$2,$3)", [
        org,
        `carla-${suffix}@devup.test`,
        "member",
      ]);

      // Workspace personal dentro de la misma organización, con contenido en
      // las tres tablas que cuelgan de él. Lo interesante no es que Ana lo vea
      // —eso es trivial— sino que Carla, que sí es de Acme, no vea nada.
      const soloWs = (
        await db.query<{ id: string }>(
          `insert into workspaces (organization_id, name, created_by, visibility)
           values ($1,$2,$3,'personal') returning id`,
          [org, "Cuaderno de Ana", ana],
        )
      ).rows[0]!.id;

      const soloChannel = (
        await db.query<{ create_channel: string }>(
          "select public.create_channel($1,$2,$3,$4)",
          [soloWs, "notas", "voice", false],
        )
      ).rows[0]!.create_channel;

      await db.query(
        `insert into files (organization_id, workspace_id, storage_key, name, uploaded_by, status)
         values ($1,$2,$3,$4,$5,'ready')`,
        [org, soloWs, `${org}/${soloWs}/${randomUUID()}.pdf`, "borrador-privado.pdf", ana],
      );

      const soloColumn = (
        await db.query<{ id: string }>(
          "select id from task_columns where workspace_id = $1 order by position limit 1",
          [soloWs],
        )
      ).rows[0]!.id;

      const soloTask = (
        await db.query<{ id: string }>(
          `insert into tasks (workspace_id, column_id, title, position, created_by)
           values ($1,$2,$3,1000,$4) returning id`,
          [soloWs, soloColumn, "idea que no comparto todavía", ana],
        )
      ).rows[0]!.id;

      return { org, ws, publicChannel, privateChannel, soloWs, soloChannel, soloTask };
    });

    const bolt = await withUser(bruno, async (db) => {
      const org = (
        await db.query<{ create_organization: string }>(
          "select public.create_organization($1, $2)",
          ["Bolt", `bolt-${suffix}`],
        )
      ).rows[0]!.create_organization;

      const ws = (
        await db.query<{ id: string }>(
          "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
          [org, "Ventas", bruno],
        )
      ).rows[0]!.id;

      await db.query(
        `insert into files (organization_id, workspace_id, storage_key, name, uploaded_by, status)
         values ($1,$2,$3,$4,$5,'ready')`,
        [org, ws, `${org}/${ws}/${randomUUID()}.png`, "secreto-de-bruno.png", bruno],
      );

      return { org, ws };
    });

    const count = async (user: string | null, table: string): Promise<number> =>
      withUser(user, async (db) => {
        const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from ${table}`);
        return Number(rows[0]!.n);
      });

    // --- Lectura: nadie ve lo del vecino -----------------------------------
    console.log("\nAislamiento de lectura");
    check("Ana ve una sola organización", (await count(ana, "organizations")) === 1);
    check("Bruno ve una sola organización", (await count(bruno, "organizations")) === 1);
    check("Ana ve sus workspaces y solo los suyos", (await count(ana, "workspaces")) === 2);
    check("Ana ve sus archivos y solo los suyos", (await count(ana, "files")) === 2);
    check("Bruno ve un solo archivo", (await count(bruno, "files")) === 1);
    check("Bruno no ve las etiquetas de Acme", (await count(bruno, "tags")) === 0);

    const brunoSeesAnaFile = await withUser(bruno, async (db) => {
      const { rows } = await db.query("select id from files where name = 'secreto-de-ana.png'");
      return rows.length;
    });
    check("Bruno no encuentra el archivo de Ana ni buscándolo por nombre", brunoSeesAnaFile === 0);

    console.log("\nSin identidad");
    check("una conexión sin app.user_id no ve organizaciones", (await count(null, "organizations")) === 0);
    check("una conexión sin app.user_id no ve archivos", (await count(null, "files")) === 0);
    check("una conexión sin app.user_id no ve usuarios", (await count(null, "users")) === 0);

    console.log("\nCanales privados dentro de la misma organización");
    check("Ana ve los tres canales que creó", (await count(ana, "channels")) === 3);
    check("Carla, miembro de Acme, solo ve el canal público", (await count(carla, "channels")) === 1);
    check("Carla sí ve el workspace compartido", (await count(carla, "workspaces")) === 1);

    console.log("\nWorkspaces personales");
    // Carla es miembro de pleno derecho de Acme. Todo lo que no ve aquí lo
    // deja de ver por la visibilidad del workspace, no por la organización.
    check("Ana ve sus dos workspaces", (await count(ana, "workspaces")) === 2);
    check("Carla solo ve el workspace compartido", (await count(carla, "workspaces")) === 1);
    check(
      "Carla no ve los canales del workspace personal de Ana",
      (await count(carla, "channels")) === 1,
    );
    check(
      "Carla no ve los archivos del workspace personal de Ana",
      (await count(carla, "files")) === 1,
    );
    check("Carla no ve las tareas de Ana", (await count(carla, "tasks")) === 0);
    check("Carla no ve ni las columnas de su tablero", (await count(carla, "task_columns")) === 3);
    check("Ana sí ve las columnas de los dos tableros", (await count(ana, "task_columns")) === 6);

    // Marcar una columna como «aquí se termina» (migración 0037). No es una
    // tabla nueva, así que no hay política nueva — pero sí una escritura nueva,
    // y una escritura que nadie comprueba es una que se descubre el día que
    // alguien de otra organización cierra las tareas de la tuya.
    // Del workspace PERSONAL de Ana, no del compartido: Carla pertenece al
    // compartido —ve sus tres columnas, se comprueba arriba— así que marcar una
    // columna suya sería legítimo. Lo que no puede tocar es el espacio personal.
    const columnaDeAna = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "select id from task_columns where workspace_id = $1 order by position limit 1",
        [acme.soloWs],
      );
      return rows[0]!.id;
    });

    const marcarTerminal = (user: string, columnId: string): Promise<number> =>
      withUser(user, async (db) => {
        const { rowCount } = await db.query(
          "update task_columns set is_terminal = true where id = $1",
          [columnId],
        );
        return rowCount ?? 0;
      });

    check("Ana puede marcar su columna como terminal", (await marcarTerminal(ana, columnaDeAna)) === 1);
    check(
      "Bruno no puede marcar la columna de Acme, ni pasando su id a mano",
      (await marcarTerminal(bruno, columnaDeAna)) === 0,
    );
    check(
      "Carla tampoco, aunque sea de la misma organización: el espacio personal no es suyo",
      (await marcarTerminal(carla, columnaDeAna)) === 0,
    );

    // --- Adjuntos de una tarea (0028) ---------------------------------------
    //
    // La columna `files.task_id` abre una puerta nueva: un archivo puede
    // apuntar a una tarea. Lo que hay que comprobar no es que se pueda
    // adjuntar, sino que no se pueda adjuntar a una tarea de OTRO sitio
    // pasando su identificador a mano.
    check(
      "Ana puede adjuntar una imagen a una tarea de su propio workspace",
      await withUser(ana, async (db) => {
        const { rowCount } = await db.query(
          `insert into files
             (organization_id, workspace_id, task_id, storage_key, name, uploaded_by, status)
           values ($1,$2,$3,$4,$5,$6,'ready')`,
          [
            acme.org,
            acme.soloWs,
            acme.soloTask,
            `${acme.org}/${acme.soloWs}/${randomUUID()}.png`,
            "captura.png",
            ana,
          ],
        );
        return rowCount === 1;
      }),
    );

    await denied(
      "Ana no puede colgar un archivo del workspace compartido de una tarea del personal",
      () =>
        withUser(ana, (db) =>
          db.query(
            `insert into files
               (organization_id, workspace_id, task_id, storage_key, name, uploaded_by, status)
             values ($1,$2,$3,$4,$5,$6,'ready')`,
            [
              acme.org,
              acme.ws,
              acme.soloTask,
              `${acme.org}/${acme.ws}/${randomUUID()}.png`,
              "cruzada.png",
              ana,
            ],
          ),
        ),
    );

    await denied("Carla no puede adjuntar nada a una tarea que no ve", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into files
             (organization_id, workspace_id, task_id, storage_key, name, uploaded_by, status)
           values ($1,$2,$3,$4,$5,$6,'ready')`,
          [
            acme.org,
            acme.soloWs,
            acme.soloTask,
            `${acme.org}/${acme.soloWs}/${randomUUID()}.png`,
            "fisgona.png",
            carla,
          ],
        ),
      ),
    );

    await denied("Carla no puede entrar en un canal del workspace personal de Ana", () =>
      withUser(carla, (db) =>
        db.query("select public.join_call($1,$2)", [acme.soloChannel, "peer-fisgon"]),
      ),
    );

    const renamedSolo = await withUser(carla, async (db) => {
      const { rowCount } = await db.query("update workspaces set name = 'Mío' where id = $1", [
        acme.soloWs,
      ]);
      return rowCount ?? 0;
    });
    check("un UPDATE sobre el workspace personal ajeno afecta a cero filas", renamedSolo === 0);

    console.log("\nPerfiles");
    // Ana y Carla comparten organización; Bruno no comparte con nadie.
    check("Ana ve su perfil y el de Carla", (await count(ana, "profiles")) === 2);
    check("Bruno solo ve su propio perfil", (await count(bruno, "profiles")) === 1);

    console.log("\nCredenciales");
    check("nadie puede leer la tabla users salvo su propia fila", (await count(ana, "users")) === 1);

    console.log("\nAislamiento de escritura");
    await denied("Bruno no puede crear un workspace en la organización de Ana", () =>
      withUser(bruno, (db) =>
        db.query(
          "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3)",
          [acme.org, "Intruso", bruno],
        ),
      ),
    );

    await denied("Bruno no puede crear un canal en el workspace de Ana", () =>
      withUser(bruno, (db) =>
        db.query("select public.create_channel($1,$2,$3,$4)", [acme.ws, "intruso", "text", false]),
      ),
    );

    await denied("nadie puede insertar un archivo declarando ser otro usuario", () =>
      withUser(bruno, (db) =>
        db.query(
          `insert into files (organization_id, workspace_id, storage_key, name, uploaded_by, status)
           values ($1,$2,$3,$4,$5,'ready')`,
          [bolt.org, bolt.ws, `${bolt.org}/${bolt.ws}/x.png`, "suplantado.png", ana],
        ),
      ),
    );

    await denied("Bruno no puede añadirse a la organización de Ana", () =>
      withUser(bruno, (db) =>
        db.query(
          "insert into organization_members (organization_id, user_id, role) values ($1,$2,'admin')",
          [acme.org, bruno],
        ),
      ),
    );

    await denied("Carla, que es miembro raso, no puede invitar a nadie", () =>
      withUser(carla, (db) =>
        db.query("select public.add_member_by_email($1,$2,$3)", [
          acme.org,
          `bruno-${suffix}@devup.test`,
          "admin",
        ]),
      ),
    );

    const renamed = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query("update organizations set name = 'Robada' where id = $1", [
        acme.org,
      ]);
      return rowCount ?? 0;
    });
    check("un UPDATE sobre la organización ajena afecta a cero filas", renamed === 0);

    const deleted = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query("delete from files where name = 'secreto-de-ana.png'");
      return rowCount ?? 0;
    });
    check("un DELETE sobre archivos ajenos afecta a cero filas", deleted === 0);

    console.log("\nMensajes");
    await withUser(ana, (db) =>
      db.query("insert into messages (channel_id, author_id, body) values ($1,$2,$3)", [
        acme.privateChannel,
        ana,
        "esto solo lo ve dirección",
      ]),
    );
    await withUser(ana, (db) =>
      db.query("insert into messages (channel_id, author_id, body) values ($1,$2,$3)", [
        acme.publicChannel,
        ana,
        "hola equipo",
      ]),
    );

    check("Ana ve sus dos mensajes", (await count(ana, "messages")) === 2);
    check(
      "Carla solo ve el del canal público, no el del privado",
      (await count(carla, "messages")) === 1,
    );
    check("Bruno no ve ningún mensaje de Acme", (await count(bruno, "messages")) === 0);

    await denied("Bruno no puede escribir en un canal ajeno", () =>
      withUser(bruno, (db) =>
        db.query("insert into messages (channel_id, author_id, body) values ($1,$2,$3)", [
          acme.publicChannel,
          bruno,
          "intruso",
        ]),
      ),
    );

    await denied("nadie puede publicar firmando como otra persona", () =>
      withUser(carla, (db) =>
        db.query("insert into messages (channel_id, author_id, body) values ($1,$2,$3)", [
          acme.publicChannel,
          ana,
          "esto no lo dijo Ana",
        ]),
      ),
    );

    const edited = await withUser(carla, async (db) => {
      const { rowCount } = await db.query("update messages set body = 'manipulado'");
      return rowCount ?? 0;
    });
    check("nadie puede editar el mensaje de otro, ni siendo del mismo canal", edited === 0);

    const unread = await withUser(carla, async (db) => {
      const { rows } = await db.query<{ unread: string }>(
        "select unread from public.unread_counts($1) where channel_id = $2",
        [acme.ws, acme.publicChannel],
      );
      return Number(rows[0]?.unread ?? -1);
    });
    check("Carla tiene un mensaje sin leer en el canal público", unread === 1);

    const privateUnread = await withUser(carla, async (db) => {
      const { rows } = await db.query("select * from public.unread_counts($1)", [acme.ws]);
      return rows.length;
    });
    check(
      "el recuento de no leídos no revela la existencia del canal privado",
      privateUnread === 1,
    );

    console.log("\nLlamadas");
    await denied("Bruno no puede entrar en la llamada de un canal ajeno", () =>
      withUser(bruno, (db) =>
        db.query("select public.join_call($1,$2)", [acme.publicChannel, "peer-intruso"]),
      ),
    );

    const session = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ join_call: string }>("select public.join_call($1,$2)", [
        acme.publicChannel,
        "peer-ana",
      ]);
      return rows[0]!.join_call;
    });
    const sameSession = await withUser(carla, async (db) => {
      const { rows } = await db.query<{ join_call: string }>("select public.join_call($1,$2)", [
        acme.publicChannel,
        "peer-carla",
      ]);
      return rows[0]!.join_call;
    });
    check("dos personas que entran al mismo canal comparten sesión", session === sameSession);

    await denied("Carla no puede entrar en la llamada del canal privado de Ana", () =>
      withUser(carla, (db) =>
        db.query("select public.join_call($1,$2)", [acme.privateChannel, "peer-carla-2"]),
      ),
    );

    const stillOpen = await withUser(ana, async (db) => {
      await db.query("select public.leave_call($1,$2)", [session, "peer-ana"]);
      const { rows } = await db.query<{ n: string }>(
        "select count(*)::text as n from call_sessions where id = $1 and ended_at is null",
        [session],
      );
      return Number(rows[0]!.n);
    });
    check("la sesión sigue abierta mientras quede alguien dentro", stillOpen === 1);

    const closed = await withUser(carla, async (db) => {
      await db.query("select public.leave_call($1,$2)", [session, "peer-carla"]);
      const { rows } = await db.query<{ n: string }>(
        "select count(*)::text as n from call_sessions where id = $1 and ended_at is not null",
        [session],
      );
      return Number(rows[0]!.n);
    });
    check("al salir el último, la sesión se cierra", closed === 1);

    // --- El mundo ----------------------------------------------------------
    //
    // El caso que de verdad importa es el de Carla. Ve el workspace, ve la
    // planta, y no debe ver la zona del canal privado — ni siquiera su nombre.
    // Es la misma trampa que ya se pisó con los workspaces personales: si la
    // política de `world_zones` colgara de `can_access_workspace` en vez de
    // `can_access_channel`, todo lo demás seguiría pasando y esta sola
    // comprobación sería la que lo cazaría.
    console.log("\nEl mundo");

    const prepare = (user: string, workspace: string): Promise<string> =>
      withUser(user, async (db) => {
        const { rows } = await db.query<{ ensure_world_room: string }>(
          "select public.ensure_world_room($1)",
          [workspace],
        );
        return rows[0]!.ensure_world_room;
      });

    const zonesIn = (user: string, room: string): Promise<number> =>
      withUser(user, async (db) => {
        const { rows } = await db.query<{ n: string }>(
          "select count(*)::text as n from world_zones where room_id = $1",
          [room],
        );
        return Number(rows[0]!.n);
      });

    const sharedRoom = await prepare(ana, acme.ws);
    check("Ana prepara la planta y sale una zona por canal", (await zonesIn(ana, sharedRoom)) === 2);

    // Idempotencia: pedir el mapa otra vez no duplica zonas ni mueve las que
    // ya estaban. Se llama en cada lectura, así que esto no es un detalle.
    await prepare(ana, acme.ws);
    check(
      "preparar la planta dos veces no duplica zonas",
      (await zonesIn(ana, sharedRoom)) === 2,
    );

    check(
      "Carla no ve la zona del canal privado, solo la del público",
      (await zonesIn(carla, sharedRoom)) === 1,
    );

    const carlaSeesPrivateZone = await withUser(carla, async (db) => {
      const { rows } = await db.query(
        "select id from world_zones where channel_id = $1",
        [acme.privateChannel],
      );
      return rows.length;
    });
    check(
      "Carla no encuentra la zona privada ni buscándola por su canal",
      carlaSeesPrivateZone === 0,
    );

    const soloRoom = await prepare(ana, acme.soloWs);
    check("la planta del workspace personal tiene su zona", (await zonesIn(ana, soloRoom)) === 1);
    check("Carla no ve nada de la planta personal de Ana", (await zonesIn(carla, soloRoom)) === 0);

    check("Ana ve sus dos plantas", (await count(ana, "world_rooms")) === 2);
    check("Carla ve solo la planta compartida", (await count(carla, "world_rooms")) === 1);
    check("Bruno no ve ninguna planta", (await count(bruno, "world_rooms")) === 0);
    check("Bruno no ve ninguna zona", (await count(bruno, "world_zones")) === 0);

    await denied("Bruno no puede preparar la planta de un workspace de Acme", () =>
      prepare(bruno, acme.ws),
    );
    await denied("Carla no puede preparar la planta del workspace personal de Ana", () =>
      prepare(carla, acme.soloWs),
    );

    // Mover una zona es editar la oficina, y pide acceso al canal que proyecta.
    const carlaMovedPrivate = await withUser(carla, async (db) => {
      const { rowCount } = await db.query(
        "update world_zones set x = x + 1 where channel_id = $1",
        [acme.privateChannel],
      );
      return rowCount ?? 0;
    });
    check("Carla no puede mover la zona del canal privado", carlaMovedPrivate === 0);

    // --- Avatares ----------------------------------------------------------
    //
    // La regla es la de `profiles`: si puedes ver el nombre de alguien, puedes
    // ver su personaje. Fuera de la organización, ni una cosa ni la otra.
    const setAvatar = (user: string, top: number): Promise<void> =>
      withUser(user, async (db) => {
        await db.query("select public.upsert_world_avatar($1::jsonb)", [
          JSON.stringify({
            body: 0, hair: 1, top, bottom: 0,
            skinTone: 2, hairTone: 3, topTone: 4, bottomTone: 5,
          }),
        ]);
      });

    await setAvatar(ana, 7);
    await setAvatar(bruno, 9);

    check("Ana ve su avatar", (await count(ana, "world_avatars")) >= 1);
    check(
      "Carla ve el avatar de Ana, que es de su organización",
      (await withUser(carla, async (db) => {
        const { rows } = await db.query("select user_id from world_avatars where user_id = $1", [
          ana,
        ]);
        return rows.length;
      })) === 1,
    );
    check(
      "Bruno no ve el avatar de Ana",
      (await withUser(bruno, async (db) => {
        const { rows } = await db.query("select user_id from world_avatars where user_id = $1", [
          ana,
        ]);
        return rows.length;
      })) === 0,
    );

    const brunoTouchedAna = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query("update world_avatars set top = 42 where user_id = $1", [
        ana,
      ]);
      return rowCount ?? 0;
    });
    check("Bruno no puede vestir el avatar de Ana", brunoTouchedAna === 0);

    // --- Ventas ------------------------------------------------------------
    //
    // Cuatro tablas nuevas con `organization_id`, así que cuatro casos nuevos.
    // Lo que se comprueba no es que la aplicación filtre: es que Bruno no vea
    // el embudo de Acme aunque la consulta no lleve ni un `where`.
    console.log("\nVentas");

    const acmeSales = await withUser(ana, async (db) => {
      const service = (
        await db.query<{ id: string }>(
          `insert into services (organization_id, name, unit_price_cents, unit, created_by)
           values ($1,'Auditoría de infraestructura',150000,'jornada',$2) returning id`,
          [acme.org, ana],
        )
      ).rows[0]!.id;

      const client = (
        await db.query<{ id: string }>(
          `insert into clients (organization_id, name, contact_email, created_by)
           values ($1,'Cliente Confidencial','quien@cliente.test',$2) returning id`,
          [acme.org, ana],
        )
      ).rows[0]!.id;

      const deal = (
        await db.query<{ id: string }>(
          `insert into opportunities (organization_id, client_id, title, owner_id, created_by)
           values ($1,$2,'Migración del backend',$3,$3) returning id`,
          [acme.org, client, ana],
        )
      ).rows[0]!.id;

      await db.query(
        `insert into opportunity_items (opportunity_id, service_id, name, unit_price_cents, quantity)
         values ($1,$2,'Auditoría de infraestructura',150000,3)`,
        [deal, service],
      );

      return { service, client, deal };
    });

    check("Ana ve su servicio", (await count(ana, "services")) === 1);
    check("Ana ve su cliente", (await count(ana, "clients")) === 1);
    check("Carla, de la misma organización, ve el embudo", (await count(carla, "opportunities")) === 1);
    check("Bruno no ve ningún servicio de Acme", (await count(bruno, "services")) === 0);
    check("Bruno no ve ningún cliente de Acme", (await count(bruno, "clients")) === 0);
    check("Bruno no ve ninguna oportunidad de Acme", (await count(bruno, "opportunities")) === 0);
    check(
      "Bruno tampoco ve las líneas de la cotización",
      (await count(bruno, "opportunity_items")) === 0,
    );

    const brunoFindsClient = await withUser(bruno, async (db) => {
      const { rows } = await db.query(
        "select id from clients where name = 'Cliente Confidencial'",
      );
      return rows.length;
    });
    check("Bruno no encuentra el cliente ni buscándolo por nombre", brunoFindsClient === 0);

    await denied("Bruno no puede crear un cliente en la organización de Ana", () =>
      withUser(bruno, (db) =>
        db.query("insert into clients (organization_id, name) values ($1,$2)", [
          acme.org,
          "cliente colado",
        ]),
      ),
    );

    // Ficha de cliente y detalle de cotización: datos propios, nuevos, para
    // no tocar acmeSales — de ahí cuelgan comprobaciones de más abajo (el
    // importe, el objetivo) que darían un resultado distinto si esto les
    // moviera la cantidad o el nombre por debajo. Ese fue justo el error de
    // la primera versión de este bloque: reutilizar es cómo se acaba
    // dudando de código correcto (ver la tabla de trampas de este archivo).
    const edicion = await withUser(ana, async (db) => {
      const client = (
        await db.query<{ id: string }>(
          `insert into clients (organization_id, name, created_by)
           values ($1,'Cliente para Editar',$2) returning id`,
          [acme.org, ana],
        )
      ).rows[0]!.id;
      const deal = (
        await db.query<{ id: string }>(
          `insert into opportunities (organization_id, client_id, title, created_by)
           values ($1,$2,'Venta de prueba para editar',$3) returning id`,
          [acme.org, client, ana],
        )
      ).rows[0]!.id;
      const item = (
        await db.query<{ id: string }>(
          `insert into opportunity_items (opportunity_id, name, unit_price_cents, quantity)
           values ($1,'Línea de prueba',10000,1) returning id`,
          [deal],
        )
      ).rows[0]!.id;
      return { client, deal, item };
    });

    // Renombrar es de cualquier miembro, borrar es solo de quien administra —
    // el mismo reparto que ya usan archivos y etiquetas.
    const clientRenamedByCarla = await withUser(carla, async (db) => {
      const { rowCount } = await db.query("update clients set name = 'Renombrado por Carla' where id = $1", [
        edicion.client,
      ]);
      return rowCount ?? 0;
    });
    check("Carla, miembro raso, puede renombrar un cliente de su organización", clientRenamedByCarla === 1);

    const clientTouchedByBruno = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query("update clients set name = 'Robado' where id = $1", [
        edicion.client,
      ]);
      return rowCount ?? 0;
    });
    check("un UPDATE de Bruno sobre el cliente de Acme afecta a cero filas", clientTouchedByBruno === 0);

    const clientDeletedByBruno = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query("delete from clients where id = $1", [edicion.client]);
      return rowCount ?? 0;
    });
    check("un DELETE de Bruno sobre el cliente de Acme afecta a cero filas", clientDeletedByBruno === 0);

    // Corregir una línea de la cotización: mismo aislamiento que crearla.
    const itemEditedByCarla = await withUser(carla, async (db) => {
      const { rowCount } = await db.query("update opportunity_items set quantity = 5 where id = $1", [
        edicion.item,
      ]);
      return rowCount ?? 0;
    });
    check("Carla puede corregir la cantidad de una línea de su organización", itemEditedByCarla === 1);

    const itemEditedByBruno = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query("update opportunity_items set quantity = 999 where id = $1", [
        edicion.item,
      ]);
      return rowCount ?? 0;
    });
    check("un UPDATE de Bruno sobre una línea de Acme afecta a cero filas", itemEditedByBruno === 0);

    const brunoMoved = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query(
        "update opportunities set stage = 'won' where id = $1",
        [acmeSales.deal],
      );
      return rowCount ?? 0;
    });
    check("Bruno no puede mover una venta ajena por el embudo", brunoMoved === 0);

    // El importe sale de las líneas y no de una columna: tres jornadas a 1.500 €.
    const amount = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ cents: string }>(
        "select public.opportunity_amount_cents($1)::text as cents",
        [acmeSales.deal],
      );
      return Number(rows[0]!.cents);
    });
    check("el importe se calcula desde el desglose", amount === 450000, `salió ${amount}`);

    // La fecha de cierre la pone la base, no la aplicación. Es de lo que
    // colgará el objetivo trimestral, y depender de que cada ruta se acuerde
    // de escribirla deja objetivos que no avanzan sin que nada falle.
    const dealClosed = await withUser(ana, async (db) => {
      await db.query("update opportunities set stage = 'won' where id = $1", [acmeSales.deal]);
      const { rows } = await db.query<{ closed_at: Date | null }>(
        "select closed_at from opportunities where id = $1",
        [acmeSales.deal],
      );
      return rows[0]?.closed_at !== null;
    });
    check("al ganarse una venta, la base marca la fecha de cierre", dealClosed);

    const reopened = await withUser(ana, async (db) => {
      await db.query("update opportunities set stage = 'proposal' where id = $1", [acmeSales.deal]);
      const { rows } = await db.query<{ closed_at: Date | null }>(
        "select closed_at from opportunities where id = $1",
        [acmeSales.deal],
      );
      return rows[0]?.closed_at === null;
    });
    check("y al reabrirla la borra", reopened);

    // --- Objetivos ---------------------------------------------------------
    //
    // Lo que se prueba aquí no es solo el aislamiento: es que «avanza solo»
    // sea cierto. El objetivo no guarda su progreso, así que ganar una venta
    // tiene que moverlo sin que nadie toque el objetivo — y reabrirla tiene
    // que devolverlo.
    console.log("\nObjetivos");

    const goal = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into goals (organization_id, name, target_cents, starts_on, ends_on, created_by)
         values ($1,'Trimestre en curso',1000000, current_date - 30, current_date + 30, $2)
         returning id`,
        [acme.org, ana],
      );
      return rows[0]!.id;
    });

    const progress = (user: string): Promise<number> =>
      withUser(user, async (db) => {
        const { rows } = await db.query<{ cents: string }>(
          "select public.goal_progress_cents($1)::text as cents",
          [goal],
        );
        return Number(rows[0]!.cents);
      });

    // La venta de más arriba quedó reabierta en 'proposal', así que el
    // objetivo arranca a cero aunque la venta exista y valga 4.500 €.
    check("un objetivo nace a cero aunque haya ventas abiertas", (await progress(ana)) === 0);

    await withUser(ana, (db) =>
      db.query("update opportunities set stage = 'won' where id = $1", [acmeSales.deal]),
    );
    check(
      "al ganarse la venta, el objetivo avanza sin que nadie lo toque",
      (await progress(ana)) === 450000,
      `salió ${await progress(ana)}`,
    );

    await withUser(ana, (db) =>
      db.query("update opportunities set stage = 'proposal' where id = $1", [acmeSales.deal]),
    );
    check("y al reabrirla, vuelve atrás", (await progress(ana)) === 0);

    check("Bruno no ve el objetivo de Acme", (await count(bruno, "goals")) === 0);
    check("Carla, de la misma organización, sí lo ve", (await count(carla, "goals")) === 1);

    await denied("Carla, que es miembro raso, no puede fijar objetivos", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into goals (organization_id, name, target_cents, starts_on, ends_on)
           values ($1,'objetivo colado',100, current_date, current_date)`,
          [acme.org],
        ),
      ),
    );

    // Un objetivo no puede ser una rendija para contar ventas ajenas: la
    // función es SECURITY INVOKER, así que para Bruno la suma es cero.
    check("para Bruno, el avance de ese objetivo es cero", (await progress(bruno)) === 0);

    // --- Búsqueda global -----------------------------------------------------
    //
    // Seis tablas en un único `union all`, sin `security definer`: lo que
    // protege cada rama es la política de su propia tabla de siempre, no la
    // función. La comprobación que de verdad importa no es que Bruno no
    // encuentre nada de Acme —eso ya lo prueban las secciones de arriba, tabla
    // por tabla— es que pasarle el id de la organización de Acme como
    // parámetro no le sirve de nada: quien decide es su membresía, nunca lo
    // que pida. Y que un miembro raso de la propia Acme tampoco encuentre por
    // búsqueda lo que no vería entrando por la puerta normal.
    console.log("\nBúsqueda global");

    const acmeColumn = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "select id from task_columns where workspace_id = $1 order by position limit 1",
        [acme.ws],
      );
      return rows[0]!.id;
    });
    await withUser(ana, (db) =>
      db.query(
        `insert into tasks (workspace_id, column_id, title, position, created_by)
         values ($1,$2,'Enviar el segundo recordatorio de pago',1000,$3)`,
        [acme.ws, acmeColumn, ana],
      ),
    );

    const search = (user: string, term: string): Promise<string[]> =>
      withUser(user, async (db) => {
        const { rows } = await db.query<{ entity: string }>(
          "select entity from public.global_search($1, $2, 50)",
          [acme.org, term],
        );
        return rows.map((r) => r.entity);
      });

    check("Carla encuentra el mensaje público por «equipo»", (await search(carla, "equipo")).includes("message"));
    check(
      "Carla no encuentra el mensaje de un canal privado ajeno por «dirección»",
      !(await search(carla, "dirección")).includes("message"),
    );
    check("Carla encuentra el archivo por «secreto»", (await search(carla, "secreto")).includes("file"));
    check("Carla encuentra la tarea por «recordatorio»", (await search(carla, "recordatorio")).includes("task"));
    check("Carla encuentra el cliente por «Confidencial»", (await search(carla, "Confidencial")).includes("client"));
    check("Carla encuentra el servicio por «Auditoría»", (await search(carla, "Auditoría")).includes("service"));
    check("Carla encuentra la oportunidad por «backend»", (await search(carla, "backend")).includes("opportunity"));

    check(
      "Bruno no encuentra el mensaje aunque pida el id de la organización de Acme",
      (await search(bruno, "equipo")).length === 0,
    );
    check("Bruno no encuentra el archivo por búsqueda", (await search(bruno, "secreto")).length === 0);
    check("Bruno no encuentra la tarea por búsqueda", (await search(bruno, "recordatorio")).length === 0);
    check("Bruno no encuentra el cliente por búsqueda", (await search(bruno, "Confidencial")).length === 0);
    check("Bruno no encuentra el servicio por búsqueda", (await search(bruno, "Auditoría")).length === 0);
    check("Bruno no encuentra la oportunidad por búsqueda", (await search(bruno, "backend")).length === 0);

    // Buscar SIN acotar a ninguna organización (migración 0036). Es el caso
    // que de verdad importa de ese cambio: pasarle nulo quita el `where
    // organization_id`, y si el aislamiento dependiera de ese `where` —y no de
    // las políticas, como está escrito— esto sería una fuga entre clientes.
    // Aquí es donde se ve que no lo es.
    // Devuelve los TÍTULOS y no solo el tipo. Sin acotar, «no ve nada» es la
    // comprobación equivocada: Bruno tiene su propio `secreto-de-bruno.png` y
    // encontrarlo es lo correcto. Lo que hay que demostrar es que no aparece lo
    // de Acme, que es una afirmación distinta y mucho más fuerte.
    const buscarEnTodo = (user: string, term: string): Promise<string[]> =>
      withUser(user, async (db) => {
        const { rows } = await db.query<{ title: string }>(
          "select title from public.global_search(null, $1, 50)",
          [term],
        );
        return rows.map((r) => r.title ?? "");
      });

    const deBruno = await buscarEnTodo(bruno, "secreto");

    check(
      "Sin acotar, Carla sigue encontrando lo suyo",
      (await buscarEnTodo(carla, "equipo")).length > 0,
    );
    check(
      "Sin acotar, Bruno SÍ encuentra su propio archivo",
      deBruno.includes("secreto-de-bruno.png"),
    );
    check(
      "Sin acotar, Bruno NO ve el archivo de Acme — y esto es lo que importa",
      !deBruno.includes("secreto-de-ana.png"),
    );
    check(
      "Sin acotar, Bruno NO ve el mensaje de Acme",
      (await buscarEnTodo(bruno, "equipo")).length === 0,
    );
    check(
      "Sin acotar, Bruno NO ve el cliente de Acme",
      (await buscarEnTodo(bruno, "Confidencial")).length === 0,
    );
    check(
      "Sin acotar, Carla tampoco ve el canal privado ajeno",
      !(await buscarEnTodo(carla, "dirección")).some((t) => t.includes("dirección")),
    );

    // --- Bóveda de credenciales ------------------------------------------------
    //
    // Dos tablas: connections (metadata) y connection_secrets (el token
    // cifrado). connection_secrets sí tiene política de SELECT —ver la
    // cabecera de 0015_vault.sql sobre por qué no puede no tenerla, o ni el
    // propio conector podría leer el token para llamar a su proveedor— así
    // que lo que hay que probar no es "nadie lo lee": es que solo lo lee
    // quien ya podría ver que la conexión existe, ni una fila más.
    console.log("\nBóveda de credenciales");

    const acmeConnection = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into connections (provider, organization_id, display_name, created_by)
         values ('github', $1, 'Repo de producto', $2) returning id`,
        [acme.org, ana],
      );
      const id = rows[0]!.id;
      await db.query(
        "insert into connection_secrets (connection_id, encrypted_secret) values ($1,$2)",
        [id, encryptSecret("ghp_secreto-de-prueba")],
      );
      return id;
    });

    check("Ana ve la conexión que creó", (await count(ana, "connections")) === 1);
    check("Carla, de la misma organización, también la ve", (await count(carla, "connections")) === 1);
    check("Bruno no ve ninguna conexión de Acme", (await count(bruno, "connections")) === 0);

    const secretRowsVisibleTo = (user: string): Promise<number> =>
      withUser(user, async (db) => {
        const { rows } = await db.query(
          "select connection_id from connection_secrets where connection_id = $1",
          [acmeConnection],
        );
        return rows.length;
      });
    check(
      "Carla puede leer la fila del secreto cifrado — lo necesita el conector para llamar a GitHub",
      (await secretRowsVisibleTo(carla)) === 1,
    );
    check(
      "Bruno no puede leer el secreto ni sabiendo el id de la conexión",
      (await secretRowsVisibleTo(bruno)) === 0,
    );

    check(
      "cifrar y descifrar con la bóveda devuelve el mismo texto",
      decryptSecret(encryptSecret("un secreto cualquiera")) === "un secreto cualquiera",
    );

    /**
     * Poder ACTUALIZAR el secreto, no solo leerlo.
     *
     * Este caso existe porque su ausencia costó una tarde: 0015 puso políticas
     * de select, insert y delete y se olvidó la de update, y con RLS activo eso
     * no da error — afecta a cero filas. El token de Spotify caduca cada hora y
     * su refresco se estaba tirando a la basura en silencio.
     *
     * Cuenta las filas afectadas y no si la consulta lanzó: una política que
     * falta se ve exactamente así, como un UPDATE que «funciona» sin cambiar
     * nada.
     */
    const secretoActualizado = await withUser(ana, async (db) => {
      const { rowCount } = await db.query(
        "update connection_secrets set encrypted_secret = $2 where connection_id = $1",
        [acmeConnection, encryptSecret("token-refrescado")],
      );
      return rowCount ?? 0;
    });
    check("Ana puede refrescar el secreto de su conexión", secretoActualizado === 1);

    const brunoActualizoSecreto = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query(
        "update connection_secrets set encrypted_secret = $2 where connection_id = $1",
        [acmeConnection, encryptSecret("robado")],
      );
      return rowCount ?? 0;
    });
    check(
      "un UPDATE de Bruno sobre el secreto de Acme afecta a cero filas",
      brunoActualizoSecreto === 0,
    );

    await denied("Carla, que es miembro raso, no puede conectar una cuenta a nombre de la organización", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into connections (provider, organization_id, display_name, created_by)
           values ('github', $1, 'colada', $2)`,
          [acme.org, carla],
        ),
      ),
    );

    await denied("Bruno no puede añadir un secreto a una conexión de Acme", () =>
      withUser(bruno, (db) =>
        db.query("insert into connection_secrets (connection_id, encrypted_secret) values ($1,$2)", [
          acmeConnection,
          encryptSecret("robado"),
        ]),
      ),
    );

    const brunoDeletedConnection = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query("delete from connections where id = $1", [acmeConnection]);
      return rowCount ?? 0;
    });
    check("un DELETE de Bruno sobre la conexión de Acme afecta a cero filas", brunoDeletedConnection === 0);

    // Personal: Ana conecta su propia cuenta. Ni Carla ni Bruno la ven — ni
    // siquiera Carla, que es de la misma organización: no es de la
    // organización, es suya.
    const anaPersonalConnection = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into connections (provider, user_id, display_name, created_by)
         values ('spotify', $1, 'Cuenta personal', $1) returning id`,
        [ana],
      );
      return rows[0]!.id;
    });
    const carlaSeesPersonal = await withUser(carla, async (db) => {
      const { rows } = await db.query("select 1 from connections where id = $1", [
        anaPersonalConnection,
      ]);
      return rows.length;
    });
    check(
      "Carla no ve la conexión personal de Ana aunque sean de la misma organización",
      carlaSeesPersonal === 0,
    );

    await denied("Carla no puede conectar una cuenta personal en nombre de Ana", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into connections (provider, user_id, display_name, created_by)
           values ('spotify', $1, 'suplantación', $2)`,
          [ana, carla],
        ),
      ),
    );

    // --- Conector de GitHub --------------------------------------------------
    //
    // github_repo_stats no tiene ninguna política de escritura: solo
    // `upsert_github_repo_stats` (security definer) puede escribir en ella.
    // Lo que se prueba aquí es lectura —hereda de la visibilidad del repo— y
    // que solo un admin de la organización puede añadir o quitar uno.
    //
    // DESDE 0034 EL DUEÑO ES `organization_id`, NO LA CONEXIÓN: un repositorio
    // público se añade pegando su enlace y no tiene conexión ninguna. El caso
    // sin token se prueba aquí abajo aparte, porque es el que no existía
    // cuando se escribieron estas comprobaciones.
    console.log("\nConector de GitHub");

    const acmeRepo = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into github_repos (connection_id, organization_id, workspace_id, full_name, added_by)
         values ($1,$2,$3,'acme/producto',$4) returning id`,
        [acmeConnection, acme.org, acme.ws, ana],
      );
      const id = rows[0]!.id;
      await db.query("select public.upsert_github_repo_stats($1, $2::jsonb, null)", [
        id,
        JSON.stringify({ openPullRequests: 2 }),
      ]);
      return id;
    });

    check("Ana ve el repositorio que conectó", (await count(ana, "github_repos")) === 1);
    check("Carla, de la misma organización, también lo ve", (await count(carla, "github_repos")) === 1);
    check("Bruno no ve ningún repositorio de Acme", (await count(bruno, "github_repos")) === 0);

    check("Carla ve las estadísticas del repositorio", (await count(carla, "github_repo_stats")) === 1);
    check("Bruno no ve las estadísticas de un repositorio ajeno", (await count(bruno, "github_repo_stats")) === 0);

    await denied("Carla, que es miembro raso, no puede conectar un repositorio", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into github_repos (connection_id, organization_id, workspace_id, full_name, added_by)
           values ($1,$2,$3,'acme/colado',$4)`,
          [acmeConnection, acme.org, acme.ws, carla],
        ),
      ),
    );

    await denied("Bruno no puede conectar un repositorio en la organización de Acme", () =>
      withUser(bruno, (db) =>
        db.query(
          `insert into github_repos (connection_id, organization_id, workspace_id, full_name, added_by)
           values ($1,$2,$3,'bruno/intruso',$4)`,
          [acmeConnection, acme.org, acme.ws, bruno],
        ),
      ),
    );

    // --- Un repositorio público, sin token detrás (0034) ----------------------
    //
    // Es el caso nuevo y el que más importa comprobar: sin conexión, lo único
    // que aísla la fila es su `workspace_id` (0035). Si esa política estuviera
    // mal, un repositorio añadido pegando un enlace sería visible para
    // cualquiera.
    const acmePublico = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into github_repos (connection_id, organization_id, workspace_id, full_name, added_by)
         values (null,$1,$2,'acme/publico',$3) returning id`,
        [acme.org, acme.ws, ana],
      );
      return rows[0]!.id;
    });

    check("Ana ve el repositorio público que añadió sin token", (await count(ana, "github_repos")) === 2);
    check("Carla, de la misma organización, también lo ve", (await count(carla, "github_repos")) === 2);
    check("Bruno sigue sin ver ninguno", (await count(bruno, "github_repos")) === 0);

    await denied("Bruno no puede colar un repositorio sin token en Acme", () =>
      withUser(bruno, (db) =>
        db.query(
          `insert into github_repos (connection_id, organization_id, workspace_id, full_name, added_by)
           values (null,$1,$2,'bruno/publico',$3)`,
          [acme.org, acme.ws, bruno],
        ),
      ),
    );

    // --- Un workspace no ve el git de otro, ni siendo de la misma empresa ----
    //
    // ESTE ES EL CASO QUE FALTABA, y el fallo que 0035 arregla: hasta ahora
    // esto colgaba de la organización, así que los tres proyectos de una
    // empresa veían exactamente los mismos repositorios. Carla es de Acme, y
    // aun así no tiene por qué ver lo del cuaderno personal de Ana.
    await withUser(ana, (db) =>
      db.query(
        `insert into github_repos (connection_id, organization_id, workspace_id, full_name, added_by)
         values (null,$1,$2,'acme/solo-de-ana',$3)`,
        [acme.org, acme.soloWs, ana],
      ),
    );

    check("Ana ve también el repositorio de su workspace personal", (await count(ana, "github_repos")) === 3);
    check(
      "Carla, de la misma organización, NO lo ve: es de otro workspace",
      (await count(carla, "github_repos")) === 2,
    );

    await denied("Carla no puede meter un repositorio en un workspace al que no llega", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into github_repos (connection_id, organization_id, workspace_id, full_name, added_by)
           values (null,$1,$2,'acme/colado-en-el-cuaderno',$3)`,
          [acme.org, acme.soloWs, carla],
        ),
      ),
    );

    const brunoAdopto = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query(
        "update github_repos set connection_id = null where id = $1",
        [acmePublico],
      );
      return rowCount ?? 0;
    });
    check("un UPDATE de Bruno sobre un repositorio de Acme afecta a cero filas", brunoAdopto === 0);

    const brunoDeletedRepo = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query("delete from github_repos where id = $1", [acmeRepo]);
      return rowCount ?? 0;
    });
    check("un DELETE de Bruno sobre el repositorio de Acme afecta a cero filas", brunoDeletedRepo === 0);

    // --- La mesa de trabajo ------------------------------------------------------
    //
    // Es de la persona y de nadie más: ni siquiera quien administra la
    // organización ve cómo coloca alguien sus herramientas. Y además tiene que
    // pertenecer al espacio, o se podrían guardar disposiciones para espacios
    // ajenos — invisibles para todos, pero con el identificador de ese espacio
    // dentro, que ya es contar algo que no habían preguntado.
    console.log("\nLa mesa de trabajo");

    await withUser(ana, (db) =>
      db.query(
        `insert into user_workbench_prefs (user_id, workspace_id, zonas, fracciones)
         values ($1, $2, '[{"herramienta":"tablero","objetivo":null}]'::jsonb, '[1]'::jsonb)`,
        [ana, acme.ws],
      ),
    );

    check("Ana ve su mesa", (await count(ana, "user_workbench_prefs")) === 1);
    check(
      "Carla, del mismo espacio, NO ve la mesa de Ana",
      (await count(carla, "user_workbench_prefs")) === 0,
    );
    check("Bruno tampoco", (await count(bruno, "user_workbench_prefs")) === 0);

    await denied(
      "nadie puede guardar una mesa a nombre de otra persona",
      () =>
        withUser(carla, (db) =>
          db.query(
            `insert into user_workbench_prefs (user_id, workspace_id, zonas, fracciones)
             values ($1, $2, '[]'::jsonb, '[]'::jsonb)`,
            [ana, acme.ws],
          ),
        ),
    );

    await denied(
      "ni guardar una mesa para un espacio al que no pertenece",
      () =>
        withUser(bruno, (db) =>
          db.query(
            `insert into user_workbench_prefs (user_id, workspace_id, zonas, fracciones)
             values ($1, $2, '[]'::jsonb, '[]'::jsonb)`,
            [bruno, acme.ws],
          ),
        ),
    );

    // El tope de tres zonas lo comprueba la base y no solo el cliente: una
    // petición hecha a mano no debería poder dejar una mesa que la pantalla no
    // sabe pintar.
    await denied(
      "la base rechaza una mesa de cuatro zonas",
      () =>
        withUser(ana, (db) =>
          db.query(
            `update user_workbench_prefs
                set zonas = '[{"h":1},{"h":2},{"h":3},{"h":4}]'::jsonb
              where user_id = $1`,
            [ana],
          ),
        ),
    );

    const carlaBorro = await withUser(carla, async (db) => {
      const { rowCount } = await db.query("delete from user_workbench_prefs where user_id = $1", [
        ana,
      ]);
      return rowCount ?? 0;
    });
    check("un DELETE de Carla sobre la mesa de Ana afecta a cero filas", carlaBorro === 0);
    // --- Atuendos por organización ---------------------------------------------
    //
    // Lo que se prueba aquí es la diferencia entre la política de
    // `world_avatars` y la de `world_outfits`. La primera dice «compartimos
    // alguna organización»; la segunda, «los dos estamos en ESTA». Con la
    // condición laxa, quien comparte contigo la organización A vería cómo vas
    // vestido en la B — que es exactamente lo que el atuendo existe para
    // separar.
    console.log("\nAtuendos por organización");

    await withUser(ana, (db) =>
      db.query(`select public.upsert_world_outfit($1, '{"hat":3,"topTone":9}'::jsonb)`, [
        acme.org,
      ]),
    );

    check("Ana ve el atuendo que se puso en Acme", (await count(ana, "world_outfits")) === 1);
    check(
      "Carla, de la misma organización, también lo ve",
      (await count(carla, "world_outfits")) === 1,
    );
    check("Bruno, de otra, no lo ve", (await count(bruno, "world_outfits")) === 0);

    await denied(
      "Bruno no puede vestirse en una organización a la que no pertenece",
      () =>
        withUser(bruno, (db) =>
          db.query(`select public.upsert_world_outfit($1, '{}'::jsonb)`, [acme.org]),
        ),
    );

    // Y el caso que justifica que esta tabla exista aparte: el personaje base
    // sigue viéndose entre quienes comparten cualquier organización, pero el
    // atuendo no sale de la suya.
    const brunoBorroAtuendo = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query(
        "delete from world_outfits where organization_id = $1",
        [acme.org],
      );
      return rowCount ?? 0;
    });
    check(
      "un DELETE de Bruno sobre el atuendo de Ana afecta a cero filas",
      brunoBorroAtuendo === 0,
    );

    const anaSeLoQuito = await withUser(ana, async (db) => {
      const { rowCount } = await db.query(
        "delete from world_outfits where organization_id = $1",
        [acme.org],
      );
      return rowCount ?? 0;
    });
    check("Ana sí puede quitárselo y volver a su personaje", anaSeLoQuito === 1);
    // --- Entornos y despliegues -----------------------------------------------
    //
    // `deployments` no tiene política de INSERT ni de UPDATE: la escribe
    // `upsert_deployment` (security definer) y nadie más. Lo que se prueba
    // aquí es que la lectura hereda de la organización del entorno, que
    // crear un entorno es cosa de administración, y —lo importante— que un
    // INSERT directo sobre `deployments` no cuela aunque el entorno sea tuyo.
    console.log("\nEntornos y despliegues");

    const acmeEntorno = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into environments (organization_id, workspace_id, name, kind, url, created_by)
         values ($1,$2,'producción','production','https://acme.example',$3) returning id`,
        [acme.org, acme.ws, ana],
      );
      const id = rows[0]!.id;
      await db.query(
        `select public.upsert_deployment($1,'gh-1','success','a1b2c3d','sube el panel',
                                        'ana','https://github.com/acme/p/actions/runs/1',
                                        now(), now())`,
        [id],
      );
      return id;
    });

    check("Ana ve el entorno que creó", (await count(ana, "environments")) === 1);
    check(
      "Carla, miembro rasa de la misma organización, también lo ve",
      (await count(carla, "environments")) === 1,
    );
    check("Bruno no ve el entorno de Acme", (await count(bruno, "environments")) === 0);

    check("Carla ve el despliegue del entorno", (await count(carla, "deployments")) === 1);
    check("Bruno no ve el despliegue de Acme", (await count(bruno, "deployments")) === 0);

    await denied("Carla, que es miembro rasa, no puede crear un entorno", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into environments (organization_id, workspace_id, name, created_by) values ($1,$2,'colado',$3)`,
          [acme.org, acme.ws, carla],
        ),
      ),
    );

    await denied("Bruno no puede crear un entorno en Acme", () =>
      withUser(bruno, (db) =>
        db.query(
          `insert into environments (organization_id, workspace_id, name, created_by) values ($1,$2,'intruso',$3)`,
          [acme.org, acme.ws, bruno],
        ),
      ),
    );

    // La infraestructura también es del proyecto, no de la empresa (0035).
    await withUser(ana, (db) =>
      db.query(
        `insert into environments (organization_id, workspace_id, name, created_by)
         values ($1,$2,'la de mi cuaderno',$3)`,
        [acme.org, acme.soloWs, ana],
      ),
    );

    check("Ana ve el entorno de su workspace personal", (await count(ana, "environments")) === 2);
    check(
      "Carla, de la misma organización, NO ve la infraestructura de otro workspace",
      (await count(carla, "environments")) === 1,
    );

    // --- Y el diagrama de arquitectura (0033, ya por workspace en 0035) ------
    console.log("\nDiagrama de arquitectura");

    await withUser(ana, (db) =>
      db.query(
        `insert into architecture_nodes (organization_id, workspace_id, kind, name, created_by)
         values ($1,$2,'servicio','API de Acme',$3)`,
        [acme.org, acme.ws, ana],
      ),
    );
    await withUser(ana, (db) =>
      db.query(
        `insert into architecture_nodes (organization_id, workspace_id, kind, name, created_by)
         values ($1,$2,'base_datos','La base de mi cuaderno',$3)`,
        [acme.org, acme.soloWs, ana],
      ),
    );

    check("Ana ve los dos nodos que dibujó", (await count(ana, "architecture_nodes")) === 2);
    check(
      "Carla ve el del workspace compartido y no el del personal",
      (await count(carla, "architecture_nodes")) === 1,
    );
    check("Bruno no ve ningún nodo de Acme", (await count(bruno, "architecture_nodes")) === 0);

    // El diagrama es de todo el equipo del workspace, no solo de quien
    // administra: Carla, miembro rasa, sí puede dibujar en el compartido. Es
    // la decisión de 0033 y conviene que quede escrita como prueba, porque es
    // lo contrario de lo que hacen las otras tablas de esta pantalla.
    const carlaDibujo = await withUser(carla, async (db) => {
      const { rowCount } = await db.query(
        `insert into architecture_nodes (organization_id, workspace_id, kind, name, created_by)
         values ($1,$2,'cola','La cola que añadió Carla',$3)`,
        [acme.org, acme.ws, carla],
      );
      return rowCount ?? 0;
    });
    check("Carla, miembro rasa, sí puede dibujar en el diagrama de su workspace", carlaDibujo === 1);

    await denied("pero no en el diagrama de un workspace al que no llega", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into architecture_nodes (organization_id, workspace_id, kind, name, created_by)
           values ($1,$2,'cola','colada',$3)`,
          [acme.org, acme.soloWs, carla],
        ),
      ),
    );

    console.log("\nEl grafo, que es donde el aislamiento cuesta más (0043)");

    /**
     * Un enlace toca DOS extremos, y quien ve uno puede no ver el otro.
     *
     * Carla está en el workspace y ve su tablero, pero NO está en el canal
     * privado «dirección». Un enlace entre ese canal y una tarea suya, visible
     * para ella, le revelaría que el canal existe — que es la misma fuga que el
     * producto ya se cuidó de evitar en las menciones.
     */
    const tareaDeAcme = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "select id from tasks where workspace_id = $1 limit 1",
        [acme.ws],
      );
      return rows[0]?.id ?? null;
    });

    check("puede_ver_nodo dice que sí a un canal del que se es miembro", Boolean(
      await withUser(ana, async (db) => {
        const { rows } = await db.query<{ r: boolean }>(
          "select public.puede_ver_nodo('canal', $1) as r",
          [acme.privateChannel],
        );
        return rows[0]!.r;
      }),
    ));

    const carlaVeElCanal = await withUser(carla, async (db) => {
      const { rows } = await db.query<{ r: boolean }>(
        "select public.puede_ver_nodo('canal', $1) as r",
        [acme.privateChannel],
      );
      return rows[0]!.r;
    });
    check("y que no a uno privado del que no se es", carlaVeElCanal === false);

    // Lo que NO puede pasar nunca: que un tipo desconocido, o un id que no
    // existe, devuelva NULL. NULL dentro de un `if not` se lee como «adelante»
    // — ver 0042, que es exactamente como se coló lo de las invitaciones.
    const inexistente = await withUser(carla, async (db) => {
      const { rows } = await db.query<{ r: boolean | null }>(
        "select public.puede_ver_nodo('tarea', gen_random_uuid()) as r",
      );
      return rows[0]!.r;
    });
    check("un nodo que no existe da false, nunca NULL", inexistente === false);

    if (tareaDeAcme) {
      await withUser(ana, (db) =>
        db.query(
          `insert into graph_links (source_kind, source_id, target_kind, target_id, label, created_by)
           values ('canal',$1,'tarea',$2,'se habló en',$3)`,
          [acme.privateChannel, tareaDeAcme, ana],
        ),
      );
      check("Ana teje un enlace entre su canal privado y una tarea", true);

      check("y lo ve, porque ve los dos extremos", (await count(ana, "graph_links")) === 1);

      // EL CASO DE LA TAREA: Carla ve la tarea y no el canal. El enlace tiene
      // que desaparecer entero para ella, no enseñarse a medias.
      check(
        "Carla, que ve la tarea pero no el canal, no ve el enlace",
        (await count(carla, "graph_links")) === 0,
      );
      check("y Bruno, de otra organización, tampoco", (await count(bruno, "graph_links")) === 0);

      // Y al revés: tampoco puede TEJER hacia algo que no ve. Si pudiera,
      // probaría a enlazar y sabría que existe por si la escritura pasa.
      await denied("Carla no puede tejer un enlace hacia el canal que no ve", () =>
        withUser(carla, (db) =>
          db.query(
            `insert into graph_links (source_kind, source_id, target_kind, target_id, created_by)
             values ('tarea',$1,'canal',$2,$3)`,
            [tareaDeAcme, acme.privateChannel, carla],
          ),
        ),
      );

      const carlaBorra = await withUser(carla, async (db) => {
        const { rowCount } = await db.query("delete from graph_links");
        return rowCount ?? 0;
      });
      check("ni borrarlo, que sería otra forma de saber que está", carlaBorra === 0);
      check("y después del intento sigue ahí", (await count(ana, "graph_links")) === 1);
    }

    console.log("\nEl guardián que no guardaba (0042)");

    /**
     * `is_org_admin` devolvía NULL a quien no es miembro, no `false`.
     *
     * Dentro de una política de RLS daba igual —NULL y `false` cierran las dos
     * igual— y por eso el aislamiento de las tablas nunca lo notó. En plpgsql
     * no: `if not NULL` NO entra en el `if`, así que los dos guardianes que lo
     * usaban no saltaban. Cualquiera con sesión podía fabricarse una
     * invitación de administrador a una organización ajena y aceptársela.
     *
     * Esto lo fija en el sitio exacto donde se rompió: el valor devuelto.
     */
    const comoRespondeAUnExtraño = await withUser(bruno, async (db) => {
      const { rows } = await db.query<{ r: boolean | null }>(
        "select public.is_org_admin($1) as r",
        [acme.org],
      );
      return rows[0]!.r;
    });
    check(
      "is_org_admin devuelve false a un extraño, no NULL —«no se sabe» se lee como «adelante»",
      comoRespondeAUnExtraño === false,
    );

    console.log("\nCódigo corto de invitación (0041)");

    // El código se guarda como hash, igual que el token: quien pueda leer la
    // tabla no puede usar ninguna invitación. Importa más desde que hay
    // respaldos automáticos — un código en claro viajaría en cada volcado.
    const invitacionConCodigo = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ create_invitation: string }>(
        "select public.create_invitation($1,$2,'member',$3,$4,null,$5,$6)",
        [
          acme.org,
          "dictado@acme.test",
          "hash-del-token-largo",
          new Date(Date.now() + 7 * 86_400_000).toISOString(),
          "hash-del-codigo-corto",
          new Date(Date.now() + 86_400_000).toISOString(),
        ],
      );
      return rows[0]!.create_invitation;
    });
    check("Ana, que administra, crea una invitación con código", Boolean(invitacionConCodigo));

    const porCodigo = await withUser(null, async (db) => {
      const { rows } = await db.query<{ organization_name: string }>(
        "select organization_name from public.invitation_by_token($1)",
        ["hash-del-codigo-corto"],
      );
      return rows[0]?.organization_name;
    });
    check("y se encuentra por el código, no solo por el token", porCodigo === "Acme");

    const porToken = await withUser(null, async (db) => {
      const { rows } = await db.query("select id from public.invitation_by_token($1)", [
        "hash-del-token-largo",
      ]);
      return rows.length;
    });
    check("el enlace largo sigue encontrándola igual", porToken === 1);

    // Lo que de verdad hay que fijar: Bruno NO administra Acme. Si esto dejara
    // de fallar, cualquiera podría fabricarse invitaciones a una organización
    // ajena y meterse dentro.
    await denied("Bruno no puede fabricar una invitación a una organización ajena", () =>
      withUser(bruno, (db) =>
        db.query("select public.create_invitation($1,$2,'admin',$3,$4,null,$5,$6)", [
          acme.org,
          "colado@acme.test",
          "otro-token",
          new Date(Date.now() + 86_400_000).toISOString(),
          "otro-codigo",
          new Date(Date.now() + 86_400_000).toISOString(),
        ]),
      ),
    );

    console.log("\nJefe de rama de una categoría (0040)");

    // Quien lleva una rama no es quien tiene sus tareas: reparte su trabajo.
    // La columna es de `tags`, así que sus políticas ya la cubren — lo que hay
    // que fijar es la escritura NUEVA, que es poder nombrar jefe.
    const etiquetaDeAcme = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into tags (organization_id, name, color, created_by)
         values ($1,'Infraestructura','blue',$2) returning id`,
        [acme.org, ana],
      );
      return rows[0]!.id;
    });

    const anaSeNombra = await withUser(ana, async (db) => {
      const { rowCount } = await db.query("update tags set owner_id = $2 where id = $1", [
        etiquetaDeAcme,
        ana,
      ]);
      return rowCount ?? 0;
    });
    check("Ana puede poner jefe a una categoría de su organización", anaSeNombra === 1);

    // El caso que de verdad importa: Bruno es de OTRA organización. Si esto
    // dejara de fallar, su nombre aparecería como jefe en una pantalla de una
    // empresa que no es la suya. La base no puede impedirlo con una clave
    // foránea —solo mira `users`, que no sabe de organizaciones— así que la
    // frontera aquí la pone RLS sobre la fila de la categoría.
    const brunoSeCuela = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query("update tags set owner_id = $2 where id = $1", [
        etiquetaDeAcme,
        bruno,
      ]);
      return rowCount ?? 0;
    });
    check("Bruno, de otra organización, no puede ponerse de jefe de una ajena", brunoSeCuela === 0);

    const siguePuesta = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ owner_id: string | null }>(
        "select owner_id from tags where id = $1",
        [etiquetaDeAcme],
      );
      return rows[0]?.owner_id;
    });
    check("y después del intento la categoría sigue con su jefe de verdad", siguePuesta === ana);

    console.log("\nHigiene del esquema");

    /**
     * Que ninguna función nuestra nazca sin `search_path` fijo.
     *
     * POR QUÉ ES UNA PRUEBA Y NO UNA MIGRACIÓN MÁS. La 0039 se lo puso a las
     * siete que faltaban, pero una migración arregla el pasado: la número ocho
     * la escribe alguien el mes que viene y vuelve a nacer sin él. Esto lo caza
     * el mismo día.
     *
     * Y la cuenta hay que hacerla contra la BASE y no contra una lista: el
     * documento decía seis, la tarea decía cinco, y `pg_proc` decía siete. Una
     * lista de esto mantenida a mano se queda corta siempre.
     *
     * Las de las extensiones (`citext`, `pgcrypto`) quedan fuera: son suyas,
     * las reinstala `create extension` y no las mantenemos nosotros.
     */
    const sinSearchPath = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ firma: string }>(
        `select p.oid::regprocedure::text as firma
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proconfig is null
            and not exists (
              select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
            )
          order by 1`,
      );
      return rows.map((r) => r.firma);
    });
    check(
      sinSearchPath.length === 0
        ? "ninguna función nuestra se queda sin search_path"
        : `estas funciones nacieron sin search_path: ${sinSearchPath.join(", ")}`,
      sinSearchPath.length === 0,
    );

    /**
     * Y la que de verdad importa: que ninguna `security definer` se quede sin
     * él. Esas corren con los permisos de quien las creó y se saltan RLS, así
     * que ahí `search_path` deja de ser higiene y pasa a ser la puerta.
     */
    const definerSinRuta = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ firma: string }>(
        `select p.oid::regprocedure::text as firma
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef and p.proconfig is null`,
      );
      return rows.map((r) => r.firma);
    });
    check(
      definerSinRuta.length === 0
        ? "y ninguna security definer, que ahí sí sería una puerta"
        : `security definer sin search_path: ${definerSinRuta.join(", ")}`,
      definerSinRuta.length === 0,
    );

    console.log("\nRegistro de actividad (0038)");

    // Lo que hace que este registro sirva para responder de algo: que nadie
    // pueda escribirlo a nombre de otro, y que nadie pueda reescribirlo
    // después. Sin las dos cosas es un cuaderno, no un registro.

    await withUser(ana, (db) =>
      db.query(
        `insert into activity (workspace_id, organization_id, actor_id, verb, subject_type, subject_label)
         values ($1,$2,$3,'movio','tarea','Arreglar el panel')`,
        [acme.ws, acme.org, ana],
      ),
    );
    await withUser(ana, (db) =>
      db.query(
        `insert into activity (workspace_id, organization_id, actor_id, verb, subject_type, subject_label)
         values ($1,$2,$3,'cerro','tarea','Lo de mi cuaderno')`,
        [acme.soloWs, acme.org, ana],
      ),
    );

    check("Ana ve los dos renglones que escribió", (await count(ana, "activity")) === 2);
    check(
      "Carla ve el del espacio compartido y no el del personal",
      (await count(carla, "activity")) === 1,
    );
    check("Bruno no ve nada de la historia de Acme", (await count(bruno, "activity")) === 0);

    // Miembro rasa sí escribe: lo que anota es lo que acaba de hacer ella.
    const carlaAnoto = await withUser(carla, async (db) => {
      const { rowCount } = await db.query(
        `insert into activity (workspace_id, organization_id, actor_id, verb, subject_type, subject_label)
         values ($1,$2,$3,'comento','tarea','Una que tocó Carla')`,
        [acme.ws, acme.org, carla],
      );
      return rowCount ?? 0;
    });
    check("Carla, miembro rasa, puede anotar en su espacio", carlaAnoto === 1);

    // El caso que de verdad importa. Si esto dejara de fallar, cualquiera
    // podría escribir «Ana cerró treinta tareas» y el registro dejaría de
    // valer para exactamente aquello para lo que se creó.
    await denied("nadie puede anotar a nombre de otra persona", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into activity (workspace_id, organization_id, actor_id, verb, subject_type, subject_label)
           values ($1,$2,$3,'cerro','tarea','No la cerró Ana')`,
          [acme.ws, acme.org, ana],
        ),
      ),
    );

    await denied("ni anotar en un espacio al que no llega", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into activity (workspace_id, organization_id, actor_id, verb, subject_type, subject_label)
           values ($1,$2,$3,'movio','tarea','Ni de lejos')`,
          [acme.soloWs, acme.org, carla],
        ),
      ),
    );

    // Y la propiedad que no se consigue con código, sino NO escribiendo dos
    // políticas: el registro no se puede retocar ni borrar. Ni siquiera Ana,
    // que administra la organización y escribió el renglón.
    const anaReescribio = await withUser(ana, async (db) => {
      const { rowCount } = await db.query("update activity set verb = 'invento'");
      return rowCount ?? 0;
    });
    check("ni Ana, que administra, puede reescribir el registro", anaReescribio === 0);

    const anaBorro = await withUser(ana, async (db) => {
      const { rowCount } = await db.query("delete from activity");
      return rowCount ?? 0;
    });
    check("ni borrarlo", anaBorro === 0);

    console.log("\nEntornos y despliegues (continuación)");

    // El caso que de verdad importa: ni siquiera la dueña del entorno puede
    // escribir un despliegue a mano. Si esto dejara de fallar, cualquiera
    // podría pintar «producción desplegada y en verde» sin que lo estuviera.
    await denied("ni Ana puede insertar un despliegue a mano", () =>
      withUser(ana, (db) =>
        db.query(
          `insert into deployments (environment_id, external_id, state)
           values ($1,'inventado','success')`,
          [acmeEntorno],
        ),
      ),
    );

    const anaCambioDespliegue = await withUser(ana, async (db) => {
      const { rowCount } = await db.query(
        "update deployments set state = 'failure' where environment_id = $1",
        [acmeEntorno],
      );
      return rowCount ?? 0;
    });
    check(
      "un UPDATE de Ana sobre un despliegue afecta a cero filas",
      anaCambioDespliegue === 0,
    );

    const brunoBorroEntorno = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query("delete from environments where id = $1", [acmeEntorno]);
      return rowCount ?? 0;
    });
    check("un DELETE de Bruno sobre el entorno de Acme afecta a cero filas", brunoBorroEntorno === 0);
    // --- Música compartida (Spotify) -------------------------------------------
    //
    // Las dos tablas cuelgan de can_access_channel, igual que los mensajes:
    // lo que importa no es solo que Bruno no vea nada de Acme, es que Carla
    // —de la misma organización— tampoco vea la cola de un canal privado al
    // que no pertenece.
    console.log("\nMúsica compartida");

    await withUser(ana, (db) =>
      db.query(
        `insert into channel_queue_tracks
           (channel_id, track_uri, track_name, track_artist, added_by, position)
         values ($1,'spotify:track:abc','Una canción','Un artista',$2,1000)`,
        [acme.publicChannel, ana],
      ),
    );
    await withUser(ana, (db) =>
      db.query(
        `insert into channel_listening_sessions
           (channel_id, track_uri, track_name, track_artist, is_playing, updated_by)
         values ($1,'spotify:track:abc','Una canción','Un artista',true,$2)`,
        [acme.publicChannel, ana],
      ),
    );

    check(
      "Carla ve la cola del canal público al que pertenece",
      (await count(carla, "channel_queue_tracks")) === 1,
    );
    check(
      "Carla ve qué suena en el canal público",
      (await count(carla, "channel_listening_sessions")) === 1,
    );
    check("Bruno no ve la cola de Acme", (await count(bruno, "channel_queue_tracks")) === 0);
    check("Bruno no ve qué suena en Acme", (await count(bruno, "channel_listening_sessions")) === 0);

    await withUser(ana, (db) =>
      db.query(
        `insert into channel_queue_tracks
           (channel_id, track_uri, track_name, track_artist, added_by, position)
         values ($1,'spotify:track:secreto','Secreta','Dirección',$2,1000)`,
        [acme.privateChannel, ana],
      ),
    );
    check(
      "Carla no ve la cola del canal privado al que no pertenece",
      (await count(carla, "channel_queue_tracks")) === 1,
    );

    await denied("Carla no puede añadir a la cola de un canal privado ajeno", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into channel_queue_tracks
             (channel_id, track_uri, track_name, track_artist, added_by, position)
           values ($1,'spotify:track:colada','Colada','Nadie',$2,2000)`,
          [acme.privateChannel, carla],
        ),
      ),
    );

    await denied("Bruno no puede añadir a la cola de un canal de Acme", () =>
      withUser(bruno, (db) =>
        db.query(
          `insert into channel_queue_tracks
             (channel_id, track_uri, track_name, track_artist, added_by, position)
           values ($1,'spotify:track:intruso','Intrusa','Nadie',$2,3000)`,
          [acme.publicChannel, bruno],
        ),
      ),
    );

    const brunoDeletedTrack = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query(
        "delete from channel_queue_tracks where channel_id = $1",
        [acme.publicChannel],
      );
      return rowCount ?? 0;
    });
    check("un DELETE de Bruno sobre la cola de Acme afecta a cero filas", brunoDeletedTrack === 0);

    // --- Enlaces y noticias de la organización (0019) ---------------------
    //
    // Las dos cuelgan de is_org_admin para escribir y de is_org_member para
    // leer: Carla, que es miembro raso de Acme, tiene que poder LEER lo que
    // Ana publique pero no poder publicar ni añadir un enlace ella misma.
    console.log("\nEnlaces y noticias");

    await withUser(ana, (db) =>
      db.query(
        `insert into organization_links (organization_id, label, url, position, created_by)
         values ($1,'Repositorio','https://github.com/acme/producto',0,$2)`,
        [acme.org, ana],
      ),
    );
    check("Carla ve el enlace que Ana publicó", (await count(carla, "organization_links")) === 1);
    check("Bruno no ve ningún enlace de Acme", (await count(bruno, "organization_links")) === 0);

    await denied("Carla, que es miembro raso, no puede añadir un enlace", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into organization_links (organization_id, label, url, position, created_by)
           values ($1,'Colado','https://ejemplo.test',1,$2)`,
          [acme.org, carla],
        ),
      ),
    );

    const brunoDeletedLink = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query(
        "delete from organization_links where organization_id = $1",
        [acme.org],
      );
      return rowCount ?? 0;
    });
    check("un DELETE de Bruno sobre los enlaces de Acme afecta a cero filas", brunoDeletedLink === 0);

    await withUser(ana, (db) =>
      db.query(
        `insert into announcements (organization_id, author_id, title, body)
         values ($1,$2,'Aviso','Cambiamos el horario de despliegue')`,
        [acme.org, ana],
      ),
    );
    check("Carla ve la noticia que Ana publicó", (await count(carla, "announcements")) === 1);
    check("Bruno no ve ninguna noticia de Acme", (await count(bruno, "announcements")) === 0);

    await denied("Carla, que es miembro raso, no puede publicar una noticia", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into announcements (organization_id, author_id, title, body)
           values ($1,$2,'Colada','de quien no administra')`,
          [acme.org, carla],
        ),
      ),
    );

    const carlaEditedAnnouncement = await withUser(carla, async (db) => {
      const { rowCount } = await db.query(
        "update announcements set title = 'editada' where organization_id = $1",
        [acme.org],
      );
      return rowCount ?? 0;
    });
    check(
      "Carla, que es miembro raso, no puede editar una noticia (afecta a cero filas)",
      carlaEditedAnnouncement === 0,
    );

    // --- Panel personal (0019) ----------------------------------------------
    //
    // Sin organization_id: la única regla es «tu fila, y solo la tuya». Ni
    // siquiera Ana, que administra la organización de Carla, puede ver ni
    // tocar el panel de Carla.
    console.log("\nPanel personal");

    await withUser(carla, (db) =>
      db.query(
        `insert into user_dashboard_prefs (user_id, widgets, spotify_mode)
         values ($1,'["spotify"]'::jsonb,'expandido')`,
        [carla],
      ),
    );
    check("Carla ve su propio panel", (await count(carla, "user_dashboard_prefs")) === 1);
    check(
      "Ana, que administra la organización de Carla, no ve el panel de Carla",
      (await count(ana, "user_dashboard_prefs")) === 0,
    );

    const anaEditedCarlaPrefs = await withUser(ana, async (db) => {
      const { rowCount } = await db.query(
        "update user_dashboard_prefs set spotify_mode = 'boton' where user_id = $1",
        [carla],
      );
      return rowCount ?? 0;
    });
    check("Ana no puede tocar el panel de Carla (afecta a cero filas)", anaEditedCarlaPrefs === 0);

    // --- El editor ---------------------------------------------------------
    //
    // Decorar es social: quien pertenece al canal puede amueblar su sala. Lo
    // que no puede es tocar la de un canal al que no pertenece — ni siquiera
    // sabiendo su identificador, que es lo que se prueba aquí.
    console.log("\nEl editor de la oficina");

    const zoneOfChannel = (user: string, channel: string): Promise<string | null> =>
      withUser(user, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          "select id from world_zones where channel_id = $1",
          [channel],
        );
        return rows[0]?.id ?? null;
      });

    const publicZone = (await zoneOfChannel(ana, acme.publicChannel))!;
    const privateZone2 = (await zoneOfChannel(ana, acme.privateChannel))!;

    const save = (user: string, zone: string, props: unknown[]): Promise<number> =>
      withUser(user, async (db) => {
        const { rows } = await db.query<{ save_world_props: number }>(
          "select public.save_world_props($1, $2::jsonb)",
          [zone, JSON.stringify(props)],
        );
        return rows[0]!.save_world_props;
      });

    const propsIn = (user: string, zone: string): Promise<number> =>
      withUser(user, async (db) => {
        const { rows } = await db.query<{ n: string }>(
          "select count(*)::text as n from world_props where zone_id = $1",
          [zone],
        );
        return Number(rows[0]!.n);
      });

    check(
      "Carla amuebla la sala del canal al que pertenece",
      (await save(carla, publicZone, [
        { kind: "sofa", x: 3, y: 2, facing: "s", tone: 1 },
        { kind: "plant", x: 5, y: 2 },
      ])) === 2,
    );
    check("y Ana ve lo que colocó", (await propsIn(ana, publicZone)) === 2);

    const marked = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ customized: boolean }>(
        "select customized from world_zones where id = $1",
        [publicZone],
      );
      return rows[0]?.customized ?? false;
    });
    check("la sala queda marcada como editada", marked);

    // La frontera. Carla tiene el identificador de la zona privada —se lo
    // damos aquí a mano— y aun así no puede escribir en ella: RLS no le deja
    // ver la fila, así que la función no encuentra la zona.
    await denied("Carla no puede amueblar la sala de un canal privado ajeno", () =>
      save(carla, privateZone2, [{ kind: "arcade", x: 2, y: 2 }]),
    );
    await denied("Bruno no puede amueblar nada de Acme", () =>
      save(bruno, publicZone, [{ kind: "arcade", x: 2, y: 2 }]),
    );
    check("y la sala privada sigue vacía", (await propsIn(ana, privateZone2)) === 0);

    // Guardar es reemplazo, no diferencia: la última en guardar gana entera.
    check(
      "volver a guardar reemplaza en vez de acumular",
      (await save(ana, publicZone, [{ kind: "desk", x: 4, y: 2 }])) === 1 &&
        (await propsIn(ana, publicZone)) === 1,
    );

    await withUser(ana, (db) => db.query("select public.reset_world_zone($1)", [publicZone]));
    check("restaurar deja la sala sin muebles propios", (await propsIn(ana, publicZone)) === 0);
    const unmarked = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ customized: boolean }>(
        "select customized from world_zones where id = $1",
        [publicZone],
      );
      return rows[0]?.customized ?? true;
    });
    check("y vuelve a amueblarse sola", !unmarked);

    // --- El interruptor de la organización ---------------------------------
    //
    // Una organización puede apagar la oficina entera. Lo interesante no es
    // que el dueño pueda —eso es trivial— sino que un miembro raso no pueda
    // volver a encenderla, y que apagarla no borre nada.
    const worldEnabled = (user: string): Promise<boolean> =>
      withUser(user, async (db) => {
        const { rows } = await db.query<{ ok: boolean }>(
          "select public.world_enabled_for_workspace($1) as ok",
          [acme.ws],
        );
        return rows[0]?.ok ?? false;
      });

    const setImmersive = (user: string, value: boolean): Promise<number> =>
      withUser(user, async (db) => {
        const { rowCount } = await db.query(
          "update organizations set immersive_enabled = $2 where id = $1",
          [acme.org, value],
        );
        return rowCount ?? 0;
      });

    check("la oficina viene encendida de fábrica", await worldEnabled(ana));
    check("Ana, que es dueña, puede apagarla", (await setImmersive(ana, false)) === 1);
    check("apagada, lo está para todo el mundo", !(await worldEnabled(carla)));
    check(
      "apagarla no borra las zonas",
      (await zonesIn(ana, sharedRoom)) === 2,
    );
    check(
      "Carla, que es miembro raso, no puede volver a encenderla",
      (await setImmersive(carla, true)) === 0,
    );
    check("y sigue apagada", !(await worldEnabled(ana)));
    await setImmersive(ana, true);
    check("al encenderla vuelve todo como estaba", await worldEnabled(carla));

    // --- Invitaciones por workspace (0027) ----------------------------------
    //
    // Un workspace compartido lo veía cualquiera de la organización. Ahora
    // depende de cómo entró cada cual: quien fue invitado a toda la
    // organización sigue viéndolos todos; quien fue invitado a un workspace
    // concreto ve ese y ninguno más. Se prueba contra la política de RLS
    // —qué filas devuelve un `select`— y no contra la función auxiliar, que es
    // lo que de verdad protege a la tabla.
    console.log("\nInvitaciones por workspace");

    const workspacesVisibles = (quien: string) =>
      withUser(quien, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          "select id from workspaces where organization_id = $1",
          [acme.org],
        );
        return rows.map((r) => r.id);
      });

    const plataforma = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
        [acme.org, "Plataforma", ana],
      );
      return rows[0]!.id;
    });

    const tokenDiego = `hash-invitacion-diego-${suffix}`;
    await withUser(ana, (db) =>
      db.query("select public.create_invitation($1,$2,$3,$4,$5,$6)", [
        acme.org,
        `diego-${suffix}@devup.test`,
        "member",
        tokenDiego,
        new Date(Date.now() + 86_400_000).toISOString(),
        plataforma,
      ]),
    );
    await withUser(diego, (db) =>
      db.query("select public.accept_invitation($1,$2)", [tokenDiego, diego]),
    );

    const deDiego = await workspacesVisibles(diego);
    check("Diego ve el workspace al que le invitaron", deDiego.includes(plataforma));
    check(
      "y no ve el otro workspace compartido de la misma organización",
      !deDiego.includes(acme.ws),
    );
    check("ni el workspace personal de Ana", !deDiego.includes(acme.soloWs));

    const deCarla = await workspacesVisibles(carla);
    check(
      "Carla, que entró a toda la organización, sí ve los dos compartidos",
      deCarla.includes(plataforma) && deCarla.includes(acme.ws),
    );

    // El contenido va detrás del workspace: si el canal siguiera visible, la
    // frontera sería de pantalla y no de base de datos.
    check(
      "Diego tampoco ve los canales del workspace que no es suyo",
      (await withUser(diego, async (db) => {
        const { rows } = await db.query<{ n: string }>(
          "select count(*)::text as n from channels where workspace_id = $1",
          [acme.ws],
        );
        return Number(rows[0]!.n);
      })) === 0,
    );

    await denied(
      "y no puede meterse solo en un workspace ajeno",
      () =>
        withUser(diego, (db) =>
          db.query("insert into workspace_members (workspace_id, user_id) values ($1,$2)", [
            acme.ws,
            diego,
          ]),
        ),
    );

    // ---------------------------------------------------------------------
    // Conexiones de agente (0029)
    //
    // Emiten una credencial de 30 dias con todo el acceso de una persona, asi
    // que aqui lo que importa es que nadie pueda abrir una a nombre de otro ni
    // cortar la de otro. Lo primero lo garantiza la firma de la funcion —saca
    // el usuario de current_user_id() y no admite que se le diga otro—, y lo
    // segundo la politica sessions_update de la 0001.
    // ---------------------------------------------------------------------
    // La clave de IA es PERSONAL (0030)
    //
    // La boveda ya estaba probada para conexiones de ORGANIZACION, donde que
    // un compañero lea el token de GitHub es lo correcto. La clave del
    // asistente es el caso contrario y no lo probaba nadie: es de una persona,
    // y quien la lea gasta el dinero de otro. La politica de DELETE de
    // connection_secrets, ademas, solo comprueba que la fila exista — falla
    // cerrada porque su subconsulta corre bajo RLS de `connections`, y eso es
    // justo lo que hay que fijar con una prueba antes de que alguien
    // "simplifique" esa politica.
    console.log("\nLa clave de IA de cada persona");

    const claveDeAna = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into connections (provider, user_id, display_name, created_by)
         values ('anthropic', $1, 'Clave del asistente', $1) returning id`,
        [ana],
      );
      const id = rows[0]!.id;
      await db.query(
        "insert into connection_secrets (connection_id, encrypted_secret) values ($1,$2)",
        [id, encryptSecret("sk-ant-de-ana")],
      );
      return id;
    });

    const veLaConexion = (quien: string) =>
      withUser(quien, async (db) => {
        const { rows } = await db.query("select id from connections where id = $1", [claveDeAna]);
        return rows.length;
      });
    const veElSecreto = (quien: string) =>
      withUser(quien, async (db) => {
        const { rows } = await db.query(
          "select connection_id from connection_secrets where connection_id = $1",
          [claveDeAna],
        );
        return rows.length;
      });

    check("Ana ve su propia clave", (await veLaConexion(ana)) === 1);
    check("y puede leer su secreto, que es lo que necesita el asistente", (await veElSecreto(ana)) === 1);
    check(
      "Carla, de la MISMA organizacion, no ve la conexion personal de Ana",
      (await veLaConexion(carla)) === 0,
    );
    check(
      "y no puede leer su clave ni sabiendo el id",
      (await veElSecreto(carla)) === 0,
    );

    const borradoPorCarla = await withUser(carla, async (db) => {
      const { rowCount } = await db.query(
        "delete from connection_secrets where connection_id = $1",
        [claveDeAna],
      );
      return rowCount ?? 0;
    });
    check("ni puede borrarsela", borradoPorCarla === 0);
    check("y despues del intento sigue ahi", (await veElSecreto(ana)) === 1);

    const descifrada = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ encrypted_secret: Buffer }>(
        "select encrypted_secret from connection_secrets where connection_id = $1",
        [claveDeAna],
      );
      return decryptSecret(rows[0]!.encrypted_secret);
    });
    check("Ana la recupera intacta", descifrada === "sk-ant-de-ana");

    console.log("\nConexiones de agente");

    const abrirConexion = (quien: string, nombre: string) =>
      withUser(quien, async (db) => {
        const { rows } = await db.query<{ agent_connection_open: string }>(
          "select public.agent_connection_open($1,$2,$3)",
          [nombre, `hash-agente-${nombre}-${suffix}`, new Date(Date.now() + 86_400_000).toISOString()],
        );
        return rows[0]!.agent_connection_open;
      });

    const conexionDeAna = await abrirConexion(ana, "claude-de-ana");
    check("Ana abre su conexion de agente", Boolean(conexionDeAna));

    const suyas = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string; label: string; is_agent: boolean }>(
        "select id, label, is_agent from sessions where is_agent",
      );
      return rows;
    });
    check(
      "y la ve con su nombre y marcada como de agente",
      suyas.some((f) => f.id === conexionDeAna && f.label === "claude-de-ana" && f.is_agent),
    );

    const lasDeCarla = await withUser(carla, async (db) => {
      const { rows } = await db.query<{ id: string }>("select id from sessions where is_agent");
      return rows.map((r) => r.id);
    });
    check("Carla no ve la conexion de agente de Ana", !lasDeCarla.includes(conexionDeAna));

    // Lo que de verdad se prueba: aunque Carla tenga el id —y un id se filtra
    // por mil sitios— no puede cortarla. Sin fila que actualizar, la ruta
    // responde 404 y Carla no distingue «no existe» de «no es tuya».
    const cortadaPorCarla = await withUser(carla, async (db) => {
      const { rowCount } = await db.query(
        "update sessions set revoked_at = now() where id = $1 and revoked_at is null",
        [conexionDeAna],
      );
      return rowCount ?? 0;
    });
    check("Carla no puede cortar la conexion de Ana ni con su id", cortadaPorCarla === 0);

    const sigueViva = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ revoked_at: string | null }>(
        "select revoked_at from sessions where id = $1",
        [conexionDeAna],
      );
      return rows[0]?.revoked_at === null;
    });
    check("y sigue viva despues del intento", sigueViva);

    const cortadaPorAna = await withUser(ana, async (db) => {
      const { rowCount } = await db.query(
        "update sessions set revoked_at = now() where id = $1 and revoked_at is null",
        [conexionDeAna],
      );
      return rowCount ?? 0;
    });
    check("Ana si puede cortar la suya", cortadaPorAna === 1);

    // El nombre sobrevive a la rotacion: sin esto, la primera renovacion
    // convertiria la conexion en una sesion anonima que sigue viva con todo el
    // acceso y ya no aparece en la lista para poder revocarla.
    const paraRotar = await abrirConexion(ana, "claude-que-rota");
    check("hay otra conexion para probar la rotacion", Boolean(paraRotar));
    const consumida = await withUser(null, async (db) => {
      const { rows } = await db.query<{ label: string; is_agent: boolean }>(
        "select label, is_agent from public.session_consume($1)",
        [`hash-agente-claude-que-rota-${suffix}`],
      );
      return rows[0];
    });
    check(
      "al consumirla, devuelve el nombre y la marca para arrastrarlos",
      consumida?.label === "claude-que-rota" && consumida?.is_agent === true,
    );

    // ---------------------------------------------------------------------
    // OAuth remoto del MCP (0032)
    //
    // oauth_clients es de lectura abierta a proposito (catalogo publico de
    // "que aplicacion existe", sin datos de nadie) — no hace falta un caso
    // de aislamiento para eso. Lo que si importa es oauth_codes: lleva un
    // user_id, y aunque el codigo en si no sirve sin el code_verifier que
    // solo tiene quien lo pidio, no deberia ser visible fuera de su dueño,
    // ni nadie deberia poder crear uno a nombre de otra persona. Y el canje
    // tiene que ser de un solo uso — es la defensa contra reutilizar un
    // codigo interceptado.
    // ---------------------------------------------------------------------
    console.log("\nOAuth remoto del MCP");

    const clienteOAuth = `cliente-test-${suffix}`;
    await admin.query(
      `insert into oauth_clients (client_id, client_name, redirect_uris)
       values ($1, 'Cliente de prueba', '["https://claude.ai/callback"]'::jsonb)`,
      [clienteOAuth],
    );

    const codigoDeAna = `codigo-ana-${suffix}`;
    await withUser(ana, (db) =>
      db.query(
        `insert into oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, expires_at)
         values ($1, $2, $3, 'https://claude.ai/callback', 'reto-de-prueba', now() + interval '10 minutes')`,
        [codigoDeAna, clienteOAuth, ana],
      ),
    );

    check("Ana ve su propio codigo de autorizacion", (await count(ana, "oauth_codes")) === 1);
    check("Carla no ve el codigo de Ana", (await count(carla, "oauth_codes")) === 0);

    await denied("nadie puede crear un codigo a nombre de otra persona", () =>
      withUser(carla, (db) =>
        db.query(
          `insert into oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, expires_at)
           values ($1, $2, $3, 'https://claude.ai/callback', 'otro-reto', now() + interval '10 minutes')`,
          [`codigo-colado-${suffix}`, clienteOAuth, ana],
        ),
      ),
    );

    const canjeado = await withUser(null, async (db) => {
      const { rows } = await db.query<{ userId: string }>(
        `select user_id as "userId" from public.oauth_code_consume($1)`,
        [codigoDeAna],
      );
      return rows[0];
    });
    check("el canje devuelve al dueño real del codigo", canjeado?.userId === ana);

    const reintento = await withUser(null, async (db) => {
      const { rows } = await db.query("select user_id from public.oauth_code_consume($1)", [codigoDeAna]);
      return rows.length;
    });
    check("un codigo ya canjeado no se puede volver a usar", reintento === 0);

    // ---------------------------------------------------------------------
    // El registro de actividad (0038)
    //
    // Tiene DOS llaves y las dos hay que fijarlas aquí, porque la de arriba
    // sola parece suficiente y no lo es. Pertenecer a la organizacion deja ver
    // la actividad de la organizacion; sin la segunda —poder acceder al
    // espacio— la historia del "Cuaderno de Ana" se leeria desde toda Acme.
    // Carla es de Acme y no ve ese espacio: es exactamente el caso.
    //
    // Y se comprueba tambien que NO se puede editar ni borrar. Sin politica de
    // UPDATE ni de DELETE, Postgres deniega — pero eso hay que fijarlo con una
    // prueba antes de que alguien las añada "para poder corregir una errata",
    // que es como un registro deja de serlo.
    console.log("\nEl registro de actividad");

    const anotarComo = (quien: string, workspace: string | null, org: string, sujeto: string) =>
      withUser(quien, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `insert into activity
             (organization_id, workspace_id, actor_id, verb, subject_type, subject_id, subject_label)
           values ($1, $2, $3, 'cerro', 'tarea', $4, $5)
           returning id`,
          [org, workspace, quien, acme.soloTask, sujeto],
        );
        return rows[0]!.id;
      });

    const enElCuaderno = await anotarComo(ana, acme.soloWs, acme.org, "algo privado");
    const enElCompartido = await anotarComo(ana, acme.ws, acme.org, "algo del equipo");

    const veActividad = (quien: string, id: string) =>
      withUser(quien, async (db) => {
        const { rows } = await db.query("select id from activity where id = $1", [id]);
        return rows.length;
      });

    check("Ana ve la actividad de su cuaderno", (await veActividad(ana, enElCuaderno)) === 1);
    check(
      "Carla, de la MISMA organizacion, no ve la actividad del cuaderno de Ana",
      (await veActividad(carla, enElCuaderno)) === 0,
    );
    check(
      "pero si ve la del workspace que comparten",
      (await veActividad(carla, enElCompartido)) === 1,
    );
    check(
      "Bruno, de otra organizacion, no ve ninguna de las dos",
      (await veActividad(bruno, enElCompartido)) === 0 &&
        (await veActividad(bruno, enElCuaderno)) === 0,
    );

    // Escribir en nombre de otro seria escribir participacion falsa.
    const suplantacion = await withUser(carla, async (db) => {
      try {
        await db.query(
          `insert into activity
             (organization_id, workspace_id, actor_id, verb, subject_type, subject_label)
           values ($1, $2, $3, 'cerro', 'tarea', 'lo hizo Ana, dice Carla')`,
          [acme.org, acme.ws, ana],
        );
        return "coló";
      } catch {
        return "rechazado";
      }
    });
    check("Carla no puede anotar actividad a nombre de Ana", suplantacion === "rechazado");

    // Un registro que se puede editar es una opinion sobre el pasado.
    const editado = await withUser(ana, async (db) => {
      const { rowCount } = await db.query(
        "update activity set subject_label = 'otra cosa' where id = $1",
        [enElCompartido],
      );
      return rowCount ?? 0;
    });
    check("ni la propia Ana puede reescribir lo que anoto", editado === 0);

    const borrado = await withUser(ana, async (db) => {
      const { rowCount } = await db.query("delete from activity where id = $1", [enElCompartido]);
      return rowCount ?? 0;
    });
    check("ni borrarlo", borrado === 0);
    check("y sigue ahi despues de los dos intentos", (await veActividad(ana, enElCompartido)) === 1);

    // ---------------------------------------------------------------------
    // Las areas del tablero (0039)
    //
    // Tabla nueva, asi que caso nuevo: es la regla dura del proyecto. Lo que
    // se fija aqui es que VER un area es ver el tablero, pero CREARLA o
    // cambiarla es organizarlo — `can_manage_workspace`, igual que las
    // columnas. Diego entra invitado a UN workspace y es quien separa «estas
    // en el equipo» de «puedes reorganizar el trabajo de los demas».
    console.log("\nLas areas del tablero");

    const areaDeAcme = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into task_categories (workspace_id, name, owner_id, position, created_by)
         values ($1, 'DevVerse', $2, 1000, $2) returning id`,
        [acme.ws, ana],
      );
      return rows[0]!.id;
    });

    const veArea = (quien: string) =>
      withUser(quien, async (db) => {
        const { rows } = await db.query("select id from task_categories where id = $1", [
          areaDeAcme,
        ]);
        return rows.length;
      });

    check("Ana ve el area que creo", (await veArea(ana)) === 1);
    check("Carla, del mismo workspace, tambien la ve", (await veArea(carla)) === 1);
    check("Bruno, de otra organizacion, no la ve", (await veArea(bruno)) === 0);

    const brunoCreo = await withUser(bruno, async (db) => {
      try {
        await db.query(
          `insert into task_categories (workspace_id, name, position, created_by)
           values ($1, 'colada', 1000, $2)`,
          [acme.ws, bruno],
        );
        return "colo";
      } catch {
        return "rechazado";
      }
    });
    check("y no puede crear areas en un tablero ajeno", brunoCreo === "rechazado");

    const brunoRenombro = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query(
        "update task_categories set name = 'mia' where id = $1",
        [areaDeAcme],
      );
      return rowCount ?? 0;
    });
    check("ni renombrar la de otros", brunoRenombro === 0);

    // Borrar un area NO se lleva sus tareas por delante: se quedan sin
    // clasificar. Lo contrario seria una trampa esperando a quien reorganice.
    const tareaClasificada = await withUser(ana, async (db) => {
      const { rows: col } = await db.query<{ id: string }>(
        "select id from task_columns where workspace_id = $1 order by position limit 1",
        [acme.ws],
      );
      const { rows } = await db.query<{ id: string }>(
        `insert into tasks (workspace_id, column_id, title, position, created_by, category_id)
         values ($1,$2,'clasificada',1000,$3,$4) returning id`,
        [acme.ws, col[0]!.id, ana, areaDeAcme],
      );
      return rows[0]!.id;
    });

    await withUser(ana, (db) =>
      db.query("delete from task_categories where id = $1", [areaDeAcme]),
    );
    const sobrevive = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ category_id: string | null }>(
        "select category_id from tasks where id = $1",
        [tareaClasificada],
      );
      return rows[0];
    });
    check("borrar un area no borra sus tareas", sobrevive !== undefined);
    check("solo las deja sin clasificar", sobrevive?.category_id === null);

    console.log("\nRamas y evidencia de una tarea");

    // Las dos tablas de la 0042 NO llevan `workspace_id` propio: se apoyan en
    // la politica de `tasks`. Eso hay que comprobarlo aqui, porque si el
    // `exists` de la politica estuviera mal escrito, las filas de una tarea
    // ajena se verian sin que nada fallara — que es como se rompe RLS siempre.
    const conRama = await withUser(ana, async (db) => {
      const { rows: col } = await db.query<{ id: string }>(
        "select id from task_columns where workspace_id = $1 order by position limit 1",
        [acme.ws],
      );
      const { rows } = await db.query<{ id: string }>(
        `insert into tasks (workspace_id, column_id, title, position, created_by, prioridad, tipo)
         values ($1,$2,'pasarela de pagos',2000,$3,3,'funcionalidad') returning id`,
        [acme.ws, col[0]!.id, ana],
      );
      const tarea = rows[0]!.id;
      await db.query(
        `insert into task_branches (task_id, nombre, created_by) values ($1,'feat/pagos',$2)`,
        [tarea, ana],
      );
      await db.query(
        `insert into task_evidence (task_id, tipo, url, created_by)
         values ($1,'pr','https://github.com/acme/x/pull/1',$2)`,
        [tarea, ana],
      );
      return tarea;
    });

    const veBruno = await withUser(bruno, async (db) => {
      const ramas = await db.query("select id from task_branches where task_id = $1", [conRama]);
      const pruebas = await db.query("select id from task_evidence where task_id = $1", [conRama]);
      return { ramas: ramas.rowCount, pruebas: pruebas.rowCount };
    });
    check("Bruno no ve las ramas de una tarea que no puede ver", veBruno.ramas === 0);
    check("ni sus evidencias", veBruno.pruebas === 0);

    await denied("ni puede colgarle una rama", () =>
      withUser(bruno, (db) =>
        db.query("insert into task_branches (task_id, nombre) values ($1,'intrusa')", [conRama]),
      ),
    );
    await denied("ni una evidencia", () =>
      withUser(bruno, (db) =>
        db.query("insert into task_evidence (task_id, tipo, nota) values ($1,'nota','yo lo vi')", [
          conRama,
        ]),
      ),
    );

    // Firmar con el nombre de otro es la unica forma que tiene esta tabla de
    // mentir: atribuirle a alguien una comprobacion que no hizo.
    await denied("nadie firma una evidencia con el nombre de otro", () =>
      withUser(carla, (db) =>
        db.query(
          "insert into task_evidence (task_id, tipo, nota, created_by) values ($1,'nota','fui yo',$2)",
          [conRama, ana],
        ),
      ),
    );

    // Sin politica de UPDATE, a proposito: cambiar en silencio lo que alguien
    // afirmo, dejando su nombre debajo, es lo que un registro de pruebas no
    // puede permitir. Corregir es borrar y volver a poner.
    const reescribio = await withUser(ana, async (db) => {
      try {
        const { rowCount } = await db.query(
          "update task_evidence set url = 'https://otro' where task_id = $1",
          [conRama],
        );
        return rowCount;
      } catch {
        return "rechazado";
      }
    });
    check("ni la propia Ana puede reescribir una evidencia", reescribio !== 1);

    const carlaVe = await withUser(carla, async (db) => {
      const { rowCount } = await db.query("select id from task_branches where task_id = $1", [
        conRama,
      ]);
      return rowCount;
    });
    check("Carla, del mismo espacio, si ve la rama", carlaVe === 1);

    // Borrar la tarea se lleva las dos por delante: son de la tarea, no cosas
    // con vida propia. Lo contrario dejaria pruebas huerfanas apuntando a algo
    // que ya no existe.
    await withUser(ana, (db) => db.query("delete from tasks where id = $1", [conRama]));
    const quedan = await admin.query("select id from task_branches where task_id = $1", [conRama]);
    const quedanPruebas = await admin.query("select id from task_evidence where task_id = $1", [
      conRama,
    ]);
    check(
      "borrar la tarea se lleva sus ramas y sus evidencias",
      quedan.rowCount === 0 && quedanPruebas.rowCount === 0,
    );

    console.log("\nNadie se invita solo a una organizacion ajena");

    // ESTO ES UNA REGRESION, NO UNA COMPROBACION DE RUTINA. Hasta la 0041,
    // `is_org_admin` devolvia NULL —no `false`— para quien no es miembro, y
    // un `if not NULL` de PL/pgSQL no entra en el bloque: la comprobacion de
    // permisos de `create_invitation` no fallaba, se saltaba. Bruno, que es de
    // otra organizacion, podia crear una invitacion de ADMINISTRADOR a Acme
    // con el token que el eligiera y canjearla. Hacerse dueño de la casa de
    // otro sabiendo solo el numero del portal.
    //
    // En RLS no se notaba porque alli NULL y `false` niegan igual. Por eso vive
    // aqui: es el unico sitio del repositorio donde se prueban permisos contra
    // la base de verdad, y es donde alguien mirara el dia que vuelva a pasar.
    await denied("un extraño no puede crear invitaciones en una organizacion ajena", () =>
      withUser(bruno, (db) =>
        db.query("select public.create_invitation($1,$2,$3,$4,$5,$6)", [
          acme.org,
          `colado-${suffix}@devup.test`,
          "admin",
          `hash-colado-${suffix}`,
          new Date(Date.now() + 86_400_000).toISOString(),
          null,
        ]),
      ),
    );

    // La misma trampa por la puerta nueva de la 0040.
    const invitacionDeAcme = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ create_invitation: string }>(
        "select public.create_invitation($1,$2,$3,$4,$5,$6)",
        [
          acme.org,
          `elena-${suffix}@devup.test`,
          "member",
          `hash-elena-${suffix}`,
          new Date(Date.now() + 86_400_000).toISOString(),
          null,
        ],
      );
      return rows[0]!.create_invitation;
    });
    await denied("ni ponerle codigo corto a una invitacion que no es suya", () =>
      withUser(bruno, (db) =>
        db.query("select public.set_invitation_code($1,$2)", [
          invitacionDeAcme,
          `hash-codigo-colado-${suffix}`,
        ]),
      ),
    );

    // Y la comprobacion directa de lo que causaba todo: la funcion contesta
    // «no», no «no lo se».
    const respuesta = await withUser(bruno, async (db) => {
      const { rows } = await db.query<{ is_org_admin: boolean | null }>(
        "select public.is_org_admin($1)",
        [acme.org],
      );
      return rows[0]!.is_org_admin;
    });
    check("`is_org_admin` contesta false a un extraño, nunca null", respuesta === false);

  } finally {
    // Limpieza. Las organizaciones primero: `created_by` es ON DELETE RESTRICT
    // a propósito —borrar una cuenta no debe llevarse por delante la
    // organización de un equipo entero— y eso obliga a este orden.
    // oauth_clients no cuelga de ningún user_id/organization_id, así que se
    // limpia aparte — sus oauth_codes sí caen solos al borrar los usuarios
    // (ON DELETE CASCADE).
    await admin.query("delete from public.oauth_clients where client_id like $1", [`%-${suffix}`]);
    await admin.query("delete from public.organizations where slug like $1", [`%-${suffix}`]);
    await admin.query("delete from public.users where email like $1", [`%-${suffix}@devup.test`]);
    await admin.end();
    await closePool();
  }

  console.log(
    `\n${passed} comprobaciones correctas, ${failures.length} fallidas` +
      (env.NODE_ENV === "production" ? " (¡esto no debería correr en producción!)" : ""),
  );
  if (failures.length > 0) {
    console.error("\nFallaron:\n" + failures.map((f) => `  · ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
