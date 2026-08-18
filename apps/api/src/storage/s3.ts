import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, webOrigins } from "../env.js";

export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  // Sin esto, la subida directa desde el navegador devuelve 403 y el mensaje
  // no dice por qué.
  //
  // Desde la versión 3.729 el SDK calcula un checksum por defecto y, al firmar
  // una URL, mete `x-amz-sdk-checksum-algorithm` y `x-amz-checksum-crc32` entre
  // los parámetros firmados. El navegador que hace el PUT no manda esas
  // cabeceras —no las conoce—, así que la firma no cuadra y el almacén
  // rechaza la subida. Pasa igual con S3, con R2 y con MinIO.
  //
  // WHEN_REQUIRED los deja fuera salvo cuando la operación los exige de
  // verdad. La integridad no se pierde: el PUT sigue yendo por TLS y el
  // tamaño real se verifica con HEAD al confirmar.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

/**
 * Compone la clave de un objeto.
 *
 * `{organization_id}/{workspace_id}/{uuid}.{ext}` — y la primera carpeta es la
 * frontera de seguridad. Con Supabase eso lo leían las políticas de
 * storage.objects; aquí no hay políticas en el almacén, así que la frontera la
 * sostiene esta función junto con la comprobación de pertenencia que hace la
 * API antes de firmar nada.
 *
 * Es el único sitio del código donde se construye una clave. Si aparece un
 * segundo, la convención deja de ser una garantía y pasa a ser una costumbre.
 */
export function buildStorageKey(
  organizationId: string,
  workspaceId: string,
  fileName: string,
): string {
  // La extensión se saca del nombre pero se limpia: un nombre puede traer
  // barras, `..` o caracteres que cambien la ruta, y el nombre original ya
  // queda guardado en la fila de `files`.
  const raw = extname(fileName).slice(0, 12).toLowerCase();
  const ext = /^\.[a-z0-9]+$/.test(raw) ? raw : "";
  return `${organizationId}/${workspaceId}/${randomUUID()}${ext}`;
}

/** Extrae la organización de una clave, para poder verificarla. */
export function organizationOfKey(key: string): string | null {
  const first = key.split("/")[0];
  return first && /^[0-9a-f-]{36}$/i.test(first) ? first : null;
}

/**
 * Clave de un activo propio de la organización (hoy solo su foto) y no de un
 * workspace concreto — de ahí la carpeta fija `org-assets` en vez del
 * `{workspace_id}` de `buildStorageKey`. Misma frontera de seguridad: la
 * primera carpeta de verdad es la organización, y quien firma comprueba antes
 * que quien pide pertenece a ella.
 */
export function buildOrgAssetKey(organizationId: string, fileName: string): string {
  const raw = extname(fileName).slice(0, 12).toLowerCase();
  const ext = /^\.[a-z0-9]+$/.test(raw) ? raw : "";
  return `${organizationId}/org-assets/${randomUUID()}${ext}`;
}

export async function signUpload(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: env.S3_SIGNED_URL_TTL },
  );
}

/**
 * URL de descarga. `disposition` decide si el navegador lo enseña o lo baja:
 * las previsualizaciones necesitan `inline`, el botón de descargar necesita
 * `attachment` con el nombre real, que no está en la clave.
 */
export async function signDownload(
  key: string,
  fileName: string,
  disposition: "inline" | "attachment" = "inline",
): Promise<string> {
  const safeName = fileName.replace(/["\\\r\n]/g, "_");
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: `${disposition}; filename="${safeName}"`,
    }),
    { expiresIn: env.S3_SIGNED_URL_TTL },
  );
}

/** Tamaño y tipo reales del objeto subido, o null si no llegó a existir. */
export async function headObject(
  key: string,
): Promise<{ size: number; contentType: string } | null> {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return {
      size: result.ContentLength ?? 0,
      contentType: result.ContentType ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key })).catch(() => {
    // Un objeto que no se puede borrar es basura que ocupa, no un fallo que
    // deba tumbar la petición del usuario. Queda en el registro y ya.
    console.warn(`[s3] no se pudo borrar ${key}`);
  });
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  // DeleteObjects admite 1000 por llamada.
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
    await s3
      .send(
        new DeleteObjectsCommand({
          Bucket: env.S3_BUCKET,
          Delete: { Objects: batch, Quiet: true },
        }),
      )
      .catch((error: unknown) => {
        console.warn("[s3] borrado por lotes incompleto:", error);
      });
  }
}

/**
 * Crea el bucket si falta y le pone la política CORS que necesita la subida
 * directa desde el navegador.
 *
 * Lo segundo es fácil de olvidar y difícil de diagnosticar: sin CORS, el
 * navegador ni siquiera llega a hacer el PUT — se queda en el preflight y lo
 * que se ve en la consola es un error de red genérico, sin mención al bucket.
 * Con curl funciona, que es lo que despista.
 *
 * La política solo se aplica a un bucket que acabamos de crear. Si el bucket
 * ya existía —el caso del cliente que trae el suyo— no se toca su
 * configuración: es infraestructura ajena y no nos corresponde reescribirla.
 */
export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    return;
  } catch {
    // No existe o no se puede consultar: se intenta crear abajo.
  }

  try {
    await s3.send(
      new CreateBucketCommand({
        Bucket: env.S3_BUCKET,
        /**
         * `CreateBucketConfiguration` explícito, aunque parezca redundante.
         *
         * Sin él, el SDK genera un cuerpo que MinIO rechaza con «The XML you
         * provided was not well-formed» — comprobado contra el almacén de
         * producción: la llamada simple falla y esta pasa. Con
         * `LocationConstraint` sin definir el SDK emite la forma que
         * corresponde a us-east-1, que es la que MinIO entiende.
         *
         * Esto estuvo roto sin que se notara: la creación fallaba al arrancar,
         * el aviso se perdía entre los registros y todo seguía pareciendo
         * normal hasta que alguien subía un archivo y la petición moría en el
         * almacén, fuera del alcance de la API.
         */
        CreateBucketConfiguration: { LocationConstraint: undefined },
      }),
    );
    console.log(`[s3] bucket «${env.S3_BUCKET}» creado`);
  } catch (error) {
    console.warn(
      `[s3] NO SE PUDO PREPARAR EL BUCKET «${env.S3_BUCKET}»: ninguna subida de ` +
        `archivos va a funcionar, y fallará en el navegador sin que la API se entere, ` +
        `porque los bytes van directos al almacén. ¿Está levantado en ${env.S3_ENDPOINT}?`,
      error instanceof Error ? error.message : error,
    );
    return;
  }

  try {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: env.S3_BUCKET,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: webOrigins,
              AllowedMethods: ["GET", "PUT", "HEAD"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
  } catch (error) {
    console.warn(
      "[s3] no se pudo fijar la política CORS del bucket. La subida desde el " +
        "navegador fallará en el preflight hasta que se configure a mano.",
      error instanceof Error ? error.message : error,
    );
  }
}
