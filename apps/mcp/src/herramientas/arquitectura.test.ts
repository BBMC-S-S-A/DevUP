import { repartirEnColumnas } from "./arquitectura.js";

/**
 * Prueba del reparto en columnas del diagrama.
 *
 * POR QUÉ ESTO Y NO EL RESTO. Casi todo `dibujar_arquitectura` es hablar con
 * la API, y eso ya lo cubren las pruebas de aislamiento. Lo que no se ve
 * leyendo el código es esto: que la disposición sale legible, que un ciclo no
 * cuelga el bucle y que un componente al que nadie llama acaba a la izquierda.
 * Es una función pura, así que se prueba sin levantar nada.
 *
 *   npm run test:mcp
 */

let fallos = 0;
let total = 0;

function check(nombre: string, condicion: boolean, detalle?: string): void {
  total++;
  if (condicion) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos++;
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

console.log("\nReparto en columnas del diagrama");

{
  const col = repartirEnColumnas(
    ["Navegador", "API", "Postgres"],
    [
      { de: "Navegador", a: "API" },
      { de: "API", a: "Postgres" },
    ],
  );
  check("una cadena sale en tres columnas seguidas", col.get("navegador") === 0 && col.get("api") === 1 && col.get("postgres") === 2);
}

{
  // Dos servicios que no se hablan van los dos a la izquierda: no hay ningún
  // motivo para poner uno detrás del otro.
  const col = repartirEnColumnas(["Uno", "Dos"], []);
  check("lo que no se conecta con nada comparte la primera columna", col.get("uno") === 0 && col.get("dos") === 0);
}

{
  const col = repartirEnColumnas(
    ["API", "Postgres", "Cola"],
    [
      { de: "API", a: "Postgres" },
      { de: "API", a: "Cola" },
    ],
  );
  check(
    "lo que cuelga de un mismo servicio queda en la misma columna",
    col.get("api") === 0 && col.get("postgres") === 1 && col.get("cola") === 1,
  );
}

{
  // El caso que colgaría un reparto ingenuo: nadie tiene cero entrantes.
  const col = repartirEnColumnas(
    ["A", "B"],
    [
      { de: "A", a: "B" },
      { de: "B", a: "A" },
    ],
  );
  check("un ciclo no cuelga el bucle y coloca a los dos", col.size === 2);
}

{
  const col = repartirEnColumnas(["Solo"], [{ de: "Solo", a: "Solo" }]);
  check("un componente que se apunta a sí mismo tampoco cuelga", col.get("solo") === 0);
}

{
  // Los nombres se comparan en minúsculas, que es como se buscan luego los
  // componentes ya existentes.
  const col = repartirEnColumnas(["API"], [{ de: "api", a: "API" }]);
  check("el reparto no distingue mayúsculas", col.get("api") === 0);
}

console.log(
  `\n${total - fallos} comprobaciones correctas, ${fallos} fallida${fallos === 1 ? "" : "s"}\n`,
);
if (fallos > 0) process.exit(1);
