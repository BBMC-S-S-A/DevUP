/**
 * Siembra en el tablero el área «Workflow» y las tareas de los dos caminos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * POR QUÉ EXISTE ESTE ARCHIVO, Y ES LA PARTE QUE HAY QUE ENTENDER PRIMERO.
 *
 * El plan de `docs/CAMINOS.md` lleva días escrito y sin subir al tablero, y el
 * motivo NO era que faltara un token: era que las sesiones de Claude Code que
 * escribieron ese plan corren en un contenedor en la nube cuya política de
 * salida **deniega** `api.hytrex.co` y el despliegue de Railway. La puerta MCP
 * no puede alcanzar DevUP desde ahí, con token o sin él.
 *
 * Así que lo que hacía falta no era una credencial, era un sitio con red. Este
 * guion es ese sitio: se ejecuta en el portátil de quien tiene el token, y hace
 * de una vez lo que la sesión no puede hacer llamada a llamada.
 *
 * NO REIMPLEMENTA NADA. Importa las mismas funciones que usa el MCP
 * —`crearArea`, `crearTarea`, `enlazarRama`— y el mismo cliente con su canje de
 * token de refresco. Un guion que hablara con la API por su cuenta sería una
 * segunda implementación de la autenticación y del formato de las tareas, y la
 * primera vez que una de las dos cambiara, esto empezaría a sembrar tableros
 * sutilmente distintos de los que crea el agente.
 *
 * ES REPETIBLE. Lo que ya existe no se duplica ni revienta: el área se busca
 * antes de crearla y las tareas se comparan por título dentro del espacio. Un
 * guion de siembra que solo se puede ejecutar una vez es un guion que nadie se
 * atreve a ejecutar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   DEVUP_TOKEN=<el de Ajustes → Conexiones de agente> \
 *   DEVUP_API_URL=https://api.hytrex.co \
 *     npx tsx scripts/sembrar-caminos.ts "Nombre del espacio"
 *
 * Sin argumento usa el único espacio que haya. Con `--ver` no escribe nada y
 * solo dice qué haría, que es como conviene ejecutarlo la primera vez.
 */
import { ClienteDevUP } from "../apps/mcp/src/api.js";
import { crearArea, crearTarea, enlazarRama } from "../apps/mcp/src/herramientas/escribir.js";
import { resolverEspacio } from "../apps/mcp/src/espacios.js";

const AREA = "Workflow";

/**
 * Las dos listas, copiadas de `docs/CAMINOS.md` §2.
 *
 * SE ESCRIBEN AQUÍ Y NO SE LEEN DEL MARKDOWN a propósito. Analizar una tabla de
 * markdown para sacar tareas es un analizador más que mantener, y la primera
 * vez que alguien reordene una columna del documento, el guion sembraría
 * basura sin fallar. Duplicar seis títulos es más barato que eso — y cuando el
 * documento cambie, esta lista sale en el mismo `git diff`.
 */
type Tarea = {
  titulo: string;
  camino: "camino-a" | "camino-b";
  tipo?: "funcionalidad" | "mejora" | "deuda" | "investigacion" | "infraestructura";
  prioridad?: "baja" | "normal" | "alta" | "urgente";
  contexto: string;
  criterio: string;
};

const TAREAS: Tarea[] = [
  // --- Camino A · el armazón y la navegación -------------------------------
  {
    titulo: "Decidir qué pantalla es la portada",
    camino: "camino-a",
    tipo: "investigacion",
    prioridad: "alta",
    contexto:
      "Va ANTES de construir el armazón: el armazón se construye alrededor de una " +
      "decisión que todavía no está tomada. Con el registro de actividad ya hecho, la " +
      "línea de tiempo tiene más papeletas que un panel de tarjetas. Ahora existe " +
      "además /app/inicio, que cruza todos los espacios.",
    criterio: "Está escrito qué ve alguien al entrar, y por qué esa y no otra.",
  },
  {
    titulo: "El armazón de organización, con cajón para móvil desde el principio",
    camino: "camino-a",
    tipo: "funcionalidad",
    prioridad: "alta",
    contexto:
      "Seis pantallas viven hoy sin barra lateral. Construirlo con barra fija y " +
      "desmontarlo después para el móvil es justo lo que hay que evitar.",
    criterio:
      "Las seis pantallas tienen barra, y en móvil la barra es un cajón que se abre " +
      "y se cierra sin recargar.",
  },
  {
    titulo: "Marco de página: una cabecera, no cinco copiadas",
    camino: "camino-a",
    tipo: "deuda",
    contexto:
      "Cada pantalla repite su cabecera. Con el marco vienen además los tres finales " +
      "de una carga, que hoy cada una resuelve a su manera: cargando, fallo, vacío.",
    criterio: "Ninguna pantalla dibuja su propia cabecera, y las tres salidas son las mismas.",
  },
  {
    titulo: "Entrada «Inicio» en el menú lateral",
    camino: "camino-a",
    tipo: "funcionalidad",
    prioridad: "alta",
    contexto:
      "La portada global ya existe entera —página y API— en /app/inicio. Solo falta " +
      "cómo llegar. El fragmento exacto está en docs/CAMINOS.md §5.",
    criterio:
      "Va ENCIMA de «Panel», no entre los de un espacio: Inicio no es de este espacio, " +
      "es de todos, y ponerlo dentro lo convierte en una pantalla más de este.",
  },

  // --- Camino B · los datos y las piezas -----------------------------------
  {
    titulo: "Capa de datos: acabar con los api.* y los efectos sueltos",
    camino: "camino-b",
    tipo: "deuda",
    prioridad: "alta",
    contexto:
      "Las primitivas ya estaban (useRecurso, useMutacion, invalidar, sembrar). Lo que " +
      "falta es migrar pantalla por pantalla. Hecho: el tablero y los ajustes de " +
      "organización. Queda ventas, cuenta, github, organizaciones y los componentes. " +
      "La trampa: al pasar de estado local a caché hay que invalidar AUNQUE la " +
      "escritura salga bien, o volver dentro de la ventana de frescura enseña lo de " +
      "antes. No falla nada: miente.",
    criterio: "Ninguna pantalla trae su propio load con su useEffect y sus dos estados.",
  },
  {
    titulo: "Partir las pantallas grandes, empezando por Ventas",
    camino: "camino-b",
    tipo: "deuda",
    contexto:
      "Ventas pasa de mil doscientas líneas. Va DESPUÉS de la capa de datos, no antes: " +
      "partirla ahora repartiría el mismo lío en cuatro archivos.",
    criterio: "Ningún page.tsx pasa de cuatrocientas líneas.",
  },
];

