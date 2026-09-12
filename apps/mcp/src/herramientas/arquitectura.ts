import { z } from "zod";
import type { ClienteApi } from "../api.js";
import { resolverEspacio } from "../espacios.js";

/**
 * El diagrama de arquitectura, para un agente.
 *
 * PARA QUÉ. Un modelo que acaba de leer un repositorio ya sabe qué servicios
 * hay, qué base usan y quién llama a quién — y hasta ahora esa respuesta se
 * quedaba en la conversación y había que redibujarla a mano caja por caja.
 * `dibujar_arquitectura` acepta el diagrama ENTERO de una vez: los componentes
 * y las conexiones en una sola llamada, que es como sale de leer un
 * repositorio.
 *
 * NO COLOCA LAS CAJAS EL MODELO. Pedirle coordenadas a un modelo da diagramas
 * ilegibles y encima gasta atención en algo que no es el problema. Aquí se
 * calcula una disposición por capas —lo que nadie llama va a la izquierda, lo
 * que llama va detrás— que es como se dibuja una arquitectura en una pizarra.
 *
 * LO QUE YA ESTÁ NO SE MUEVE NI SE BORRA. Si el diagrama tiene cajas
 * colocadas a mano, se respetan donde están y lo nuevo se dibuja debajo: la
 * disposición es trabajo de alguien. Y un componente que ya existe con ese
 * nombre se reutiliza en vez de duplicarse, para que llamar dos veces a esto
 * no deje el lienzo con todo por partida doble.
 *
 * NO HAY HERRAMIENTA DE BORRAR, igual que en el tablero y por lo mismo:
 * equivocarse creando deja trabajo que revisar, equivocarse borrando deja
 * trabajo perdido.
 */

const TIPOS = ["servicio", "base_datos", "cola", "cache", "almacenamiento", "api_externa", "otro"] as const;

type Nodo = {
  id: string;
  kind: (typeof TIPOS)[number];
  name: string;
  description: string;
  posX: number;
  posY: number;
};

type Enlace = { id: string; sourceId: string; targetId: string; label: string };

type Diagrama = { nodes: Nodo[]; links: Enlace[] };

const NOMBRE_TIPO: Record<string, string> = {
  servicio: "servicio",
  base_datos: "base de datos",
  cola: "cola",
  cache: "caché",
  almacenamiento: "almacenamiento",
  api_externa: "API externa",
  otro: "otro",
};

// --- Ver ---------------------------------------------------------------------

export const esquemaVerArquitectura = {
  espacio: z
    .string()
    .optional()
    .describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
};

export const descripcionVerArquitectura = [
  "Enseña el diagrama de arquitectura de un espacio de trabajo de DevUP: qué",
  "componentes hay —servicios, bases de datos, colas— y cómo se conectan entre",
  "ellos.",
  "",
  "Úsala antes de dibujar nada, para saber qué hay ya y no repetirlo. Cada",
  "espacio de trabajo tiene el suyo: el diagrama de un proyecto no incluye los",
  "componentes de otro aunque sean de la misma empresa.",
].join("\n");

export async function verArquitectura(
  cliente: ClienteApi,
  entrada: { espacio?: string; organizacion?: string },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);
  const diagrama = await cliente.get<Diagrama>(`/workspaces/${espacio.id}/architecture`);

  if (diagrama.nodes.length === 0) {
    return `El diagrama de «${espacio.name}» está vacío.`;
  }

  const porId = new Map(diagrama.nodes.map((n) => [n.id, n]));
  const lineas = [
    `${diagrama.nodes.length} componente(s) en «${espacio.name}»:`,
    "",
    ...diagrama.nodes.map(
      (n) => `- ${n.name} (${NOMBRE_TIPO[n.kind] ?? n.kind})${n.description ? ` — ${n.description}` : ""}`,
    ),
  ];

  if (diagrama.links.length > 0) {
    lineas.push("", `${diagrama.links.length} conexión(es):`, "");
    for (const l of diagrama.links) {
      const de = porId.get(l.sourceId)?.name ?? "?";
      const a = porId.get(l.targetId)?.name ?? "?";
      lineas.push(`- ${de} ${l.label ? `«${l.label}»` : "→"} ${a}`);
    }
  }

  return lineas.join("\n");
}

// --- Dibujar -----------------------------------------------------------------

export const esquemaDibujarArquitectura = {
  componentes: z
    .array(
      z.object({
        nombre: z.string().trim().min(1).max(60).describe("Como lo llama el equipo: «API de pagos»."),
        tipo: z.enum(TIPOS).default("servicio"),
        descripcion: z.string().trim().max(2000).optional().describe("Qué hace, en una línea."),
        x: z
          .number()
          .finite()
          .optional()
          .describe(
            "Solo si YA tienes un diagrama y quieres que se vea igual. Píxeles desde la " +
              "izquierda del lienzo. Si lo omites, DevUP coloca la caja sola y mejor: " +
              "no inventes coordenadas para un diagrama que estás deduciendo.",
          ),
        y: z.number().finite().optional().describe("Píxeles desde arriba. Ver `x`."),
      }),
    )
    .min(1)
    .max(40)
    .describe("Los componentes del sistema. Los que ya existan por nombre se reutilizan."),
  conexiones: z
    .array(
      z.object({
        de: z.string().trim().min(1).describe("Nombre del componente de origen."),
        a: z.string().trim().min(1).describe("Nombre del componente de destino."),
        etiqueta: z
          .string()
          .trim()
          .max(60)
          .optional()
          .describe("Cómo se relacionan: «llama a», «lee de», «publica en»."),
      }),
    )
    .max(120)
    .optional(),
  espacio: z.string().optional().describe("Nombre del espacio de trabajo. Omitir si solo hay uno."),
  organizacion: z.string().optional().describe("Nombre de la organización. Omitir si solo hay una."),
};

