#!/bin/sh
# El planificador de los respaldos: repite un ciclo cada INTERVALO segundos.
#
# EXISTE POR UN FALLO REAL, y conviene contarlo porque el bucle ingenuo parecía
# suficiente. `depends_on: condition: service_healthy` solo ordena el arranque
# cuando lo arranca Compose. Cuando el demonio de Docker se reinicia —y aquí lo
# pasa cada vez que se cierra la aplicación de Docker Desktop— la política `restart: unless-stopped`
# devuelve todos los contenedores a la vez, sin ese orden. El respaldo salía
# antes que Postgres, `pg_dump` daba «connection refused», y el bucle se iba a
# dormir el INTERVALO entero: veinticuatro horas sin copia por una carrera de
# arranque de treinta segundos.
#
# Por eso el reintento corto. Un ciclo que falla no espera al día siguiente:
# insiste cada REINTENTO_ESPERA segundos hasta REINTENTOS veces. Diez minutos de
# margen cubren cualquier arranque de Postgres, y si a los diez minutos sigue
# fallando ya no es una carrera, es una avería — y entonces sí toca esperar al
# siguiente ciclo en vez de castigar la máquina cada minuto.
set -eu

ciclo="${1:?falta la ruta del script de ciclo}"
INTERVALO="${INTERVALO:-86400}"
REINTENTOS="${REINTENTOS:-10}"
REINTENTO_ESPERA="${REINTENTO_ESPERA:-60}"

while true; do
  intento=0
  while true; do
    if "$ciclo"; then
      break
    fi
    intento=$((intento + 1))
    if [ "$intento" -ge "$REINTENTOS" ]; then
      echo "[respaldo] $intento intentos fallidos; se espera al siguiente ciclo" >&2
      break
    fi
    echo "[respaldo] intento $intento fallido; se reintenta en ${REINTENTO_ESPERA}s" >&2
    sleep "$REINTENTO_ESPERA"
  done
  sleep "$INTERVALO"
done
