import { contextoDeTarea } from "./contexto.js";

/**
 * Reconstruir el contexto de una tarea.
 *
 * QUÉ SE COMPRUEBA, Y POR QUÉ NO ES «QUE SALGA BIEN». Que salga bien se ve en
 * cuanto se usa. Lo que se fija aquí son las cuatro formas que tiene de estar
 * mal sin que nadie lo note — todas producen un texto que se lee estupendamente:
 *
 *   1. **El orden de la historia.** Hacia delante, al revés que en todas las
 *      demás vistas del registro. Una reconstrucción se cuenta desde el
 *      principio; del revés hay que leerla dos veces para entenderla, y sigue
 *      pareciendo correcta.
 *
 *   2. **Que un contexto a medias no se presente como completo.** Es lo peor
 *      que puede hacer esta herramienta: quien la lea dejará de buscar, y la
 *      pieza que falta suele ser justo la que explica la decisión.
 *
 *   3. **Que no elija por su cuenta entre varias tareas parecidas.**
 *      Reconstruir el contexto de la tarea equivocada es peor que no
 *      reconstruir ninguno, porque se lee como si fuera el bueno.
 *
 *   4. **La raya de siempre:** el día, no la hora.
 *
 *   npm run test:mcp
 */

let total = 0;
let fallos = 0;

function check(nombre: string, condicion: boolean): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
  }
}

const ID = "11111111-2222-3333-4444-555555555555";

function clienteFalso(respuesta: unknown, caminos: string[] = []) {
  return {
    apiUrl: "http://x",
    get: async <T,>(camino: string): Promise<T> => {
      caminos.push(camino);
      return respuesta as T;
    },
    post: async <T,>(): Promise<T> => ({}) as T,
    patch: async <T,>(): Promise<T> => ({}) as T,
  };
}

const tareaBase = {
  id: ID,
  title: "Pasarela de pagos",
  description: null,
  tipo: "funcionalidad",
  prioridad: 2,
  contexto: "Se eligió Stripe porque Wompi no cubría suscripciones.",
  criterio: "Un cobro recurrente que se renueva solo.",
  assigneeName: "Ana",
  ramas: [{ nombre: "feat/pagos", estado: "fusionada", repo: "acme/producto" }],
  evidencia: [
    { tipo: "pr", url: "https://github.com/acme/producto/pull/12", titulo: "El PR", nota: "", autor: "Ana" },
  ],
};

const historiaCompleta = [
  { verbo: "creo", detalle: null, procedencia: "persona" as const, cuando: "2026-08-01T23:40:00.000Z", actorNombre: "Ana" },
  { verbo: "asigno", detalle: null, procedencia: "persona" as const, cuando: "2026-08-03T09:00:00.000Z", actorNombre: "Ana" },
  { verbo: "movio", detalle: { de: "Por hacer", a: "En curso" }, procedencia: "persona" as const, cuando: "2026-08-05T09:00:00.000Z", actorNombre: "Carlos" },
  { verbo: "cerro", detalle: null, procedencia: "agente" as const, cuando: "2026-08-20T09:00:00.000Z", actorNombre: "Carlos" },
];

console.log("\nLo que reconstruye");

{
  const texto = await contextoDeTarea(
    clienteFalso({
      task: tareaBase,
      historia: historiaCompleta,
      enlaces: [
        { etiqueta: "se toca en", direccion: "sale" as const, tipo: "repositorio", nombre: "acme/producto", procedencia: "regla" as const },
        { etiqueta: "salió de", direccion: "sale" as const, tipo: "mensaje", nombre: "¿usamos Stripe?", procedencia: "persona" as const },
      ],
    }),
    { tarea: ID },
  );

  // Lo escrito a mano va entero: es lo único del contexto que alguien redactó a
  // propósito para quien viniera después.
  check("el porqué escrito a mano sale entero", texto.includes("Wompi no cubría suscripciones"));
  check("y el criterio de terminado", texto.includes("Un cobro recurrente"));
  check("la rama donde se tocó", texto.includes("feat/pagos"));
  check("la prueba que dejó", texto.includes("pull/12"));
  check("y lo enlazado", texto.includes("acme/producto"));

  // De quién salió el enlace importa al leerlo: lo de una persona es una
  // afirmación suya; lo de una regla se puede volver a deducir.
  check("lo enlazado a mano se distingue de lo deducido", texto.includes("(a mano)"));
  check("y lo que hizo un agente va marcado", texto.includes("[agente]"));

  // LA 1. Hacia delante: primero se creó, luego se movió, luego se cerró.
  const creo = texto.indexOf("la creó");
  const cerro = texto.indexOf("la cerró");
  check("la historia va hacia delante, no del revés", creo > 0 && cerro > creo);

  // LA 4. El hecho de arriba pasó a las 23:40; el día sí, la hora no.
  check("sale el día", texto.includes("1 de agosto"));
  check("pero no la hora", !/23:40|18:40/.test(texto));

  // Con todo puesto no hay nada que confesar.
  check("y con todo enlazado no dice que falte nada", !texto.includes("todo lo que hay enlazado"));
}

