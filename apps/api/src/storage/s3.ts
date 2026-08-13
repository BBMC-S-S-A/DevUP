import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env.js";

export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
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

/** Crea el bucket si falta. Cómodo con MinIO recién levantado. */
export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
      console.log(`[s3] bucket «${env.S3_BUCKET}» creado`);
    } catch (error) {
      console.warn(
        `[s3] no se pudo preparar el bucket «${env.S3_BUCKET}». ` +
          `¿Está levantado el almacén en ${env.S3_ENDPOINT}?`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}
