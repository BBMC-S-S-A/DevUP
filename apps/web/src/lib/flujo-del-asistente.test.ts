/**
 * Prueba del corte de sucesos del asistente.
 *
 * QUÉ SE PRUEBA Y POR QUÉ ES LO ÚNICO QUE MERECE PRUEBA AQUÍ: un suceso puede
 * partirse entre dos lecturas de la red, y tratar ese trozo como si estuviera
 * entero da un JSON roto. Eso no pasa con respuestas cortas — pasa cuando la
 * respuesta crece, o sea justo con las que más importan, y en una demostración
 * delante de alguien. Probarlo sin red es la única forma de fijarlo.
 *
 * Lo demás de ese archivo es una llamada `fetch`: montarla en una prueba sería
 * probar el montaje.
 *
 *   npm run test:flujo
 */
import { fraseDe, partirSucesos } from "./flujo-del-asistente.js";

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

const sse = (dato: unknown) => `data: ${JSON.stringify(dato)}\n\n`;

console.log("\nLo que llega entero");

const dos = partirSucesos(
  sse({ tipo: "herramienta", herramienta: "ver_tablero" }) +
    sse({ tipo: "herramienta", herramienta: "mis_tareas" }),
);
check("salen los dos sucesos", dos.sucesos.length === 2);
check("en orden", (dos.sucesos[0] as { herramienta: string }).herramienta === "ver_tablero");
check("y no sobra nada", dos.resto === "");

console.log("\nLo que llega cortado, que es el caso que importa");

// El corte cae en medio del JSON: es lo que pasa de verdad cuando la respuesta
// es larga y la red la entrega en trozos.
const entero = sse({ tipo: "fin", respuesta: "hay 2 tareas", pasos: [], adjuntos: [] });
const corte = Math.floor(entero.length / 2);

const primera = partirSucesos(entero.slice(0, corte));
check("un trozo a medias no da ningún suceso", primera.sucesos.length === 0);
check("y se guarda entero para la vuelta siguiente", primera.resto === entero.slice(0, corte));

const segunda = partirSucesos(primera.resto + entero.slice(corte));
check("al juntarlo sale el suceso", segunda.sucesos.length === 1);
check(
  "con su contenido intacto",
  (segunda.sucesos[0] as { respuesta: string }).respuesta === "hay 2 tareas",
);

// Y el caso hermano: dos sucesos donde el segundo queda a medias.
const mezcla = partirSucesos(
  sse({ tipo: "herramienta", herramienta: "buscar" }) + 'data: {"tipo":"fi',
);
check("el completo sale", mezcla.sucesos.length === 1);
check("y el incompleto espera", mezcla.resto === 'data: {"tipo":"fi');

console.log("\nLo que no debe tirar la conversación");

const roto = partirSucesos("data: {esto no es json}\n\n" + sse({ tipo: "fin", respuesta: "ok" }));
check("un suceso ilegible se descarta", roto.sucesos.length === 1);
check(
  "y el bueno de detrás sí llega",
  (roto.sucesos[0] as { respuesta: string }).respuesta === "ok",
);

check("cadena vacía no da nada", partirSucesos("").sucesos.length === 0);
check("líneas que no son data se ignoran", partirSucesos(": latido\n\n").sucesos.length === 0);
check("sin separador, todo es resto", partirSucesos("data: {}").sucesos.length === 0);

console.log("\nCon saltos de línea de estilo Windows");

// El protocolo admite CRLF y hay intermediarios que reescriben los saltos.
// Partiendo solo por `\n\n` esto daba CERO sucesos y se quedaba esperando un
// separador que ya había pasado: la pantalla pensando para siempre, sin un
// error que lo explicara. La prueba de al lado decía cubrirlo y no lo hacía.
const conCrlf = partirSucesos('data: {"tipo":"fin","respuesta":"ok"}\r\n\r\n');
check("un suceso con CRLF también sale", conCrlf.sucesos.length === 1);
check("con su contenido", (conCrlf.sucesos[0] as { respuesta: string }).respuesta === "ok");
check("y no queda resto colgado", conCrlf.resto === "");

console.log("\nLas frases de cada herramienta");

check("las conocidas tienen frase", fraseDe("ver_tablero") === "mirando el tablero");
// Una herramienta nueva no rompe nada: se cuenta con su nombre legible. Sin
// esto, añadir una herramienta dejaría la espera muda otra vez.
check("una desconocida se cuenta igual", fraseDe("herramienta_nueva") === "herramienta nueva");
check("y nunca vacía", fraseDe("x").length > 0);

console.log(`\n${total} comprobaciones, ${fallos} fallidas`);
if (fallos > 0) process.exit(1);