console.log("\nLo que NO hay, dicho en voz alta");

{
  const texto = await contextoDeTarea(
    clienteFalso({
      task: { ...tareaBase, contexto: null, criterio: null, ramas: [], evidencia: [] },
      historia: [],
      enlaces: [],
    }),
    { tarea: ID },
  );

  // LA 2, que es la que más importa. Un contexto vacío que se presentara como
  // completo haría que quien lo lea deje de buscar — y la pieza que falta suele
  // ser justo la que explica la decisión.
  check("dice que no hay historia anotada", texto.includes("no hay historia anotada"));
  check("que no hay ramas", texto.includes("ninguna rama apuntada"));
  check("que no hay pruebas", texto.includes("ninguna prueba"));
  check("y que no hay conversaciones enlazadas", texto.includes("ninguna conversación enlazada"));
  check(
    "y deja claro que eso es todo lo que hay",
    texto.includes("todo lo que hay enlazado"),
  );
}

{
  // Una conversación enlazada sí, ramas no: la confesión tiene que ser
  // parcial, no un bloque de todo-o-nada.
  const texto = await contextoDeTarea(
    clienteFalso({
      task: { ...tareaBase, ramas: [], evidencia: [] },
      historia: historiaCompleta,
      enlaces: [
        { etiqueta: "salió de", direccion: "entra" as const, tipo: "mensaje", nombre: "el hilo", procedencia: "persona" as const },
      ],
    }),
    { tarea: ID },
  );
  check("con conversación enlazada, no la echa en falta", !texto.includes("ninguna conversación"));
  check("pero sí sigue diciendo que no hay ramas", texto.includes("ninguna rama apuntada"));
}

console.log("\nY cuando no sabe de cuál le hablan");

{
  // LA 3. Dos tareas que encajan con el mismo texto: se planta.
  const tablero = {
    columns: [
      { tasks: [{ id: ID, title: "Arreglar el login" }, { id: "otra", title: "Arreglar el login de admin" }] },
    ],
  };
  const cliente = {
    apiUrl: "http://x",
    get: async <T,>(camino: string): Promise<T> => {
      if (camino.includes("/board")) return tablero as T;
      if (camino === "/organizations") return { organizations: [{ id: "o1", name: "Acme" }] } as T;
      return { workspaces: [{ id: "w1", name: "Producto" }] } as T;
    },
    post: async <T,>(): Promise<T> => ({}) as T,
    patch: async <T,>(): Promise<T> => ({}) as T,
  };

  let mensaje = "";
  try {
    await contextoDeTarea(cliente, { tarea: "Arreglar el login", espacio: "Producto" });
  } catch (fallo) {
    mensaje = (fallo as Error).message;
  }

  check("con dos que encajan, no elige por su cuenta", mensaje.includes("encaja con varias"));
  check("y dice cuáles son, para poder responder", mensaje.includes("Arreglar el login de admin"));
}

{
  const caminos: string[] = [];
  await contextoDeTarea(
    clienteFalso({ task: tareaBase, historia: [], enlaces: [] }, caminos),
    { tarea: ID },
  );
  // Con un identificador no hay que recorrer ningún tablero: una petición.
  check("con un identificador va directa, sin recorrer tableros", caminos.length === 1);
  check("y a la ruta de contexto", caminos[0] === `/tasks/${ID}/contexto`);
}

console.log(`\n${total - fallos} comprobaciones correctas, ${fallos} fallida${fallos === 1 ? "" : "s"}\n`);
if (fallos > 0) process.exit(1);
