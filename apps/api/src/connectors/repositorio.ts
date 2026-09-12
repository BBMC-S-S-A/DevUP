import { parse as parseYaml } from "yaml";
import type { Componente, Conexion, Lectura, TipoDeNodo } from "./terraform.js";

/**
 * Deduce la arquitectura de un repositorio que NO tiene Terraform.
 *
 * POR QUÉ HACE FALTA ESTO. El lector de Terraform solo sirve si alguien
 * escribió su infraestructura en `.tf`, y eso es la excepción: el propio DevUP
 * no tiene ni uno. Un botón que contesta «no encontré ningún archivo .tf» es un
 * callejón sin salida — la arquitectura del proyecto SÍ está en el repositorio,
 * lo que pasa es que no está declarada en un sitio, está repartida por el
 * código. Esto la junta.
 *
 * TRES FUENTES, DE MÁS A MENOS FIABLE. El orden importa porque lo que dice la
 * primera manda sobre lo que sugiere la tercera:
 *
 *  1. **`docker-compose`**, que es lo más parecido a un Terraform que tiene un
 *     proyecto normal: dice qué servicios hay, con qué imagen, y —en
 *     `depends_on`— quién necesita a quién. Es la única fuente que da flechas
 *     de verdad y no deducidas.
 *  2. **Los manifiestos de dependencias** (`package.json`, `requirements.txt`,
 *     `go.mod`…). Que un servicio dependa de `pg` significa que habla con
 *     Postgres; que dependa de `stripe`, que llama a Stripe. No es una
 *     suposición: es una declaración, solo que escrita para otra cosa.
 *  3. **La forma de las carpetas**: `apps/api`, `services/pagos`, cualquier
 *     carpeta con su `Dockerfile`. Cada una es algo que se despliega solo.
 *
 * LO QUE ESTO NO PUEDE VER, y hay que decirlo porque un mapa que se cree
 * completo engaña más que no tenerlo:
 *
 * - **No lee el código.** Que dos servicios se llamen por HTTP no se sabe si
 *   nadie lo declaró en un `depends_on` o en una variable de entorno.
 * - **Una dependencia declarada puede no usarse.** Queda la caja de una base de
 *   datos que a lo mejor se dejó de usar hace un año y nadie quitó del
 *   manifiesto.
 * - **Lo que solo existe en producción no aparece.** Un balanceador o una CDN
 *   que nadie escribió en el repositorio no está aquí.
 *
 * Por eso todo lo que sale de aquí dice de qué fuente salió: una caja que viene
 * de un `depends_on` y otra que viene de adivinar por el nombre de una carpeta
 * no merecen la misma confianza, y quien mire el diagrama tiene derecho a
 * saberlo.
 */

export type Fuente = "compose" | "dependencias" | "carpetas";

export type LecturaDeRepo = Lectura & {
  /** Qué se llegó a leer, para poder decirlo en pantalla. */
  fuentes: Fuente[];
  /** Los archivos que hicieron falta, ya leídos. */
  archivosUsados: string[];
};

// --- Qué archivos vale la pena pedir ----------------------------------------

const COMPOSE = /^(docker-)?compose\.ya?ml$/i;

/** Manifiestos de dependencias, por lenguaje. */
const MANIFIESTOS = /^(package\.json|requirements\.txt|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml|Gemfile|composer\.json)$/;

const nombreDeArchivo = (ruta: string) => ruta.split("/").pop() ?? ruta;

/**
 * Los archivos que hay que leer, ya ordenados por lo que aportan.
 *
 * El orden ES el presupuesto: leer un repositorio sin credencial da para pocos
 * archivos (ver la ruta de importar), así que el que llegue primero es el que
 * se lee. Un `docker-compose` vale más que veinte `package.json`, y un
 * manifiesto de la raíz más que uno enterrado a cuatro carpetas.
 */
export function archivosQueImportan(rutas: string[]): string[] {
  const hondura = (r: string) => r.split("/").length;
  const compose = rutas.filter((r) => COMPOSE.test(nombreDeArchivo(r)));
  const manifiestos = rutas.filter((r) => MANIFIESTOS.test(nombreDeArchivo(r)));

  return [
    ...compose.sort((a, b) => hondura(a) - hondura(b) || a.localeCompare(b, "en")),
    ...manifiestos.sort((a, b) => hondura(a) - hondura(b) || a.localeCompare(b, "en")),
  ];
}

