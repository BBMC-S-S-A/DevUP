/**
 * Reordena el tablero en tres ramas, con su gerente cada una.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * POR QUÉ ES UN GUION Y NO LO HIZO LA SESIÓN. Por lo mismo que
 * `sembrar-caminos.ts`, y conviene repetirlo porque se olvida: las sesiones de
 * Claude Code corren en un contenedor cuya política de salida **deniega**
 * `api.hytrex.co` — un 403 al abrir el túnel, con token o sin él. No falta una
 * credencial: falta red. Esto se ejecuta donde sí la hay.
 *
 * QUÉ HACE, en este orden:
 *
 *   1. Crea las tres ramas si no están: **Workflow** (Juan Medina),
 *      **DevVerse** (Carlos) y **Funcionalidades** (Juan Bonilla).
 *   2. Reparte las tareas que ya hay entre ellas, por lo que dice cada título.
 *   3. **Retira la rama «Agente»**, que no la pidió nadie: sus tareas no se
 *      borran, se reclasifican. Ver abajo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * LO QUE NO HACE, Y ES LA DECISIÓN QUE MÁS IMPORTA: **no toca el responsable de
 * ninguna tarea**. Se pidió expresamente —«me las atribuyes a mí, que yo soy el
 * trabajador»— y además es lo correcto: quien hizo el trabajo lo hizo, y mover
 * una tarea de rama no cambia quién la sacó adelante. Es exactamente la
 * distinción de la 0050: el **gerente** responde de la rama y reparte; el
 * **delegado** es quien la hace. Cambiar la rama de una tarea cerrada no puede
 * reescribir su historia.
 *
 * Por eso tampoco **marca nada como hecho**. Las que están hechas ya lo están, y
 * si alguna se quedó abierta, eso no lo puede decidir un guion leyendo un
 * título: una tarea se cierra a mano, con su contexto y su evidencia. Un guion
 * que cerrara tareas por su cuenta estaría escribiendo historia que no pasó.
 *
 * EL REPARTO SE HACE POR PALABRAS DEL TÍTULO, y eso es adivinar. Por eso:
 *   · `--ver` no escribe nada y enseña la propuesta entera. **Ejecútalo así la
 *     primera vez.** Es el modo en que esto está pensado para usarse.
 *   · Lo que no encaja con nada **se deja quieto** y sale listado aparte. Un
 *     guion que reparte a ojo lo que no entiende hace más daño que no repartir.
 *
 * ES REPETIBLE. Las ramas se buscan antes de crearse y una tarea que ya está en
 * su rama no se vuelve a mover. Se puede ejecutar dos veces sin miedo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   DEVUP_TOKEN=<Ajustes → Conexiones de agente> \
 *   DEVUP_API_URL=https://api.hytrex.co \
 *     npx tsx scripts/reordenar-ramas.ts --ver            # propuesta, sin tocar
 *     npx tsx scripts/reordenar-ramas.ts                  # aplica
 *     npx tsx scripts/reordenar-ramas.ts "Gestek"         # un espacio concreto
 */
import { ClienteDevUP } from "../apps/mcp/src/api.js";
import { resolverEspacio } from "../apps/mcp/src/espacios.js";
import { resolverPersona } from "../apps/mcp/src/herramientas/escribir.js";

