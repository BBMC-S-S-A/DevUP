/**
 * Las primeras pruebas de `apps/web`.
 *
 * POR QUÉ ESTAS Y NO OTRAS. La web no tenía ni una, y eso no es solo una
 * carencia: es lo que bloquea partir `ventas`, que lleva un mes marcada para
 * dividirse y en ese mes creció. Mover código sin red se hace a ciegas.
 *
 * Empezar por la navegación no es arbitrario. Es la lógica que estaba
 * DUPLICADA —la misma regla escrita dos veces, y ya distinta entre las dos
 * copias— y es la que falla de la peor manera posible: aterrizar en el sitio
 * equivocado no se parece a un error, así que nadie lo reporta como tal. Un
 * fallo que no parece un fallo es justo para lo que sirve una prueba.
 *
 * Sin marco de pruebas, igual que el resto del repositorio: `tsx` y un
 * contador. Lo que se gana con un marco aquí es menos que lo que se pierde
 * metiendo una dependencia nueva en una decisión que todavía está abierta
 * —Playwright lleva meses pendiente— y este archivo no necesita nada de él.
 *
 *   npm run test:web
 */
import { destinoDeResultado, enlaceDentroDelEspacio, type Destinable } from "./enlaces.js";

let total = 0;
let fallos = 0;

function check(nombre: string, real: string, esperado: string): void {
  total += 1;
  if (real === esperado) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  ✗ ${nombre}`);
    console.log(`      esperaba  ${esperado}`);
    console.log(`      y llegó   ${real}`);
  }
}

const ORG = "org-aqui";
const OTRA = "org-de-al-lado";
const ESPACIO = "espacio-aqui";

function resultado(parcial: Partial<Destinable> & { entity: Destinable["entity"] }): Destinable {
  return {
    organizationId: ORG,
    workspaceId: null,
    channelId: null,
    ...parcial,
  };
}

console.log("\nA dónde lleva un resultado de búsqueda");

check(
  "un mensaje abre su canal",
  destinoDeResultado(
    resultado({ entity: "message", workspaceId: "w1", channelId: "c1" }),
    { orgId: ORG },
  ),
  "/app/w/w1/c/c1",
);

check(
  "un archivo abre la biblioteca, no la raíz del espacio",
  destinoDeResultado(resultado({ entity: "file", workspaceId: "w1" }), { orgId: ORG }),
  "/app/w/w1/archivos",
);

check(
  "una tarea abre el tablero",
  destinoDeResultado(resultado({ entity: "task", workspaceId: "w1" }), { orgId: ORG }),
  "/app/w/w1/board",
);

// El caso que se rompió al cruzar organizaciones, y el motivo de este archivo.
check(
  "un cliente de ESTA organización se abre sin salir del espacio",
  destinoDeResultado(resultado({ entity: "client" }), { orgId: ORG, workspaceId: ESPACIO }),
  `/app/w/${ESPACIO}/ventas`,
);

check(
  "un cliente de OTRA organización sale del espacio, o enseñaría el embudo equivocado",
  destinoDeResultado(resultado({ entity: "client", organizationId: OTRA }), {
    orgId: ORG,
    workspaceId: ESPACIO,
  }),
  `/app/o/${OTRA}/ventas`,
);

check(
  "sin espacio desde el que mirar, se abre en el armazón de la organización",
  destinoDeResultado(resultado({ entity: "opportunity" }), { orgId: ORG }),
  `/app/o/${ORG}/ventas`,
);

check(
  "un mensaje sin canal no inventa una ruta rota",
  destinoDeResultado(resultado({ entity: "message", workspaceId: "w1" }), { orgId: ORG }),
  "/app",
);

console.log("\nUna notificación no te saca del espacio de trabajo");

check(
  "Noticias se traduce a la ruta del espacio",
  enlaceDentroDelEspacio(`/app/o/${ORG}/noticias`, ESPACIO),
  `/app/w/${ESPACIO}/noticias`,
);

check(
  "y conserva lo que venga detrás",
  enlaceDentroDelEspacio(`/app/o/${ORG}/ventas/algo`, ESPACIO),
  `/app/w/${ESPACIO}/ventas/algo`,
);

check(
  "fuera de un espacio se queda como está",
  enlaceDentroDelEspacio(`/app/o/${ORG}/noticias`, null),
  `/app/o/${ORG}/noticias`,
);

check(
  "una herramienta que ya no vive bajo la organización no se traduce",
  enlaceDentroDelEspacio(`/app/o/${ORG}/github`, ESPACIO),
  `/app/o/${ORG}/github`,
);

check(
  "una ruta que ya es del espacio no se toca",
  enlaceDentroDelEspacio(`/app/w/otro/noticias`, ESPACIO),
  `/app/w/otro/noticias`,
);

check(
  "y una que no es de la aplicación, tampoco",
  enlaceDentroDelEspacio("/login", ESPACIO),
  "/login",
);

console.log(
  `\n${total} comprobaciones, ${fallos} fallida${fallos === 1 ? "" : "s"}`,
);
process.exit(fallos === 0 ? 0 : 1);
