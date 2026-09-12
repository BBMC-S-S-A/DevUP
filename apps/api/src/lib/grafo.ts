import type { Db } from "../db/pool.js";

/**
 * Los enlaces del grafo del proyecto: tejerlos y leerlos.
 *
 * UNA SOLA PUERTA, POR EL MISMO MOTIVO QUE `actividad.ts`. Todo lo que quiera
 * enlazar dos cosas pasa por aquí en vez de escribir su propio `insert`. Así el
 * vocabulario de etiquetas vive en un sitio y no repartido por diez sitios que
 * acaban escribiendo «cierra», «closes» y «cerro» según quién lo tocara — y con
 * un grafo, un vocabulario partido no es una incomodidad: es que la misma
 * relación deja de encontrarse.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * EL AISLAMIENTO NO SE COMPRUEBA AQUÍ, Y ESO ES DELIBERADO. La tentación es
 * escribir un `if (!puedeVer(origen) || !puedeVer(destino))` antes del insert.
 * Sería una segunda copia de la regla que ya vive en las políticas de la 0043,
 * y la segunda copia es la que diverge. Las políticas comprueban **los dos
 * extremos** en select, insert y delete; lo que hace esta capa es traducir su
 * negativa a algo que se pueda leer, porque lo que devuelve Postgres cuando una
 * política rechaza un insert es «new row violates row-level security policy for
 * table graph_links», que no le dice nada a nadie.
 *
 * TEJER ES IDEMPOTENTE, y tiene que serlo. Las reglas que tejen —al adjuntar un
 * archivo, al enlazar una rama, al mencionar una tarea— se ejecutan cada vez que
 * pasa el hecho, no una sola. Sin `on conflict do nothing`, adjuntar dos veces
 * el mismo archivo reventaría la petición entera por una restricción de
 * unicidad que en realidad está diciendo «esto ya estaba bien».
 *
 * Y POR ESO NO DEVUELVE SI CREÓ O NO. Quien teje no necesita saberlo y
 * preguntárselo llevaría a escribir un `if` alrededor. El enlace está: era lo
 * que se quería.
 */

/** Los ocho tipos de nodo de la 0043. Que un tipo nuevo obligue a tocar esto
 *  es la misma decisión que en `puede_ver_nodo`: lo que nadie enseñó a tratar,
 *  no se trata. */
export const TIPOS_DE_NODO = [
  "espacio",
  "canal",
  "mensaje",
  "tarea",
  "archivo",
  "componente",
  "repositorio",
  "entorno",
] as const;

export type TipoDeNodo = (typeof TIPOS_DE_NODO)[number];

/** De dónde salió el enlace. Mismo vocabulario que el registro de actividad:
 *  hay que poder distinguir lo que tejió una regla de lo que puso una persona,
 *  porque solo lo primero se puede recalcular sin perder nada. */
export type Procedencia = "persona" | "regla" | "agente";

export type Enlace = {
  origenTipo: TipoDeNodo;
  origenId: string;
  destinoTipo: TipoDeNodo;
  destinoId: string;
  /** Qué relación es: «menciona», «cierra», «despliega». Libre a propósito. */
  etiqueta?: string;
  procedencia?: Procedencia;
  autorId?: string | null;
};

/**
 * Cómo se llama cada tipo de nodo en su propia tabla.
 *
 * SE ESCRIBE UNA VEZ Y SE USA EN LA CONSULTA DE ABAJO. Un enlace guarda tipo e
 * identificador y nada más —es lo correcto: el nombre de una tarea cambia y el
 * enlace no debería—, pero para DIBUJARLO hace falta el nombre de ahora. Sin
 * esto, la pantalla tendría que pedir cada nodo por su lado: con treinta
 * enlaces, treinta peticiones.
 *
 * Los subselects corren bajo RLS como todo lo demás, así que un nodo invisible
 * daría nombre nulo — pero no puede pasar: la política de `graph_links` ya
 * excluyó la fila entera si alguno de los dos extremos no se ve.
 */
const NOMBRE_DEL_NODO = `
  case $KIND
    when 'espacio'     then (select w.name from workspaces w where w.id = $ID)
    when 'canal'       then (select c.name from channels c where c.id = $ID)
    -- Un mensaje no tiene título: se usa su principio, que es lo que una
    -- persona reconocería al verlo en un grafo.
    when 'mensaje'     then (select left(m.body, 80) from messages m where m.id = $ID)
    when 'tarea'       then (select t.title from tasks t where t.id = $ID)
    when 'archivo'     then (select f.name from files f where f.id = $ID)
    when 'componente'  then (select n.name from architecture_nodes n where n.id = $ID)
    when 'repositorio' then (select r.full_name from github_repos r where r.id = $ID)
    when 'entorno'     then (select e.name from environments e where e.id = $ID)
  end`;

/** La misma expresión, apuntando a un extremo o al otro. */
const nombreDe = (lado: "source" | "target") =>
  NOMBRE_DEL_NODO.replaceAll("$KIND", `l.${lado}_kind`).replaceAll("$ID", `l.${lado}_id`);

