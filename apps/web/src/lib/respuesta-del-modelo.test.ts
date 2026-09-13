/**
 * Prueba del lector de la respuesta del modelo.
 *
 * EL CASO QUE ABRE LA PRUEBA ES EL DE LA CAPTURA. La respuesta del asistente se
 * pintaba en crudo y se leían los asteriscos: «hay 2 tareas en la columna
 * **Por hacer**». Ese texto exacto es la primera comprobación, porque una
 * prueba con un markdown inventado no habría cazado nada — el fallo no estaba
 * en el markdown, estaba en que nadie lo leía.
 *
 * Y LO QUE MÁS IMPORTA DESPUÉS: que lo que el lector no entienda salga TAL
 * CUAL en vez de desaparecer. Un lector incompleto es aceptable; uno que se
 * come contenido convierte una respuesta a medias en una respuesta equivocada,
 * y nadie puede saberlo mirando la pantalla.
 *
 *   npm run test:respuesta
 */
import { bloquesDe, trozosDe } from "./respuesta-del-modelo.js";

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

/** Todo el texto de unos trozos, sin sus marcas. Para comprobar que no se
 *  pierde nada por el camino. */
const plano = (trozos: { texto: string }[]) => trozos.map((t) => t.texto).join("");

console.log("\nLa respuesta de la captura, que es la que fallaba");

const REAL = `En el tablero hay 2 tareas en la columna **Por hacer**:

- **Desarrollo agéntico** — Juan Bonilla · Vence el 15/09/2026
- **te** — Juan Bonilla · Vence el 10/09/2026 *(tiene 1 imagen adjunta)*`;

const bloques = bloquesDe(REAL);

check("sale un párrafo y una lista", bloques.length === 2);
check("el primero es el párrafo", bloques[0]!.tipo === "parrafo");
check("el segundo es la lista", bloques[1]!.tipo === "lista");

const parrafo = bloques[0]! as { tipo: "parrafo"; trozos: ReturnType<typeof trozosDe> };
check(
  "«Por hacer» sale en negrita, no con asteriscos",
  parrafo.trozos.some((t) => t.tipo === "fuerte" && t.texto === "Por hacer"),
);
check("y ya no queda ni un asterisco", !plano(parrafo.trozos).includes("*"));

const lista = bloques[1]! as { tipo: "lista"; puntos: ReturnType<typeof trozosDe>[] };
check("la lista tiene dos puntos", lista.puntos.length === 2);
check(
  "el guion del punto no sale como texto",
  !plano(lista.puntos[0]!).startsWith("-") && !plano(lista.puntos[0]!).startsWith(" "),
);
check(
  "el nombre de la tarea va en negrita",
  lista.puntos[0]!.some((t) => t.tipo === "fuerte" && t.texto === "Desarrollo agéntico"),
);
// El contenido tiene que llegar entero: la fecha y el separador son datos.
check("la fecha sobrevive", plano(lista.puntos[0]!).includes("15/09/2026"));
check("y el nombre de quien la tiene", plano(lista.puntos[1]!).includes("Juan Bonilla"));

console.log("\nNegrita, código y lo que los mezcla");

check("negrita con asteriscos", trozosDe("hola **mundo**")[1]!.tipo === "fuerte");
check("negrita con guiones bajos", trozosDe("hola __mundo__")[1]!.tipo === "fuerte");
check("código entre acentos graves", trozosDe("usa `npm run dev`")[1]!.tipo === "codigo");

// El caso que obliga a recorrer una sola vez: dentro del código, los asteriscos
// son literales. Con pasadas separadas esto saldría en negrita.
const mezcla = trozosDe("el patrón `a**b**c` no es negrita");
check("un ** dentro de código NO es negrita", mezcla.every((t) => t.tipo !== "fuerte"));
check("y el código llega con sus asteriscos", plano(mezcla).includes("a**b**c"));

console.log("\nLo que no se entiende, sale tal cual");

// Un asterisco suelto, un énfasis simple, una tabla: nada de eso se interpreta,
// pero NADA se pierde.
const raro = "un * suelto, *cursiva simple*, y | una | tabla |";
check("ni un carácter se pierde", plano(trozosDe(raro)) === raro);

const conTabla = bloquesDe("texto\n\n| a | b |\n| - | - |");
check("una tabla no desaparece", JSON.stringify(conTabla).includes("| a | b |"));

console.log("\nLos bordes que rompen un lector escrito a la ligera");

check("texto vacío no da bloques", bloquesDe("").length === 0);
check("solo espacios tampoco", bloquesDe("   \n\n  ").length === 0);
check("una línea vacía siempre da un trozo", trozosDe("").length === 1);
check("negrita sin cerrar no se traga el resto", plano(trozosDe("**sin cerrar")) === "**sin cerrar");
check("asteriscos vacíos no dan negrita", trozosDe("****").every((t) => t.tipo === "texto"));

console.log("\nTitulares y párrafos");

const conTitulo = bloquesDe("## Lo que queda\n\ntexto debajo");
check("un titular es su propio bloque", conTitulo[0]!.tipo === "titulo");
check("y no se lleva las almohadillas", !JSON.stringify(conTitulo[0]).includes("#"));

// Dos líneas seguidas son UN párrafo: el modelo corta a lo ancho por su cuenta,
// y respetar sus cortes dejaría renglones partidos a media frase.
const dosLineas = bloquesDe("una frase\ncortada en dos");
check("dos líneas seguidas son un párrafo", dosLineas.length === 1);
check("unidas por un espacio", JSON.stringify(dosLineas).includes("una frase cortada en dos"));

// Y una línea normal después de una lista cierra la lista.
const listaYTexto = bloquesDe("- uno\n- dos\ncomentario final");
check("la lista se cierra al volver a texto", listaYTexto.length === 2);
check("la lista tiene sus dos puntos", (listaYTexto[0] as { puntos: unknown[] }).puntos.length === 2);

console.log(`\n${total} comprobaciones, ${fallos} fallidas`);
if (fallos > 0) process.exit(1);