// --- De qué es cada cosa -----------------------------------------------------

/**
 * Qué tipo de caja es una imagen de contenedor.
 *
 * Se mira por trozos del nombre y no por una tabla cerrada, por lo mismo que en
 * Terraform: salen imágenes nuevas cada mes y lo que no se reconozca cae en
 * «servicio», que para algo que corre en un contenedor es la respuesta
 * correcta y no un fallo.
 */
const POR_IMAGEN: [RegExp, TipoDeNodo][] = [
  [/redis|memcach|valkey|dragonfly/i, "cache"],
  [/rabbit|kafka|nats|activemq|artemis|pulsar|mosquitto/i, "cola"],
  [/minio|ceph|seaweed/i, "almacenamiento"],
  [/postgres|mysql|mariadb|mongo|clickhouse|cassandra|cockroach|timescale|influx|elasticsearch|opensearch|neo4j|couch|surreal/i, "base_datos"],
];

export function tipoDeImagen(imagen: string): TipoDeNodo {
  for (const [patron, tipo] of POR_IMAGEN) if (patron.test(imagen)) return tipo;
  return "servicio";
}

/**
 * Paquetes que delatan con qué habla un servicio.
 *
 * NO ES ADIVINAR. Que un proyecto declare `pg` en sus dependencias es una
 * afirmación suya de que habla con Postgres; que declare `stripe`, de que llama
 * a Stripe. Está escrito para otra cosa —instalar—, pero es igual de explícito
 * que un `depends_on`.
 *
 * El nombre de la caja se escribe como lo diría una persona («Postgres», no
 * «pg»), porque es lo que va a leerse en el diagrama.
 */
const POR_DEPENDENCIA: { patron: RegExp; nombre: string; tipo: TipoDeNodo }[] = [
  { patron: /^(pg|postgres|postgresql|psycopg2?(-binary)?|node-postgres|asyncpg)$/i, nombre: "Postgres", tipo: "base_datos" },
  { patron: /^(mysql2?|mariadb|pymysql)$/i, nombre: "MySQL", tipo: "base_datos" },
  { patron: /^(mongodb|mongoose|pymongo)$/i, nombre: "MongoDB", tipo: "base_datos" },
  { patron: /^(redis|ioredis|node-redis)$/i, nombre: "Redis", tipo: "cache" },
  { patron: /^(amqplib|pika|kombu|rhea)$/i, nombre: "RabbitMQ", tipo: "cola" },
  { patron: /^(kafkajs|node-rdkafka|confluent-kafka)$/i, nombre: "Kafka", tipo: "cola" },
  { patron: /^(bullmq|bull|celery|rq|sidekiq)$/i, nombre: "Cola de trabajos", tipo: "cola" },
  { patron: /^(@aws-sdk\/client-s3|aws-sdk|boto3|minio|@google-cloud\/storage)$/i, nombre: "Almacén de objetos", tipo: "almacenamiento" },
  { patron: /^(stripe)$/i, nombre: "Stripe", tipo: "api_externa" },
  { patron: /^(@anthropic-ai\/sdk|anthropic)$/i, nombre: "Anthropic", tipo: "api_externa" },
  { patron: /^(openai)$/i, nombre: "OpenAI", tipo: "api_externa" },
  { patron: /^(@google\/genai|google-generativeai|googleapis)$/i, nombre: "Google", tipo: "api_externa" },
  { patron: /^(nodemailer|@sendgrid\/mail|resend|postmark)$/i, nombre: "Correo saliente", tipo: "api_externa" },
  { patron: /^(twilio)$/i, nombre: "Twilio", tipo: "api_externa" },
  { patron: /^(@octokit\/rest|@octokit\/core|pygithub)$/i, nombre: "GitHub", tipo: "api_externa" },
];

function componenteDeDependencia(dep: string): { nombre: string; tipo: TipoDeNodo } | null {
  for (const { patron, nombre, tipo } of POR_DEPENDENCIA) {
    if (patron.test(dep)) return { nombre, tipo };
  }
  return null;
}

// --- Leer cada fuente --------------------------------------------------------

type Parcial = { componentes: Componente[]; conexiones: Conexion[] };

