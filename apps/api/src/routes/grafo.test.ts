/**
 * Los enlaces del grafo, contra la base.
 *
 * POR QUÉ ESTO MERECE PRUEBA PROPIA Y NO UN BLOQUE MÁS EN `isolation.test.ts`.
 * Allí ya está lo que protege la tabla: que un enlace del que no se ven los dos
 * extremos no existe para quien mira. Lo de aquí es la capa de encima —`tejer`
 * y `vecinosDe`— y tiene tres formas de estar mal que las políticas no pueden
 * cazar:
 *
 *   1. **La dirección.** «La tarea menciona al mensaje» y «el mensaje menciona
 *      a la tarea» son la misma fila leída desde cada punta. Si `vecinosDe` se
 *      equivocara de lado, el grafo se dibujaría con las flechas al revés y
 *      nadie lo notaría: seguiría siendo un grafo plausible.
 *
 *   2. **Las dos direcciones.** Un nodo tiene vecinos por donde sale y por
 *      donde entra. Devolver solo los de salida deja la mitad del grafo
 *      invisible según por dónde se entre, y eso tampoco falla: contesta menos.
 *
 *   3. **La idempotencia.** Las reglas que tejen se ejecutan cada vez que pasa
 *      el hecho, no una sola. Sin `on conflict do nothing`, adjuntar dos veces
 *      el mismo archivo reventaría la petición entera por una restricción que
 *      en realidad decía «esto ya estaba bien».
 *
 * Y la cuarta, que es de seguridad y sí se comprueba aquí porque es de la capa:
 * que tejer hacia algo que no se ve **falle**, y no que se guarde a medias.
 *
 *   npm run test:grafo --workspace apps/api
 */
import { closePool, withUser } from "../db/pool.js";
import { olvidarNodo, retejerMensaje, retejerTarea, tejer, vecinosDe } from "../lib/grafo.js";

let total = 0;
const fallos: string[] = [];

function check(nombre: string, condicion: boolean): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos.push(nombre);
    console.log(`  ✗ ${nombre}`);
  }
}

const sufijo = Date.now().toString(36);