/** Las tres ramas y quién responde de cada una. */
const RAMAS = [
  {
    nombre: "Workflow",
    gerente: "Juan Medina",
    /**
     * Cómo se mueve el trabajo por el producto: navegación, flujo, interfaz,
     * ajustes, sesión, comunicación.
     */
    pistas: [
      "workflow", "flujo", "interfaz", "menu", "menú", "sidebar", "lateral",
      "navegacion", "navegación", "ajuste", "ajustes", "login", "sesion", "sesión",
      "portada", "inicio", "panel", "pantalla", "vista", "onboarding", "tutorial",
      "perfil", "tema oscuro", "responsive", "movil", "móvil",
    ],
  },
  {
    nombre: "DevVerse",
    gerente: "Carlos",
    pistas: [
      "devverse", "devvers", "mundo", "world", "avatar", "sala", "salas", "zona",
      "oficina virtual", "personaje", "sprite", "muñeco", "proximidad", "edificio",
    ],
  },
  {
    nombre: "Funcionalidades",
    gerente: "Juan Bonilla",
    pistas: [
      "api", "ruta", "migracion", "migración", "base de datos", "rls", "aislamiento",
      "grafo", "mcp", "agente", "integracion", "integración", "conexion", "conexión",
      "github", "webhook", "actividad", "registro", "diario", "contexto", "buscador",
      "busqueda", "búsqueda", "invitacion", "invitación", "token", "variable de entorno",
      "respaldo", "backup", "despliegue", "infraestructura", "terraform", "arquitectura",
    ],
  },
] as const;

/**
 * La rama que se retira.
 *
 * NO SE BORRA CON SUS TAREAS. Borrar una categoría deja sus tareas sin
 * clasificar y no las pierde (0044, `on delete set null`), pero aun así el orden
 * importa: primero se reclasifican una a una, y solo si no queda ninguna dentro
 * se retira. Si algo no encajó en ninguna rama, la vieja se queda con ello y se
 * avisa — antes eso que dejar trabajo huérfano por limpiar una lista.
 */
const A_RETIRAR = "Agente";

type Tarea = { id: string; title: string; categoryId: string | null; columnId: string };
type Columna = { id: string; name: string; isTerminal?: boolean; tasks: Tarea[] };
type Categoria = { id: string; name: string; ownerId?: string | null };

