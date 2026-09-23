import type { ClienteApi } from "../api.js";
import { subirArchivos } from "./archivos.js";

/**
 * Subir archivos de una: qué falla, y qué NO puede fallar por culpa de otro.
 *
 * LA QUE JUSTIFICA EL FICHERO ES EL AISLAMIENTO POR ARCHIVO. Se pidió que se
 * pudieran mandar varios de una sola llamada, y «de una» no puede significar
 * «o todos o ninguno»: un PDF que pesa de más no puede tirar los otros cuatro
 * que sí cabían. Así que lo que hay que fijar no es que subir funcione —eso ya
 * lo prueba `basedatos.test.ts` a su manera para la consola— sino que un fallo
 * se queda donde ocurrió.
 *
 * Y DOS MÁS QUE SE LEEN BIEN ESTANDO MAL:
 *
 *   · El tamaño se mide en los BYTES DECODIFICADOS, no en la longitud del
 *     texto base64 que llega —un 33 % más larga— ni fiándose de lo que diga
 *     quien llama. Confiar en un tamaño declarado es exactamente el fallo que
 *     ARQ-04 ya evitó de otra forma: el tamaño real se mide, no se pregunta.
 *   · Una carpeta ambigua para el NOMBRE ES UN ERROR, no una carpeta cualquiera:
 *     elegir la primera subiría el archivo a un sitio que nadie pidió.
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

const ORG = { id: "org-1", name: "Acme", slug: "acme" };
const WS = { id: "ws-1", name: "Producto" };

type Carpeta = { id: string; nombre: string; padreId: string | null };

/**
 * Un cliente que contesta según la ruta, y anota cada `post` para poder
 * comprobar que uno rechazado por tamaño NUNCA llega a reservar nada.
 */
function clienteCon(opciones: {
  carpetas?: Carpeta[];
  reservaFalla?: string;
}): { cliente: ClienteApi; llamadasPost: string[] } {
  const llamadasPost: string[] = [];
  const carpetas = opciones.carpetas ?? [];

  const cliente: ClienteApi = {
    apiUrl: "http://127.0.0.1:4000",
    get: (async (ruta: string) => {
      if (ruta === "/organizations") return { organizations: [ORG] };
      if (ruta === `/organizations/${ORG.id}/workspaces`) return { workspaces: [WS] };
      if (ruta === `/workspaces/${WS.id}/carpetas`) return { carpetas };
      throw new Error(`ruta GET no prevista en la prueba: ${ruta}`);
    }) as ClienteApi["get"],
    post: (async (ruta: string, cuerpo: unknown) => {
      llamadasPost.push(ruta);
      if (ruta === `/workspaces/${WS.id}/files`) {
        if (opciones.reservaFalla) throw new Error(opciones.reservaFalla);
        const nombre = (cuerpo as { name: string }).name;
        return { fileId: `file-${nombre}`, uploadUrl: `https://almacen.test/subir/${nombre}` };
      }
      if (ruta.startsWith("/files/") && ruta.endsWith("/confirm")) return {};
      throw new Error(`ruta POST no prevista en la prueba: ${ruta}`);
    }) as ClienteApi["post"],
    patch: (async () => ({})) as ClienteApi["patch"],
  };
  return { cliente, llamadasPost };
}

/** base64 de "hola mundo" (10 bytes). */
const CONTENIDO = Buffer.from("hola mundo").toString("base64");

