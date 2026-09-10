import Anthropic from "@anthropic-ai/sdk";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../auth/plugin.js";
import { type Db, withUser } from "../db/pool.js";
import { forbidden, parseBody, parseParams, requireUser } from "../lib/http.js";
import { getDecryptedSecret } from "./connections.js";
import { asegurarEtiqueta } from "./files.js";
import { crearTareaEnDb, moverTareaEnDb } from "./tasks.js";

/**
 * El asistente de dentro de DevUP.
 *
 * QUIÉN PAGA, Y POR QUÉ ESO DECIDE LA ARQUITECTURA. Un asistente dentro del
 * producto necesita inferencia, y la inferencia se paga. La decisión tomada es
 * que la pague quien la usa: cada persona guarda su propia clave de API en la
 * bóveda (proveedor `anthropic`, migración 0030) y esta ruta la descifra para
 * hacer la llamada saliente y la descarta. DevUP no compra ni un token, no
 * tiene clave propia y no hay factura que crezca con el uso.
 *
 * LAS HERRAMIENTAS CORREN CONTRA LA BASE, NO CONTRA NUESTRA PROPIA API. Aquí
 * ya estamos dentro del servidor y con la identidad resuelta, así que llamarse
 * a sí mismo por HTTP sería un salto de red para nada. Lo que NO cambia es la
 * frontera: todas van por `withUser`, así que RLS sigue decidiendo qué filas
 * ve el asistente — exactamente las que vería su dueño en el navegador, ni una
 * más. Un fallo de permisos aquí no puede filtrar otra organización porque no
 * es este código el que los comprueba.
 *
 * EL BUCLE ES DE UNA SOLA PETICIÓN. El historial que manda el navegador son
 * turnos de texto; las llamadas a herramientas pasan dentro de esta petición y
 * no se guardan. Es una simplificación deliberada de la primera versión: hace
 * que el estado del chat sea trivial (una lista de mensajes) al precio de que
 * el modelo no recuerde los resultados de herramientas de turnos anteriores
 * —vuelve a pedirlos si los necesita—, que es un precio bajo y visible.
 */

const uuid = z.string().uuid();

/** Tope de vueltas del bucle. Sin esto, un modelo que se empeñe en pedir la
 *  misma herramienta gasta la clave de la persona hasta que se cansa. */
const MAX_VUELTAS = 8;

const MODELO = "claude-opus-5";

const SISTEMA = `Eres el asistente de DevUP, dentro del espacio de trabajo de un equipo.

Contestas en español, con la confianza de quien conoce el proyecto: directo,
cercano y sin rodeos. Nada de «como modelo de lenguaje», nada de disculpas de
relleno, nada de repetir la pregunta antes de contestarla.

REGLA QUE NO SE SALTA: no inventas datos del proyecto. Todo lo que digas sobre
tareas, tableros, clientes o archivos sale de una herramienta. Si una
herramienta no devuelve nada, lo dices tal cual en vez de rellenar el hueco.

Cuando alguien pregunte por sus tareas, usa la herramienta y contesta con lo
que hay: qué es, en qué columna está, cuándo vence y si algo está vencido —eso
se dice primero. Si una tarea lleva imágenes, dilo, porque se le van a
enseñar debajo de tu respuesta.

PUEDES ESCRIBIR EN EL TABLERO, y eso pide cuidado. Crear una tarea la ve todo
el equipo. Cuando te pidan un plan, propón primero la lista en texto y crea
solo lo que te confirmen — salvo que te lo pidan ya creado, y entonces las
creas sin volver a preguntar. Cada tarea debe ser algo que una persona pueda
terminar; no «hacer el módulo de pagos» sino los pasos en que eso se parte.

Todo lo que crees queda con la etiqueta «agente». Dilo cuando crees algo, para
que quien te lo pidió sepa que puede encontrarlo y deshacerlo en bloque.

Nunca borras nada: no tienes herramienta para eso, y si te lo piden dices que
eso se hace a mano en el tablero.

Sé breve. Una lista corta es mejor que un párrafo largo, y un dato concreto es
mejor que un resumen amable.`;

type Paso = { herramienta: string; entrada: unknown };