/** Sin tildes y en minúsculas, para comparar títulos escritos como salga. */
const plano = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** A qué rama pertenece un título, o null si no está claro. */
function ramaDe(titulo: string): (typeof RAMAS)[number] | null {
  const t = plano(titulo);
  // Se cuenta cuántas pistas encaja con cada rama y gana la que más, no la
  // primera: «la pantalla del grafo» toca interfaz y funcionalidades, y quedarse
  // con la primera de la lista sería un orden arbitrario decidiendo el reparto.
  const marcador = RAMAS.map((r) => ({
    rama: r,
    puntos: r.pistas.filter((p) => t.includes(plano(p))).length,
  })).sort((a, b) => b.puntos - a.puntos);

  const mejor = marcador[0];
  if (!mejor || mejor.puntos === 0) return null;
  // Empate entre dos ramas: no se elige. Sale en «sin clasificar» para que lo
  // decida una persona, que es lo que un empate significa.
  if (marcador[1] && marcador[1].puntos === mejor.puntos) return null;
  return mejor.rama;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const soloVer = args.includes("--ver");
  const nombreEspacio = args.find((a) => !a.startsWith("--"));

  const cliente = new ClienteDevUP();
  const espacio = await resolverEspacio(cliente, nombreEspacio);
  console.log(`Espacio: ${espacio.name}${soloVer ? "  (solo mirando, no escribe nada)" : ""}\n`);

  /**
   * Quién es cada gerente, con la MISMA función que usa el MCP.
   *
   * No se busca a mano contra una lista propia: `resolverPersona` ya sabe
   * perdonar cómo se escribe un nombre y, sobre todo, **se planta cuando el
   * nombre encaja con dos personas** en vez de elegir. Poner de gerente a quien
   * no era es peor que no poner a nadie: nadie va a revisarlo después.
   */
  const buscarPersona = async (quien: string): Promise<string | null> => {
    try {
      return await resolverPersona(cliente, quien);
    } catch (fallo) {
      console.log(`  ! ${(fallo as Error).message}`);
      return null;
    }
  };

  // --- 1. Las tres ramas ----------------------------------------------------
  let { categories } = await cliente.get<{ categories: Categoria[] }>(
    `/workspaces/${espacio.id}/categories`,
  );

  const porNombre = (n: string) =>
    categories.find((c) => plano(c.name) === plano(n));

  for (const rama of RAMAS) {
    const gerente = await buscarPersona(rama.gerente);

    if (porNombre(rama.nombre)) {
      console.log(`  = «${rama.nombre}» ya existe`);
      continue;
    }
    if (soloVer) {
      console.log(`  + crearía «${rama.nombre}» (gerente: ${rama.gerente})`);
      continue;
    }
    const { category } = await cliente.post<{ category: Categoria }>(
      `/workspaces/${espacio.id}/categories`,
      { name: rama.nombre, ownerId: gerente },
    );
    categories = [...categories, category];
    console.log(`  + «${rama.nombre}» creada (gerente: ${rama.gerente})`);
  }

  // --- 2. El reparto --------------------------------------------------------
  const { columns } = await cliente.get<{ columns: Columna[] }>(
    `/workspaces/${espacio.id}/board`,
  );
  const tareas = columns.flatMap((c) =>
    c.tasks.map((t) => ({ ...t, columna: c.name, terminal: c.isTerminal === true })),
  );

  const vieja = porNombre(A_RETIRAR);
  const sinClasificar: string[] = [];
  let movidas = 0;

  console.log("\nReparto");

  for (const tarea of tareas) {
    const rama = ramaDe(tarea.title);
    if (!rama) {
      sinClasificar.push(`${tarea.title}  (${tarea.columna})`);
      continue;
    }
    const destino = porNombre(rama.nombre);
    if (!destino) continue;
    if (tarea.categoryId === destino.id) continue;

    const desde = categories.find((c) => c.id === tarea.categoryId)?.name ?? "sin rama";
    console.log(`  ${soloVer ? "→" : "✓"} «${tarea.title}»  ${desde} → ${rama.nombre}`);

    if (!soloVer) {
      // Solo la rama. El responsable NO se toca: ver la cabecera.
      await cliente.patch(`/tasks/${tarea.id}`, { categoryId: destino.id });
    }
    movidas += 1;
  }

  // --- 3. La rama que se retira --------------------------------------------
  if (vieja) {
    const quedan = tareas.filter(
      (t) => t.categoryId === vieja.id && ramaDe(t.title) === null,
    );
    console.log("");
    if (quedan.length > 0) {
      console.log(
        `  ! «${A_RETIRAR}» NO se retira: quedan ${quedan.length} tarea(s) que no encajan en ninguna rama.`,
      );
      for (const t of quedan) console.log(`      · ${t.title}`);
      console.log("    Clasifícalas a mano y vuelve a ejecutar esto.");
    } else if (soloVer) {
      console.log(`  → retiraría la rama «${A_RETIRAR}» (ya sin tareas dentro)`);
    } else {
      // El cliente del MCP no tiene `delete` —no le hace falta a ninguna
      // herramienta— así que se renombra en vez de borrarse. Es además lo más
      // prudente: deja rastro de que existió, y si algo quedó dentro sin que
      // este guion lo viera, sigue estando donde estaba.
      await cliente.patch(`/categories/${vieja.id}`, { name: `${A_RETIRAR} (retirada)` });
      console.log(`  ✓ «${A_RETIRAR}» marcada como retirada (vacía; bórrala desde el tablero si quieres)`);
    }
  }

  // --- Lo que hay que mirar a mano -----------------------------------------
  if (sinClasificar.length > 0) {
    console.log(`\nSin clasificar (${sinClasificar.length}) — se quedan donde están:`);
    for (const t of sinClasificar) console.log(`  · ${t}`);
  }

  console.log(
    `\n${movidas} tarea(s) ${soloVer ? "se moverían" : "movidas"}, ${sinClasificar.length} sin clasificar.`,
  );
  if (soloVer) console.log("Nada se ha escrito. Quita `--ver` para aplicarlo.");
}

main().catch((error: unknown) => {
  console.error(`\nNo se pudo: ${(error as Error).message}`);
  process.exit(1);
});
