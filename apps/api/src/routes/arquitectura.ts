import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { ANCHO_COLUMNA, ALTO_FILA, MARGEN, alturaLibre, repartirEnColumnas } from "../connectors/arquitectura.js";
import { fetchGithubFileContent, fetchGithubTree } from "../connectors/github.js";
import { leerTerraform, terraformDelArbol } from "../connectors/terraform.js";
import { type Db, withUser } from "../db/pool.js";
import { badGateway, notFound, parseBody, parseParams, requireUser } from "../lib/http.js";
import { repoSinCredencial } from "./github.js";

/**
 * El diagrama de arquitectura: nodos y enlaces.
 *
 * QUÉ RESUELVE. Infraestructura (0021) enseña despliegues, pero no deja
 * dibujar cómo está montado el sistema. Esto es esa pieza: un nodo por
 * componente —servicio, base de datos, cola— y un enlace por relación entre
 * dos.
 *
 * HAY TRES MANERAS DE LLENARLO y las tres acaban en el mismo sitio: a mano
 * desde la pantalla, de una tacada desde un agente por MCP, o leyendo el
 * Terraform de un repositorio conectado. Las dos últimas pasan por
 * `fusionarArquitectura`, que es donde vive —una sola vez— la regla de qué
 * pasa cuando lo que llega ya está dibujado.
 *
 * SE DEVUELVE TODO JUNTO. El diagrama se pinta entero o no se pinta: no hay
 * paginación de nodos que tenga sentido para un lienzo, así que una sola
 * llamada trae nodos y enlaces a la vez.
 */

const uuid = z.string().uuid();
const KIND = z.enum(["servicio", "base_datos", "cola", "cache", "almacenamiento", "api_externa", "otro"]);

const NODE_COLUMNS = `
  id, kind, name, description, pos_x as "posX", pos_y as "posY", created_at as "createdAt"`;

const LINK_COLUMNS = `id, source_id as "sourceId", target_id as "targetId", label`;
const LINK_COLUMNS_L = `l.id, l.source_id as "sourceId", l.target_id as "targetId", l.label`;

/**
 * `x` e `y` son opcionales, y esa es toda la diferencia entre las dos formas
 * de meter un diagrama.
 *
 * SIN COORDENADAS, las calcula DevUP repartiendo en columnas. Es lo que hay
 * que hacer cuando quien manda los componentes los dedujo de un repositorio o
 * de un Terraform: ahí hay estructura, pero no hay dibujo.
 *
 * CON COORDENADAS, se respetan tal cual. Cuando alguien ya TIENE el diagrama
 * —lo trae de otra herramienta, o el agente lo ha compuesto a propósito—,
 * recolocarlo sería tirar el trabajo hecho y devolver algo que no es lo que se
 * pidió. Se mezclan las dos: las cajas que traen sitio van a su sitio, y las
 * que no lo traen se reparten entre los huecos.
 */
const COMPONENTE = z.object({
  nombre: z.string().trim().min(1).max(60),
  tipo: KIND.default("servicio"),
  descripcion: z.string().trim().max(2000).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
});

const CONEXION = z.object({
  de: z.string().trim().min(1).max(60),
  a: z.string().trim().min(1).max(60),
  etiqueta: z.string().trim().max(60).optional(),
});

/**
 * El tope de cajas que entran de una vez.
 *
 * No es una restricción de la base: es que un diagrama de doscientas cajas no
 * se lee, y quien manda mil casi siempre está mandando el árbol de archivos de
 * un repositorio en vez de su arquitectura. Cortar aquí con un número y un
 * mensaje es más útil que dibujarlo.
 */
const TOPE_COMPONENTES = 200;
const TOPE_CONEXIONES = 600;

export const ENTRADA_FUSION = z.object({
  componentes: z.array(COMPONENTE).max(TOPE_COMPONENTES),
  conexiones: z.array(CONEXION).max(TOPE_CONEXIONES).default([]),
});

