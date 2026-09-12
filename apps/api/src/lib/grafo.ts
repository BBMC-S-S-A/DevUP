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
