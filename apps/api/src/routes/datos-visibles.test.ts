import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Que lo que el producto promete no enseñar, siga sin enseñarse.
 *
 * POR QUÉ ESTA PRUEBA. «Mi cuenta» tiene una tarjeta que le dice a cada persona
 * qué ve el resto de ella y qué no: que su correo no circula, que su huso solo
 * lo usa el servidor, que el rol del recorrido no lo ve nadie. Esas frases se
 * escribieron comprobando las rutas UNA VEZ.
 *
 * Y ese es el problema. El día que alguien añada `p.timezone` a la consulta de
 * los miembros —por una razón perfectamente buena, como pintar la hora local de
 * cada quien— la tarjeta seguirá diciendo que no se ve. Nada fallará. Nadie lo
 * notará. Y el producto estará afirmando algo falso sobre la privacidad de sus
 * usuarios, que es de lo peor que puede hacer.
 *
 * Una promesa escrita en la interfaz sin nada que la sostenga es una promesa
 * con fecha de caducidad desconocida. Esto es lo que la sostiene.
 *
 * CÓMO. Se lee el código de las rutas que devuelven datos de TERCEROS y se
 * comprueba que no nombren las columnas prohibidas. No es un análisis
 * semántico: es buscar texto, y por eso puede dar un falso positivo si alguien
 * menciona una de esas palabras en un comentario. Ese es el intercambio
 * correcto — un aviso de más cuesta un minuto de leer; uno de menos cuesta la
 * confianza de quien nos creyó.
 *
 * NO CUBRE TODO, y conviene decirlo: si alguien crea una ruta NUEVA que
 * devuelva correos ajenos, esto no se entera. Cubre las que hay, que son por
 * donde se filtraría sin querer al tocar algo existente.
 *
 *   npm run test:datos-visibles --workspace apps/api
 */

let total = 0;
const fallos: string[] = [];

function check(nombre: string, condicion: boolean, detalle = ""): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos.push(nombre);
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

const aqui = dirname(fileURLToPath(import.meta.url));

/** Lee un trozo de fichero entre dos marcas, para mirar solo la ruta que toca. */
function trozo(fichero: string, desde: string, hasta: string): string {
  const texto = readFileSync(join(aqui, fichero), "utf8");
  const inicio = texto.indexOf(desde);
  if (inicio === -1) {
    // Si la marca ya no está, la ruta se renombró o se movió: eso también hay
    // que mirarlo a mano, así que se avisa en vez de dar por bueno un vacío.
    throw new Error(`no encuentro «${desde}» en ${fichero}: ¿se movió esa ruta?`);
  }
  const fin = texto.indexOf(hasta, inicio + desde.length);
  return texto.slice(inicio, fin === -1 ? undefined : fin);
}

console.log("\nLo que la tarjeta promete que no se ve");

/**
 * La lista de miembros de una organización es la ruta más expuesta que hay:
 * la piden el tablero, los ajustes, las ramas y el panel. Si algo de una
 * persona se va a filtrar sin querer, se filtra por aquí.
 */
const miembros = trozo(
  "workspaces.ts",
  'app.get("/organizations/:orgId/members"',
  'app.post("/organizations/:orgId/members"',
);

check(
  "la lista de miembros no devuelve correos",
  !/\bemail\b/.test(miembros),
  "Si ahora hace falta el correo, hay que quitar esa línea de la tarjeta «Qué ve el resto de ti».",
);
check(
  "ni el huso horario de nadie",
  !/timezone/.test(miembros),
  "La tarjeta dice que el huso solo lo usa el servidor. Si deja de ser cierto, hay que cambiarla.",
);
check(
  "ni el rol que elige el recorrido de bienvenida",
  !/\bm\.rol\b|\brol::/.test(miembros),
  "La tarjeta dice que ese rol no lo ve nadie más.",
);

/**
 * El marcador enseña a toda la organización quién ha ganado qué. Lo que NO
 * puede enseñar es de dónde salió cada persona más allá de eso.
 */
const puntos = readFileSync(join(aqui, "..", "lib", "puntos.ts"), "utf8");
check(
  "el marcador no arrastra correos",
  !/\bemail\b/.test(puntos),
  "El marcador lo ve toda la organización; un correo ahí es un correo publicado.",
);

/**
 * Y las caras. Esta ruta devuelve fotos firmadas de OTRAS personas, así que es
 * la que más cerca está de convertirse en un directorio si se le añaden campos.
 */
const caras = trozo("preferences.ts", 'app.post("/avatars/urls"', 'app.put("/me/avatar/personaje"');
check(
  "la ruta de las caras no devuelve nada más que la cara",
  !/\bemail\b/.test(caras) && !/timezone/.test(caras),
  "Devuelve fotos de terceros: cualquier campo extra aquí se publica a la organización entera.",
);

/**
 * Y la que de verdad no se puede tocar: la clave del almacén. Es lo que permite
 * pedir el objeto sin pasar por nosotros, así que lo que sale firmado y caduca
 * dejaría de caducar.
 */
check(
  "y nunca la clave del almacén, solo una URL firmada",
  !/avatarKey.*=>|"avatarKey":/.test(caras.replace(/avatar_key as "avatarKey"/g, "")),
  "La clave no caduca; la URL firmada sí. Devolver la clave sería dar acceso permanente.",
);

console.log(`\n${total - fallos.length} comprobaciones correctas, ${fallos.length} fallidas`);
if (fallos.length > 0) {
  console.error("\nFallaron:\n" + fallos.map((f) => `  · ${f}`).join("\n"));
  process.exit(1);
}
