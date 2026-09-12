import { ALTO_FILA, MARGEN, alturaLibre, repartirEnColumnas } from "./arquitectura.js";

/**
 * Prueba de la colocación de las cajas del diagrama.
 *
 * POR QUÉ ESTO Y NO EL RESTO. Casi todo lo de meter una arquitectura es
 * escribir filas, y eso ya lo cubren las pruebas de aislamiento. Lo que no se
 * ve leyendo el código es esto: que la disposición sale legible, que un ciclo
 * no cuelga el bucle y que un componente al que nadie llama acaba a la
 * izquierda. Son funciones puras, así que se prueban sin levantar nada.
 *
 * Vivía en el paquete MCP, cuando dibujar el diagrama solo lo hacía un agente.
 * Se movió aquí con la función, al aparecer el segundo camino —importar
 * Terraform— que tiene que colocar las cajas igual.
 *
 *   npm run test:arquitectura
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
  check(
    "una cadena sale en tres columnas seguidas",
    col.get("navegador") === 0 && col.get("api") === 1 && col.get("postgres") === 2,
  );
}

{
  // Dos servicios que no se hablan van los dos a la izquierda: no hay ningún
  // motivo para poner uno detrás del otro.
  const col = repartirEnColumnas(["Uno", "Dos"], []);
  check(
    "lo que no se conecta con nada comparte la primera columna",
    col.get("uno") === 0 && col.get("dos") === 0,
  );
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

{
  // Una conexión que nombra a alguien que no está entre los nuevos —porque ya
  // existía en el lienzo— no puede empujar columnas ni colgar el reparto.
  const col = repartirEnColumnas(["API"], [{ de: "Navegador", a: "API" }]);
  check("una conexión desde alguien que ya estaba no descoloca lo nuevo", col.get("api") === 0);
}

console.log("\nDesde qué altura se dibuja lo nuevo");

check("en un lienzo vacío, desde el margen", alturaLibre([]) === MARGEN);
check("y si ya hay cajas, por debajo de la más baja", alturaLibre([40, 300, 160]) === 300 + ALTO_FILA);

console.log(
  `\n${total - fallos} comprobaciones correctas, ${fallos} fallida${fallos === 1 ? "" : "s"}\n`,
);
if (fallos > 0) process.exit(1);
