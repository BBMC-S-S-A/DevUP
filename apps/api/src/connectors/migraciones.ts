/**
 * El criterio de migraciones, aplicado al repositorio de un cliente.
 *
 * ESTO ES EL PRODUCTO, no un detalle interno. El criterio existe porque lo
 * aprendimos a base de un fallo silencioso que costó una migración entera
 * encontrar: una tabla sin política de aislamiento no da error, devuelve cero
 * filas y sigue. Lo que se vende no es «leemos tus migraciones» —eso lo hace
 * cualquiera—: es que sabemos qué mirar.
 *
 * SE ANALIZA EL TEXTO, NO SE EJECUTA. Ni se conecta a la base del cliente ni se
 * corre nada: se leen los archivos de su repositorio y se comprueban tres
 * reglas. Ejecutar para averiguar si algo es seguro es exactamente el orden
 * equivocado.
 *
 * Y POR ESO ESTO SE EQUIVOCA HACIA EL AVISO. Un analizador de texto no entiende
 * SQL: entiende cómo se escribe SQL. Cuando dude, avisa — un aviso de más se
 * descarta leyéndolo, y un aviso de menos es la tabla sin política de la que
 * nadie se entera hasta que un cliente ve los datos de otro.
 */

export type Severidad = "error" | "aviso" | "bien";

export type Hallazgo = {
  severidad: Severidad;
  regla: "aditiva" | "idempotente" | "aislamiento";
  mensaje: string;
  /** La línea del archivo, 1-indexada, o null si es del archivo entero. */
  linea: number | null;
};

export type AnalisisMigracion = {
  archivo: string;
  hallazgos: Hallazgo[];
  /** La peor severidad encontrada. Es lo que decide el color de la fila. */
  veredicto: Severidad;
};

/**
 * Quita cadenas y comentarios antes de buscar nada.
 *
 * Sin esto, un `-- ojo: nunca hagas drop table aquí` se cuenta como un
 * `drop table`, y el comentario que avisa del peligro se convierte en el
 * peligro. Lo mismo con un literal `'drop column'` dentro de un insert.
 *
 * Se sustituye por espacios en vez de borrarse, para que los números de línea
 * y las posiciones sigan siendo los del archivo original.
 */
function sinRuido(sql: string): string {
  let salida = "";
  let i = 0;
  while (i < sql.length) {
    const dos = sql.slice(i, i + 2);

    if (dos === "--") {
      while (i < sql.length && sql[i] !== "\n") salida += " ", i++;
      continue;
    }
    if (dos === "/*") {
      while (i < sql.length && sql.slice(i, i + 2) !== "*/") {
        salida += sql[i] === "\n" ? "\n" : " ";
        i++;
      }
      salida += "  ";
      i += 2;
      continue;
    }
    if (sql[i] === "'") {
      salida += " ";
      i++;
      while (i < sql.length && sql[i] !== "'") {
        salida += sql[i] === "\n" ? "\n" : " ";
        i++;
      }
      salida += " ";
      i++;
      continue;
    }
    // Los cuerpos de función van entre $$ o $etiqueta$. Se conservan: dentro
    // hay create table y policy de verdad, y saltárselos dejaría fuera justo
    // las migraciones más delicadas.
    salida += sql[i];
    i++;
  }
  return salida;
}

function lineaDe(sql: string, indice: number): number {
  return sql.slice(0, indice).split("\n").length;
}

