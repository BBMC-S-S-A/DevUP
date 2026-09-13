import {
  elegirDe,
  guardarDispositivo,
  leerDispositivo,
  nombreDe,
  olvidarDispositivo,
  restriccionPara,
  type Dispositivo,
} from "./dispositivos.js";

/**
 * Cómo se recuerda el micrófono y la cámara.
 *
 * LA QUE JUSTIFICA EL FICHERO ES LA DEL USB. Los cascos que se desenchufan y se
 * vuelven a enchufar llegan con OTRO `deviceId`: si solo se guardara el
 * identificador, cada reconexión se leería como un dispositivo nuevo y la
 * elección se perdería justo cuando más se nota — al volver a la mesa y entrar
 * a una llamada. Por eso se guarda también la etiqueta y se busca por ella.
 *
 * Y ESTAS OTRAS, QUE SE LEEN BIEN ESTANDO MAL:
 *
 *   · **Un dispositivo que ya no está no puede devolverse.** Preferirlo es peor
 *     que no recordar ninguno: el navegador falla con `OverconstrainedError` en
 *     vez de coger el que haya, y quien lo sufre se queda sin micrófono sin
 *     entender por qué.
 *   · **Sin recuerdo NO se coge el primero.** El primero de la lista es
 *     arbitrario, y forzarlo acaba eligiendo el micrófono de la webcam que
 *     nadie quería. «Nada» significa «que decida el sistema».
 *   · **Las etiquetas vacías no emparejan.** El navegador las oculta hasta que
 *     se concede permiso, y entonces TODAS son «»: compararlas emparejaría
 *     dispositivos al azar.
 *   · **La restricción va con `ideal`, no con `exact`.** Con `exact`, un
 *     dispositivo ausente tira la llamada entera.
 *   · **Un `localStorage` roto no puede reventar.** Lo que hay ahí lo pudo
 *     escribir otra versión de esto.
 *
 *   npm run test:dispositivos --workspace apps/web
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

/** `localStorage` de mentira: esto corre en Node, no en un navegador. */
const almacen = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => almacen.get(k) ?? null,
  setItem: (k: string, v: string) => void almacen.set(k, v),
  removeItem: (k: string) => void almacen.delete(k),
};

const cascos: Dispositivo = { deviceId: "abc123", label: "Jabra Evolve 65" };
const interno: Dispositivo = { deviceId: "default", label: "Micrófono del portátil" };
const webcam: Dispositivo = { deviceId: "cam1", label: "Webcam HD" };

console.log("\nRecordar y volver a encontrar");

check("sin haber elegido nada, no hay nada recordado", leerDispositivo("microfono") === null);
check(
  "y no se coge el primero de la lista",
  elegirDe("microfono", [interno, cascos]) === null,
);

guardarDispositivo("microfono", cascos);
check(
  "lo elegido se encuentra por su identificador",
  elegirDe("microfono", [interno, cascos])?.deviceId === "abc123",
);

// LA DE VERDAD: mismos cascos, otro identificador.
check(
  "y también después de desenchufarlos y volver a enchufarlos",
  elegirDe("microfono", [interno, { deviceId: "otro-id", label: "Jabra Evolve 65" }])?.deviceId ===
    "otro-id",
);

check(
  "si ya no están, no se devuelve nada en vez de forzarlos",
  elegirDe("microfono", [interno]) === null,
);

console.log("\nLas dos clases no se pisan");

guardarDispositivo("camara", webcam);
check("la cámara se guarda aparte", elegirDe("camara", [webcam])?.deviceId === "cam1");
check("y el micrófono sigue siendo el suyo", elegirDe("microfono", [cascos])?.deviceId === "abc123");
olvidarDispositivo("camara");
check("olvidar una no toca la otra", elegirDe("camara", [webcam]) === null);
check("el micrófono sigue ahí", elegirDe("microfono", [cascos])?.deviceId === "abc123");

console.log("\nLas etiquetas en blanco, que es como llega todo sin permiso");

almacen.clear();
guardarDispositivo("microfono", { deviceId: "se-fue", label: "   " });
check(
  "una etiqueta vacía no empareja con otra vacía",
  elegirDe("microfono", [{ deviceId: "cualquiera", label: "" }]) === null,
);

console.log("\nLo que se le pide al navegador");

check(
  "sin elegido, solo el tratamiento de audio",
  restriccionPara("microfono", null).deviceId === undefined,
);
check(
  "y ese tratamiento se mantiene al elegir uno",
  restriccionPara("microfono", cascos).echoCancellation === true,
);
// `ideal` y no `exact`: con `exact`, unos cascos desenchufados entre comprobar
// y pedir tiran la llamada entera.
const conCascos = restriccionPara("microfono", cascos).deviceId as { ideal?: string } | undefined;
check("el dispositivo va como «ideal», no como «exact»", conCascos?.ideal === "abc123");
check(
  "la cámara no arrastra el tratamiento de audio",
  restriccionPara("camara", webcam).echoCancellation === undefined,
);

console.log("\nY lo que se lee en pantalla");

check("un dispositivo con nombre se llama por su nombre", nombreDe(cascos, "microfono") === "Jabra Evolve 65");
check("uno sin nombre no sale en blanco", nombreDe({ deviceId: "x", label: "" }, "microfono").length > 0);
check(
  "y dice de qué clase es",
  nombreDe({ deviceId: "x", label: "" }, "camara").toLowerCase().includes("cámara"),
);

console.log("\nY nada de esto puede reventar");

almacen.set("devup:microfono", "{esto no es json");
check("un valor corrupto se ignora", leerDispositivo("microfono") === null);
almacen.set("devup:microfono", JSON.stringify({ id: 7 }));
check("y uno con la forma equivocada, también", leerDispositivo("microfono") === null);

console.log(`\n${total - fallos} de ${total} comprobaciones`);
if (fallos > 0) process.exit(1);
