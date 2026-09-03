/**
 * Pruebas del conector de YouTube.
 *
 * QUÉ SE PRUEBA Y QUÉ NO. Buscar exige salir a internet con una clave, y una
 * prueba que sale a internet no es una prueba: falla los días que falla la red
 * y pasa por casualidad los demás. Lo que sí se puede probar —y es donde estas
 * cosas se rompen de verdad— es el análisis: sacar el id de un enlace y leer
 * la duración.
 *
 * EL ANÁLISIS DE ENLACES IMPORTA MÁS DE LO QUE PARECE. YouTube reparte el
 * mismo vídeo con seis formas de dirección distintas, y la gente pega lo que
 * le da el botón «compartir» de su móvil, no la forma canónica. Un análisis
 * flojo aquí se traduce en «eso no parece un enlace de YouTube» delante de
 * alguien que acaba de pegar un enlace de YouTube perfectamente válido.
 *
 *   npm run test:youtube
 */
// `export {}` para que este archivo sea un módulo: sin un solo import ni
// export, TypeScript lo trata como script y prohíbe el `await` de abajo. Y ese
// await tiene que ser de arriba, porque `env` se evalúa al importar el módulo y
// la clave debe estar puesta antes.
export {};

process.env.YOUTUBE_API_KEY = "clave-de-prueba";

const { idDeEnlace, youtubeConfigurado } = await import("./youtube.js");

let total = 0;
let fallos = 0;
function check(nombre: string, condicion: boolean): void {
  total += 1;
  if (condicion) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
  }
}

const ID = "dQw4w9WgXcQ";

console.log("\nLas formas en que la gente pega un enlace");
check("la dirección normal", idDeEnlace(`https://www.youtube.com/watch?v=${ID}`) === ID);
check("sin www", idDeEnlace(`https://youtube.com/watch?v=${ID}`) === ID);
check("la corta de compartir", idDeEnlace(`https://youtu.be/${ID}`) === ID);
check("la del móvil", idDeEnlace(`https://m.youtube.com/watch?v=${ID}`) === ID);
check("la de YouTube Music", idDeEnlace(`https://music.youtube.com/watch?v=${ID}`) === ID);
check("un short", idDeEnlace(`https://www.youtube.com/shorts/${ID}`) === ID);
check("un incrustado", idDeEnlace(`https://www.youtube.com/embed/${ID}`) === ID);
check("un directo", idDeEnlace(`https://www.youtube.com/live/${ID}`) === ID);
check("el id a secas", idDeEnlace(ID) === ID);
check("con espacios alrededor, como al copiar", idDeEnlace(`  https://youtu.be/${ID}  `) === ID);

// El «compartir» de YouTube añade el segundo por el que ibas, y la lista de
// reproducción si venías de una. Ninguna de las dos cosas cambia el vídeo.
console.log("\nCon lo que el botón de compartir añade encima");
check(
  "con el segundo de inicio",
  idDeEnlace(`https://youtu.be/${ID}?t=42`) === ID,
);
check(
  "dentro de una lista de reproducción",
  idDeEnlace(`https://www.youtube.com/watch?v=${ID}&list=PLabc&index=3`) === ID,
);

console.log("\nLo que no es un vídeo de YouTube");
check("otro sitio cualquiera", idDeEnlace("https://vimeo.com/12345678") === null);
check("texto suelto", idDeEnlace("pon algo de música") === null);
check("vacío", idDeEnlace("") === null);
check(
  "un dominio que solo TERMINA en youtube.com",
  idDeEnlace(`https://noesyoutube.com/watch?v=${ID}`) === null,
);
check(
  "un id demasiado corto",
  idDeEnlace("https://youtu.be/abc") === null,
);
check("un canal, que no se puede reproducir", idDeEnlace("https://youtube.com/@alguien") === null);

console.log("\nLa configuración");
check("con la clave puesta, está configurado", youtubeConfigurado());

console.log(`\n${total - fallos} comprobaciones correctas, ${fallos} fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