/** Todas las apariciones de un patrón, con su línea. */
function buscar(sql: string, patron: RegExp): { texto: string; linea: number; indice: number }[] {
  const encontrados: { texto: string; linea: number; indice: number }[] = [];
  const re = new RegExp(patron.source, patron.flags.includes("g") ? patron.flags : patron.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    encontrados.push({ texto: m[0], linea: lineaDe(sql, m.index), indice: m.index });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return encontrados;
}

/**
 * Regla 1 · Solo se añade.
 *
 * Una migración que borra no se puede volver a aplicar, no se puede revisar en
 * una copia y no se puede deshacer. Renombrar cuenta como borrar: quien tenga
 * la versión anterior desplegada deja de encontrar la columna en cuanto la
 * migración pasa, y eso es una caída, no un cambio.
 *
 * `drop ... if exists` sobre políticas e índices NO cuenta: es la forma normal
 * de reescribir una política sin duplicarla, y es justo lo que pide la regla 2.
 */
function reglaAditiva(sql: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  const destructivos: [RegExp, string][] = [
    [/\bdrop\s+table\b/gi, "borra una tabla"],
    [/\bdrop\s+column\b/gi, "borra una columna"],
    [/\bdrop\s+schema\b/gi, "borra un esquema"],
    [/\btruncate\b/gi, "vacía una tabla"],
    [/\brename\s+to\b/gi, "renombra, que para quien ya tiene la versión anterior desplegada es borrar"],
    [/\balter\s+column\s+\w+\s+type\b/gi, "cambia el tipo de una columna, que puede perder datos al convertir"],
  ];

  for (const [patron, motivo] of destructivos) {
    for (const encontrado of buscar(sql, patron)) {
      hallazgos.push({
        severidad: "error",
        regla: "aditiva",
        mensaje: `\`${encontrado.texto.replace(/\s+/g, " ")}\` ${motivo}.`,
        linea: encontrado.linea,
      });
    }
  }

  // Aflojar una restricción NO pierde datos, así que no es un error: es una
  // puerta de un solo sentido. Ponerlo al lado de un `drop table` enseñaría a
  // ignorar los errores, que es la forma más rápida de que un `drop table` de
  // verdad pase desapercibido.
  for (const encontrado of buscar(sql, /\bdrop\s+not\s+null\b/gi)) {
    hallazgos.push({
      severidad: "aviso",
      regla: "aditiva",
      mensaje:
        "Afloja una restricción. No pierde datos, pero volver atrás deja de ser gratis en cuanto entre el primer nulo.",
      linea: encontrado.linea,
    });
  }

  return hallazgos;
}

/**
 * Regla 2 · Se puede aplicar dos veces.
 *
 * No es una elegancia: es lo que permite reintentar una migración que se cortó
 * a la mitad, y lo que hace que aplicar el historial entero sobre una copia
 * para probar algo no sea una aventura.
 */
function reglaIdempotente(sql: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  const creaciones: [RegExp, RegExp, string][] = [
    [/\bcreate\s+table\b/gi, /\bcreate\s+table\s+if\s+not\s+exists\b/i, "create table … if not exists"],
    [/\bcreate\s+index\b/gi, /\bcreate\s+index\s+if\s+not\s+exists\b/i, "create index … if not exists"],
    [/\bcreate\s+type\b/gi, /\bcreate\s+type\b/i, ""],
    [/\badd\s+column\b/gi, /\badd\s+column\s+if\s+not\s+exists\b/i, "add column if not exists"],
  ];

  for (const [patron, seguro, sugerencia] of creaciones) {
    for (const encontrado of buscar(sql, patron)) {
      const trozo = sql.slice(encontrado.indice, encontrado.indice + 90);
      if (seguro.test(trozo) && sugerencia !== "") continue;

      // `create type` no admite `if not exists` en Postgres. La forma correcta
      // es envolverlo en un bloque que compruebe el catálogo, así que se busca
      // eso en vez de pedir algo que el motor no acepta.
      if (sugerencia === "") {
        const envuelto = /pg_type/i.test(sql.slice(Math.max(0, encontrado.indice - 400), encontrado.indice));
        if (envuelto) continue;
        hallazgos.push({
          severidad: "aviso",
          regla: "idempotente",
          mensaje:
            "`create type` no admite `if not exists`: envuélvelo en un bloque que consulte `pg_type` primero, o fallará al aplicarse dos veces.",
          linea: encontrado.linea,
        });
        continue;
      }

      hallazgos.push({
        severidad: "aviso",
        regla: "idempotente",
        mensaje: `Falla al aplicarse dos veces. Usa \`${sugerencia}\`.`,
        linea: encontrado.linea,
      });
    }
  }

  // Una política creada sin borrarla antes falla en la segunda pasada.
  for (const encontrado of buscar(sql, /\bcreate\s+policy\s+([\w"]+)/gi)) {
    const nombre = encontrado.texto.split(/\s+/).pop()!.replace(/"/g, "");
    const seBorraAntes = new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+"?${nombre}"?`, "i").test(
      sql.slice(0, encontrado.indice),
    );
    if (seBorraAntes) continue;
    hallazgos.push({
      severidad: "aviso",
      regla: "idempotente",
      mensaje: `La política \`${nombre}\` se crea sin borrarla antes: la segunda pasada fallará. Añade \`drop policy if exists ${nombre} on …;\` delante.`,
      linea: encontrado.linea,
    });
  }

  return hallazgos;
}

/**
 * Regla 3 · El aislamiento va en la misma migración.
 *
 * La más importante de las tres, y la que ningún otro sitio comprueba. Con RLS
 * apagado la tabla es pública para la aplicación; con RLS encendido y sin
 * ninguna política, es invisible para todos y no da error — devuelve cero filas
 * y sigue. Las dos son fallos silenciosos, y por eso se comprueban las dos.
 *
 * En la MISMA migración y no «en algún sitio»: si la política llega en la
 * siguiente, entre una y otra hay una ventana con la tabla desprotegida, y esa
 * ventana dura lo que tarde alguien en desplegar solo la primera.
 */
function reglaAislamiento(sql: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  const tablas = buscar(sql, /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)/gi);

  for (const encontrado of tablas) {
    const nombre = encontrado.texto.split(/\s+/).pop()!;
    const corto = nombre.includes(".") ? nombre.split(".").pop()! : nombre;

    const enciende = new RegExp(
      `alter\\s+table\\s+[\\w.]*${corto}\\s+enable\\s+row\\s+level\\s+security`,
      "i",
    ).test(sql);
    const tienePolitica = new RegExp(`create\\s+policy\\s+[\\w"]+\\s+on\\s+[\\w.]*${corto}\\b`, "i").test(
      sql,
    );

    if (!enciende) {
      hallazgos.push({
        severidad: "error",
        regla: "aislamiento",
        mensaje: `\`${corto}\` se crea sin \`enable row level security\`: cualquiera que use la aplicación ve todas sus filas, sean de quien sean.`,
        linea: encontrado.linea,
      });
      continue;
    }

    if (!tienePolitica) {
      // AVISO Y NO ERROR, y la diferencia importa: sin RLS la tabla se ve
      // entera —falla abierto, y eso es una fuga—; con RLS y sin política no
      // la ve nadie —falla cerrado—. Lo segundo es un fallo silencioso que hay
      // que contar, pero a veces es deliberado: una tabla que solo escribe una
      // función `security definer` y que nadie debe leer se deja así a
      // propósito. Llamarlo error convertiría un diseño correcto en una alarma
      // que la gente aprende a ignorar.
      hallazgos.push({
        severidad: "aviso",
        regla: "aislamiento",
        mensaje: `\`${corto}\` enciende el aislamiento y no define ninguna política: la tabla queda invisible para todos, sin dar ningún error — devuelve cero filas y sigue. Si es a propósito (solo la escribe una función \`security definer\`), déjalo; si no, le falta su política.`,
        linea: encontrado.linea,
      });
    }
  }

  return hallazgos;
}

const PESO: Record<Severidad, number> = { bien: 0, aviso: 1, error: 2 };

export function analizarMigracion(archivo: string, sql: string): AnalisisMigracion {
  const limpio = sinRuido(sql);
  const hallazgos = [
    ...reglaAditiva(limpio),
    ...reglaIdempotente(limpio),
    ...reglaAislamiento(limpio),
  ].sort((a, b) => (a.linea ?? 0) - (b.linea ?? 0));

  const veredicto = hallazgos.reduce<Severidad>(
    (peor, h) => (PESO[h.severidad] > PESO[peor] ? h.severidad : peor),
    "bien",
  );

  return { archivo, hallazgos, veredicto };
}

/**
 * Dónde suelen vivir las migraciones.
 *
 * Se reconocen por carpeta y no se pide configurarlo: casi todo el mundo usa
 * uno de estos nombres, y una pantalla que empieza pidiendo una ruta es una
 * pantalla que mucha gente cierra antes de ver para qué servía. Si no encaja
 * ninguna, se dice cuáles se miraron.
 */
export const CARPETAS = [
  "db/migrations",
  "migrations",
  "supabase/migrations",
  "prisma/migrations",
  "database/migrations",
  "sql/migrations",
];

export function migracionesDelArbol(rutas: string[]): string[] {
  const carpeta = CARPETAS.find((c) => rutas.some((r) => r.startsWith(`${c}/`)));
  if (!carpeta) return [];
  return rutas
    .filter((r) => r.startsWith(`${carpeta}/`) && r.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"));
}