export type Fusion = {
  creados: string[];
  reutilizados: string[];
  enlazados: string[];
  sinResolver: string[];
};

type NodoFila = { id: string; name: string; posX: number; posY: number };

/**
 * Mete componentes y conexiones en un diagrama que ya puede tener cosas.
 *
 * QUÉ PASA CON LO QUE YA ESTÁ, que es la única pregunta que importa aquí:
 *
 * - **Un componente que ya existe con ese nombre se reutiliza**, no se
 *   duplica. Volver a importar el mismo Terraform, o que un agente llame dos
 *   veces, tiene que dejar el mismo lienzo y no el doble de cajas.
 * - **Lo que ya estaba colocado no se mueve.** La disposición es trabajo de
 *   alguien: recolocar el diagrama entero en cada importación convertiría una
 *   función útil en una que da miedo usar.
 * - **Nada se borra.** Un recurso que desaparece del Terraform deja su caja,
 *   que alguien quita si quiere. Equivocarse creando deja trabajo que revisar;
 *   equivocarse borrando deja trabajo perdido.
 *
 * Las conexiones cuyos dos extremos no se encuentran no son un error: se
 * devuelven en `sinResolver` para poder decirlo. Un agente que se inventa un
 * nombre en la lista de conexiones es un caso corriente, y tirar la operación
 * entera por eso perdería las veinte cajas que sí estaban bien.
 */
export async function fusionarArquitectura(
  db: Db,
  workspaceId: string,
  userId: string,
  entrada: z.infer<typeof ENTRADA_FUSION>,
): Promise<Fusion> {
  const { rows: existentes } = await db.query<NodoFila>(
    `select ${NODE_COLUMNS} from architecture_nodes where workspace_id = $1`,
    [workspaceId],
  );

  const clave = (nombre: string) => nombre.trim().toLowerCase();
  const porNombre = new Map(existentes.map((n) => [clave(n.name), n]));
  const baseY = alturaLibre(existentes.map((n) => n.posY));

  // Solo se reparten en columnas los que NO traen sitio propio: a los que lo
  // traen no hay nada que calcularles, y meterlos en el reparto además
  // desplazaría a los otros para dejarles un hueco que no van a usar.
  const nuevos = entrada.componentes.filter(
    (c) => !porNombre.has(clave(c.nombre)) && c.x === undefined && c.y === undefined,
  );
  const columnas = repartirEnColumnas(
    nuevos.map((c) => c.nombre),
    entrada.conexiones,
  );
  /** Cuántas cajas lleva ya cada columna, para no apilarlas encima. */
  const ocupadas = new Map<number, number>();

  const creados: string[] = [];
  const reutilizados: string[] = [];

  for (const componente of entrada.componentes) {
    const k = clave(componente.nombre);
    if (porNombre.has(k)) {
      reutilizados.push(componente.nombre);
      continue;
    }
    /** Donde lo pidan, o donde toque por el reparto. */
    let posX: number;
    let posY: number;
    if (componente.x !== undefined || componente.y !== undefined) {
      posX = Math.round(componente.x ?? MARGEN);
      posY = Math.round(componente.y ?? MARGEN);
    } else {
      const col = columnas.get(k) ?? 0;
      const fila = ocupadas.get(col) ?? 0;
      ocupadas.set(col, fila + 1);
      posX = MARGEN + col * ANCHO_COLUMNA;
      posY = baseY + fila * ALTO_FILA;
    }

    const { rows } = await db.query<NodoFila>(
      `insert into architecture_nodes
         (workspace_id, organization_id, kind, name, description, pos_x, pos_y, created_by)
       values ($1,(select organization_id from workspaces where id = $1),
               $2::architecture_node_kind,$3,$4,$5,$6,$7)
       returning ${NODE_COLUMNS}`,
      [
        workspaceId,
        componente.tipo,
        componente.nombre,
        componente.descripcion ?? "",
        posX,
        posY,
        userId,
      ],
    );
    const nodo = rows[0]!;
    porNombre.set(k, nodo);
    creados.push(nodo.name);
  }

  // Los enlaces que ya existen no se repiten: la base no admite el mismo dos
  // veces, y fallar entero por eso sería absurdo.
  const { rows: enlaces } = await db.query<{ sourceId: string; targetId: string; label: string }>(
    `select ${LINK_COLUMNS_L}
       from architecture_links l
       join architecture_nodes n on n.id = l.source_id
      where n.workspace_id = $1`,
    [workspaceId],
  );
  const yaEnlazados = new Set(enlaces.map((l) => `${l.sourceId}|${l.targetId}|${l.label}`));

  const enlazados: string[] = [];
  const sinResolver: string[] = [];

  for (const conexion of entrada.conexiones) {
    const origen = porNombre.get(clave(conexion.de));
    const destino = porNombre.get(clave(conexion.a));
    if (!origen || !destino) {
      sinResolver.push(`${conexion.de} → ${conexion.a}`);
      continue;
    }
    if (origen.id === destino.id) continue;

    const etiqueta = conexion.etiqueta ?? "";
    const huella = `${origen.id}|${destino.id}|${etiqueta}`;
    if (yaEnlazados.has(huella)) continue;

    await db.query(
      `insert into architecture_links (source_id, target_id, label, created_by)
       values ($1,$2,$3,$4)`,
      [origen.id, destino.id, etiqueta, userId],
    );
    yaEnlazados.add(huella);
    enlazados.push(`${origen.name} → ${destino.name}`);
  }

  return { creados, reutilizados, enlazados, sinResolver };
}