/**
 * La etiqueta con la que queda marcado todo lo que escribe el asistente.
 *
 * Es el mismo nombre que usa la puerta MCP a proposito: lo que el equipo ve en
 * el tablero no debe depender de por donde entro el agente. Y no es adorno —
 * es lo que permite ver de un vistazo que salio de un modelo, filtrarlo y
 * deshacerlo en bloque. Sin esa marca, dejar escribir a un modelo en el
 * tablero de otras personas no seria aceptable.
 */
const ETIQUETA_AGENTE = "agente";

/** Un adjunto que alguna herramienta ha tocado, para que la pantalla lo pinte
 *  debajo de la respuesta. Es como el asistente «enseña» una imagen. */
type Adjunto = { fileId: string; nombre: string; tarea: string };

const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: "mis_tareas",
    description:
      "Las tareas asignadas a la persona que está preguntando, en este espacio de " +
      "trabajo. Devuelve columna, vencimiento, etiquetas y cuántas imágenes lleva " +
      "cada una. Úsala para «¿qué tareas tengo?», «¿qué me toca?», «¿qué se me vence?».",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ver_tablero",
    description:
      "El tablero completo del espacio: cada columna con sus tareas, de quién son y " +
      "cuándo vencen. Para «¿en qué anda el equipo?» o «¿qué hay en curso?».",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ver_tarea",
    description:
      "El detalle de una tarea concreta y los nombres de sus imágenes. Se le pasa el " +
      "identificador que devuelven las otras herramientas.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "El identificador de la tarea." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "crear_tarea",
    description:
      "Crea una tarea en el tablero de este espacio. ESCRIBE DE VERDAD: la van a ver " +
      "todas las personas del equipo. Se llama una vez por tarea, y cada una debería " +
      "ser algo que alguien pueda terminar. Queda marcada con la etiqueta «agente» " +
      "para que el equipo sepa que salió de un modelo; eso no se puede desactivar.",
    input_schema: {
      type: "object",
      properties: {
        titulo: { type: "string", description: "Qué hay que hacer, en una línea." },
        detalle: { type: "string", description: "Contexto o criterio de aceptación." },
        columna: { type: "string", description: "Nombre de la columna. Por defecto, la primera." },
        responsable: { type: "string", description: "Nombre de la persona a la que se asigna." },
        vence: { type: "string", description: "Fecha límite, AAAA-MM-DD." },
      },
      required: ["titulo"],
      additionalProperties: false,
    },
  },
  {
    name: "crear_columna",
    description:
      "Crea una columna en el tablero. Solo cuando el tablero está vacío o el plan " +
      "necesita una etapa que no existe. Un tablero con ocho columnas que nadie usa es " +
      "peor que uno con tres.",
    input_schema: {
      type: "object",
      properties: { nombre: { type: "string" } },
      required: ["nombre"],
      additionalProperties: false,
    },
  },
  {
    name: "mover_tarea",
    description:
      "Mueve una tarea a otra columna: es cómo se marca que algo empezó, se terminó o " +
      "se bloqueó. Se le pasa el identificador que devuelven las otras herramientas.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Identificador de la tarea." },
        columna: { type: "string", description: "Nombre de la columna destino." },
      },
      required: ["id", "columna"],
      additionalProperties: false,
    },
  },
  {
    name: "actualizar_tarea",
    description:
      "Cambia una tarea que ya existe: título, detalle, responsable o fecha. Solo se " +
      "toca lo que se pase. SOBRESCRIBE, así que equivocarse de tarea borra lo que " +
      "otra persona escribió: usa el identificador, nunca el título.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        titulo: { type: "string" },
        detalle: { type: "string" },
        responsable: { type: "string", description: "Nombre, o cadena vacía para desasignar." },
        vence: { type: "string", description: "AAAA-MM-DD, o cadena vacía para quitarla." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "buscar",
    description:
      "Busca por texto en todo el contenido de la organización a la vez: mensajes de " +
      "canales, archivos, tareas, clientes, servicios y oportunidades. Para cuando la " +
      "pregunta menciona algo por su nombre y no se sabe dónde vive. No busca en código.",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string", description: "Palabras, no una pregunta." } },
      required: ["texto"],
      additionalProperties: false,
    },
  },
];