/**
 * Teje un enlace. Si ya estaba, no hace nada y no se queja.
 *
 * Sin `try/catch`, igual que `anotar`: va dentro de la transacción de
 * `withUser`, así que o pasó el hecho y quedó tejido, o no pasó. Un grafo con
 * agujeros es peor que uno vacío — nadie sabe cuáles faltan, y las respuestas
 * se leen igual de confiadas.
 */
export async function tejer(db: Db, enlace: Enlace): Promise<void> {
  await db.query(
    `insert into graph_links
       (source_kind, source_id, target_kind, target_id, label, source, created_by)
     values ($1::public.graph_node_kind, $2, $3::public.graph_node_kind, $4, $5,
             $6::public.activity_source, $7)
     on conflict do nothing`,
    [
      enlace.origenTipo,
      enlace.origenId,
      enlace.destinoTipo,
      enlace.destinoId,
      (enlace.etiqueta ?? "").slice(0, 60),
      enlace.procedencia ?? "regla",
      enlace.autorId ?? null,
    ],
  );
}

export type Vecino = {
  id: string;
  etiqueta: string;
  procedencia: Procedencia;
  creadoEn: string;
  /** Hacia dónde apunta la flecha respecto al nodo por el que se preguntó. */
  direccion: "sale" | "entra";
  tipo: TipoDeNodo;
  nodoId: string;
  nombre: string | null;
};

/**
 * Los vecinos de un nodo, en las dos direcciones.
 *
 * EN LAS DOS, Y NO SOLO HACIA DELANTE. «Qué cierra este PR» y «qué PR cierra
 * esta tarea» son la misma arista mirada desde cada punta, y una pantalla que
 * solo enseñara una de las dos dejaría la mitad del grafo invisible según por
 * dónde se entrara. Lo que sí se conserva es la DIRECCIÓN, porque «la tarea
 * menciona al mensaje» y «el mensaje menciona a la tarea» no son lo mismo.
 *
 * No hace falta ningún `where` de organización: la política de la 0043 ya
 * excluye cualquier enlace del que no se vean los dos extremos.
 */
export async function vecinosDe(
  db: Db,
  tipo: TipoDeNodo,
  id: string,
  limite = 200,
): Promise<Vecino[]> {
  const { rows } = await db.query<Vecino>(
    `select l.id, l.label as etiqueta, l.source as procedencia,
            l.created_at as "creadoEn",
            case when l.source_kind = $1::public.graph_node_kind and l.source_id = $2
                 then 'sale' else 'entra' end as direccion,
            case when l.source_kind = $1::public.graph_node_kind and l.source_id = $2
                 then l.target_kind else l.source_kind end as tipo,
            case when l.source_kind = $1::public.graph_node_kind and l.source_id = $2
                 then l.target_id else l.source_id end as "nodoId",
            case when l.source_kind = $1::public.graph_node_kind and l.source_id = $2
                 then ${nombreDe("target")} else ${nombreDe("source")} end as nombre
       from graph_links l
      where (l.source_kind = $1::public.graph_node_kind and l.source_id = $2)
         or (l.target_kind = $1::public.graph_node_kind and l.target_id = $2)
      order by l.created_at desc
      limit $3`,
    [tipo, id, limite],
  );
  return rows;
}

/**
 * Quita del grafo todo lo que tocaba a un nodo, por las dos puntas.
 *
 * HAY QUE LLAMARLO **ANTES** DE BORRAR LA FILA, y no es una preferencia de
 * estilo: es la única ventana que existe. `graph_links` no guarda claves ajenas
 * hacia las ocho tablas —no puede, el extremo es polimórfico—, así que borrar
 * una tarea no se lleva sus enlaces. Y la política de `delete` de la 0043 exige
 * ver los dos extremos: en cuanto la fila desaparece, `puede_ver_nodo` contesta
 * que no y esos enlaces quedan **inalcanzables para siempre** desde la API. No
 * se pueden borrar ni leer; solo engordan la tabla y salen en cualquier recuento
 * que se haga como dueño.
 *
 * Por eso quien llama tiene que asegurarse de que, si el borrado de la fila
 * acaba no ocurriendo —porque RLS lo rechaza—, la transacción entera se
 * deshace. Si no, se habrían tirado los enlaces de algo que sigue estando.
 *
 * AQUÍ SÍ SE BORRA LO QUE PUSO UNA PERSONA, al revés que en `retejerTarea`.
 * Allí se conserva porque el nodo sigue ahí y lo que dijo alguien a mano no se
 * puede volver a deducir. Aquí no hay nada que conservar: la cosa a la que
 * apuntaba ya no existe.
 */
export async function olvidarNodo(db: Db, tipo: TipoDeNodo, id: string): Promise<void> {
  await db.query(
    `delete from graph_links
      where (source_kind = $1::public.graph_node_kind and source_id = $2)
         or (target_kind = $1::public.graph_node_kind and target_id = $2)`,
    [tipo, id],
  );
}

