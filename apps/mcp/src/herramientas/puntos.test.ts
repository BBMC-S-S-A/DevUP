import type { ClienteApi } from "../api.js";
import { verPuntos } from "./puntos.js";

/**
 * Cómo se redacta el marcador.
 *
 * LA QUE JUSTIFICA EL FICHERO ES «A SOLAS». Los puntos se ganan al cerrar una
 * tarea (0055), y la única defensa contra inflar el número a base de tareas
 * fáciles cerradas por uno mismo es que se VEA cuánto de ese total pasó por una
 * sola persona. La base lo guarda y la API lo devuelve — y todo eso se pierde
 * si la frase que lee una persona enseña el total y se calla el resto. Un dato
 * que no se pinta es un dato que no existe.
 *
 * Y TRES MÁS QUE SE LEEN BIEN ESTANDO MAL:
 *
 *   · **Cuando TODO se ganó a solas hay que decirlo aparte.** Persona a
 *     persona, cada línea se lee normal; lo que solo se ve mirando el conjunto
 *     es que nadie ha revisado nada de nadie, y ese es el caso que hay que
 *     nombrar en voz alta.
 *   · **Un nombre que encaja con dos personas se pregunta, no se elige.**
 *     Elegir por su cuenta enseña los puntos de otra persona con toda
 *     seguridad, y quien lo lee no tiene forma de saber que se equivocó.
 *   · **Quien no ha ganado nada merece una frase, no una lista vacía.** Una
 *     lista vacía se lee como avería.
 *
 *   npm run test:mcp
 */

let total = 0;
let fallos = 0;

function check(nombre: string, condicion: boolean, detalle?: string): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos += 1;
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

const ORG = { id: "org-1", name: "Hytrex", slug: "hytrex" };

/** Un cliente que contesta lo que se le diga, según la ruta que le pidan. */
function clienteCon(respuestas: Record<string, unknown>): ClienteApi {
  return {
    apiUrl: "http://127.0.0.1:4000",
    get: (async (ruta: string) => {
      if (ruta === "/organizations") return { organizations: [ORG] };
      for (const [trozo, valor] of Object.entries(respuestas)) {
        if (ruta.includes(trozo)) return valor;
      }
      throw new Error(`ruta no prevista en la prueba: ${ruta}`);
    }) as ClienteApi["get"],
    post: (async () => ({})) as ClienteApi["post"],
    patch: (async () => ({})) as ClienteApi["patch"],
  };
}

const mezclado = {
  "/puntos": {
    gente: [
      {
        id: "u1",
        nombre: "Juan",
        total: 45,
        aSolas: 15,
        tareas: 4,
        porMotivo: { cerro_tarea: 30, dejo_prueba: 15 },
      },
      { id: "u2", nombre: "Carlos", total: 10, aSolas: 0, tareas: 1, porMotivo: { cerro_tarea: 10 } },
    ],
  },
};

async function main(): Promise<void> {
  console.log("\nEl marcador");

  const texto = await verPuntos(clienteCon(mezclado), {});

  check("sale cada persona con su total", texto.includes("Juan") && texto.includes("45 punto"));
  // LA DE VERDAD.
  check("«a solas» va en la misma línea que el total, no en otra parte", /Juan.*15 a solas/.test(texto));
  check(
    "y a quien no ganó nada a solas no se le cuelga un cero que no dice nada",
    !/Carlos.*a solas/.test(texto),
  );
  check("dice de qué salieron los puntos", texto.includes("por cerrar") && texto.includes("por dejar prueba"));
  check(
    "no se anuncia el aviso del conjunto cuando hay trabajo compartido",
    !texto.includes("ninguna tarea pasó por dos personas"),
  );

  console.log("\nCuando nadie ha revisado nada de nadie");

  const todoSolo = await verPuntos(
    clienteCon({
      "/puntos": {
        gente: [
          { id: "u1", nombre: "Juan", total: 20, aSolas: 20, tareas: 2, porMotivo: { cerro_tarea: 20 } },
          { id: "u2", nombre: "Ana", total: 10, aSolas: 10, tareas: 1, porMotivo: { cerro_tarea: 10 } },
        ],
      },
    }),
    {},
  );
  check(
    "se dice en voz alta, que línea a línea no se ve",
    todoSolo.includes("ninguna tarea pasó por dos personas"),
  );

  console.log("\nSin nada que enseñar");

  const vacio = await verPuntos(clienteCon({ "/puntos": { gente: [] } }), {});
  check("una organización sin puntos explica cómo se ganan", vacio.includes("Se ganan al cerrar"));

  console.log("\nLos asientos de una persona");

  const asientos = {
    "/puntos/u1": {
      asientos: [
        {
          id: "a1",
          tarea: "t1",
          titulo: "Arreglar el riel",
          motivo: "cerro_tarea",
          cantidad: 10,
          aSolas: false,
          cuando: "2026-09-12T14:02:00.000Z",
        },
        {
          id: "a2",
          tarea: "t2",
          titulo: "Carpetas en la biblioteca",
          motivo: "dejo_prueba",
          cantidad: 5,
          aSolas: true,
          cuando: "2026-09-11T09:30:00.000Z",
        },
      ],
    },
    "/puntos": mezclado["/puntos"],
  };

  const deJuan = await verPuntos(clienteCon(asientos), { persona: "juan" });
  check("se encuentra por el nombre en minúsculas", deJuan.includes("Juan"));
  check("cada asiento dice de qué tarea salió", deJuan.includes("«Arreglar el riel»"));
  check("y el motivo se lee en castellano, no como clave", deJuan.includes("cerró la tarea"));
  check("los que fueron a solas se marcan", deJuan.includes("(a solas)"));
  // 45 de total y 15 en los asientos que caben: decirlo, o se lee como «esto es
  // todo» cuando es «esto es lo último».
  check("y se avisa de que no están todos", deJuan.includes("hay más puntos"));

  console.log("\nY los nombres que no deciden solos");

  const dosJuanes = {
    "/puntos": {
      gente: [
        { id: "u1", nombre: "Juan Medina", total: 45, aSolas: 0, tareas: 4, porMotivo: {} },
        { id: "u3", nombre: "Juan Bonilla", total: 20, aSolas: 0, tareas: 2, porMotivo: {} },
      ],
    },
  };
  const ambiguo = await verPuntos(clienteCon(dosJuanes), { persona: "Juan" });
  check("con dos que encajan, pregunta en vez de elegir", ambiguo.includes("Concreta cuál"));
  check("y dice cuáles son", ambiguo.includes("Juan Medina") && ambiguo.includes("Juan Bonilla"));

  const nadie = await verPuntos(clienteCon(mezclado), { persona: "Fulano" });
  check("y quien no ha ganado nada recibe una frase, no una lista vacía", nadie.includes("no ha ganado") || nadie.includes("Nadie que se llame"));

  console.log(`\n${total - fallos} de ${total} comprobaciones`);
  if (fallos > 0) process.exit(1);
}

await main();