/** Hoy en calendario local, en el formato que guarda el servidor. */
function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

type FilaTarea = {
  id: string;
  title: string;
  description: string;
  columna: string;
  responsable: string | null;
  due_date: string | null;
  adjuntos: number;
};

const SELECT_TAREAS = `
  select t.id, t.title, t.description,
         k.name as columna,
         p.display_name as responsable,
         t.due_date::text as due_date,
         (select count(*) from files f
           where f.task_id = t.id and f.status = 'ready' and f.deleted_at is null)::int
           as adjuntos
    from tasks t
    join task_columns k on k.id = t.column_id
    left join profiles p on p.id = t.assignee_id`;

function comoLinea(t: FilaTarea): string {
  const trozos = [t.columna];
  if (t.responsable) trozos.push(t.responsable);
  if (t.due_date) {
    trozos.push(t.due_date < hoy() ? `VENCIDA el ${t.due_date}` : `vence el ${t.due_date}`);
  }
  if (t.adjuntos > 0) {
    trozos.push(`${t.adjuntos} ${t.adjuntos === 1 ? "imagen" : "imágenes"}`);
  }
  return `- ${t.title} — ${trozos.join(", ")}  [id ${t.id}]`;
}

/** La organización del espacio, que hace falta para etiquetas y personas. */
async function orgDeEspacio(db: Db, workspaceId: string): Promise<string | null> {
  const { rows } = await db.query<{ organization_id: string }>(
    "select organization_id from workspaces where id = $1",
    [workspaceId],
  );
  return rows[0]?.organization_id ?? null;
}

/**
 * Resuelve la columna por nombre; sin nombre, la primera — que es donde entra
 * el trabajo nuevo. Cuando hay ambigüedad NO elige: devuelve el aviso como
 * texto, porque elegir por su cuenta es como una tarea acaba en la columna de
 * otro estado sin que nadie se entere.
 */
async function columnaPorNombre(
  db: Db,
  workspaceId: string,
  nombre?: string,
): Promise<{ id: string; name: string } | string> {
  const { rows } = await db.query<{ id: string; name: string }>(
    "select id, name from task_columns where workspace_id = $1 order by position, created_at",
    [workspaceId],
  );
  if (rows.length === 0) {
    return "Ese tablero no tiene columnas todavía. Usa crear_columna antes de poner tareas.";
  }
  if (!nombre) return rows[0]!;

  const buscado = nombre.trim().toLowerCase();
  const exacta = rows.find((c) => c.name.toLowerCase() === buscado);
  if (exacta) return exacta;
  const parciales = rows.filter((c) => c.name.toLowerCase().includes(buscado));
  if (parciales.length === 1) return parciales[0]!;
  return parciales.length === 0
    ? `No hay ninguna columna «${nombre}». Hay: ${rows.map((c) => c.name).join(", ")}.`
    : `«${nombre}» encaja con varias columnas: ${parciales.map((c) => c.name).join(", ")}.`;
}

/** Resuelve una persona por su nombre, para no pedirle un uuid al modelo. */
async function personaPorNombre(
  db: Db,
  organizationId: string,
  nombre: string,
): Promise<string | { aviso: string }> {
  const { rows } = await db.query<{ user_id: string; display_name: string }>(
    `select m.user_id, p.display_name
       from organization_members m join profiles p on p.id = m.user_id
      where m.organization_id = $1`,
    [organizationId],
  );
  const buscado = nombre.trim().toLowerCase();
  const exacto = rows.find((m) => m.display_name.toLowerCase() === buscado);
  if (exacto) return exacto.user_id;
  const parciales = rows.filter((m) => m.display_name.toLowerCase().includes(buscado));
  if (parciales.length === 1) return parciales[0]!.user_id;
  return {
    aviso:
      parciales.length === 0
        ? `No hay nadie que se llame «${nombre}». Hay: ${rows.map((m) => m.display_name).join(", ")}.`
        : `«${nombre}» encaja con varias personas: ${parciales.map((m) => m.display_name).join(", ")}.`,
  };
}