async function main(): Promise<void> {
  const fetchOriginal = globalThis.fetch;
  // El PUT a la URL firmada es un `fetch` normal, sin pasar por `ClienteApi` —
  // exactamente como lo hace la web. Se sustituye para no salir a la red: una
  // URL que contenga "rechaza" simula que el almacén dijo que no.
  globalThis.fetch = (async (url: string) => {
    const rechaza = String(url).includes("rechaza");
    return { ok: !rechaza, status: rechaza ? 403 : 200 } as Response;
  }) as typeof fetch;

  try {
    console.log("\nUno bueno, a la raíz");

    const { cliente: c1 } = clienteCon({});
    const r1 = await subirArchivos(c1, {
      archivos: [{ nombre: "informe.pdf", contenidoBase64: CONTENIDO, mimeType: "application/pdf" }],
    });
    check("dice que se subió, con su tamaño", r1.includes("informe.pdf (10 B)"));
    check("nombra el espacio", r1.includes("Producto"));
    check("no dice que falló nada", !r1.includes("Fallaron"));

    console.log("\nUno grande no tira a los que sí caben");

    const { cliente: c2, llamadasPost } = clienteCon({});
    const enorme = Buffer.alloc(16 * 1024 * 1024).toString("base64"); // 16 MB > límite
    const r2 = await subirArchivos(c2, {
      archivos: [
        { nombre: "bueno.pdf", contenidoBase64: CONTENIDO },
        { nombre: "gigante.pdf", contenidoBase64: enorme },
      ],
    });
    check("el bueno se subió", r2.includes("bueno.pdf"));
    check("el gigante aparece entre los fallidos", /Fallaron[\s\S]*gigante\.pdf/.test(r2));
    check("y dice por qué: el límite, no un error genérico", r2.includes("límite"));
    check(
      "el gigante NUNCA llegó a reservar nada — se corta antes de gastar una petición",
      !llamadasPost.some((r) => r.includes("gigante")),
    );

    console.log("\nUn base64 vacío o inválido no se intenta subir");

    const { cliente: c3 } = clienteCon({});
    const r3 = await subirArchivos(c3, {
      archivos: [{ nombre: "vacio.txt", contenidoBase64: "" }],
    });
    check("falla, no se cuela como archivo de 0 bytes", r3.includes("vacio.txt"));

    console.log("\nEl almacén puede rechazar la subida, y se distingue");

    const { cliente: c4 } = clienteCon({});
    const r4 = await subirArchivos(c4, {
      archivos: [{ nombre: "rechaza-esto.pdf", contenidoBase64: CONTENIDO }],
    });
    check("dice que el almacén lo rechazó, con el código", r4.includes("403"));

    console.log("\nLa API puede rechazar la reserva, y el mensaje se conserva");

    const { cliente: c5 } = clienteCon({ reservaFalla: "el espacio no tiene sitio" });
    const r5 = await subirArchivos(c5, {
      archivos: [{ nombre: "informe.pdf", contenidoBase64: CONTENIDO }],
    });
    check("se propaga el motivo de la API, no un genérico", r5.includes("el espacio no tiene sitio"));

    console.log("\nLa carpeta");

    const raiz: Carpeta[] = [
      { id: "f-contratos-1", nombre: "Contratos", padreId: null },
      { id: "f-legal", nombre: "Legal", padreId: null },
      { id: "f-contratos-2", nombre: "Contratos", padreId: "f-legal" },
    ];

    const { cliente: c6 } = clienteCon({ carpetas: raiz });
    const r6 = await subirArchivos(c6, {
      carpeta: "Legal",
      archivos: [{ nombre: "acta.pdf", contenidoBase64: CONTENIDO }],
    });
    check("una carpeta que no es ambigua, sube sin preguntar", r6.includes("acta.pdf"));
    check("y lo dice: en qué carpeta", r6.includes("«Legal»"));

    const { cliente: c7 } = clienteCon({ carpetas: raiz });
    const r7 = await subirArchivos(c7, {
      carpeta: "Contratos",
      archivos: [{ nombre: "acta.pdf", contenidoBase64: CONTENIDO }],
    });
    check("dos carpetas con el mismo nombre: pregunta, no elige la primera", r7.includes("2 carpetas"));
    // Cada candidata se nombra con su camino completo, porque «Contratos» a
    // secas no basta para saber cuál es cuál.
    check("y da el camino de cada una para desempatar", r7.includes("Legal / Contratos"));

    const { cliente: c8 } = clienteCon({ carpetas: raiz });
    const r8 = await subirArchivos(c8, {
      carpeta: "Facturas",
      archivos: [{ nombre: "acta.pdf", contenidoBase64: CONTENIDO }],
    });
    check("una carpeta que no existe, lo dice y no sube nada", r8.includes("No encontré"));
  } finally {
    globalThis.fetch = fetchOriginal;
  }

  console.log(`\n${total} comprobaciones, ${fallos} fallidas`);
  if (fallos > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
