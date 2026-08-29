/**
 * Integraciones guiadas: el diagnóstico.
 *
 * LA MITAD QUE DIFERENCIA NO ES EL CATÁLOGO. Un sitio donde buscas lo que ya
 * sabes que quieres no le sirve a quien no sabe que eso existe — y ese es el
 * caso mayoritario: mucha gente no ha descartado estas herramientas, es que no
 * las conoce. Lo que sí sirve es mirar lo que están haciendo y decir «para eso
 * que ya estás escribiendo a mano, esto te lo ahorraría».
 *
 * TODA RECOMENDACIÓN LLEVA SU PRUEBA. Cada una nombra el archivo —y la línea,
 * cuando la hay— donde se ve lo que se está haciendo a mano. Sin eso esto sería
 * publicidad: «te recomendamos Supabase» no lo lee nadie; «en `src/auth.ts:34`
 * estás firmando tus propios tokens de sesión» sí.
 *
 * SE MIRA EL TEXTO Y LAS DEPENDENCIAS, NO SE EJECUTA NADA. Igual que el
 * criterio de migraciones: leer para saber, no correr para averiguar.
 *
 * Y SE CALLA CUANDO NO SABE. Es preferible no decir nada a inventar un
 * diagnóstico: una recomendación equivocada gasta la confianza de todas las
 * siguientes, y esta pantalla vale exactamente lo que valga su primera
 * recomendación.
 */

export type Recomendacion = {
  id: string;
  /** Lo que están haciendo a mano, en una frase y en su idioma. */
  titulo: string;
  /** Qué cuesta seguir así. */
  problema: string;
  /** Qué lo sustituye, y qué se gana. */
  propuesta: string;
  /** Dónde se ve. Sin esto, esto sería publicidad. */
  pruebas: { archivo: string; linea: number | null; fragmento: string }[];
  /** `alta` = les está costando dinero o riesgo ahora mismo. */
  peso: "alta" | "media";
};

export type Entrada = {
  /** Rutas del árbol del repositorio. */
  rutas: string[];
  /** Contenido de los archivos que se hayan podido leer, por ruta. */
  archivos: Map<string, string>;
};

/**
 * Qué archivos merece la pena leer. Pocos y concretos: cada uno es una
 * petición a GitHub.
 *
 * `package.json` a secas es el de la raíz; quien llame debe añadir además los
 * de los subproyectos que encuentre en el árbol — en un monorepo es donde
 * están las dependencias que importan.
 */
export const ARCHIVOS_DE_INTERES = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "composer.json",
  "Gemfile",
];

function lineaDe(texto: string, indice: number): number {
  return texto.slice(0, indice).split("\n").length;
}

/** La primera aparición de un patrón, con su línea y su trozo de contexto. */
function evidencia(
  archivos: Map<string, string>,
  patron: RegExp,
  soloEn?: (ruta: string) => boolean,
): { archivo: string; linea: number; fragmento: string } | null {
  for (const [archivo, contenido] of archivos) {
    if (soloEn && !soloEn(archivo)) continue;
    const re = new RegExp(patron.source, patron.flags.includes("g") ? patron.flags : patron.flags + "g");
    const m = re.exec(contenido);
    if (!m) continue;
    const linea = lineaDe(contenido, m.index);
    const texto = contenido.split("\n")[linea - 1] ?? m[0];
    return { archivo, linea, fragmento: texto.trim().slice(0, 120) };
  }
  return null;
}

/**
 * Todas las dependencias del repositorio, vengan de donde vengan.
 *
 * DE TODOS LOS package.json Y NO SOLO DEL DE LA RAÍZ. Lo descubrió el propio
 * diagnóstico al correrse contra este repositorio: en un monorepo la raíz solo
 * tiene las herramientas de construcción, y `fastify`, `pg` o `multer` viven en
 * `apps/api/package.json`. Mirando solo la raíz, a un monorepo se le diagnostica
 * un proyecto vacío — y esa es exactamente la forma de callarse cuando había
 * algo que decir.
 */
function dependencias(archivos: Map<string, string>): Set<string> {
  const nombres = new Set<string>();

  for (const [ruta, contenido] of archivos) {
    if (!ruta.endsWith("package.json")) continue;
    try {
      const json = JSON.parse(contenido) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const n of Object.keys({ ...json.dependencies, ...json.devDependencies })) nombres.add(n);
    } catch {
      // Un package.json que no es JSON válido no impide diagnosticar el resto.
    }
  }
  for (const otro of ["requirements.txt", "pyproject.toml", "go.mod", "composer.json", "Gemfile"]) {
    const contenido = archivos.get(otro);
    if (contenido) for (const linea of contenido.split("\n")) nombres.add(linea.trim().toLowerCase());
  }
  return nombres;
}

const tiene = (deps: Set<string>, ...cuales: string[]) =>
  cuales.some((c) => [...deps].some((d) => d === c || d.startsWith(`${c}@`) || d.includes(c)));