/**
 * Ejecuta una herramienta. Devuelve el texto que ve el modelo y, si toca
 * imágenes, los adjuntos para que la pantalla los enseñe.
 */
/** Exportada para que las pruebas puedan ejercitar las herramientas sin
 *  gastar la clave de nadie: el modelo no hace falta para comprobar que una
 *  escritura acaba donde debe. */
export async function ejecutar(
  db: Db,
  workspaceId: string,
  userId: string,
  nombre: string,
  entrada: Record<string, unknown>,
): Promise<{ texto: string; adjuntos: Adjunto[] }> {
  switch (nombre) {
    case "mis_tareas": {
      const { rows } = await db.query<FilaTarea>(
        `${SELECT_TAREAS} where t.workspace_id = $1 and t.assignee_id = $2
          order by t.due_date nulls last, t.position`,
        [workspaceId, userId],
      );
      if (rows.length === 0) return { texto: "No tiene ninguna tarea asignada aquí.", adjuntos: [] };
      const adjuntos = await imagenesDe(
        db,
        rows.filter((r) => r.adjuntos > 0),
      );
      return {
        texto: `${rows.length} ${rows.length === 1 ? "tarea" : "tareas"}:\n${rows
          .map(comoLinea)
          .join("\n")}`,
        adjuntos,
      };
    }

    case "ver_tablero": {
      const { rows } = await db.query<FilaTarea>(
        `${SELECT_TAREAS} where t.workspace_id = $1 order by k.position, t.position`,
        [workspaceId],
      );
      if (rows.length === 0) return { texto: "El tablero está vacío.", adjuntos: [] };
      const porColumna = new Map<string, FilaTarea[]>();
      for (const r of rows) porColumna.set(r.columna, [...(porColumna.get(r.columna) ?? []), r]);
      const texto = [...porColumna]
        .map(([col, tareas]) => `${col} (${tareas.length})\n${tareas.map(comoLinea).join("\n")}`)
        .join("\n\n");
      return { texto, adjuntos: [] };
    }

    case "ver_tarea": {
      const id = z.string().uuid().safeParse(entrada.id);
      if (!id.success) return { texto: "Ese identificador no es válido.", adjuntos: [] };
      const { rows } = await db.query<FilaTarea>(
        `${SELECT_TAREAS} where t.id = $1 and t.workspace_id = $2`,
        [id.data, workspaceId],
      );
      const tarea = rows[0];
      if (!tarea) return { texto: "No existe esa tarea, o no está en este espacio.", adjuntos: [] };
      const adjuntos = await imagenesDe(db, [tarea]);
      const detalle = tarea.description?.trim() || "(sin detalle escrito)";
      return {
        texto: `${comoLinea(tarea)}\n\n${detalle}${
          adjuntos.length > 0 ? `\n\nImágenes: ${adjuntos.map((a) => a.nombre).join(", ")}` : ""
        }`,
        adjuntos,
      };
    }

    case "buscar": {
      const texto = z.string().trim().min(1).max(200).safeParse(entrada.texto);
      if (!texto.success) return { texto: "Hay que decir qué buscar.", adjuntos: [] };
      const { rows: org } = await db.query<{ organization_id: string }>(
        "select organization_id from workspaces where id = $1",
        [workspaceId],
      );
      const organizationId = org[0]?.organization_id;
      if (!organizationId) return { texto: "No encuentro ese espacio.", adjuntos: [] };
      const { rows } = await db.query<{ entity: string; id: string; title: string | null }>(
        "select entity, id, title from global_search($1, $2, 20)",
        [organizationId, texto.data],
      );
      if (rows.length === 0) return { texto: `Sin resultados para «${texto.data}».`, adjuntos: [] };
      return {
        texto: rows.map((r) => `- [${r.entity}] ${r.title ?? "(sin título)"}  [id ${r.id}]`).join("\n"),
        adjuntos: [],
      };
    }

    // --- Las que escriben --------------------------------------------------
    //
    // Comparten la lógica con las rutas (`crearTareaEnDb`, `moverTareaEnDb`) y
    // no una copia del SQL: copiarlo habría perdido en silencio el cálculo de
    // la posición y el AVISO a quien recibe la tarea.

    case "crear_tarea": {
      const datos = z
        .object({
          titulo: z.string().trim().min(1).max(200),
          detalle: z.string().max(4000).optional(),
          columna: z.string().optional(),
          responsable: z.string().optional(),
          vence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .safeParse(entrada);
      if (!datos.success) {
        return {
          texto: `Faltan datos o están mal: ${datos.error.issues[0]?.message}`,
          adjuntos: [],
        };
      }

      const organizationId = await orgDeEspacio(db, workspaceId);
      if (!organizationId) return { texto: "No encuentro ese espacio.", adjuntos: [] };

      const columna = await columnaPorNombre(db, workspaceId, datos.data.columna);
      if (typeof columna === "string") return { texto: columna, adjuntos: [] };

      let assigneeId: string | null = null;
      if (datos.data.responsable) {
        const quien = await personaPorNombre(db, organizationId, datos.data.responsable);
        if (typeof quien !== "string") return { texto: quien.aviso, adjuntos: [] };
        assigneeId = quien;
      }

      const etiqueta = await asegurarEtiqueta(db, organizationId, ETIQUETA_AGENTE, "violet", userId);

      const tarea = await crearTareaEnDb(db, {
        workspaceId,
        columnId: columna.id,
        title: datos.data.titulo,
        description: datos.data.detalle ?? "",
        assigneeId,
        dueDate: datos.data.vence ?? null,
        tagIds: [etiqueta.id],
        autor: userId,
      });

      const extras = [`en ${columna.name}`];
      if (datos.data.responsable) extras.push(`para ${datos.data.responsable}`);
      if (datos.data.vence) extras.push(`vence el ${datos.data.vence}`);
      return {
        texto:
          `Creada «${datos.data.titulo}» ${extras.join(", ")}, con la etiqueta ` +
          `«${ETIQUETA_AGENTE}».  [id ${String(tarea.id)}]`,
        adjuntos: [],
      };
    }

    case "crear_columna": {
      const datos = z.object({ nombre: z.string().trim().min(1).max(60) }).safeParse(entrada);
      if (!datos.success) return { texto: "La columna necesita un nombre.", adjuntos: [] };
      // Mismo SQL que `POST /workspaces/:id/columns`: `task_columns` no tiene
      // `created_by` —una columna no tiene autor— y el paso de posicion es el
      // mismo STEP de 1000 que usa la ruta.
      const { rowCount } = await db.query(
        `insert into task_columns (workspace_id, name, position)
         values (
           $1, $2,
           coalesce((select max(position) from task_columns where workspace_id = $1), 0) + 1000
         )`,
        [workspaceId, datos.data.nombre],
      );
      if (!rowCount) return { texto: "No encuentro ese espacio.", adjuntos: [] };
      return { texto: `Columna «${datos.data.nombre}» creada.`, adjuntos: [] };
    }

    case "mover_tarea": {
      const datos = z
        .object({ id: z.string().uuid(), columna: z.string().min(1) })
        .safeParse(entrada);
      if (!datos.success) {
        return { texto: "Para mover hace falta el identificador y la columna.", adjuntos: [] };
      }
      const columna = await columnaPorNombre(db, workspaceId, datos.data.columna);
      if (typeof columna === "string") return { texto: columna, adjuntos: [] };

      // La tarea tiene que ser de ESTE espacio. Sin esta comprobación, un id de
      // otro espacio al que la persona sí tiene acceso acabaría en una columna
      // que no es suya — y RLS no lo impediría, porque ve las dos.
      const { rows: suya } = await db.query<{ title: string }>(
        "select title from tasks where id = $1 and workspace_id = $2",
        [datos.data.id, workspaceId],
      );
      if (!suya[0]) return { texto: "Esa tarea no está en este espacio.", adjuntos: [] };

      await moverTareaEnDb(db, datos.data.id, columna.id, null);
      return { texto: `«${suya[0].title}» movida a ${columna.name}.`, adjuntos: [] };
    }

    case "actualizar_tarea": {
      const datos = z
        .object({
          id: z.string().uuid(),
          titulo: z.string().trim().min(1).max(200).optional(),
          detalle: z.string().max(4000).optional(),
          responsable: z.string().optional(),
          vence: z.string().optional(),
        })
        .safeParse(entrada);
      if (!datos.success) {
        return { texto: "Para cambiar una tarea hace falta su identificador.", adjuntos: [] };
      }

      const organizationId = await orgDeEspacio(db, workspaceId);
      if (!organizationId) return { texto: "No encuentro ese espacio.", adjuntos: [] };

      const cambios: string[] = [];
      const valores: unknown[] = [datos.data.id, workspaceId];
      const puestos: string[] = [];
      const anadir = (columna: string, valor: unknown, legible: string) => {
        valores.push(valor);
        puestos.push(`${columna} = $${valores.length}`);
        cambios.push(legible);
      };

      if (datos.data.titulo !== undefined) anadir("title", datos.data.titulo, "título");
      if (datos.data.detalle !== undefined) anadir("description", datos.data.detalle, "detalle");
      if (datos.data.vence !== undefined) {
        anadir("due_date", datos.data.vence === "" ? null : datos.data.vence, "fecha");
      }
      if (datos.data.responsable !== undefined) {
        if (datos.data.responsable === "") anadir("assignee_id", null, "responsable");
        else {
          const quien = await personaPorNombre(db, organizationId, datos.data.responsable);
          if (typeof quien !== "string") return { texto: quien.aviso, adjuntos: [] };
          anadir("assignee_id", quien, "responsable");
        }
      }

      if (puestos.length === 0) return { texto: "No me dijiste qué cambiar.", adjuntos: [] };

      const { rowCount } = await db.query(
        `update tasks set ${puestos.join(", ")} where id = $1 and workspace_id = $2`,
        valores,
      );
      if (!rowCount) return { texto: "Esa tarea no está en este espacio.", adjuntos: [] };
      return { texto: `Tarea actualizada: ${cambios.join(", ")}.`, adjuntos: [] };
    }

    default:
      return { texto: `No tengo ninguna herramienta llamada ${nombre}.`, adjuntos: [] };
  }
}

/** Los adjuntos de imagen de unas tareas. Solo el id y el nombre: la pantalla
 *  pide luego su enlace firmado, igual que hace el tablero. */
async function imagenesDe(db: Db, tareas: FilaTarea[]): Promise<Adjunto[]> {
  if (tareas.length === 0) return [];
  const { rows } = await db.query<{ id: string; name: string; task_id: string }>(
    `select id, name, task_id from files
      where task_id = any($1::uuid[])
        and status = 'ready' and deleted_at is null
        and mime_type like 'image/%'
      order by created_at`,
    [tareas.map((t) => t.id)],
  );
  const titulo = new Map(tareas.map((t) => [t.id, t.title]));
  return rows.map((f) => ({
    fileId: f.id,
    nombre: f.name,
    tarea: titulo.get(f.task_id) ?? "",
  }));
}

export async function asistenteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireSession);

  /** ¿Hay clave puesta? La pantalla lo pregunta para saber qué enseñar. Nunca
   *  devuelve la clave: solo si existe. */
  app.get("/me/asistente", async (request) => {
    const userId = requireUser(request);
    return withUser(userId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "select id from connections where user_id = $1 and provider = 'anthropic' limit 1",
        [userId],
      );
      return { configurado: rows.length > 0, modelo: MODELO };
    });
  });

  app.post("/workspaces/:workspaceId/asistente", async (request) => {
    const userId = requireUser(request);
    const { workspaceId } = parseParams(z.object({ workspaceId: uuid }), request.params);
    const { pregunta, historial } = parseBody(
      z.object({
        pregunta: z.string().trim().min(1).max(4000),
        historial: z
          .array(
            z.object({
              rol: z.enum(["usuario", "asistente"]),
              texto: z.string().max(20000),
            }),
          )
          .max(40)
          .default([]),
      }),
      request.body,
    );

    // La clave y el acceso al espacio se comprueban con la identidad de quien
    // pregunta: si RLS no le deja ver el espacio, no hay nada que contestar.
    const preparado = await withUser(userId, async (db) => {
      const { rows: ws } = await db.query<{ id: string; name: string }>(
        "select id, name from workspaces where id = $1",
        [workspaceId],
      );
      if (!ws[0]) return null;
      const { rows: con } = await db.query<{ id: string }>(
        "select id from connections where user_id = $1 and provider = 'anthropic' limit 1",
        [userId],
      );
      if (!con[0]) return { espacio: ws[0], clave: null };
      return { espacio: ws[0], clave: await getDecryptedSecret(db, con[0]!.id) };
    });

    if (!preparado) throw forbidden("no tienes acceso a ese espacio de trabajo");
    if (!preparado.clave) {
      throw forbidden(
        "todavía no has puesto tu clave de IA. Se pone en Mi cuenta, y el gasto es tuyo: " +
          "DevUP no compra inferencia.",
      );
    }

    const anthropic = new Anthropic({ apiKey: preparado.clave });

    const mensajes: Anthropic.MessageParam[] = [
      ...historial.map((m) => ({
        role: m.rol === "usuario" ? ("user" as const) : ("assistant" as const),
        content: m.texto,
      })),
      { role: "user" as const, content: pregunta },
    ];

    const pasos: Paso[] = [];
    const adjuntos: Adjunto[] = [];
    let respuesta = "";

    try {
      for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta += 1) {
        const salida = await anthropic.messages.create({
          model: MODELO,
          max_tokens: 16000,
          thinking: { type: "adaptive" },
          system: `${SISTEMA}\n\nEl espacio de trabajo se llama «${preparado.espacio.name}».`,
          tools: HERRAMIENTAS,
          messages: mensajes,
        });

        // El texto se acumula: una vuelta con herramientas puede traer una
        // frase antes de la llamada, y tirarla perdería la mitad de la
        // respuesta.
        for (const bloque of salida.content) {
          if (bloque.type === "text") respuesta += (respuesta ? "\n" : "") + bloque.text;
        }

        if (salida.stop_reason !== "tool_use") break;

        mensajes.push({ role: "assistant", content: salida.content });

        const peticiones = salida.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );

        // Todos los resultados en UN solo mensaje de usuario: partirlos en
        // varios le enseña al modelo a dejar de pedir herramientas en
        // paralelo.
        const resultados: Anthropic.ToolResultBlockParam[] = [];
        for (const peticion of peticiones) {
          pasos.push({ herramienta: peticion.name, entrada: peticion.input });
          const r = await withUser(userId, (db) =>
            ejecutar(
              db,
              workspaceId,
              userId,
              peticion.name,
              (peticion.input ?? {}) as Record<string, unknown>,
            ),
          ).catch((fallo: unknown) => ({
            texto: `La herramienta falló: ${fallo instanceof Error ? fallo.message : "error"}`,
            adjuntos: [] as Adjunto[],
            fallo: true,
          }));
          adjuntos.push(...r.adjuntos);
          resultados.push({
            type: "tool_result",
            tool_use_id: peticion.id,
            content: r.texto,
            ...("fallo" in r ? { is_error: true } : {}),
          });
        }
        mensajes.push({ role: "user", content: resultados });
      }
    } catch (fallo) {
      // Los fallos de la clave son de quien la puso, así que el mensaje tiene
      // que decirle qué arreglar en vez de «error interno».
      if (fallo instanceof Anthropic.AuthenticationError) {
        throw forbidden("tu clave de IA no vale: revísala en Mi cuenta.");
      }
      if (fallo instanceof Anthropic.RateLimitError) {
        throw forbidden("tu cuenta de Anthropic está al límite ahora mismo. Prueba en un rato.");
      }
      if (fallo instanceof Anthropic.BadRequestError) {
        throw forbidden(`Anthropic rechazó la petición: ${fallo.message}`);
      }
      if (fallo instanceof Anthropic.APIError) {
        throw forbidden(`Anthropic contestó ${fallo.status}: ${fallo.message}`);
      }
      throw fallo;
    }

    // Sin duplicados: dos herramientas pueden traer la misma imagen.
    const unicos = [...new Map(adjuntos.map((a) => [a.fileId, a])).values()];

    return {
      respuesta: respuesta.trim() || "No supe qué contestar a eso.",
      pasos,
      adjuntos: unicos,
    };
  });
}
