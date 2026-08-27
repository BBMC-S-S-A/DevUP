#!/bin/sh
# Restaura el último volcado en una base desechable y compara con la de verdad.
#
# EXISTE PORQUE UNA COPIA QUE NADIE HA RESTAURADO NO ES UNA COPIA. Un `pg_dump`
# que termina sin error puede producir un archivo que `pg_restore` rechaza, o
# que restaura la mitad de las tablas. La única forma de saber que el respaldo
# sirve es restaurarlo, y la única forma de que eso ocurra de verdad es que sea
# un comando y no un plan.
#
# No toca la base de producción en ningún momento: crea una aparte, compara, y
# la borra. Lo único que comparte es el servidor.
set -eu

: "${PGHOST:?falta PGHOST}"
: "${PGUSER:?falta PGUSER}"
: "${PGPASSWORD:?falta PGPASSWORD}"
: "${PGDATABASE:?falta PGDATABASE}"
: "${DESTINO:?falta DESTINO}"

PRUEBA="devup_prueba_restauracion"
carpeta="$DESTINO/base-de-datos"

ultimo=$(ls -1 "$carpeta"/devup-*.dump 2>/dev/null | sort | tail -n 1 || true)
if [ -z "$ultimo" ]; then
  echo "[prueba] no hay ningún volcado en $carpeta" >&2
  exit 1
fi
echo "[prueba] restaurando $ultimo"

limpiar() {
  psql -d postgres -q -c "drop database if exists $PRUEBA;" >/dev/null 2>&1 || true
}
trap limpiar EXIT

limpiar
psql -d postgres -q -c "create database $PRUEBA;"

# `--no-owner` y `--no-privileges`: el volcado trae al dueño y los permisos de
# producción (devup_app y compañía), que en una base recién creada no existen.
# Sin esto, pg_restore llena la salida de errores de permisos que no significan
# nada y esconden los que sí.
pg_restore --dbname="$PRUEBA" --no-owner --no-privileges --exit-on-error "$ultimo"

# La comprobación de verdad: mismas filas en las tablas que importan.
tablas="users organizations workspaces channels messages files tasks clients connections schema_migrations"
fallos=0

printf "\n%-22s %10s %10s\n" "TABLA" "PRODUCCIÓN" "RESTAURADA"
for t in $tablas; do
  vivo=$(psql -d "$PGDATABASE" -t -A -c "select count(*) from $t;" 2>/dev/null || echo "?")
  copia=$(psql -d "$PRUEBA" -t -A -c "select count(*) from $t;" 2>/dev/null || echo "?")
  estado=""
  if [ "$vivo" != "$copia" ]; then
    estado="  <-- NO COINCIDE"
    fallos=$((fallos + 1))
  fi
  printf "%-22s %10s %10s%s\n" "$t" "$vivo" "$copia" "$estado"
done

echo ""
if [ "$fallos" -gt 0 ]; then
  echo "[prueba] FALLÓ: $fallos tabla(s) no coinciden" >&2
  exit 1
fi
echo "[prueba] el respaldo restaura correctamente"
