/**
 * El protocolo «smart HTTP» de git, servido lanzando el propio git.
 *
 * QUÉ ES ESTO. Lo que hace `git clone https://…` son tres peticiones HTTP muy
 * concretas, y el trabajo de verdad —negociar qué commits faltan, armar el
 * paquete— lo hacen dos programas que vienen con git: `git-upload-pack` (para
 * quien lee) y `git-receive-pack` (para quien empuja). Servir git es
 * básicamente conectarles la entrada y la salida a una petición HTTP.
 *
 * Por eso esto son ochenta líneas y no un reimplementar git: la alternativa
 * —escribir el empaquetado de objetos -- sería meses de trabajo y peor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS TRES COSAS QUE HAY QUE HACER BIEN
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 1. `--stateless-rpc`. Sin esta bandera los dos programas esperan una
 *    conversación continua, como por SSH. Con ella, cada petición HTTP es un
 *    turno completo y se acaba.
 *
 * 2. LA CABECERA DEL ANUNCIO. La primera petición (`/info/refs`) tiene que
 *    empezar por una línea en formato «pkt-line» diciendo qué servicio
 *    contesta, y un `0000` detrás. Eso NO lo escribe git: lo escribe el
 *    servidor. Si falta, el cliente dice «invalid server response» sin más
 *    pistas.
 *
 * 3. EL CUERPO VA EN CRUDO Y A VECES COMPRIMIDO. Git manda su petición como
 *    binario y, cuando es grande, con `Content-Encoding: gzip`. Si el servidor
 *    web intenta interpretarla como JSON, o se olvida de descomprimirla, git
 *    se queda esperando para siempre — que es peor que un error.
 */
import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import type { Readable, Writable } from "node:stream";

export type Servicio = "git-upload-pack" | "git-receive-pack";

export const SERVICIOS: Servicio[] = ["git-upload-pack", "git-receive-pack"];

export function esServicio(valor: string): valor is Servicio {
  return (SERVICIOS as string[]).includes(valor);
}

/** Empujar escribe; clonar y traerse cambios, no. */
export function escribe(servicio: Servicio): boolean {
  return servicio === "git-receive-pack";
}

/**
 * Una línea en formato pkt-line: cuatro dígitos hexadecimales con la longitud
 * total (los cuatro incluidos) y detrás el contenido.
 */
export function pktLine(texto: string): Buffer {
  const cuerpo = Buffer.from(texto, "utf8");
  const largo = (cuerpo.length + 4).toString(16).padStart(4, "0");
  return Buffer.concat([Buffer.from(largo, "utf8"), cuerpo]);
}

/** La cabecera que el servidor pone delante del anuncio. Ver la cabecera (2). */
export function cabeceraDeAnuncio(servicio: Servicio): Buffer {
  return Buffer.concat([pktLine(`# service=${servicio}\n`), Buffer.from("0000", "utf8")]);
}

const entorno = (protocolo?: string) => ({
  ...process.env,
  // Que la configuración de la máquina no se cuele en lo que hace el servidor:
  // un `includeIf`, un `core.hooksPath` heredado. Sin esto, lo que hace git
  // aquí dependería de lo que alguien dejó en el `~/.gitconfig` de la imagen.
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  /**
   * EL PROTOCOLO QUE PIDIÓ EL CLIENTE, y no es un detalle de rendimiento.
   *
   * git manda `Git-Protocol: version=2` en la cabecera y espera que el
   * servidor se lo pase a `upload-pack` por esta variable. Si no se pasa, la
   * conversación cae a la versión 0 — y en la versión 0 el anuncio de un
   * repositorio VACÍO no puede decir a qué rama apunta HEAD. Resultado: quien
   * clona un repositorio recién creado se lleva la rama que tenga configurada
   * su máquina (`master` en muchas), no la que el repositorio dice tener, y al
   * empujar crea una rama distinta de la que la pantalla anuncia.
   *
   * Se filtra a `version=N` en vez de pasar la cabecera tal cual: es una
   * cabecera que viene de fuera y acaba en el entorno de un proceso.
   */
  ...(protocolo ? { GIT_PROTOCOL: protocolo } : {}),
});

/** `git-upload-pack` se lanza como `git upload-pack`. */
function subcomando(servicio: Servicio): string {
  return servicio.slice("git-".length);
}

/**
 * El anuncio de referencias: qué tiene el servidor. Es la primera petición de
 * cualquier clon, traída o empuje.
 */
export function anunciarRefs(
  servicio: Servicio,
  ruta: string,
  destino: Writable,
  protocolo?: string,
): Promise<void> {
  return new Promise((cumplir, fallar) => {
    destino.write(cabeceraDeAnuncio(servicio));
    const hijo = spawn("git", [subcomando(servicio), "--stateless-rpc", "--advertise-refs", ruta], {
      env: entorno(protocolo),
    });
    let error = "";
    hijo.stderr.on("data", (d) => (error += d));
    hijo.stdout.pipe(destino, { end: false });
    hijo.on("error", fallar);
    hijo.on("close", (codigo) => {
      if (codigo === 0) cumplir();
      else fallar(new Error(error.trim() || `${servicio} terminó con código ${codigo}`));
    });
  });
}

/**
 * El turno de verdad: lo que manda el cliente entra por la entrada de git y lo
 * que git conteste sale por la respuesta.
 *
 * `comprimido` viene de `Content-Encoding: gzip`. Descomprimir aquí y no antes
 * es lo que evita que el cuerpo se quede a medias sin que nadie se entere.
 */
export function atenderServicio(
  servicio: Servicio,
  ruta: string,
  entrada: Readable,
  comprimido: boolean,
  destino: Writable,
  protocolo?: string,
): Promise<void> {
  return new Promise((cumplir, fallar) => {
    const hijo = spawn("git", [subcomando(servicio), "--stateless-rpc", ruta], {
      env: entorno(protocolo),
    });
    let error = "";
    hijo.stderr.on("data", (d) => (error += d));
    hijo.stdout.pipe(destino, { end: false });
    hijo.on("error", fallar);
    hijo.on("close", (codigo) => {
      if (codigo === 0) cumplir();
      else fallar(new Error(error.trim() || `${servicio} terminó con código ${codigo}`));
    });

    if (comprimido) {
      const descompresor = createGunzip();
      descompresor.on("error", fallar);
      entrada.pipe(descompresor).pipe(hijo.stdin);
    } else {
      entrada.pipe(hijo.stdin);
    }
  });
}

/**
 * Solo se deja pasar lo que git puede pedir de verdad. La cabecera viene de
 * fuera y acaba siendo una variable de entorno de un proceso: filtrarla es más
 * barato que confiar en ella.
 */
export function protocoloPedido(cabecera: string | undefined): string | undefined {
  if (!cabecera) return undefined;
  const m = /^version=(\d)$/.exec(cabecera.trim());
  return m ? `version=${m[1]}` : undefined;
}