async function main(): Promise<void> {
  const pg = await import("pg");
  const admin = new pg.default.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  await admin.query("set search_path to public");

  const alta = async (nombre: string): Promise<string> =>
    (
      await admin.query<{ id: string }>("select public.register_user($1,$2,$3) as id", [
        `${nombre}-grafo-${sufijo}@devup.test`,
        "no-se-usa",
        nombre,
      ])
    ).rows[0]!.id;

  const ana = await alta("ana");
  const bruno = await alta("bruno");

  try {
    // Ana monta un espacio con dos tareas y un archivo. Bruno monta el suyo,
    // en otra organización: es el extremo que Ana no puede ver.
    const acme = await withUser(ana, async (db) => {
      const org = (
        await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          `Acme ${sufijo}`,
          `acme-grafo-${sufijo}`,
        ])
      ).rows[0]!.id;
      const ws = (
        await db.query<{ id: string }>(
          "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
          [org, "Producto", ana],
        )
      ).rows[0]!.id;
      const col = (
        await db.query<{ id: string }>(
          "select id from task_columns where workspace_id = $1 order by position limit 1",
          [ws],
        )
      ).rows[0]!.id;
      const tarea = async (titulo: string) =>
        (
          await db.query<{ id: string }>(
            `insert into tasks (workspace_id, column_id, title, position, created_by)
             values ($1,$2,$3,1000,$4) returning id`,
            [ws, col, titulo, ana],
          )
        ).rows[0]!.id;
      return { org, ws, pagos: await tarea("Pasarela de pagos"), login: await tarea("Arreglar el login") };
    });

    const deBruno = await withUser(bruno, async (db) => {
      const org = (
        await db.query<{ id: string }>("select public.create_organization($1,$2) as id", [
          `Bolt ${sufijo}`,
          `bolt-grafo-${sufijo}`,
        ])
      ).rows[0]!.id;
      const ws = (
        await db.query<{ id: string }>(
          "insert into workspaces (organization_id, name, created_by) values ($1,$2,$3) returning id",
          [org, "Lo suyo", bruno],
        )
      ).rows[0]!.id;
      const col = (
        await db.query<{ id: string }>(
          "select id from task_columns where workspace_id = $1 order by position limit 1",
          [ws],
        )
      ).rows[0]!.id;
      return (
        await db.query<{ id: string }>(
          `insert into tasks (workspace_id, column_id, title, position, created_by)
           values ($1,$2,'Secreto de Bolt',1000,$3) returning id`,
          [ws, col, bruno],
        )
      ).rows[0]!.id;
    });

    console.log("\nTejer");

    await withUser(ana, (db) =>
      tejer(db, {
        origenTipo: "tarea",
        origenId: acme.pagos,
        destinoTipo: "espacio",
        destinoId: acme.ws,
        etiqueta: "vive en",
        procedencia: "persona",
        autorId: ana,
      }),
    );

    const desdePagos = await withUser(ana, (db) => vecinosDe(db, "tarea", acme.pagos));
    check("el enlace aparece desde el nodo por el que se preguntó", desdePagos.length === 1);
    check("con su etiqueta", desdePagos[0]?.etiqueta === "vive en");
    // Sin el nombre no se puede dibujar nada, y pedirlo nodo a nodo serían
    // treinta peticiones para treinta enlaces.
    check("y con el nombre del OTRO extremo, no el del propio", desdePagos[0]?.nombre === "Producto");
    check("y su tipo", desdePagos[0]?.tipo === "espacio");

    console.log("\nLas dos direcciones, y cuál es cuál");

    // La misma fila, mirada desde la otra punta. Si esto devolviera vacío, la
    // mitad del grafo sería invisible según por dónde se entrara.
    const desdeEspacio = await withUser(ana, (db) => vecinosDe(db, "espacio", acme.ws));
    check("la misma arista se ve desde el otro extremo", desdeEspacio.length === 1);
    check("y ahí el vecino es la tarea", desdeEspacio[0]?.nodoId === acme.pagos);

    // Lo que no se puede perder al mirar desde los dos lados: de quién sale.
    check("desde el origen, la flecha SALE", desdePagos[0]?.direccion === "sale");
    check("desde el destino, la misma flecha ENTRA", desdeEspacio[0]?.direccion === "entra");

    console.log("\nTejer dos veces no rompe nada");

    const otraVez = await withUser(ana, async (db) => {
      // Exactamente el mismo enlace: es lo que hace una regla que se dispara
      // cada vez que pasa el hecho.
      await tejer(db, {
        origenTipo: "tarea",
        origenId: acme.pagos,
        destinoTipo: "espacio",
        destinoId: acme.ws,
        etiqueta: "vive en",
      });
      return (await vecinosDe(db, "tarea", acme.pagos)).length;
    });
    check("el mismo enlace dos veces sigue siendo uno", otraVez === 1);

    // Pero la etiqueta forma parte de la identidad del enlace: «cierra» y
    // «menciona» entre las mismas dos cosas son dos relaciones distintas.
    const conOtraEtiqueta = await withUser(ana, async (db) => {
      await tejer(db, {
        origenTipo: "tarea",
        origenId: acme.pagos,
        destinoTipo: "espacio",
        destinoId: acme.ws,
        etiqueta: "se despliega en",
      });
      return (await vecinosDe(db, "tarea", acme.pagos)).length;
    });
    check("y con otra etiqueta son dos relaciones distintas", conOtraEtiqueta === 2);

    console.log("\nLos dos extremos, o nada");

    // La comprobación que justifica toda la 0043: Ana no ve la tarea de Bruno,
    // así que no puede enlazarla. Si esto pasara, el enlace revelaría que esa
    // tarea existe — y con ella, el espacio de otra organización.
    const haciaLoAjeno = await withUser(ana, async (db) => {
      try {
        await tejer(db, {
          origenTipo: "tarea",
          origenId: acme.pagos,
          destinoTipo: "tarea",
          destinoId: deBruno,
          etiqueta: "curiosidad",
        });
        return "coló";
      } catch {
        return "rechazado";
      }
    });
    check("no se puede enlazar hacia algo que no se ve", haciaLoAjeno === "rechazado");

    // Y la otra mitad: que el intento no haya dejado rastro. Un enlace a medias
    // sería la misma fuga escrita más despacio.
    const rastro = await admin.query(
      "select id from graph_links where target_id = $1 or source_id = $1",
      [deBruno],
    );
    check("y el intento no deja el enlace escrito a medias", rastro.rowCount === 0);

    console.log("\nLo que ve el otro lado");

    // Bruno no ve NINGUNO de los enlaces de Ana, porque no ve sus extremos.
    const loQueVeBruno = await withUser(bruno, (db) => vecinosDe(db, "tarea", acme.pagos));
    check("Bruno no ve los enlaces de una tarea que no puede ver", loQueVeBruno.length === 0);

    // Y preguntar por un nodo que no existe contesta lo mismo que preguntar por
    // uno ajeno: nada. Es lo que impide usar esta ruta como detector.
    const inventado = await withUser(ana, (db) =>
      vecinosDe(db, "tarea", "00000000-0000-0000-0000-000000000000"),
    );
    check(
      "y un nodo inventado contesta lo mismo que uno ajeno: nada",
      inventado.length === loQueVeBruno.length,
    );

    console.log("\nBorrar");

    const quedan = await withUser(ana, async (db) => {
      const vecinos = await vecinosDe(db, "tarea", acme.pagos);
      await db.query("delete from graph_links where id = $1", [vecinos[0]!.id]);
      return (await vecinosDe(db, "tarea", acme.pagos)).length;
    });
    check("borrar un enlace lo quita de las dos puntas", quedan === 1);

    const brunoBorro = await withUser(bruno, async (db) => {
      const { rowCount } = await db.query("delete from graph_links where source_id = $1", [
        acme.pagos,
      ]);
      return rowCount ?? 0;
    });
    check("y Bruno no puede borrar los que no ve", brunoBorro === 0);

    /* =======================================================================
     * Las reglas que tejen solas
     *
     * Hasta aquí todo eran enlaces puestos a mano. Lo de abajo es lo que de
     * verdad llena el grafo —nadie va a dibujar su red de trabajo a mano— y lo
     * que se comprueba no es que teja, que es lo fácil: es que DESTEJA cuando
     * el hecho deja de ser verdad, y que al hacerlo no se lleve por delante lo
     * que escribió una persona. Un índice que solo suma acaba siendo un índice
     * que miente, y miente con la misma cara con la que decía la verdad.
     * ==================================================================== */

    console.log("\nRetejer desde los hechos");

    const repo = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into github_repos (connection_id, organization_id, workspace_id, full_name, added_by)
         values (null,$1,$2,'acme/producto',$3) returning id`,
        [acme.org, acme.ws, ana],
      );
      return rows[0]!.id;
    });

    const archivo = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into files
           (organization_id, workspace_id, task_id, storage_key, name, mime_type,
            size_bytes, uploaded_by, status)
         values ($1,$2,$3,$4,'diagrama.png','image/png',10,$5,'ready') returning id`,
        [acme.org, acme.ws, acme.login, `acme/${sufijo}/diagrama.png`, ana],
      );
      return rows[0]!.id;
    });

    const rama = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into task_branches (task_id, nombre, github_repo_id, estado, created_by)
         values ($1,'feat/login',$2,'abierta',$3) returning id`,
        [acme.login, repo, ana],
      );
      return rows[0]!.id;
    });

    const tejido = await withUser(ana, async (db) => {
      await retejerTarea(db, acme.login);
      return vecinosDe(db, "tarea", acme.login);
    });
    const etiquetas = (v: typeof tejido) => v.map((x) => x.etiqueta).sort();

    check("el adjunto sale como enlace", tejido.some((v) => v.nodoId === archivo));
    check("con la etiqueta de lo que es", tejido.find((v) => v.nodoId === archivo)?.etiqueta === "lleva pegado");
    check("la rama trae el repositorio donde se toca", tejido.some((v) => v.nodoId === repo));
    check("y lo que teje una regla queda marcado como tal", tejido.every((v) => v.procedencia === "regla"));

    // Lo mismo dos veces, que es lo que hace una regla que corre en cada hecho.
    const dosVeces = await withUser(ana, async (db) => {
      await retejerTarea(db, acme.login);
      return vecinosDe(db, "tarea", acme.login);
    });
    check("retejer no duplica nada", dosVeces.length === tejido.length);

    console.log("\nY desteje cuando el hecho deja de serlo");

    // Alguien pone un enlace a mano ANTES de que se quite el adjunto: es el que
    // no se puede perder al recalcular, porque no está escrito en ningún otro
    // sitio del que volver a deducirlo.
    await withUser(ana, (db) =>
      tejer(db, {
        origenTipo: "tarea",
        origenId: acme.login,
        destinoTipo: "tarea",
        destinoId: acme.pagos,
        etiqueta: "espera a",
        procedencia: "persona",
        autorId: ana,
      }),
    );

    const trasQuitar = await withUser(ana, async (db) => {
      await db.query("delete from task_branches where id = $1", [rama]);
      await retejerTarea(db, acme.login);
      return vecinosDe(db, "tarea", acme.login);
    });

    check("quitada la rama, su enlace desaparece", !trasQuitar.some((v) => v.nodoId === repo));
    check("pero el adjunto sigue", trasQuitar.some((v) => v.nodoId === archivo));
    // La que justifica que el borrado mire `source`: sin eso, recalcular sería
    // una herramienta de pérdida de datos con nombre de mantenimiento.
    check(
      "y lo que puso una persona sobrevive al recálculo",
      trasQuitar.some((v) => v.nodoId === acme.pagos && v.procedencia === "persona"),
    );
    check("sin inventarse etiquetas por el camino", etiquetas(trasQuitar).join("|") === "espera a|lleva pegado");

    console.log("\nCuando el nodo se va del todo");

    /**
     * LA TRAMPA QUE ESTO FIJA. `graph_links` no tiene clave ajena hacia las
     * ocho tablas —no puede, el extremo es polimórfico— y la política de
     * `delete` exige ver los DOS extremos. Así que si la fila se borra primero,
     * sus enlaces dejan de poder borrarse: quedan en la tabla para siempre,
     * apuntando a un identificador que ya no es de nadie, y saliendo en
     * cualquier recuento que se haga como dueño. No falla nada; solo se pudre.
     */
    const olvidado = await withUser(ana, async (db) => {
      await olvidarNodo(db, "archivo", archivo);
      await db.query("delete from files where id = $1", [archivo]);
      return (await vecinosDe(db, "tarea", acme.login)).length;
    });
    check("borrado el archivo, su enlace se fue con él", olvidado === 1);

    const huerfanos = await admin.query(
      "select 1 from graph_links where source_id = $1 or target_id = $1",
      [archivo],
    );
    check("y no queda rastro ni mirando como dueño", huerfanos.rowCount === 0);

    /**
     * Y AL REVÉS, que es lo que hace que el orden de arriba no sea manía.
     *
     * Esto hace justo lo contrario —borra la fila primero y limpia después— y
     * comprueba que el enlace SOBREVIVE. No es un comportamiento deseable que
     * se esté fijando: es la trampa, escrita para que se vea. Si algún día
     * alguien invierte las dos líneas en una ruta pensando que da igual, esto
     * de aquí es lo único que lo va a decir, porque por fuera no falla nada.
     */
    const segundo = await withUser(ana, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into files
           (organization_id, workspace_id, task_id, storage_key, name, mime_type,
            size_bytes, uploaded_by, status)
         values ($1,$2,$3,$4,'otro.png','image/png',10,$5,'ready') returning id`,
        [acme.org, acme.ws, acme.login, `acme/${sufijo}/otro.png`, ana],
      );
      const id = rows[0]!.id;
      await retejerTarea(db, acme.login);
      await db.query("delete from files where id = $1", [id]);
      // Ahora el extremo ya no se ve, así que la política de `delete` no deja
      // tocar la fila: borra cero.
      await olvidarNodo(db, "archivo", id);
      return id;
    });

    const encallado = await admin.query("select 1 from graph_links where target_id = $1", [segundo]);
    check(
      "limpiar DESPUÉS de borrar la fila no limpia nada: el enlace queda encallado",
      encallado.rowCount === 1,
    );

    // Y una vez encallado, ya no hay forma de llegar a él desde la API — ni
    // para verlo ni para quitarlo. Solo el dueño de la base puede.
    await admin.query("delete from graph_links where target_id = $1", [segundo]);
    /* =======================================================================
     * De qué conversación salió esto
     *
     * Era el único hueco real que le quedaba al grafo: `contexto_de_tarea`
     * contestaba «ninguna conversación enlazada» casi siempre, y no porque no
     * las hubiera — las menciones solo saben apuntar a personas.
     *
     * Lo que se vigila aquí no es que enlace, que es lo fácil. Es que NO enlace
     * de más, porque un enlace falso en un grafo se lee con la misma confianza
     * que uno verdadero:
     *
     *   · un identificador que no es de ninguna tarea
     *   · uno de una tarea de OTRO espacio, aunque quien escribe la vea
     *   · y que editar el mensaje para quitar la cita quite la arista
     * ==================================================================== */

    console.log("\nDe qué conversación salió esto");

    // El canal lo crea el dueño de la base: crearlo bajo RLS pide condiciones
    // que no son lo que se está probando aquí. Lo que sí corre bajo RLS —que es
    // lo que importa— es `retejerMensaje`.
    const canal = (
      await admin.query<{ id: string }>(
        `insert into channels (workspace_id, name, kind, is_private, created_by)
         values ($1,'general','text',false,$2) returning id`,
        [acme.ws, ana],
      )
    ).rows[0]!.id;

    const escribir = (texto: string) =>
      withUser(ana, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          "insert into messages (channel_id, author_id, body) values ($1,$2,$3) returning id",
          [canal, ana, texto],
        );
        await retejerMensaje(db, rows[0]!.id);
        return rows[0]!.id;
      });

    const citaPagos = await escribir(
      `Lo de la pasarela lo dejamos para el sprint que viene [tarea ${acme.pagos}]`,
    );

    const desdeMensaje = await withUser(ana, (db) => vecinosDe(db, "mensaje", citaPagos));
    check("citar una tarea por su identificador la enlaza", desdeMensaje.length === 1);
    check("y apunta a la tarea citada", desdeMensaje[0]?.nodoId === acme.pagos);
    check("con la flecha saliendo del mensaje", desdeMensaje[0]?.direccion === "sale");

    // Y desde la tarea se ve la conversación: es la mitad que hace útil esto.
    const desdeTarea = await withUser(ana, (db) => vecinosDe(db, "tarea", acme.pagos));
    check(
      "y desde la tarea se ve de qué conversación salió",
      desdeTarea.some((v) => v.nodoId === citaPagos && v.direccion === "entra"),
    );

    console.log("\nLo que NO enlaza");

    const conUuidFalso = await escribir(
      "mirad este identificador 00000000-0000-0000-0000-000000000000 a ver",
    );
    check(
      "un identificador que no es de nadie no enlaza nada",
      (await withUser(ana, (db) => vecinosDe(db, "mensaje", conUuidFalso))).length === 0,
    );

    // LA QUE MÁS IMPORTA. Ana ve las dos tareas y los dos espacios, así que la
    // política dejaría tejer esto. Lo que lo impide es la regla: un canal de un
    // proyecto no queda unido al tablero de otro porque alguien pegó algo sin
    // darse cuenta — y el grafo se lee después como si dijera la verdad.
    const otroEspacio = await withUser(ana, async (db) => {
      const { rows: ws } = await db.query<{ id: string }>(
        "insert into workspaces (organization_id, name, created_by) values ($1,'Otro',$2) returning id",
        [acme.org, ana],
      );
      const { rows: col } = await db.query<{ id: string }>(
        "select id from task_columns where workspace_id = $1 order by position limit 1",
        [ws[0]!.id],
      );
      const { rows: t } = await db.query<{ id: string }>(
        `insert into tasks (workspace_id, column_id, title, position, created_by)
         values ($1,$2,'De otro proyecto',1000,$3) returning id`,
        [ws[0]!.id, col[0]!.id, ana],
      );
      return t[0]!.id;
    });

    const citaAjena = await escribir(`y esta otra [tarea ${otroEspacio}]`);
    check(
      "una tarea de otro espacio no se enlaza desde este canal",
      (await withUser(ana, (db) => vecinosDe(db, "mensaje", citaAjena))).length === 0,
    );

    console.log("\nY si se edita o se borra");

    const editado = await withUser(ana, async (db) => {
      await db.query("update messages set body = 'ya no digo nada' where id = $1", [citaPagos]);
      await retejerMensaje(db, citaPagos);
      return (await vecinosDe(db, "mensaje", citaPagos)).length;
    });
    check("quitar la cita al editar quita la arista", editado === 0);

    const trasBorrar = await withUser(ana, async (db) => {
      const otro = await db.query<{ id: string }>(
        "insert into messages (channel_id, author_id, body) values ($1,$2,$3) returning id",
        [canal, ana, `otra vez [tarea ${acme.pagos}]`],
      );
      await retejerMensaje(db, otro.rows[0]!.id);
      await db.query(
        "update messages set deleted_at = now(), body = '(mensaje eliminado)' where id = $1",
        [otro.rows[0]!.id],
      );
      await retejerMensaje(db, otro.rows[0]!.id);
      return (await vecinosDe(db, "mensaje", otro.rows[0]!.id)).length;
    });
    check("y borrarlo se lleva la suya", trasBorrar === 0);
  } finally {
    await admin.query("delete from public.organizations where slug like $1", [`%-grafo-${sufijo}`]);
    await admin.query("delete from public.users where email like $1", [
      `%-grafo-${sufijo}@devup.test`,
    ]);
    await admin.end();
    await closePool();
  }

  console.log(`\n${total - fallos.length} comprobaciones correctas, ${fallos.length} fallidas`);
  if (fallos.length > 0) {
    console.error("\nFallaron:\n" + fallos.map((f) => `  · ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
