import {
  archivosQueImportan,
  dependenciasDe,
  leerCompose,
  leerRepositorio,
  servicioDeLaRuta,
  serviciosPorCarpeta,
  tipoDeImagen,
} from "./repositorio.js";

/**
 * Pruebas del lector de repositorios sin Terraform.
 *
 * LO QUE MÁS IMPORTA AQUÍ, igual que en el de Terraform, ES LO QUE **NO** DEBE
 * DEDUCIR. Este lector adivina más que aquel —una dependencia declarada no es
 * una arquitectura—, así que la línea entre «lo dice el repositorio» y «me lo
 * estoy inventando» es justo lo que hay que fijar: una flecha hacia una caja
 * que no se dibujó, una dependencia de desarrollo tomada por infraestructura o
 * un `depends_on` que apunta a un servicio inexistente convierten el diagrama
 * en algo que no se puede creer.
 *
 *   npm run test:repositorio
 */

let fallos = 0;
let total = 0;

function check(nombre: string, condicion: boolean, detalle?: string): void {
  total++;
  if (condicion) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos++;
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

console.log("\nDe qué tipo es cada imagen de contenedor");

check("postgres es una base de datos", tipoDeImagen("postgres:17-alpine") === "base_datos");
check("minio es almacenamiento", tipoDeImagen("minio/minio:latest") === "almacenamiento");
check("redis es caché", tipoDeImagen("redis:7") === "cache");
check("rabbitmq es una cola", tipoDeImagen("rabbitmq:3-management") === "cola");
check("lo que no se reconoce es un servicio, que no es un fallo", tipoDeImagen("nginx:alpine") === "servicio");

console.log("\nLeer un docker-compose");

{
  const { componentes, conexiones } = leerCompose(`
services:
  api:
    build: .
    depends_on:
      - postgres
      - redis
  postgres:
    image: postgres:17-alpine
  redis:
    image: redis:7
`);
  check("encuentra los tres servicios", componentes.length === 3);
  check(
    "y les pone tipo por su imagen",
    componentes.find((c) => c.nombre === "postgres")?.tipo === "base_datos" &&
      componentes.find((c) => c.nombre === "redis")?.tipo === "cache",
  );
  check(
    "las flechas salen de depends_on",
    conexiones.some((c) => c.de === "api" && c.a === "postgres") &&
      conexiones.some((c) => c.de === "api" && c.a === "redis"),
  );
  check("el que se construye aquí se marca como servicio", componentes.find((c) => c.nombre === "api")?.tipo === "servicio");
}

{
  // `depends_on` con condiciones es un mapa, no una lista. Un apaño a base de
  // expresiones regulares acierta con una forma y falla con la otra.
  const { conexiones } = leerCompose(`
services:
  api:
    image: mi/api
    depends_on:
      postgres:
        condition: service_healthy
  postgres:
    image: postgres:16
`);
  check("depends_on en forma de mapa se lee igual", conexiones.some((c) => c.de === "api" && c.a === "postgres"));
}

{
  const { componentes } = leerCompose("esto: no es\n  un compose: [");
  check("un YAML roto no revienta, se queda sin fuente", componentes.length === 0);
}
{
  const { componentes } = leerCompose("version: '3'\n");
  check("un compose sin servicios tampoco", componentes.length === 0);
}

console.log("\nQué dependencias declara cada manifiesto");

check(
  "de un package.json, solo las de producción",
  (() => {
    const deps = dependenciasDe("apps/api/package.json", JSON.stringify({
      dependencies: { pg: "^8", stripe: "^14" },
      devDependencies: { typescript: "^5", vitest: "^1" },
    }));
    return deps.includes("pg") && deps.includes("stripe") && !deps.includes("vitest");
  })(),
);

check(
  "de un requirements.txt, con sus versiones y extras quitados",
  (() => {
    const deps = dependenciasDe("requirements.txt", "# comentario\npsycopg2-binary==2.9.9\nredis[hiredis]>=5\nboto3\n\n");
    return deps.join(",") === "psycopg2-binary,redis,boto3";
  })(),
);

check(
  "de un go.mod",
  dependenciasDe("go.mod", "module x\n\nrequire (\n\tgithub.com/lib/pq v1.10.9\n)\n").includes("github.com/lib/pq"),
);

check("un package.json ilegible da cero y no revienta", dependenciasDe("package.json", "{roto").length === 0);

console.log("\nDe quién es cada manifiesto");

check("el de apps/api es del servicio «api»", servicioDeLaRuta("apps/api/package.json") === "api");
check("el de la raíz no es de nadie", servicioDeLaRuta("package.json") === null);

console.log("\nQué carpetas se despliegan solas");

{
  const s = serviciosPorCarpeta([
    "apps/api/src/index.ts",
    "apps/web/next.config.js",
    "services/pagos/main.go",
    "cobros/Dockerfile",
    "README.md",
    "src/lib/cosa.ts",
  ]);
  check("las de apps, services y las que tienen Dockerfile", s.join(",") === "api,cobros,pagos,web");
  check("y una carpeta cualquiera no cuenta", !s.includes("lib") && !s.includes("src"));
}

console.log("\nTodo junto, que es como se usa");

{
  const rutas = [
    "docker-compose.yml",
    "package.json",
    "apps/api/package.json",
    "apps/api/src/server.ts",
    "apps/web/package.json",
  ];
  const { componentes, conexiones, fuentes } = leerRepositorio(rutas, [
    {
      ruta: "docker-compose.yml",
      contenido: "services:\n  postgres:\n    image: postgres:17\n",
    },
    {
      ruta: "apps/api/package.json",
      contenido: JSON.stringify({ dependencies: { pg: "^8", stripe: "^14", express: "^4" } }),
    },
  ]);

  const nombres = componentes.map((c) => c.nombre);
  check("junta las tres fuentes", fuentes.includes("compose") && fuentes.includes("carpetas") && fuentes.includes("dependencias"));
  check("el servicio sale de la carpeta", nombres.includes("api") && nombres.includes("web"));
  check("la base de datos, del compose", componentes.find((c) => c.nombre === "postgres")?.tipo === "base_datos");
  check("y lo de fuera, de las dependencias", nombres.includes("Stripe"));
  check(
    "la flecha va del servicio dueño del manifiesto a lo que usa",
    conexiones.some((c) => c.de === "api" && c.a === "Stripe"),
  );
  check(
    "una dependencia que no es infraestructura no pinta caja",
    !nombres.includes("express"),
  );
}

console.log("\nLo que NO debe deducir");

{
  // Un `depends_on` puede nombrar un servicio que no está declarado —porque
  // vive en otro compose—. Dibujar la flecha dejaría una punta en el vacío.
  const { conexiones } = leerRepositorio(
    [],
    [{ ruta: "compose.yml", contenido: "services:\n  api:\n    image: x\n    depends_on: [fantasma]\n" }],
  );
  check("una flecha hacia algo que no se dibujó se descarta", conexiones.length === 0);
}

{
  // El manifiesto de la RAÍZ no es de ningún servicio: su Postgres se dibuja,
  // pero sin inventarle un origen.
  const { componentes, conexiones } = leerRepositorio(
    ["package.json"],
    [{ ruta: "package.json", contenido: JSON.stringify({ dependencies: { pg: "^8" } }) }],
  );
  check("la caja del manifiesto de la raíz se dibuja", componentes.some((c) => c.nombre === "Postgres"));
  check("pero sin flecha inventada", conexiones.length === 0);
}

{
  // La misma base de datos vista por el compose y por las dependencias es UNA
  // caja, no dos.
  const { componentes } = leerRepositorio(
    ["apps/api/package.json"],
    [
      { ruta: "docker-compose.yml", contenido: "services:\n  postgres:\n    image: postgres:17\n" },
      { ruta: "apps/api/package.json", contenido: JSON.stringify({ dependencies: { postgres: "^3" } }) },
    ],
  );
  check(
    "la misma caja vista por dos fuentes no se duplica",
    componentes.filter((c) => c.nombre.toLowerCase() === "postgres").length === 1,
  );
}

{
  const vacio = leerRepositorio([], []);
  check("un repositorio del que no se pudo leer nada da un resultado vacío y sin fuentes",
    vacio.componentes.length === 0 && vacio.fuentes.length === 0);
}

console.log("\nQué archivos se piden, y en qué orden");

{
  const orden = archivosQueImportan([
    "apps/api/package.json",
    "docker-compose.yml",
    "README.md",
    "package.json",
    "src/index.ts",
  ]);
  check("el compose va primero, que es el que más dice", orden[0] === "docker-compose.yml");
  check("y el manifiesto de la raíz antes que el de dentro", orden[1] === "package.json" && orden[2] === "apps/api/package.json");
  check("lo que no es ni una cosa ni otra no se pide", !orden.includes("README.md") && !orden.includes("src/index.ts"));
}

console.log(
  `\n${total - fallos} comprobaciones correctas, ${fallos} fallida${fallos === 1 ? "" : "s"}\n`,
);
if (fallos > 0) process.exit(1);
