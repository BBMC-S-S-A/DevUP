/**
 * Prueba del reintento tras refrescar la sesión.
 *
 * EL FALLO QUE FIJA ESTO SE VEÍA COMO «LA APP ME DESLOGUEA SOLA». El token de
 * acceso dura quince minutos; el de refresco, treinta días. Al volver a la
 * pestaña al rato, la primera petición da 401 y el cliente tiene que refrescar
 * y reintentar — eso ya lo hacía. Lo que no hacía era reintentar cuando la
 * ruta empezaba por `/auth/`, y justo ahí viven las dos que más importan:
 * `/auth/me`, que es la que arranca la sesión al cargar la página, y
 * `/auth/ws-ticket`, que es el billete del WebSocket.
 *
 * Así que abrir DevUP después de quince minutos te enseñaba la pantalla de
 * entrar teniendo una sesión perfectamente viva, y los avisos en vivo se
 * paraban sin decir nada. En los registros de producción se ve como
 * `GET /auth/me -> 401` sin ningún `/auth/refresh` detrás, mientras que un 401
 * de cualquier otra ruta sí lo lleva.
 *
 * SE PRUEBA CONTRA UN `fetch` DE MENTIRA, no contra el servidor: lo que hay
 * que fijar es la DECISIÓN del cliente —cuándo refresca y cuándo se rinde—, y
 * eso se lee en la secuencia de llamadas. Cada comprobación mira esa lista.
 *
 *   npm run test:api
 */
import { API_URL, ApiError, api, sinReintento } from "./api.js";

let total = 0;
const fallos: string[] = [];

function check(nombre: string, condicion: boolean): void {
  total += 1;
  if (condicion) console.log(`  ✓ ${nombre}`);
  else {
    fallos.push(nombre);
    console.log(`  ✗ ${nombre}`);
  }
}

type Guion = { estado: number; cuerpo?: unknown };

/**
 * Sustituye `fetch` por uno que sigue un guion y apunta por dónde le llaman.
 * Devuelve la lista de rutas pedidas, en orden.
 */
function fingirFetch(guion: (ruta: string, vez: number) => Guion): string[] {
  const llamadas: string[] = [];
  const vistas = new Map<string, number>();

  globalThis.fetch = (async (entrada: string | URL | Request) => {
    const url = typeof entrada === "string" ? entrada : entrada.toString();
    const ruta = url.startsWith(API_URL) ? url.slice(API_URL.length) : url;
    llamadas.push(ruta);
    const vez = (vistas.get(ruta) ?? 0) + 1;
    vistas.set(ruta, vez);

    const { estado, cuerpo } = guion(ruta, vez);
    return {
      ok: estado >= 200 && estado < 300,
      status: estado,
      json: async () => cuerpo ?? {},
    } as Response;
  }) as typeof fetch;

  return llamadas;
}

async function main(): Promise<void> {
  console.log("\nQué rutas no se reintentan");
  check("refrescar no se reintenta a sí mismo", sinReintento("/auth/refresh"));
  check("entrar con la contraseña mal tampoco", sinReintento("/auth/login"));
  check("pero /auth/me SÍ se reintenta", !sinReintento("/auth/me"));
  check("y el billete del WebSocket también", !sinReintento("/auth/ws-ticket"));
  check("la lista de sesiones también", !sinReintento("/auth/sessions"));
  check("una ruta cualquiera, por supuesto", !sinReintento("/workspaces/x/unread"));
  check(
    "los parámetros no despistan a la comparación",
    sinReintento("/auth/refresh?x=1") && !sinReintento("/auth/me?y=2"),
  );

  console.log("\nVolver tras quince minutos no te echa");

  let llamadas = fingirFetch((ruta, vez) => {
    if (ruta === "/auth/refresh") return { estado: 200 };
    // La primera vez el token de acceso está caducado; tras refrescar, vale.
    if (ruta === "/auth/me") {
      return vez === 1 ? { estado: 401 } : { estado: 200, cuerpo: { user: { id: "u1" } } };
    }
    return { estado: 500 };
  });

  // Con el fallo puesto esto LANZA en vez de devolver, así que se atrapa: una
  // prueba que revienta deja sin correr a las de abajo y el informe no dice
  // cuál era el problema.
  const yo = await api.get<{ user: { id: string } }>("/auth/me").catch(() => null);
  check("/auth/me caducado acaba devolviendo el usuario", yo?.user.id === "u1");
  check(
    "y lo hace refrescando en medio, no rindiéndose",
    llamadas.join(" ") === "/auth/me /auth/refresh /auth/me",
  );

  console.log("\nEl billete del WebSocket se renueva igual");

  llamadas = fingirFetch((ruta, vez) => {
    if (ruta === "/auth/refresh") return { estado: 200 };
    if (ruta === "/auth/ws-ticket") {
      return vez === 1 ? { estado: 401 } : { estado: 200, cuerpo: { ticket: "t" } };
    }
    return { estado: 500 };
  });

  const billete = await api.get<{ ticket: string }>("/auth/ws-ticket").catch(() => null);
  check("se consigue billete a la segunda", billete?.ticket === "t");
  check(
    "tras un refresco, no tras rendirse",
    llamadas.join(" ") === "/auth/ws-ticket /auth/refresh /auth/ws-ticket",
  );

  console.log("\nCuando la sesión se acabó de verdad, se acabó");

  llamadas = fingirFetch((ruta) => {
    if (ruta === "/auth/refresh") return { estado: 401 };
    return { estado: 401, cuerpo: { message: "no autorizado" } };
  });

  let fallo: unknown = null;
  try {
    await api.get("/auth/me");
  } catch (error) {
    fallo = error;
  }
  check("se propaga el 401", fallo instanceof ApiError && fallo.status === 401);
  check(
    "se intenta refrescar UNA vez y no se gira en bucle",
    llamadas.join(" ") === "/auth/me /auth/refresh",
  );

  console.log("\nRefrescar no se llama a sí mismo");

  llamadas = fingirFetch(() => ({ estado: 401, cuerpo: { message: "no" } }));
  try {
    await api.post("/auth/refresh");
  } catch {
    // Da igual cómo falle: lo que se comprueba es que no se reintentó.
  }
  check("un 401 al refrescar no dispara otro refresco", llamadas.length === 1);

  console.log(`\n${total - fallos.length} comprobaciones correctas, ${fallos.length} fallidas`);
  if (fallos.length > 0) {
    console.error("\nFallaron:\n" + fallos.map((f) => `  · ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
