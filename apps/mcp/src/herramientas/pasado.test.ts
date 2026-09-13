import { momentoDesde, queHaPasado } from "./pasado.js";

/**
 * Prueba de «desde cuándo» de `que_ha_pasado`.
 *
 * POR QUÉ ESTO Y NO EL RESTO. Casi toda la herramienta es pedirle al registro y
 * redactar lo que vuelve. Lo que sí puede fallar callado es interpretar el
 * «desde»: si «8h» se entendiera mal, la herramienta contestaría con toda
 * seguridad sobre un periodo equivocado — y nadie lo notaría, porque la
 * respuesta se ve igual de bien. Es peor que un error.
 *
 * Y lo que NO puede hacer: reventar. Un «desde» que no se entiende cae al día
 * por defecto, porque convertir una pregunta en un error por una coma mal
 * puesta es la forma más tonta de que una herramienta deje de usarse.
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

/** Un momento fijo, para que la prueba no dependa de cuándo se corre. */
const AHORA = new Date("2026-09-12T15:00:00.000Z");
const HORA = 3_600_000;

console.log("\nDesde cuándo mira «que_ha_pasado»");

check(
  "sin decir nada, el último día",
  momentoDesde(undefined, AHORA).getTime() === AHORA.getTime() - 24 * HORA,
);
check("una cadena vacía es lo mismo que no decir nada", momentoDesde("  ", AHORA).getTime() === AHORA.getTime() - 24 * HORA);

check("«8h» son ocho horas atrás", momentoDesde("8h", AHORA).getTime() === AHORA.getTime() - 8 * HORA);
check("«8H» también, que nadie escribe en minúsculas siempre", momentoDesde("8H", AHORA).getTime() === AHORA.getTime() - 8 * HORA);
check("«3 h» con espacio, igual", momentoDesde("3 h", AHORA).getTime() === AHORA.getTime() - 3 * HORA);
check("«7d» son siete días atrás", momentoDesde("7d", AHORA).getTime() === AHORA.getTime() - 7 * 24 * HORA);

// Una fecha suelta es el día ENTERO: quien escribe 2026-09-10 quiere lo que
// pasó ese día, no lo que pasó desde las tres de la tarde.
check(
  "una fecha suelta empieza a las cero de ese día",
  momentoDesde("2026-09-10", AHORA).toISOString() === "2026-09-10T00:00:00.000Z",
);

check(
  "un instante ISO completo se respeta tal cual",
  momentoDesde("2026-09-11T09:30:00.000Z", AHORA).toISOString() === "2026-09-11T09:30:00.000Z",
);

console.log("\nLo que no puede reventar");

for (const basura of ["el lunes pasado", "ayer", "12/09/2026", "8 horas", "-5h", "", "????"]) {
  const r = momentoDesde(basura, AHORA);
  check(
    `«${basura}» da una fecha válida y no un fallo`,
    r instanceof Date && !Number.isNaN(r.getTime()),
  );
}

// Y el caso que importa de los de arriba: lo que no se entiende NO se inventa,
// se cae al día por defecto. Si alguna vez se acepta «ayer», que sea a
// propósito y con su prueba, no por accidente de `new Date()`.
check(
  "lo que no se entiende cae al día por defecto",
  momentoDesde("el lunes pasado", AHORA).getTime() === AHORA.getTime() - 24 * HORA,
);

/* ===========================================================================
 * A dónde pregunta y qué contesta
 *
 * Sin base ni servidor: un cliente de mentira que apunta qué camino se le pidió
 * y devuelve lo que se le diga. Lo que se fija aquí son cuatro cosas que no
 * fallan cuando se rompen — la herramienta contesta igual de segura:
 *
 *   · Que sin decir dónde NO resuelva un espacio. Era el fallo de antes: la
 *     pregunta más frecuente («¿qué me he perdido?») era la que peor
 *     contestaba, porque se plantaba pidiendo elegir entre cinco espacios.
 *   · Que al cruzar varios sitios diga de cuál es cada renglón. Sin eso la
 *     lista es un montón de frases que no sitúan a nadie.
 *   · Que «no ha pasado nada» no se diga cuando hay un filtro puesto. Puede
 *     haber pasado mucho y no encajar, y quien lo lea cerrará la pregunta
 *     creyendo que el equipo estuvo parado.
 *   · Y la raya que la cabecera del módulo se compromete a no cruzar: que la
 *     respuesta NO lleve la hora de cada hecho. Es lo que separa esto de una
 *     herramienta de vigilancia, y hasta hoy no lo guardaba nada.
 * ======================================================================== */

