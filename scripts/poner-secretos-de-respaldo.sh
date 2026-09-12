#!/usr/bin/env bash
# Pone los cuatro secretos que le faltan al workflow de respaldo.
#
# POR QUÉ ESTO ES UN SCRIPT Y NO LO HIZO CLAUDE. Meter contraseñas y tokens en
# un campo lo hace una persona, no un agente. Aquí está el trabajo hecho —de
# dónde sale cada valor y cómo se llama cada secreto— para que no haya que
# buscarlos ni teclearlos: se ejecuta y ya.
#
#   bash scripts/poner-secretos-de-respaldo.sh
#
# NINGÚN VALOR SE IMPRIME. Van de Railway a GitHub por una tubería; lo único
# que sale por pantalla es si cada uno quedó puesto.
#
# Hace falta: `railway` con sesión (`railway login`) y `gh` con sesión
# (`gh auth login`), los dos ya instalados en este equipo.
set -euo pipefail

cd "$(dirname "$0")/.."

falta() { echo "· $1: NO se pudo leer de Railway, ponlo a mano"; }

# --- La contraseña del superusuario de Postgres ------------------------------
pg=$(railway variables --service Postgres --json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).POSTGRES_PASSWORD||''))")
if [ -n "$pg" ]; then
  printf '%s' "$pg" | gh secret set POSTGRES_PASSWORD
  echo "· POSTGRES_PASSWORD: puesto"
else falta POSTGRES_PASSWORD; fi

# --- Las credenciales del almacén, las mismas que usa la API ------------------
leer_de_api() {
  railway variables --service api --json \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s)['$1']||''))"
}
for nombre in S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
  valor=$(leer_de_api "$nombre")
  if [ -n "$valor" ]; then
    printf '%s' "$valor" | gh secret set "$nombre"
    echo "· $nombre: puesto"
  else falta "$nombre"; fi
done

# --- La frase con la que se cifran los respaldos ------------------------------
#
# Se genera aquí y se enseña UNA vez, a propósito: si se pierde, los respaldos
# no se pueden abrir — y entonces no son respaldos. Guárdala en el gestor de
# contraseñas ANTES de cerrar esta ventana. GitHub no la vuelve a enseñar.
if gh secret list | grep -q '^BACKUP_PASSPHRASE'; then
  echo "· BACKUP_PASSPHRASE: ya estaba, no se toca"
else
  frase=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")
  printf '%s' "$frase" | gh secret set BACKUP_PASSPHRASE
  echo "· BACKUP_PASSPHRASE: puesto"
  echo
  echo "  ⚠️  GUÁRDALA DONDE NO ESTÉ SOLO EN GITHUB. Sin ella los respaldos no se abren:"
  echo
  echo "      $frase"
  echo
fi

echo
echo "Listo. Ahora lánzalo una vez para verlo pasar entero:"
echo "  gh workflow run respaldo.yml"
