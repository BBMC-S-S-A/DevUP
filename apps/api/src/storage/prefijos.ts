/**
 * Qué prefijos del almacén se pueden borrar de golpe.
 *
 * VIVE APARTE DE `s3.ts` A PROPÓSITO: aquel importa la configuración y arranca
 * un cliente, y esto tiene que poder probarse en un milisegundo sin nada de eso.
 * Es la única línea que separa «borrar los archivos de un espacio» de «borrar
 * los archivos de todos los clientes», así que se prueba sin excusas.
 *
 * SOLO DOS FORMAS, y las dos acaban en barra:
 *
 *   · `{organización}/`          — todo lo de una organización
 *   · `{organización}/{espacio}/` — todo lo de un espacio
 *
 * La barra final no es un detalle. En S3 un prefijo es texto, no una carpeta:
 * sin la barra, el prefijo de un uuid casaría también con cualquier clave que
 * empezara por los mismos caracteres. Con uuid completos no pasa, pero la barra
 * es lo que hace que no dependa de eso.
 *
 * Todo lo demás se rechaza: vacío (que es el bucket entero), `users/` (fotos de
 * personas, que no son de ninguna organización), uuid a medias, rutas con `..`.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BORRABLE = new RegExp(`^${UUID}/(${UUID}/)?$`);

export function prefijoBorrable(prefijo: string): boolean {
  return BORRABLE.test(prefijo);
}

export function prefijoDeOrganizacion(organizationId: string): string {
  return `${organizationId.toLowerCase()}/`;
}

export function prefijoDeEspacio(organizationId: string, workspaceId: string): string {
  return `${organizationId.toLowerCase()}/${workspaceId.toLowerCase()}/`;
}