/* ===========================================================================
 * Las reglas que tejen
 * ======================================================================== */

/**
 * Rehace los enlaces de una tarea a partir de lo que hay AHORA.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * POR QUÉ «REHACER» Y NO «AÑADIR», que era lo obvio. El diseño
 * (`DISENO-GRAFO-DEL-PROYECTO.md` §2) dice que **el grafo es un índice, no una
 * fuente**, y que lo que lo hace valioso es poder rehacerlo entero si una regla
 * estaba mal. Un tejido que solo añade no cumple ninguna de las dos cosas: en
 * cuanto alguien quita un adjunto, la arista se queda ahí diciendo que existe.
 * Y un índice que miente no se arregla mirándolo — hay que saber que miente.
 *
 * Así que esto borra y reescribe. Es idempotente por construcción, no por
 * suerte: llamarlo diez veces seguidas deja lo mismo que llamarlo una.
 *
 * LO QUE NO BORRA, Y AHÍ ESTÁ LA COLUMNA `source` GANÁNDOSE EL SITIO: solo
 * quita lo que tejió una regla. Lo que puso una persona a mano sobrevive, y
 * tiene que sobrevivir — es lo único del grafo que no está escrito en ningún
 * otro sitio y que no se puede volver a deducir. Perderlo al recalcular sería
 * convertir una herramienta de mantenimiento en una de pérdida de datos.
 *
 * LA INVARIANTE QUE LO HACE SEGURO: todas las reglas ponen la TAREA como
 * origen. Por eso el borrado de abajo puede mirar solo `source_id` y estar
 * seguro de que no se lleva por delante un enlace ajeno que apuntara a esta
 * tarea desde otro sitio. Si alguna regla futura invierte los extremos, este
 * borrado deja de ser correcto — de ahí que esté dicho aquí y no solo en la
 * cabeza de quien lo escribió.
 *
 * NO COMPRUEBA PERMISOS, y no le hace falta: cada `select` de abajo corre bajo
 * RLS, así que solo ve lo que quien llama ve, y `tejer` pasa por las políticas
 * de la 0043. Una regla no puede enlazar hacia algo que su dueño no alcanza.
 */
export async function retejerTarea(db: Db, tareaId: string): Promise<void> {
  await db.query(
    `delete from graph_links
      where source_kind = 'tarea' and source_id = $1 and source = 'regla'`,
    [tareaId],
  );

  // --- Lo que lleva pegado --------------------------------------------------
  // `files.task_id` es la única arista de esta lista que el documento daba ya
  // por existente: existía el dato, no el enlace. Ahora el grafo la ve.
  const { rows: archivos } = await db.query<{ id: string }>(
    `select id from files
      where task_id = $1 and status = 'ready' and deleted_at is null`,
    [tareaId],
  );
  for (const archivo of archivos) {
    await tejer(db, {
      origenTipo: "tarea",
      origenId: tareaId,
      destinoTipo: "archivo",
      destinoId: archivo.id,
      etiqueta: "lleva pegado",
    });
  }

  // --- Dónde se está tocando ------------------------------------------------
  // De las ramas apuntadas en la ficha (0045). Solo las que dicen en qué
  // repositorio: una rama sin repositorio es un nombre, y un nombre no es un
  // nodo del grafo.
  const { rows: repos } = await db.query<{ github_repo_id: string }>(
    `select distinct github_repo_id from task_branches
      where task_id = $1 and github_repo_id is not null`,
    [tareaId],
  );
  for (const repo of repos) {
    await tejer(db, {
      origenTipo: "tarea",
      origenId: tareaId,
      destinoTipo: "repositorio",
      destinoId: repo.github_repo_id,
      etiqueta: "se toca en",
    });
  }

  /**
   * --- Dónde quedó probada --------------------------------------------------
   *
   * De la evidencia (0045), cuando apunta a un repositorio CONECTADO.
   *
   * ES DETERMINISTA Y NO UNA ADIVINANZA, que es la raya que el diseño pide no
   * cruzar (§7). No se interpreta la URL: se saca `owner/repo` de una dirección
   * de GitHub y se busca una coincidencia EXACTA en los repositorios que esta
   * organización ya conectó. Si no hay, no se teje nada — no se inventa un nodo
   * ni se deja una arista «probablemente».
   *
   * El `join` corre bajo RLS, así que un repositorio de otra organización que
   * se llamara igual no existiría para esta consulta.
   */
  const { rows: probada } = await db.query<{ id: string }>(
    `select distinct r.id
       from task_evidence e
       join github_repos r
         on lower(r.full_name) = lower(substring(e.url from 'github\\.com/([^/?#]+/[^/?#]+)'))
      where e.task_id = $1 and e.url is not null`,
    [tareaId],
  );
  for (const repo of probada) {
    await tejer(db, {
      origenTipo: "tarea",
      origenId: tareaId,
      destinoTipo: "repositorio",
      destinoId: repo.id,
      etiqueta: "se probó en",
    });
  }
}