/**
 * Los servicios de un `docker-compose` y quién depende de quién.
 *
 * Se usa un analizador de YAML de verdad y no un apaño a base de expresiones
 * regulares: el YAML tiene demasiadas formas de decir lo mismo —`depends_on`
 * puede ser una lista o un mapa con condiciones— y un apaño acierta con el
 * archivo que tienes delante y falla con el siguiente.
 */
export function leerCompose(contenido: string): Parcial {
  let doc: unknown;
  try {
    doc = parseYaml(contenido);
  } catch {
    // Un compose que no es YAML válido no tira la importación entera: se queda
    // sin esta fuente y las otras siguen.
    return { componentes: [], conexiones: [] };
  }

  const servicios = (doc as { services?: Record<string, unknown> } | null)?.services;
  if (!servicios || typeof servicios !== "object") return { componentes: [], conexiones: [] };

  const componentes: Componente[] = [];
  const conexiones: Conexion[] = [];

  for (const [nombre, valor] of Object.entries(servicios)) {
    const cfg = (valor ?? {}) as { image?: unknown; depends_on?: unknown; build?: unknown };
    const imagen = typeof cfg.image === "string" ? cfg.image : "";

    componentes.push({
      nombre,
      tipo: imagen ? tipoDeImagen(imagen) : "servicio",
      // La imagen es la mejor descripción posible: dice la versión exacta.
      descripcion: imagen || (cfg.build !== undefined ? "se construye en este repositorio" : "docker-compose"),
    });

    // `depends_on` acepta lista (`[db, redis]`) o mapa con condiciones
    // (`db: {condition: service_healthy}`). Las dos dicen lo mismo aquí.
    const dep = cfg.depends_on;
    const destinos = Array.isArray(dep)
      ? dep.filter((d): d is string => typeof d === "string")
      : dep && typeof dep === "object"
        ? Object.keys(dep as Record<string, unknown>)
        : [];
    for (const destino of destinos) {
      conexiones.push({ de: nombre, a: destino, etiqueta: "necesita" });
    }
  }

  return { componentes, conexiones };
}

