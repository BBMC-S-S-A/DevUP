#!/bin/sh
# Un ciclo de respaldo del almacén de objetos. El bucle lo pone quien llama.
#
# SIN `--remove`, Y ESA ES LA DECISIÓN IMPORTANTE. Un espejo exacto borraría del
# respaldo lo que se borró del almacén, y entonces no protege del caso más común
# —alguien borra un archivo por error— sino solo del disco que falla. Aquí el
# respaldo es acumulativo: lo que entró, se queda. Cuesta algo de espacio y
# cubre las dos cosas.
#
# La contrapartida honesta: un archivo borrado a propósito sigue en el respaldo.
# Si algún día hay que borrar algo de verdad —una petición de un cliente, por
# ejemplo— hay que acordarse de borrarlo también aquí.
set -eu

: "${S3_ENDPOINT_INTERNO:?falta S3_ENDPOINT_INTERNO}"
: "${S3_ACCESS_KEY_ID:?falta S3_ACCESS_KEY_ID}"
: "${S3_SECRET_ACCESS_KEY:?falta S3_SECRET_ACCESS_KEY}"
: "${S3_BUCKET:?falta S3_BUCKET}"
: "${DESTINO:?falta DESTINO}"

carpeta="$DESTINO/almacen"
mkdir -p "$carpeta"

# `--api S3v4` explícito: sin esto mc negocia y, contra un MinIO detrás de un
# proxy, a veces elige una firma que el otro lado no acepta.
mc alias set respaldo "$S3_ENDPOINT_INTERNO" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" --api S3v4 >/dev/null

echo "[respaldo] espejando $S3_BUCKET"
mc mirror --overwrite "respaldo/$S3_BUCKET" "$carpeta"

# Se cuenta con `mc` y no con `find`: la imagen de mc es mínima y no trae find,
# así que la versión anterior imprimía «0 objetos» con el respaldo bien hecho —
# que es la clase de mentira que hace desconfiar de un registro entero.
objetos=$(mc ls --recursive "respaldo/$S3_BUCKET" | wc -l)
echo "[respaldo] almacén al día · $objetos objetos copiados"
