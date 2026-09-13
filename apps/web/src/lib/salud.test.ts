import { type Salud, cuantasPidenAlgo, filasDe } from "./salud.js";

/**
 * Cómo se lee el estado de la instalación.
 *
 * LA QUE JUSTIFICA EL FICHERO ES LA DEL ORDEN. Esta pantalla solo sirve si lo
 * que está mal aparece arriba: si una instalación con el almacén caído lo
 * enseña en la séptima fila, debajo de «Spotify: sin configurar», nadie lo ve
 * — y una pantalla de diagnóstico que no se mira es peor que ninguna, porque
 * da la sensación de que el asunto está cubierto.
 *
 * Y DOS MÁS QUE SE LEEN BIEN ESTANDO MAL:
 *
 *   · **«Sin configurar» no es siempre un fallo.** Spotify sin poner es una
 *     instalación perfectamente sana; el correo sin poner es gente que no
 *     recupera su cuenta. Si las dos cuentan como problema, el titular dice
 *     «3 cosas que mirar» en una instalación impecable y se aprende a
 *     ignorarlo.
 *   · **Toda fila con gravedad «mal» dice qué pasa.** Un rojo sin
 *     consecuencia escrita deja a quien lo lee sabiendo que algo va mal y sin
 *     saber si puede irse a casa.
 *
 *   npm run test:salud --workspace apps/web
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

/** Una instalación sana: todo lo que importa puesto, lo opcional sin poner. */
const SANA: Salud = {
  entorno: { nodeEnv: "production", altas: "invite", verificaCorreo: true },
  migraciones: { aplicadas: 60, ultima: { nombre: "0060_x.sql", cuando: "2026-09-13" } },
  almacen: { responde: true },
  correo: { via: "smtp" },
  llamadas: { turn: "propio" },
  boveda: { conClaveDeEjemplo: false },
  entrar: { google: false },
  integraciones: { spotify: false, youtube: false },
};

console.log("\nUna instalación sana");

const sana = filasDe(SANA);
check("no pide nada", cuantasPidenAlgo(sana) === 0);
check(
  "lo opcional sin poner sale como «apagado», no como fallo",
  sana.filter((f) => f.gravedad === "apagado").length === 3,
);
check("ninguna fila en rojo", sana.every((f) => f.gravedad !== "mal"));
check(
  "lo que está bien no explica consecuencias",
  sana.filter((f) => f.gravedad === "bien").every((f) => !f.consecuencia),
);

console.log("\nLo que está mal, arriba");

const rota: Salud = {
  ...SANA,
  almacen: { responde: false },
  llamadas: { turn: "sin configurar" },
};
const filas = filasDe(rota);
check("la primera fila es la del almacén caído", filas[0]?.que === "Almacén de archivos");
check("el aviso del TURN va después del fallo", filas[1]?.que === "TURN para las llamadas");
check("pide dos cosas", cuantasPidenAlgo(filas) === 2);
check(
  "nada en rojo o ámbar por debajo de algo que está bien",
  filas.findIndex((f) => f.gravedad === "bien") >
    filas.map((f) => f.gravedad).lastIndexOf("atencion"),
);

console.log("\nLa bóveda con la clave de ejemplo");

const filtrada = filasDe({ ...SANA, boveda: { conClaveDeEjemplo: true } });
check("sale la primera", filtrada[0]?.que === "Bóveda de credenciales");
check("va en rojo", filtrada[0]?.gravedad === "mal");
check("dice que hay que cambiarla", /cambiarla/.test(filtrada[0]?.consecuencia ?? ""));

console.log("\nEl correo sin configurar es un fallo, no un apagado");

const sinCorreo = filasDe({ ...SANA, correo: { via: "sin configurar" } });
const correo = sinCorreo.find((f) => f.que === "Correo saliente");
check("va en rojo", correo?.gravedad === "mal");
check("dice lo del código corto como salida", /código corto/.test(correo?.consecuencia ?? ""));

console.log("\nLo que siempre tiene que cumplirse");

/** Todas las combinaciones de los cuatro interruptores que cambian gravedad. */
const CASOS: Salud[] = [];
for (const responde of [true, false])
  for (const via of ["smtp", "sin configurar"] as const)
    for (const turn of ["propio", "sin configurar"] as const)
      for (const conClaveDeEjemplo of [true, false])
        CASOS.push({
          ...SANA,
          almacen: { responde },
          correo: { via },
          llamadas: { turn },
          boveda: { conClaveDeEjemplo },
        });

check(
  "toda fila en rojo dice qué pasa si se deja así",
  CASOS.every((caso) =>
    filasDe(caso)
      .filter((f) => f.gravedad === "mal")
      .every((f) => (f.consecuencia ?? "").length > 20),
  ),
);
check(
  "toda fila en ámbar dice qué pasa si se deja así",
  CASOS.every((caso) =>
    filasDe(caso)
      .filter((f) => f.gravedad === "atencion")
      .every((f) => (f.consecuencia ?? "").length > 20),
  ),
);
check(
  "el orden nunca se rompe",
  CASOS.every((caso) => {
    const peso = { mal: 0, atencion: 1, bien: 2, apagado: 3 } as const;
    const pesos = filasDe(caso).map((f) => peso[f.gravedad]);
    return pesos.every((p, i) => i === 0 || pesos[i - 1]! <= p);
  }),
);
check(
  "no hay dos filas con el mismo nombre",
  CASOS.every((caso) => new Set(filasDe(caso).map((f) => f.que)).size === filasDe(caso).length),
);
check(
  "ninguna fila se queda sin estado escrito",
  CASOS.every((caso) => filasDe(caso).every((f) => f.estado.trim().length > 0)),
);

console.log(`\n${total - fallos}/${total} comprobaciones`);
if (fallos > 0) process.exit(1);