/* ========================================================================== */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ensayo = args.includes("--ver");
  const espacioPedido = args.find((a) => !a.startsWith("--"));

  if (ensayo) {
    console.log("Ensayo: no se va a escribir nada.\n");
  }

  const cliente = new ClienteDevUP();

  // Se resuelve el espacio ANTES de tocar nada: si el token no vale o el
  // espacio no existe, es mejor enterarse aquí que a mitad de la siembra con
  // tres tareas ya creadas.
  const espacio = await resolverEspacio(cliente, espacioPedido);
  console.log(`Espacio: ${espacio.name}\n`);

  // --- El área ------------------------------------------------------------
  const { categories } = await cliente.get<{ categories: { id: string; name: string }[] }>(
    `/workspaces/${espacio.id}/categories`,
  );
  const yaEsta = categories.find((c) => c.name.toLowerCase() === AREA.toLowerCase());

  if (yaEsta) {
    console.log(`· El área «${AREA}» ya existe.`);
  } else if (ensayo) {
    console.log(`· Crearía el área «${AREA}».`);
  } else {
    console.log(`· ${await crearArea(cliente, { nombre: AREA, espacio: espacio.name })}`);
  }

  // --- Las tareas ---------------------------------------------------------
  const { columns } = await cliente.get<{
    columns: { tasks: { id: string; title: string }[] }[];
  }>(`/workspaces/${espacio.id}/board`);
  const existentes = new Map(
    columns.flatMap((c) => c.tasks).map((t) => [t.title.trim().toLowerCase(), t.id]),
  );

  let creadas = 0;
  let saltadas = 0;

  for (const t of TAREAS) {
    const clave = t.titulo.trim().toLowerCase();
    const id = existentes.get(clave);

    if (id) {
      saltadas += 1;
      // Aunque la tarea ya exista, la rama puede faltar: es lo que se añadió
      // después. Enlazarla otra vez no duplica —la 0042 tiene su índice único
      // y la ruta hace `on conflict do update`— así que se intenta siempre.
      if (!ensayo) await enlazarRama(cliente, { tarea: id, rama: t.camino });
      console.log(`· «${t.titulo}» ya estaba. Rama ${t.camino} asegurada.`);
      continue;
    }

    if (ensayo) {
      console.log(`· Crearía «${t.titulo}» (${t.camino}).`);
      continue;
    }

    const dicho = await crearTarea(cliente, {
      titulo: t.titulo,
      area: AREA,
      espacio: espacio.name,
      detalle: "",
      contexto: t.contexto,
      criterio: t.criterio,
      ...(t.tipo ? { tipo: t.tipo } : {}),
      ...(t.prioridad ? { prioridad: t.prioridad } : {}),
    });
    console.log(`· ${dicho}`);

    // El identificador sale entre corchetes al final de lo que contesta
    // `crear_tarea`. Es su contrato con el modelo y aquí se usa igual, en vez
    // de volver a pedir el tablero entero por cada tarea.
    const encaje = /\[tarea ([0-9a-f-]{36})\]/.exec(dicho);
    if (encaje?.[1]) {
      console.log(`  ${await enlazarRama(cliente, { tarea: encaje[1], rama: t.camino })}`);
    }
    creadas += 1;
  }

  console.log(
    `\n${ensayo ? "Ensayo terminado." : `${creadas} creadas, ${saltadas} que ya estaban.`}`,
  );
}

main().catch((fallo: unknown) => {
  const mensaje = fallo instanceof Error ? fallo.message : String(fallo);
  console.error(`\nNo se pudo sembrar: ${mensaje}`);
  // Los dos fallos que se van a dar de verdad, dichos con su remedio en vez de
  // con una traza que no ayuda a nadie.
  if (mensaje.includes("token")) {
    console.error(
      "\nEl token sale de DevUP: Ajustes → Conexiones de agente → crear una.\n" +
        "Después:  DEVUP_TOKEN=<el token> npx tsx scripts/sembrar-caminos.ts",
    );
  }
  if (mensaje.includes("fetch") || mensaje.includes("ENOTFOUND") || mensaje.includes("403")) {
    console.error(
      "\nEsto tiene que correr donde SE LLEGUE a la API. Desde un contenedor con la\n" +
        "salida restringida —una sesión de Claude Code en la nube— no se llega, y por\n" +
        "eso existe este guion: para ejecutarlo en el portátil.",
    );
  }
  process.exit(1);
});
