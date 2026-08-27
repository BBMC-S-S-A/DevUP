# Respaldos y custodia de claves

Bloque A del [plan](plan-lo-que-falta.md). No añade ninguna función: evita
perder lo que ya hay.

---

## 1. Qué se respalda, y qué no

| Qué | Cómo | Cada cuánto |
|---|---|---|
| Base de datos | `pg_dump --format=custom` | 24 h, 14 copias |
| Almacén de objetos | `mc mirror` acumulativo | 24 h, sin borrar nunca |
| **`.env.production`** | **nada. Ver §4** | — |

Dos servicios y no uno porque cada uno usa la herramienta oficial de lo que
respalda: `pg_dump` viene en la imagen de Postgres y `mc` en la de MinIO. Meter
las dos en una imagen propia obligaría a mantenerla al día con ambas.

**El espejo del almacén no lleva `--remove`, y esa es la decisión importante.**
Un espejo exacto borraría del respaldo lo que se borró del almacén, y entonces
solo protegería del disco que falla, no del caso más común: alguien borra un
archivo por error. Aquí lo que entró se queda. Cuesta algo de espacio y cubre las
dos cosas. La contrapartida: si algún día hay que borrar algo de verdad —una
petición de un cliente— hay que acordarse de borrarlo también aquí.

---

## 2. Dónde van · **decisión pendiente**

Por defecto van a `./respaldos`, es decir **en el mismo disco** que la base y el
almacén. Eso protege de un borrado por error y **no protege de lo que de verdad
da miedo**: que ese disco falle.

Para que sea un respaldo de verdad, `RUTA_RESPALDOS` en `.env.production` tiene
que apuntar fuera de esta máquina:

```bash
RUTA_RESPALDOS=//servidor/respaldos/devup
```

Una unidad de red montada, un disco externo, un bucket de otro proveedor — lo
que sea que no muera con la máquina. Hasta que eso se decida, lo que hay es media
red de seguridad, y conviene no confundirla con una entera.

Otras dos variables, ambas opcionales:

```bash
RESPALDOS_RETENER=14      # cuántos volcados se guardan
RESPALDOS_INTERVALO=86400 # segundos entre ciclos
```

---

## 3. Comprobar y restaurar

### Ver que está funcionando

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs respaldo-base-de-datos --tail 20
```

### Probar la restauración

**Esto es lo que hay que correr de vez en cuando, y no solo cuando ya hay un
problema.** Restaura el último volcado en una base desechable, compara las filas
con producción y la borra. No toca la base de verdad en ningún momento.

```bash
npm run respaldo:probar
```

Una copia que nadie ha restaurado no es una copia: un `pg_dump` que termina sin
error puede producir un archivo que `pg_restore` rechaza, o que restaura la mitad
de las tablas.

### Restaurar de verdad, cuando haga falta

Con la API parada, para que nadie escriba a mitad:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml stop api web
```

Luego, dentro del contenedor de respaldos:

```bash
psql -d postgres -c "drop database devup;" -c "create database devup;"
pg_restore --dbname=devup --no-owner --no-privileges --exit-on-error \
  /respaldos/base-de-datos/devup-XXXXXXXX-XXXXXXZ.dump
```

Y el almacén, desde la imagen de `mc`:

```bash
mc mirror /respaldos/almacen respaldo/devup-files
```

Después, levantar api y web y **aplicar migraciones**: el volcado trae el esquema
del día que se hizo, no el de hoy.

---

## 4. `.env.production` y `VAULT_MASTER_KEY`

Esto no lo respalda ningún servicio, y es el punto más delicado de todo el
apartado.

`.env.production` está en `.gitignore` a propósito —lleva secretos— así que **no
existe en ninguna copia**. Vive en un único archivo, en una única máquina. Si ese
disco falla, los datos se recuperan del respaldo y las credenciales no.

Y dentro de ese archivo hay una que es peor que las demás:

> **`VAULT_MASTER_KEY` descifra todas las credenciales de terceros guardadas en
> la bóveda. Si se pierde o cambia, todas las conexiones quedan indescifrables
> para siempre.**

No es «hay que reconectar»: es que los tokens guardados se vuelven ruido y no hay
forma de leerlos. Un respaldo de la base **sin** esa clave restaura las filas de
`connection_secrets` y no sirven para nada.

### Lo que hace falta, y que no puede hacer un script

1. **Copiar `.env.production` a un gestor de contraseñas** —o a un sobre sellado,
   pero fuera de esta máquina—. Es un archivo pequeño y cambia poco.
2. **Anotar en qué fecha se copió.** Una copia de hace tres meses a la que le
   faltan dos variables nuevas se descubre en el peor momento.
3. **Rotación:** hoy no hay procedimiento porque rotar `VAULT_MASTER_KEY` exige
   descifrar con la vieja y volver a cifrar con la nueva, en una sola
   transacción, para cada fila de `connection_secrets`. Mientras eso no exista,
   la clave **no se cambia**. Si alguna vez hay que cambiarla, primero se escribe
   ese script y se prueba en desarrollo.

---

## 5. Lo que el planificador no hace

El ciclo es un `sleep` dentro del contenedor, no cron. Sin una tercera pieza que
configurar, y el estado se ve en `docker compose ps` como todo lo demás.

La contrapartida, que conviene saber: **si la máquina está apagada a la hora que
tocaba, ese respaldo no se recupera al encender** — el reloj empieza de nuevo
desde el arranque. Con la máquina encendida a diario no es un problema. El día
que esto viva en un servidor de verdad, cron.

Tampoco avisa a nadie si falla. Un ciclo que revienta se registra y se reintenta
al siguiente, pero nadie se enterará salvo que mire los registros. Avisar por
correo depende de tener SMTP, que es el otro punto pendiente del bloque A.
