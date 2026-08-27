#!/bin/sh
# Un ciclo de respaldo de Postgres. El bucle lo pone quien llama.
#
# `--format=custom` y no SQL plano a propósito: es el único formato que
# `pg_restore` puede restaurar por partes —una tabla suelta, sin los índices, en
# paralelo— y el día que haga falta restaurar, casi nunca hace falta todo.
#
# EL VOLCADO SE ESCRIBE CON OTRO NOMBRE Y LUEGO SE RENOMBRA. Un `mv` dentro del
# mismo sistema de archivos es atómico, así que nunca existe un archivo
# `devup-*.dump` a medias. Sin esto, un corte de luz a mitad de volcado dejaría
# un archivo con nombre de respaldo bueno y contenido inservible, que es peor que
# no tener respaldo: parece que estás cubierto.
set -eu

: "${PGHOST:?falta PGHOST}"
: "${PGUSER:?falta PGUSER}"
: "${PGPASSWORD:?falta PGPASSWORD}"
: "${PGDATABASE:?falta PGDATABASE}"
: "${DESTINO:?falta DESTINO}"
RETENER="${RETENER:-14}"

carpeta="$DESTINO/base-de-datos"
mkdir -p "$carpeta"

sello=$(date -u +%Y%m%d-%H%M%SZ)
parcial="$carpeta/.parcial-$sello.dump"
final="$carpeta/devup-$sello.dump"

echo "[respaldo] volcando $PGDATABASE de $PGHOST"
pg_dump --format=custom --compress=9 --file="$parcial"
mv "$parcial" "$final"

tamano=$(wc -c < "$final")
echo "[respaldo] escrito $final ($tamano bytes)"

# Un volcado de cero bytes es un fallo silencioso: mejor gritar ahora que
# descubrirlo el día de la restauración.
if [ "$tamano" -lt 1000 ]; then
  echo "[respaldo] ERROR: el volcado pesa $tamano bytes, eso no puede estar bien" >&2
  exit 1
fi

# Retención por antigüedad de nombre, que aquí coincide con la cronológica
# porque el sello va en formato ordenable.
sobran=$(ls -1 "$carpeta"/devup-*.dump 2>/dev/null | sort | head -n "-$RETENER" || true)
if [ -n "$sobran" ]; then
  echo "$sobran" | while read -r viejo; do
    echo "[respaldo] retirando $viejo"
    rm -f "$viejo"
  done
fi

# Los parciales de un intento que murió a medias no se acumulan.
find "$carpeta" -name '.parcial-*.dump' -mmin +120 -delete 2>/dev/null || true

echo "[respaldo] listo · $(ls -1 "$carpeta"/devup-*.dump | wc -l) copias guardadas"