export const descripcionDibujarArquitectura = [
  "Dibuja la arquitectura de un sistema en el diagrama de un espacio de trabajo",
  "de DevUP: crea los componentes y las conexiones entre ellos de una sola vez.",
  "",
  "PENSADA PARA USARLA DESPUÉS DE LEER EL REPOSITORIO. Si el proyecto no tiene",
  "Terraform —que es lo normal—, su arquitectura no está escrita en ningún",
  "archivo y no hay nada que importar: está repartida por el código, y",
  "deducirla es justamente lo que sabes hacer tú. Mira qué servicios se",
  "levantan, a qué base de datos se conectan, qué colas y cachés usan y a qué",
  "APIs de fuera llaman, y mándalo aquí entero. Eso es lo que convierte una",
  "lectura del repositorio en un diagrama que se queda.",
  "",
  "DOS FORMAS DE USARLA, según lo que tengas:",
  "",
  "- **Deduciendo** (lo habitual): manda los componentes y las conexiones SIN",
  "  `x` ni `y`. DevUP los reparte en columnas, con lo que nadie llama a la",
  "  izquierda. No inventes coordenadas: salen diagramas ilegibles.",
  "- **Copiando un diagrama que ya existe**: si traes uno de otra herramienta o",
  "  lo has compuesto tú a propósito, manda `x` e `y` y se pinta tal cual, sin",
  "  recolocar nada.",
  "",
  "El `tipo` de cada componente decide su forma en el lienzo —el cilindro es la",
  "base de datos, la nube es lo que vive fuera—, así que acertarlo es lo que",
  "hace que el diagrama se lea de un vistazo.",
  "",
  "Es acumulativa y no destructiva: lo que ya exista con el mismo nombre se",
  "reutiliza en vez de duplicarse, lo que ya estuviera colocado a mano no se",
  "mueve, y nada se borra. Para quitar algo, lo hace una persona desde la",
  "pantalla de Infraestructura.",
  "",
  "Conviene llamar antes a `ver_arquitectura` para saber qué hay.",
].join("\n");

type Componente = {
  nombre: string;
  tipo: (typeof TIPOS)[number];
  descripcion?: string;
  x?: number;
  y?: number;
};
type Conexion = { de: string; a: string; etiqueta?: string };

/**
 * El resumen que devuelve el servidor al fusionar. Ver
 * `fusionarArquitectura` en `apps/api/src/routes/arquitectura.ts`: la regla
 * de qué pasa con lo que ya está dibujado vive allí, y no aquí, porque
 * importar Terraform desde la pantalla tiene que hacer exactamente lo mismo.
 */
type Fusion = {
  creados: string[];
  reutilizados: string[];
  enlazados: string[];
  sinResolver: string[];
};

export async function dibujarArquitectura(
  cliente: ClienteApi,
  entrada: {
    componentes: Componente[];
    conexiones?: Conexion[];
    espacio?: string;
    organizacion?: string;
  },
): Promise<string> {
  const espacio = await resolverEspacio(cliente, entrada.espacio, entrada.organizacion);

  // Una sola llamada y no una por caja: así el diagrama entra entero o no
  // entra, y no se queda a medias con veinte cajas puestas y las flechas sin
  // poner.
  const fusion = await cliente.post<Fusion>(`/workspaces/${espacio.id}/architecture/fusionar`, {
    componentes: entrada.componentes,
    conexiones: entrada.conexiones ?? [],
  });

  const { creados, reutilizados, enlazados, sinResolver } = fusion;
  const lineas = [`Diagrama de «${espacio.name}» actualizado.`];
  if (creados.length > 0) lineas.push(`Componentes nuevos (${creados.length}): ${creados.join(", ")}.`);
  if (reutilizados.length > 0) {
    lineas.push(`Ya estaban y no se duplicaron (${reutilizados.length}): ${reutilizados.join(", ")}.`);
  }
  if (enlazados.length > 0) lineas.push(`Conexiones nuevas (${enlazados.length}): ${enlazados.join(", ")}.`);
  if (sinResolver.length > 0) {
    lineas.push(
      `No pude enlazar (${sinResolver.length}) porque no encontré alguno de los dos extremos: ` +
        `${sinResolver.join(", ")}. Los nombres tienen que coincidir con los de la lista de componentes.`,
    );
  }
  if (creados.length === 0 && enlazados.length === 0) {
    lineas.push("No había nada nuevo que añadir.");
  }

  return lineas.join("\n");
}
