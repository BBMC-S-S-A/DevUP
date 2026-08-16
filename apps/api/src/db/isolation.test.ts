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

      await db.query(
        `insert into tasks (workspace_id, column_id, title, position, created_by)
         values ($1,$2,$3,1000,$4)`,
        [soloWs, soloColumn, "idea que no comparto todavía", ana],
      );

      return { org, ws, publicChannel, privateChannel, soloWs, soloChannel };
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
        await db.query("select public.upsert_world_avatar($1,$2,$3,$4,$5,$6,$7,$8)", [
          0, 1, top, 0, 2, 3, 4, 5,
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
  } finally {
    // Limpieza. Las organizaciones primero: `created_by` es ON DELETE RESTRICT
    // a propósito —borrar una cuenta no debe llevarse por delante la
    // organización de un equipo entero— y eso obliga a este orden.
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