/** Las dependencias declaradas en un manifiesto, sea del lenguaje que sea. */
export function dependenciasDe(ruta: string, contenido: string): string[] {
  const archivo = nombreDeArchivo(ruta);

  if (archivo === "package.json" || archivo === "composer.json") {
    try {
      const json = JSON.parse(contenido) as Record<string, unknown>;
      // Solo las de producción: una dependencia de desarrollo no es parte de
      // la arquitectura de lo que corre.
      const deps = json["dependencies"] ?? json["require"];
      return deps && typeof deps === "object" ? Object.keys(deps as Record<string, unknown>) : [];
    } catch {
      return [];
    }
  }

  if (archivo === "requirements.txt") {
    return contenido
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      // `paquete==1.2.3`, `paquete[extra]>=1`, `paquete ; python_version<'3'`
      .map((l) => l.split(/[<>=!~;[\s]/)[0]!.trim())
      .filter(Boolean);
  }

  if (archivo === "go.mod") {
    return [...contenido.matchAll(/^\s+([\w.\-/]+)\s+v\d/gm)].map((m) => m[1]!);
  }

  if (archivo === "pyproject.toml" || archivo === "Cargo.toml") {
    return [...contenido.matchAll(/^\s*["']?([A-Za-z][\w.\-@/]*)["']?\s*=/gm)].map((m) => m[1]!);
  }

  if (archivo === "pom.xml") {
    return [...contenido.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)].map((m) => m[1]!.trim());
  }

  if (archivo === "Gemfile") {
    return [...contenido.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
  }

  return [];
}

/**
 * De qué servicio es un manifiesto.
 *
 * El de `apps/api/package.json` es de «api»; el de la raíz es del proyecto
 * entero y no de ningún servicio concreto, así que devuelve null y sus
 * dependencias quedan sin dueño.
 */
export function servicioDeLaRuta(ruta: string): string | null {
  const partes = ruta.split("/").filter(Boolean);
  if (partes.length < 2) return null;
  const carpeta = partes[partes.length - 2]!;
  return carpeta === "." ? null : carpeta;
}

/** Las carpetas que se despliegan solas, por cómo está montado el repositorio. */
export function serviciosPorCarpeta(rutas: string[]): string[] {
  const nombres = new Set<string>();
  for (const ruta of rutas) {
    // `apps/x/...`, `services/x/...`, `packages/x/...` — el reparto de siempre
    // en un monorepo. Y cualquier carpeta con su propio Dockerfile, que es la
    // señal más clara que hay de «esto se despliega solo».
    const m = /^(?:apps|services|packages|cmd)\/([^/]+)\//.exec(ruta);
    if (m) nombres.add(m[1]!);
    const d = /^([^/]+)\/Dockerfile$/.exec(ruta);
    if (d) nombres.add(d[1]!);
  }
  return [...nombres].sort((a, b) => a.localeCompare(b, "en"));
}

// --- Juntarlo todo -----------------------------------------------------------

/**
 * La arquitectura que se puede deducir del repositorio.
 *
 * `rutas` es el árbol entero —que es una sola llamada y sale barato— y
 * `archivos` solo los que se llegaron a leer. Lo que no se pudo leer
 * sencillamente no aporta; nada revienta por faltar.
 */
export function leerRepositorio(
  rutas: string[],
  archivos: { ruta: string; contenido: string }[],
): LecturaDeRepo {
  const fuentes: Fuente[] = [];
  const componentes: Componente[] = [];
  const conexiones: Conexion[] = [];
  const archivosUsados: string[] = [];

  /** Por nombre normalizado, para no repetir la misma caja desde dos fuentes. */
  const vistos = new Map<string, Componente>();
  const anotar = (c: Componente) => {
    const clave = c.nombre.trim().toLowerCase();
    if (!clave) return;
    const antes = vistos.get(clave);
    if (antes) {
      // La primera fuente manda: lo que dice el compose sobre un servicio vale
      // más que lo que se deduzca luego de una carpeta con el mismo nombre.
      if (antes.tipo === "servicio" && c.tipo !== "servicio") antes.tipo = c.tipo;
      return;
    }
    vistos.set(clave, c);
    componentes.push(c);
  };

  // 1. El compose, que es el que da flechas de verdad.
  for (const archivo of archivos) {
    if (!COMPOSE.test(nombreDeArchivo(archivo.ruta))) continue;
    const parcial = leerCompose(archivo.contenido);
    if (parcial.componentes.length === 0) continue;
    if (!fuentes.includes("compose")) fuentes.push("compose");
    archivosUsados.push(archivo.ruta);
    parcial.componentes.forEach(anotar);
    conexiones.push(...parcial.conexiones);
  }

  // 2. Las carpetas que se despliegan solas. Van antes que las dependencias
  //    porque son quienes tienen que quedar como ORIGEN de sus flechas.
  const porCarpeta = serviciosPorCarpeta(rutas);
  if (porCarpeta.length > 0) {
    fuentes.push("carpetas");
    for (const nombre of porCarpeta) {
      anotar({ nombre, tipo: "servicio", descripcion: "se despliega por su cuenta" });
    }
  }

  // 3. Con qué habla cada uno, según lo que declara instalar.
  for (const archivo of archivos) {
    if (!MANIFIESTOS.test(nombreDeArchivo(archivo.ruta))) continue;
    const deps = dependenciasDe(archivo.ruta, archivo.contenido);
    const encontrados = deps.map(componenteDeDependencia).filter((c) => c !== null);
    if (encontrados.length === 0) continue;

    if (!fuentes.includes("dependencias")) fuentes.push("dependencias");
    archivosUsados.push(archivo.ruta);

    const duenyo = servicioDeLaRuta(archivo.ruta);
    for (const hallado of encontrados) {
      anotar({ ...hallado, descripcion: "declarado en las dependencias" });
      // Sin dueño —el manifiesto de la raíz— la caja se queda suelta: inventar
      // de quién cuelga sería peor que dejarla sin flecha.
      if (duenyo && vistos.has(duenyo.toLowerCase())) {
        conexiones.push({ de: duenyo, a: hallado.nombre, etiqueta: "usa" });
      }
    }
  }

  // Ni flechas repetidas ni flechas hacia algo que no se dibujó.
  const unicas: Conexion[] = [];
  const huellas = new Set<string>();
  for (const c of conexiones) {
    const de = c.de.trim().toLowerCase();
    const a = c.a.trim().toLowerCase();
    if (de === a || !vistos.has(de) || !vistos.has(a)) continue;
    const huella = `${de}|${a}`;
    if (huellas.has(huella)) continue;
    huellas.add(huella);
    unicas.push(c);
  }

  return { componentes, conexiones: unicas, fuentes, archivosUsados };
}
