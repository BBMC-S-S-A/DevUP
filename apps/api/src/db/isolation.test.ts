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
    // Lo que se prueba aquí es lectura —hereda de la visibilidad del repo,
    // que a su vez hereda de la conexión— y que solo un admin de la
    // organización puede añadir o quitar un repositorio.
    console.log("\nConector de GitHub");

    const acmeRepo = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into github_repos (connection_id, full_name, added_by)
         values ($1,'acme/producto',$2) returning id`,
        [acmeConnection, ana],
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
          `insert into github_repos (connection_id, full_name, added_by)
           values ($1,'acme/colado',$2)`,
          [acmeConnection, carla],
        ),
      ),
    );

    await denied("Bruno no puede conectar un repositorio contra la conexión de Acme", () =>
      withUser(bruno, (db) =>
        db.query(
          `insert into github_repos (connection_id, full_name, added_by)
           values ($1,'bruno/intruso',$2)`,
          [acmeConnection, bruno],
        ),
      ),
    );

    const brunoDeletedRepo = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query("delete from github_repos where id = $1", [acmeRepo]);
      return rowCount ?? 0;
    });
    check("un DELETE de Bruno sobre el repositorio de Acme afecta a cero filas", brunoDeletedRepo === 0);

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
        `insert into environments (organization_id, name, kind, url, created_by)
         values ($1,'producción','production','https://acme.example',$2) returning id`,
        [acme.org, ana],
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
          `insert into environments (organization_id, name, created_by) values ($1,'colado',$2)`,
          [acme.org, carla],
        ),
      ),
    );

    await denied("Bruno no puede crear un entorno en Acme", () =>
      withUser(bruno, (db) =>
        db.query(
          `insert into environments (organization_id, name, created_by) values ($1,'intruso',$2)`,
          [acme.org, bruno],
        ),
      ),
    );

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
