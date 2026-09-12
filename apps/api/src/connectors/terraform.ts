/**
 * Lee la arquitectura que ya está escrita en Terraform.
 *
 * DE DÓNDE SALE ESTO. El diagrama de Infraestructura se dibuja a mano, caja a
 * caja. Pero quien usa Terraform ya declaró su infraestructura entera —qué hay
 * y qué depende de qué— y volver a dibujarla es copiar a mano algo que ya está
 * escrito, con el agravante de que las dos copias se separan en cuanto alguien
 * cambia una.
 *
 * SE LEE EL TEXTO, NO SE EJECUTA NADA. Ni `terraform plan`, ni credenciales de
 * nadie, ni estado remoto: se piden los `.tf` del repositorio y se analizan
 * como texto, exactamente igual que el criterio de migraciones analiza los
 * `.sql`. Ejecutar la infraestructura de un cliente para dibujarla sería pedir
 * mucho más de lo que la función vale.
 *
 * LO QUE ESTO NO PUEDE VER, y hay que decirlo porque un mapa que se cree
 * completo engaña:
 *
 * - **No resuelve variables ni `locals`.** Un nombre que venga de
 *   `var.entorno` se queda como está escrito.
 * - **No entra en los módulos.** Un `module "red"` es una caja cuyo contenido
 *   vive en otra carpeta —a menudo en otro repositorio, o en el registro
 *   público— y no está aquí para leerlo.
 * - **`count` y `for_each` dibujan UNA caja.** Diez réplicas declaradas en un
 *   bucle son un recurso en el texto, y es el texto lo que se lee.
 * - **Los bloques `data` quedan fuera.** Describen cosas que ya existen y que
 *   este código no crea; meterlos doblaría el ruido sin añadir estructura.
 */

/** Dónde suele vivir Terraform. Vale cualquier carpeta: se busca por extensión. */
export const EXTENSION = ".tf";

export type TipoDeNodo =
  | "servicio"
  | "base_datos"
  | "cola"
  | "cache"
  | "almacenamiento"
  | "api_externa"
  | "otro";

export type Componente = { nombre: string; tipo: TipoDeNodo; descripcion: string };
export type Conexion = { de: string; a: string; etiqueta: string };
export type Lectura = { componentes: Componente[]; conexiones: Conexion[] };

/**
 * De qué tipo de caja es cada recurso.
 *
 * Se mira por TROZOS DEL NOMBRE y no por una tabla de recursos exactos. Entre
 * AWS, Google, Azure y el resto hay miles, salen nuevos cada mes, y una tabla
 * cerrada envejece mal: lo que no reconozca cae en «otro», que es una caja
 * correcta y no un fallo. `aws_db_instance`, `google_sql_database_instance` y
 * `azurerm_postgresql_server` son los tres bases de datos por la misma razón
 * legible en su nombre.
 *
 * El orden importa: se queda con la primera que encaje, así que lo más
 * específico va arriba. `aws_elasticache_cluster` es caché y no base de datos
 * aunque contenga «cache» y no «db».
 */
const POR_NOMBRE: [RegExp, TipoDeNodo][] = [
  [/redis|memcach|elasticache/i, "cache"],
  [/sqs|pubsub|kafka|queue|servicebus|amqp|rabbit/i, "cola"],
  [/bucket|_s3_|storage_account|blob|filestore|efs_/i, "almacenamiento"],
  [/db_instance|rds|sql|postgres|mysql|mariadb|dynamodb|firestore|spanner|mongo|cosmos/i, "base_datos"],
  [/lambda|function|ecs|fargate|cloud_run|app_service|instance|container|kubernetes|deployment|service/i, "servicio"],
];

export function tipoDeRecurso(tipo: string): TipoDeNodo {
  for (const [patron, nodo] of POR_NOMBRE) {
    if (patron.test(tipo)) return nodo;
  }
  return "otro";
}

/** Los `.tf` del árbol de un repositorio. */
export function terraformDelArbol(rutas: string[]): string[] {
  return rutas.filter((r) => r.endsWith(EXTENSION)).sort((a, b) => a.localeCompare(b, "en"));
}

/**
 * Quita comentarios, cadenas y heredocs antes de mirar nada.
 *
 * Sin esto, un `# ojo: depende de aws_db_instance.principal` cuenta como una
 * dependencia, y el comentario que explica la relación se convierte en la
 * relación. Los heredocs importan más de lo que parece: un `user_data` con un
 * script de arranque dentro lleva llaves que descuadrarían el conteo de
 * bloques.
 *
 * Se sustituye por espacios y no se borra, para que las posiciones sigan
 * siendo las del archivo original.
 */
