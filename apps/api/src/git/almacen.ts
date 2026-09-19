/**
 * Los repositorios alojados, en disco.
 *
 * NO ES UN SIMULACRO, Y ESA FUE LA DECISIÓN — la misma que en `alojar.ts` para
 * las bases de datos. Se pidió «poder subir los repositorios» y se planteó
 * dejarlo como un mock creíble. Fingirlo bien —un historial inventado, un
 * listado de commits de mentira— es más trabajo que hacerlo: git ya está en el
 * servidor y habla un protocolo por HTTP que se puede servir. Así que estos son
 * repositorios de verdad, y `git clone` y `git push` funcionan con el git de
 * cualquiera.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE ESTÁ EL PELIGRO
 * ────────────────────────────────────────────────────────────────────────────
 *
 * UN NOMBRE DE REPOSITORIO ES UNA CARPETA. Eso convierte cada nombre que llega
 * de fuera en una ruta, y una ruta que nadie mire deja escribir donde no se
 * debe: `../../etc`, un nombre con `\` en Windows, un `%2e%2e` que el servidor
 * web ya decodificó. Aquí hay tres cosas, y ninguna sobra:
 *
 *   1. `nombreValido` solo acepta minúsculas, dígitos y guiones. No es una
 *      lista de lo prohibido —esas se quedan cortas— sino de lo permitido.
 *   2. El mismo `check` está en la migración 0068, en la base. Si alguna vez
 *      alguien inserta una fila por otro camino, el nombre sigue siendo seguro.
 *   3. `rutaDelRepo` comprueba ADEMÁS que la ruta resultante siga colgando de
 *      la raíz, después de resolverla. Es la comprobación que atrapa lo que las
 *      otras dos no vieron venir.
 *
 * EL IDENTIFICADOR DEL ESPACIO TAMBIÉN VA EN LA RUTA, y ese no viene de nadie:
 * es un uuid que puso la base. Se valida igual, porque la comprobación es
 * gratis y la suposición «esto siempre es un uuid» es justo la que deja de ser
 * verdad el día que alguien reutiliza la función.
 */