export async function arquitecturaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  app.get("/workspaces/:workspaceId/architecture", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    return withUser(userId, async (db) => {
      const [nodes, links] = await Promise.all([
        db.query(
          `select ${NODE_COLUMNS} from architecture_nodes where workspace_id = $1 order by created_at`,
          [workspaceId],
        ),
        db.query(
          `select ${LINK_COLUMNS_L}
             from architecture_links l
             join architecture_nodes n on n.id = l.source_id
            where n.workspace_id = $1
            order by l.created_at`,
          [workspaceId],
        ),
      ]);
      return { nodes: nodes.rows, links: links.rows };
    });
  });

  app.post("/workspaces/:workspaceId/architecture/nodes", async (request, reply) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const body = parseBody(
      z.object({
        kind: KIND.default("servicio"),
        name: z.string().trim().min(1).max(60),
        description: z.string().trim().max(2000).optional(),
        posX: z.number().finite(),
        posY: z.number().finite(),
      }),
      request.body,
    );

    const node = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into architecture_nodes
           (workspace_id, organization_id, kind, name, description, pos_x, pos_y, created_by)
         values ($1,(select organization_id from workspaces where id = $1),
                 $2::architecture_node_kind,$3,$4,$5,$6,$7)
         returning ${NODE_COLUMNS}`,
        [workspaceId, body.kind, body.name, body.description ?? "", body.posX, body.posY, userId],
      );
      return rows[0];
    });

    return reply.status(201).send({ node });
  });

  app.patch("/architecture/nodes/:nodeId", async (request) => {
    const userId = requireUser(request);
    const { nodeId } = parseParams(z.object({ nodeId: uuid }), request.params);
    const body = parseBody(
      z.object({
        kind: KIND.optional(),
        name: z.string().trim().min(1).max(60).optional(),
        description: z.string().trim().max(2000).optional(),
        posX: z.number().finite().optional(),
        posY: z.number().finite().optional(),
      }),
      request.body,
    );

    return withUser(userId, async (db) => {
      const { rows } = await db.query(
        `update architecture_nodes set
           kind        = coalesce($2::architecture_node_kind, kind),
           name        = coalesce($3, name),
           description = coalesce($4, description),
           pos_x       = coalesce($5, pos_x),
           pos_y       = coalesce($6, pos_y)
         where id = $1
         returning ${NODE_COLUMNS}`,
        [nodeId, body.kind ?? null, body.name ?? null, body.description ?? null, body.posX ?? null, body.posY ?? null],
      );
      // Cero filas con RLS no distingue «no existe» de «no te deja»: se
      // responde igual a propósito, ver infraestructura.ts.
      if (!rows[0]) throw notFound("nodo no encontrado");
      return { node: rows[0] };
    });
  });

  app.delete("/architecture/nodes/:nodeId", async (request, reply) => {
    const userId = requireUser(request);
    const { nodeId } = parseParams(z.object({ nodeId: uuid }), request.params);
    await withUser(userId, async (db) => {
      const { rowCount } = await db.query("delete from architecture_nodes where id = $1", [nodeId]);
      if (!rowCount) throw notFound("nodo no encontrado");
    });
    return reply.status(204).send();
  });

  /**
   * Sin `:orgId` en la ruta a propósito: un enlace no tiene organización
   * propia (ver la migración), y validarla aquí sería repetir lo que ya hace
   * la política de RLS al comprobar que los dos nodos son de la misma.
   */
  app.post("/architecture/links", async (request, reply) => {
    const userId = requireUser(request);
    const body = parseBody(
      z.object({
        sourceId: uuid,
        targetId: uuid,
        label: z.string().trim().max(60).optional(),
      }),
      request.body,
    );

    if (body.sourceId === body.targetId) throw notFound("un nodo no se enlaza consigo mismo");

    const link = await withUser(userId, async (db) => {
      const { rows } = await db.query(
        `insert into architecture_links (source_id, target_id, label, created_by)
         values ($1,$2,$3,$4)
         returning ${LINK_COLUMNS}`,
        [body.sourceId, body.targetId, body.label ?? "", userId],
      );
      return rows[0];
    });

    return reply.status(201).send({ link });
  });

  app.delete("/architecture/links/:linkId", async (request, reply) => {
    const userId = requireUser(request);
    const { linkId } = parseParams(z.object({ linkId: uuid }), request.params);
    await withUser(userId, async (db) => {
      const { rowCount } = await db.query("delete from architecture_links where id = $1", [linkId]);
      if (!rowCount) throw notFound("enlace no encontrado");
    });
    return reply.status(204).send();
  });

  /**
   * El diagrama entero de una vez.
   *
   * La usa `dibujar_arquitectura` desde MCP: un modelo que acaba de leer un
   * repositorio sabe las veinte cajas y las treinta flechas a la vez, y
   * mandarlas de una en una eran cincuenta viajes que podían quedarse a medias
   * —con medio diagrama escrito y sin manera de saber por dónde iba—. Aquí es
   * una transacción: sale entero o no sale.
   */
  app.post("/workspaces/:workspaceId/architecture/fusionar", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const body = parseBody(ENTRADA_FUSION, request.body);
    return withUser(userId, (db) => fusionarArquitectura(db, workspaceId, userId, body));
  });

  /**
   * Traer la arquitectura que ya está escrita en el Terraform del repositorio.
   *
   * SE LEE EL TEXTO, NO SE EJECUTA NADA: ni `terraform plan`, ni credenciales
   * de nadie, ni estado remoto. Lo que se puede y lo que no se puede ver así
   * está escrito en `connectors/terraform.ts`, y la pantalla lo repite, porque
   * un mapa que se cree completo engaña más que no tenerlo.
   *
   * Y SE LEE CON EL ENLACE, SIN TOKEN. Aunque la organización tenga una
   * credencial de GitHub guardada, esta ruta no la toca: dibujar un diagrama
   * no es motivo para descifrar el secreto de nadie ni para mandarlo a un
   * tercero. La consecuencia se acepta y se dice en pantalla — de un
   * repositorio privado no se puede importar— y es preferible a que una
   * función de dibujo tenga acceso a lo privado «por si acaso».
   *
   * NO BORRA NI RECOLOCA. Importar dos veces deja el mismo diagrama, y lo que
   * alguien hubiera movido a mano sigue donde lo dejó: ver
   * `fusionarArquitectura`.
   */
  app.post("/workspaces/:workspaceId/architecture/importar/terraform", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const { repoId } = parseBody(z.object({ repoId: uuid }), request.body);

    const { fullName, workspaceId: suEspacio } = await withUser(userId, (db) =>
      repoSinCredencial(db, repoId),
    );
    // Quien pertenece a dos proyectos ve los repositorios de los dos, así que
    // RLS no puede impedir esto: lo impide el código. Traerse el Terraform de
    // un proyecto al diagrama de otro es la mezcla que 0035 vino a evitar.
    if (suEspacio !== workspaceId) throw notFound("repositorio no encontrado");

    /** Sin credencial y sin excepciones: se lee como lo leería cualquiera con
     *  el enlace. Un repositorio privado responde 404 y el conector ya traduce
     *  ese 404 a «o no existe o es privado», que es lo que hay que decir. */
    const token = null;

    const arbol = await fetchGithubTree(token, fullName).catch((error: unknown) => {
      throw badGateway(error instanceof Error ? error.message : "no se pudo leer el repositorio");
    });
    const todos = terraformDelArbol(arbol.map((e) => e.path));

    if (todos.length === 0) {
      return {
        fullName,
        archivos: [],
        omitidos: 0,
        ilegibles: [],
        recortados: 0,
        creados: [],
        reutilizados: [],
        enlazados: [],
        sinResolver: [],
      };
    }

    /**
     * Cuántos `.tf` se leen, y por qué son doce y no cuarenta.
     *
     * Al leer sin credencial, el cupo de GitHub son 60 peticiones por hora Y
     * POR IP: no por organización, sino compartidas por todo DevUP. Una sola
     * importación con tope de cuarenta dejaría sin lecturas a las demás
     * organizaciones durante una hora, y ellas verían un fallo que no causaron
     * y no pueden arreglar. Doce deja ver la infraestructura de un repositorio
     * normal —que rara vez pasa de unos pocos `.tf`— sin secuestrar el cupo de
     * nadie, y lo que no entre se dice en pantalla.
     */
    const TOPE = 12;
    const omitidos = Math.max(0, todos.length - TOPE);
    const aLeer = todos.slice(0, TOPE);

    const archivos: { ruta: string; contenido: string }[] = [];
    const ilegibles: string[] = [];
    for (const ruta of aLeer) {
      try {
        archivos.push({ ruta, contenido: await fetchGithubFileContent(token, fullName, ruta) });
      } catch {
        // Un archivo que no se puede leer —demasiado grande, o retirado entre
        // el árbol y la lectura— no tira la importación de los otros. Se dice
        // cuál fue: con Terraform, el que falta puede ser justo el que tenía
        // la base de datos, y un diagrama incompleto sin avisar es peor que
        // uno vacío.
        ilegibles.push(ruta);
      }
    }

    const { componentes, conexiones } = leerTerraform(archivos);
    // Un repositorio con más de doscientos recursos existe, y el diagrama que
    // saldría no se puede leer. Se dibuja lo que cabe y se dice cuántos se
    // quedaron fuera: callarlo dejaría un mapa con agujeros que parecen
    // decisiones.
    const recortados = Math.max(0, componentes.length - TOPE_COMPONENTES);
    const fusion = await withUser(userId, (db) =>
      fusionarArquitectura(db, workspaceId, userId, {
        componentes: componentes.slice(0, TOPE_COMPONENTES).map((c) => ({
          nombre: c.nombre.slice(0, 60),
          tipo: c.tipo,
          descripcion: c.descripcion,
        })),
        conexiones: conexiones.slice(0, TOPE_CONEXIONES).map((c) => ({
          de: c.de.slice(0, 60),
          a: c.a.slice(0, 60),
          etiqueta: c.etiqueta,
        })),
      }),
    );

    return {
      fullName,
      archivos: aLeer,
      omitidos,
      ilegibles,
      recortados,
      ...fusion,
    };
  });
}