console.log("\nA dónde pregunta");

const caminos: string[] = [];

/** Un cliente que solo apunta lo que se le pide y contesta lo que se le dijo. */
function clienteFalso(respuesta: unknown) {
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

const renglon = (extra: Record<string, unknown> = {}) => ({
  verbo: "movio",
  sujeto: "tarea",
  sujetoNombre: "Pasarela de pagos",
  detalle: { de: "Por hacer", a: "En curso" },
  procedencia: "persona" as const,
  cuando: "2026-09-11T23:47:13.000Z",
  actorNombre: "Ana",
  espacio: "Producto",
  organizacion: "Acme",
  ...extra,
});

{
  caminos.length = 0;
  const cliente = clienteFalso({ actividad: [renglon()], hayMas: false });
  await queHaPasado(cliente, {});

  const camino = caminos[0] ?? "";
  // Si esto llamara a /organizations/... querría decir que resolvió una
  // organización primero, y ahí es donde se plantaba a pedir que eligieras.
  check("sin decir dónde, pregunta por todo lo suyo", camino.startsWith("/me/actividad"));
  check("y no acota a ningún espacio", !camino.includes("workspaceId"));
  check("una sola petición, no una por espacio", caminos.length === 1);
}

{
  caminos.length = 0;
  const cliente = clienteFalso({ actividad: [], hayMas: false });
  await queHaPasado(cliente, { quien: "Carlos", verbo: "CERRO" });

  const camino = caminos[0] ?? "";
  check("el filtro por persona viaja", camino.includes("quien=Carlos"));
  // En la base los verbos se guardan en minúsculas y sin tilde. Quien pregunta
  // escribe como le sale, y un filtro que no encaja devuelve vacío — que se lee
  // como «no pasó nada», no como «escribiste distinto».
  check("y el verbo se manda en minúsculas", camino.includes("verbo=cerro"));
}

console.log("\nQué contesta");

{
  const cliente = clienteFalso({ actividad: [], hayMas: false });
  const texto = await queHaPasado(cliente, { quien: "Carlos" });
  check("con un filtro puesto, no dice «no ha pasado nada» a secas", texto.includes("Carlos"));
}

{
  const cliente = clienteFalso({
    actividad: [renglon(), renglon({ organizacion: "Bolt", espacio: "Interno" })],
    hayMas: false,
  });
  const texto = await queHaPasado(cliente, {});
  check("cruzando dos organizaciones, cada renglón dice de cuál es", texto.includes("Acme/Producto"));
  check("y la otra también", texto.includes("Bolt/Interno"));
}

{
  const cliente = clienteFalso({
    actividad: [renglon(), renglon({ sujetoNombre: "Otra" })],
    hayMas: false,
  });
  const texto = await queHaPasado(cliente, {});
  // Con una sola organización, repetir su nombre en cada línea es ruido.
  check("con una sola organización, no se repite su nombre en cada línea", !texto.includes("Acme/"));
  check("pero el espacio sí, que son varios", texto.includes("· Producto"));
}

{
  // LA RAYA. El hecho de arriba pasó a las 23:47, que es justo el dato que esta
  // herramienta se compromete a no dar: sirve para saber qué se hizo, no a qué
  // hora trabaja cada quien. Se comprueba con la hora dicha de las dos formas
  // en que podría escaparse.
  const cliente = clienteFalso({ actividad: [renglon()], hayMas: false });
  const texto = await queHaPasado(cliente, {});
  check("la respuesta no lleva la hora de cada hecho", !/23:47|11:47/.test(texto));
  check("ni el instante completo en ISO", !texto.includes("2026-09-11T"));
}

console.log(`\n${total - fallos} comprobaciones correctas, ${fallos} fallida${fallos === 1 ? "" : "s"}\n`);
if (fallos > 0) process.exit(1);