import { spawn } from "node:child_process";
import { mkdir, rm, stat, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { env } from "../env.js";

/** Minúsculas, dígitos y guiones; ni empieza ni acaba en guión. Ver la cabecera. */
const NOMBRE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function nombreValido(slug: string): boolean {
  return NOMBRE.test(slug);
}

export class RutaInsegura extends Error {}

/**
 * La carpeta de un repositorio, o revienta.
 *
 * REVIENTA EN VEZ DE DEVOLVER NULL a propósito: quien llama a esto está a punto
 * de tocar el disco, y un null que alguien olvide comprobar es exactamente el
 * fallo que estas tres comprobaciones existen para impedir.
 */
export function rutaDelRepo(workspaceId: string, slug: string): string {
  if (!UUID.test(workspaceId)) throw new RutaInsegura("identificador de espacio inesperado");
  if (!nombreValido(slug)) throw new RutaInsegura("nombre de repositorio inesperado");

  const raiz = resolve(env.GIT_ROOT);
  const destino = resolve(join(raiz, workspaceId.toLowerCase(), `${slug}.git`));

  // La red de seguridad. Aunque las dos comprobaciones de arriba fallaran, una
  // ruta que no cuelgue de la raíz no se devuelve.
  if (destino !== raiz && !destino.startsWith(raiz + sep)) {
    throw new RutaInsegura("la ruta se sale del almacén de repositorios");
  }
  return destino;
}

/** Lanza git y espera. Devuelve lo que escribió, o revienta con lo que dijo. */
function correrGit(args: string[], cwd?: string): Promise<string> {
  return new Promise((cumplir, fallar) => {
    const hijo = spawn("git", args, {
      cwd,
      // Sin esto, un git configurado en la máquina (un `includeIf`, un
      // `core.hooksPath`) se colaría en lo que hace el servidor.
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    });
    let salida = "";
    let error = "";
    hijo.stdout.on("data", (d) => (salida += d));
    hijo.stderr.on("data", (d) => (error += d));
    hijo.on("error", fallar);
    hijo.on("close", (codigo) => {
      if (codigo === 0) cumplir(salida);
      else fallar(new Error(error.trim() || `git ${args[0]} terminó con código ${codigo}`));
    });
  });
}

/**
 * Crea el repositorio vacío. `--bare` porque un repositorio de servidor no
 * tiene copia de trabajo: si la tuviera, un push a la rama que estuviera
 * sacada sería rechazado por git, que es la forma más confusa de romperlo.
 */
export async function crearRepo(
  workspaceId: string,
  slug: string,
  ramaPorDefecto: string,
): Promise<void> {
  const ruta = rutaDelRepo(workspaceId, slug);
  await mkdir(ruta, { recursive: true });
  await correrGit(["init", "--bare", `--initial-branch=${ramaPorDefecto}`, ruta]);
}

export async function borrarRepo(workspaceId: string, slug: string): Promise<void> {
  await rm(rutaDelRepo(workspaceId, slug), { recursive: true, force: true });
}

/**
 * La carpeta que agrupa todos los repositorios de un espacio, o revienta.
 *
 * Las mismas redes que `rutaDelRepo`, sin la del nombre: el identificador tiene
 * que ser un uuid de verdad y la ruta tiene que colgar de la raíz. Y una más,
 * que allí no hacía falta: **nunca devuelve la raíz misma**. Esta función
 * acaba en un `rm -r`, y un identificador que por lo que sea resolviera a la
 * raíz borraría los repositorios de todos los clientes.
 */
export function rutaDelEspacio(workspaceId: string): string {
  if (!UUID.test(workspaceId)) throw new RutaInsegura("identificador de espacio inesperado");

  const raiz = resolve(env.GIT_ROOT);
  const destino = resolve(join(raiz, workspaceId.toLowerCase()));
  if (destino === raiz || !destino.startsWith(raiz + sep)) {
    throw new RutaInsegura("la ruta se sale del almacén de repositorios");
  }
  return destino;
}

/**
 * Borra todos los repositorios de un espacio de una vez.
 *
 * Para cuando el espacio desaparece: la fila de `hosted_repos` se va en cascada
 * con el espacio, pero la carpeta del disco no la borra ninguna cascada. Sin
 * esto, los repositorios de un espacio borrado seguían en el servidor, con su
 * código entero, sin ninguna fila que los nombrara.
 */
export async function borrarReposDelEspacio(workspaceId: string): Promise<void> {
  await rm(rutaDelEspacio(workspaceId), { recursive: true, force: true });
}

export async function existeRepo(workspaceId: string, slug: string): Promise<boolean> {
  try {
    const s = await stat(rutaDelRepo(workspaceId, slug));
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Lo que ocupa, sumando el árbol.
 *
 * Se recorre a mano y no con `du` porque `du` no está en la imagen de Alpine
 * con las mismas banderas en todas partes, y porque esto se llama después de
 * cada push: un fallo aquí no puede tumbar el push que acaba de funcionar.
 */
export async function tamanoDelRepo(workspaceId: string, slug: string): Promise<number> {
  const raiz = rutaDelRepo(workspaceId, slug);
  let total = 0;
  const pendientes = [raiz];
  while (pendientes.length > 0) {
    const carpeta = pendientes.pop()!;
    let entradas;
    try {
      entradas = await readdir(carpeta, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entrada of entradas) {
      const completa = join(carpeta, entrada.name);
      if (entrada.isDirectory()) pendientes.push(completa);
      else if (entrada.isFile()) {
        try {
          total += (await stat(completa)).size;
        } catch {
          // Un archivo que git acaba de mover mientras contábamos. El tamaño es
          // orientativo; perder uno no justifica fallar.
        }
      }
    }
  }
  return total;
}

/** Las ramas y a qué commit apuntan, para poder enseñarlas sin clonar. */
export async function ramasDelRepo(
  workspaceId: string,
  slug: string,
): Promise<{ nombre: string; commit: string }[]> {
  const ruta = rutaDelRepo(workspaceId, slug);
  const salida = await correrGit(
    ["for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads"],
    ruta,
  );
  return salida
    .split("\n")
    .filter(Boolean)
    .map((linea) => {
      const [nombre, commit] = linea.split("\t");
      return { nombre: nombre ?? "", commit: commit ?? "" };
    });
}

/** Los últimos commits de una rama. Vacío si el repositorio aún no tiene nada. */
export async function commitsDelRepo(
  workspaceId: string,
  slug: string,
  rama: string,
  cuantos = 20,
): Promise<{ sha: string; autor: string; cuando: string; mensaje: string }[]> {
  const ruta = rutaDelRepo(workspaceId, slug);
  // `--` y el nombre de rama validado: sin el separador, una rama llamada como
  // una opción se leería como una opción.
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(rama)) return [];
  let salida: string;
  try {
    salida = await correrGit(
      ["log", `--max-count=${Math.min(Math.max(cuantos, 1), 100)}`, "--format=%H%x09%an%x09%aI%x09%s", rama, "--"],
      ruta,
    );
  } catch {
    // Un repositorio recién creado no tiene ni un commit, y `git log` falla con
    // «does not have any commits yet». No es un error que enseñar: es vacío.
    return [];
  }
  return salida
    .split("\n")
    .filter(Boolean)
    .map((linea) => {
      const [sha, autor, cuando, ...resto] = linea.split("\t");
      return {
        sha: sha ?? "",
        autor: autor ?? "",
        cuando: cuando ?? "",
        mensaje: resto.join("\t"),
      };
    });
}

/** La raíz existe al arrancar; si el volumen no está montado, se sabe ya. */
export async function prepararAlmacen(): Promise<void> {
  const raiz = resolve(env.GIT_ROOT);
  if (!isAbsolute(raiz)) throw new Error("GIT_ROOT tiene que ser una ruta absoluta");
  await mkdir(raiz, { recursive: true });
}