export function sinRuido(tf: string): string {
  let salida = "";
  let i = 0;
  while (i < tf.length) {
    const dos = tf.slice(i, i + 2);

    if (tf[i] === "#" || dos === "//") {
      while (i < tf.length && tf[i] !== "\n") (salida += " "), i++;
      continue;
    }
    if (dos === "/*") {
      while (i < tf.length && tf.slice(i, i + 2) !== "*/") {
        salida += tf[i] === "\n" ? "\n" : " ";
        i++;
      }
      salida += "  ";
      i += 2;
      continue;
    }
    // Heredoc: <<ETIQUETA o <<-ETIQUETA hasta una línea con solo la etiqueta.
    const heredoc = /^<<-?([A-Za-z_]\w*)\r?\n/.exec(tf.slice(i));
    if (heredoc) {
      const cierre = new RegExp(`^[ \\t]*${heredoc[1]}[ \\t]*$`, "m");
      const resto = tf.slice(i + heredoc[0].length);
      const fin = cierre.exec(resto);
      const hasta = fin ? i + heredoc[0].length + fin.index + fin[0].length : tf.length;
      for (let j = i; j < hasta; j++) salida += tf[j] === "\n" ? "\n" : " ";
      i = hasta;
      continue;
    }
    if (tf[i] === '"') {
      salida += " ";
      i++;
      while (i < tf.length && tf[i] !== '"') {
        if (tf[i] === "\\") (salida += " "), i++;
        salida += tf[i] === "\n" ? "\n" : " ";
        i++;
      }
      salida += " ";
      i++;
      continue;
    }
    salida += tf[i];
    i++;
  }
  return salida;
}

/** El cuerpo de un bloque que empieza en la llave de `desde`, contando llaves. */
function cuerpoDelBloque(texto: string, desde: number): { cuerpo: string; fin: number } | null {
  const abre = texto.indexOf("{", desde);
  if (abre === -1) return null;
  let nivel = 0;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === "{") nivel++;
    else if (texto[i] === "}") {
      nivel--;
      if (nivel === 0) return { cuerpo: texto.slice(abre + 1, i), fin: i };
    }
  }
  return null;
}

type Recurso = { tipo: string; nombre: string; cuerpo: string };

/**
 * Los recursos declarados, con su cuerpo.
 *
 * La cabecera se busca sobre el texto ORIGINAL —porque los nombres van entre
 * comillas y `sinRuido` se las come— pero el cuerpo se toma del texto limpio,
 * que es donde hay que contar llaves y buscar referencias.
 */
export function recursosDe(tf: string): Recurso[] {
  const limpio = sinRuido(tf);
  const recursos: Recurso[] = [];
  const cabecera = /resource\s+"([^"]+)"\s+"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = cabecera.exec(tf)) !== null) {
    const bloque = cuerpoDelBloque(limpio, m.index + m[0].length);
    if (!bloque) continue;
    recursos.push({ tipo: m[1]!, nombre: m[2]!, cuerpo: bloque.cuerpo });
  }
  return recursos;
}

/**
 * Lee un conjunto de archivos `.tf` y devuelve componentes y conexiones.
 *
 * LA DIRECCIÓN DE LA FLECHA. Si el servidor menciona a la base de datos, la
 * flecha va del servidor a la base: quien nombra al otro es quien depende de
 * él. Es la misma dirección que dibuja una persona en una pizarra, y la
 * contraria de la que usa Terraform para ordenar su grafo de creación.
 *
 * EL NOMBRE DE LA CAJA es el del recurso —`principal`, `api`— y no
 * `aws_db_instance.principal`, porque lo primero es como lo llama el equipo.
 * Cuando dos recursos de tipos distintos comparten nombre, los dos pasan a
 * llevar su tipo delante: sin eso serían una sola caja y las flechas de uno
 * acabarían en el otro.
 */
export function leerTerraform(archivos: { ruta: string; contenido: string }[]): Lectura {
  const recursos = archivos.flatMap((a) => recursosDe(a.contenido));

  // Nombres repetidos entre tipos distintos: hay que desambiguar los dos.
  const vecesPorNombre = new Map<string, number>();
  for (const r of recursos) vecesPorNombre.set(r.nombre, (vecesPorNombre.get(r.nombre) ?? 0) + 1);

  const etiquetaDe = (r: Recurso) =>
    (vecesPorNombre.get(r.nombre) ?? 0) > 1 ? `${r.tipo}.${r.nombre}` : r.nombre;

  const componentes: Componente[] = recursos.map((r) => ({
    nombre: etiquetaDe(r),
    tipo: tipoDeRecurso(r.tipo),
    descripcion: r.tipo,
  }));

  /** `tipo.nombre` -> la etiqueta con la que quedó la caja. */
  const porClave = new Map(recursos.map((r) => [`${r.tipo}.${r.nombre}`, etiquetaDe(r)]));

  const conexiones: Conexion[] = [];
  const vistas = new Set<string>();
  for (const r of recursos) {
    const mio = etiquetaDe(r);
    // Referencias de la forma `tipo.nombre`, que es como se cita un recurso
    // dentro de otro. `.id`, `.arn` o lo que venga detrás da igual: lo que
    // importa es a quién se nombra.
    for (const cita of r.cuerpo.matchAll(/\b([a-z][a-z0-9_]*\.[A-Za-z_][\w-]*)/g)) {
      const destino = porClave.get(cita[1]!);
      if (!destino || destino === mio) continue;
      const clave = `${mio}|${destino}`;
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      conexiones.push({ de: mio, a: destino, etiqueta: "usa" });
    }
  }

  return { componentes, conexiones };
}
