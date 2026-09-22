/**
 * Qué está corriendo aquí: commit, entorno y región (ARQ-04).
 *
 * POR QUÉ HACÍA FALTA. Hasta ahora `/health` contestaba `{status:"ok", now}` y
 * nada más, así que «¿está desplegado lo que creo que está desplegado?» no
 * tenía respuesta: el despliegue de un cliente se verificó con CAPTURAS DE
 * PANTALLA. Con el commit ahí, la pregunta la contesta una petición, y DevUP
 * puede comparar lo que corre con la rama principal y decir si un entorno va
 * por detrás.
 *
 * EL COMMIT NO LO SABE RAILWAY, Y ESE ES EL DETALLE QUE ORDENA TODO ESTO.
 * `RAILWAY_GIT_COMMIT_SHA` existe cuando Railway construye desde GitHub; aquí
 * el despliegue sube el código con `railway up`, así que Railway no ve ningún
 * git y esa variable nunca llega. Se comprobó pidiéndole sus variables al
 * servicio: no está. Por eso lo inyecta el propio flujo de despliegue como
 * `DEVUP_COMMIT` antes de subir, con `--skip-deploys` para no provocar un
 * despliegue de más.
 *
 * LA REGIÓN NO SE CONFIGURA, SE LEE. `RAILWAY_REPLICA_REGION` la pone Railway
 * dentro del contenedor en ejecución, y no aparece en las variables guardadas
 * —se buscó allí primero, para la política de datos, y no estaba—. Leerla aquí
 * es la forma de contestar «¿dónde están los datos?» sin depender de que
 * alguien mire un panel y lo transcriba bien.
 *
 * TODO ES OPCIONAL A PROPÓSITO. En desarrollo no hay ninguna de las tres, y
 * `/health` tiene que seguir contestando: es la comprobación de vida del
 * hosting, y romperla por no saber el commit sería cambiar un dato que falta
 * por un servicio que parece caído.
 */

/** Los 7 primeros, que es como se nombra un commit al hablar. */
function corto(sha: string): string {
  return /^[0-9a-f]{40}$/i.test(sha) ? sha.slice(0, 7) : sha;
}

export type Version = {
  /** El commit desplegado, completo. `null` si esta instancia no lo sabe. */
  commit: string | null;
  /** El mismo, abreviado, que es lo que se enseña. */
  commitCorto: string | null;
  /** `production`, `staging`… lo que diga el hosting. */
  entorno: string | null;
  /** Dónde corre de verdad esta réplica. Ver la cabecera. */
  region: string | null;
};

export function version(): Version {
  const sha = process.env.DEVUP_COMMIT?.trim() || null;
  return {
    commit: sha,
    commitCorto: sha ? corto(sha) : null,
    entorno: process.env.RAILWAY_ENVIRONMENT_NAME?.trim() || null,
    region: process.env.RAILWAY_REPLICA_REGION?.trim() || null,
  };
}