export function diagnosticar({ rutas, archivos }: Entrada): Recomendacion[] {
  const deps = dependencias(archivos);
  const salida: Recomendacion[] = [];

  // --- 1. Un .env de verdad commiteado ---------------------------------------
  // La primera de todas y la única que no es una recomendación de producto: es
  // un incidente. Si hay credenciales en el repositorio, todo lo demás da igual
  // hasta que se saquen.
  const envReal = rutas.find(
    (r) => /(^|\/)\.env$/.test(r) || /(^|\/)\.env\.(production|local|prod)$/.test(r),
  );
  if (envReal) {
    salida.push({
      id: "env-en-el-repo",
      titulo: "Hay un archivo de entorno dentro del repositorio",
      problema:
        "Si lleva credenciales, las tiene todo el que pueda clonar — y siguen en el historial aunque se borre hoy. Rotarlas es el único arreglo real.",
      propuesta:
        "Sácalo del repositorio, añádelo a .gitignore, deja solo un .env.example con marcadores, y rota lo que hubiera dentro. Después, una bóveda para guardarlas: DevUP ya tiene una.",
      pruebas: [{ archivo: envReal, linea: null, fragmento: envReal }],
      peso: "alta",
    });
  }

  // --- 2. Autenticación escrita a mano ---------------------------------------
  const hashPropio = tiene(deps, "bcrypt", "bcryptjs", "argon2", "passport", "jsonwebtoken");
  const pruebaAuth =
    evidencia(archivos, /\b(bcrypt|argon2|jsonwebtoken|jwt\.sign)\b/i) ??
    (hashPropio ? { archivo: "package.json", linea: null, fragmento: "bcrypt / jsonwebtoken" } : null);

  if (hashPropio && pruebaAuth) {
    salida.push({
      id: "auth-a-mano",
      titulo: "Estáis escribiendo la autenticación a mano",
      problema:
        "Hashes, sesiones, caducidad de tokens, recuperación de contraseña, verificación de correo y rotación: son seis piezas que hay que mantener, y las seis fallan en silencio cuando fallan.",
      propuesta:
        "Un servicio de autenticación —Supabase, Auth0, Clerk— trae las seis, con correo incluido. Lo que se gana no es escribir menos: es dejar de ser quien responde cuando un token no caduca.",
      pruebas: [pruebaAuth],
      peso: "media",
    });
  }

  // --- 3. Archivos en el disco del servidor ----------------------------------
  const subidaLocal = evidencia(archivos, /diskStorage|multer\.diskStorage|writeFileSync\(.*upload/i);
  if (tiene(deps, "multer", "formidable", "busboy") || subidaLocal) {
    salida.push({
      id: "archivos-en-disco",
      titulo: "Los archivos que sube la gente viven en el disco del servidor",
      problema:
        "Se pierden si la máquina muere, no se comparten si algún día hay dos, y crecen hasta llenar el disco sin avisar. Y no entran en ninguna copia de seguridad que no sea de la máquina entera.",
      propuesta:
        "Un almacén compatible con S3 —R2, S3, el propio Supabase— con URLs firmadas: el navegador sube directo, el servidor solo firma. Es lo que hace DevUP y por eso una subida no pasa por la API.",
      pruebas: subidaLocal
        ? [subidaLocal]
        : [
            {
              archivo:
                [...archivos.keys()].find((r) => r.endsWith("package.json")) ?? "package.json",
              linea: null,
              fragmento: "multer / formidable",
            },
          ],
      peso: "media",
    });
  }

  // --- 4. Base de datos sin migraciones --------------------------------------
  const hayBase = tiene(deps, "pg", "mysql2", "sqlite3", "prisma", "typeorm", "sequelize", "mongoose");
  const hayMigraciones = rutas.some((r) => /(^|\/)(migrations|migraciones)\//.test(r));
  if (hayBase && !hayMigraciones) {
    salida.push({
      id: "sin-migraciones",
      titulo: "Hay base de datos y no hay migraciones",
      problema:
        "El esquema se cambia a mano, así que nadie puede reproducir el de producción en su máquina, y dos entornos se separan sin que se note hasta que algo falla solo en uno.",
      propuesta:
        "Migraciones en el repositorio, que solo se añadan y se puedan aplicar dos veces. DevUP las lee y las comprueba contra ese criterio en la pantalla de Base de datos.",
      pruebas: [{ archivo: "package.json", linea: null, fragmento: "una dependencia de base de datos" }],
      peso: "alta",
    });
  }

  // --- 5. Sin integración continua -------------------------------------------
  const hayCI = rutas.some(
    (r) => r.startsWith(".github/workflows/") || r === ".gitlab-ci.yml" || r.startsWith(".circleci/"),
  );
  if (!hayCI && rutas.length > 0) {
    salida.push({
      id: "sin-ci",
      titulo: "No hay nada que compruebe los cambios antes de que entren",
      problema:
        "Cada cambio se prueba en la máquina de quien lo escribió y en ningún sitio más. Lo que se rompe se descubre desplegado.",
      propuesta:
        "Un flujo que compile, mire los tipos y corra las pruebas en cada cambio. Media hora de configurar, y es lo que convierte «funciona en mi máquina» en una frase que ya no hace falta decir.",
      pruebas: [{ archivo: "(el repositorio entero)", linea: null, fragmento: "sin .github/workflows" }],
      peso: "media",
    });
  }

  // --- 6. Tareas periódicas dentro del proceso web ---------------------------
  const intervalo = evidencia(archivos, /setInterval\s*\(/);
  if (intervalo && tiene(deps, "express", "fastify", "koa", "next")) {
    salida.push({
      id: "cron-en-el-proceso",
      titulo: "Hay tareas periódicas dentro del proceso que atiende peticiones",
      problema:
        "Con dos instancias se ejecutan dos veces, y con cero —mientras se despliega— no se ejecutan ninguna. Los dos casos son silenciosos.",
      propuesta:
        "Un planificador aparte, o el cron del proveedor. Lo importante no es la herramienta: es que el reloj deje de depender de cuántas copias del servidor haya vivas.",
      pruebas: [intervalo],
      peso: "media",
    });
  }

  return salida;
}
