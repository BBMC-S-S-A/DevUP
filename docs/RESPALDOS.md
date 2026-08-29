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

## 2. Dónde van · a mano, y a propósito

Por defecto van a `./respaldos`, es decir **en el mismo disco** que la base y el
almacén. Eso protege de un borrado por error y no protege de que ese disco falle.

Hubo un momento en que esto figuraba como «decisión pendiente» que bloqueaba
todo lo demás, con `RUTA_RESPALDOS` apuntando a una unidad de red. Se descartó
al mirar el tamaño:

> **Todo lo que hay que salvar son unos 2 MB.** El volcado de la base pesa 285 KB
> y el almacén entero unos 1,7 MB.

A ese tamaño montar una unidad de red o un bucket es más ceremonia que
protección. Mientras esto sea un MVP, lo que toca es copiar la carpeta a mano
donde sea de vez en cuando:

```bash
tar -czf devup-$(date +%Y%m%d).tar.gz respaldos/
```

Y llevarse ese archivo a otro sitio: un pendrive, otro ordenador, el correo. Un
minuto, sin configurar nada.

**`.env.production` va aparte, y no dentro de ese paquete.** Lleva
`VAULT_MASTER_KEY`, que es justo lo que descifra los secretos del volcado:
meterlos en el mismo archivo que se manda por correo es guardar la llave dentro
de la caja. Ese va al gestor de contraseñas, y son 3 KB de texto — cabe en una
nota segura. Ver el apartado 4.

`RUTA_RESPALDOS` sigue existiendo para el día que esto viva en un servidor de
verdad. Hoy no hace falta tocarla.

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

### Lo que hace falta

Los dos primeros no los puede hacer un script: son llevar un archivo a un sitio
seguro y acordarse de cuándo. El tercero sí, y ya está escrito.

1. **Copiar `.env.production` a un gestor de contraseñas** —o a un sobre sellado,
   pero fuera de esta máquina—. Es un archivo pequeño y cambia poco.
2. **Anotar en qué fecha se copió.** Una copia de hace tres meses a la que le
   faltan dos variables nuevas se descubre en el peor momento.
3. **Rotación: ya se puede.** Hasta ahora aquí ponía que no había procedimiento
   y que, mientras no lo hubiera, la clave no se cambiaba. Eso convertía una
   credencial normal en una que no se puede rotar aunque se filtre, que es la
   peor propiedad que puede tener una clave maestra.

### Rotar `VAULT_MASTER_KEY`

```bash
node scripts/rotar-clave-boveda.mjs --generar                        # ensayo
node scripts/rotar-clave-boveda.mjs --generar --aplicar .env.production
```

**Sin `--aplicar` no escribe nada.** Hace el trabajo entero —descifra, vuelve a
cifrar, comprueba— y deshace la transacción. Un ensayo que pasa significa que la
rotación de verdad va a funcionar, y cuesta lo mismo que no hacerlo.

**Para la API antes de rotar.** Una cuenta que alguien conecte a mitad nacería
cifrada con la clave vieja y se quedaría fuera. El script cuenta las filas al
empezar y al terminar y aborta si cambiaron, así que la carrera es un fallo
ruidoso y no una pérdida silenciosa — pero es mejor no provocarla.

Lo que hace seguro el script, y por qué:

| | |
|---|---|
| Una sola transacción | A medias es el peor sitio: parte con la clave vieja y parte con la nueva, y ninguna de las dos sirve para el conjunto |
| Descifra lo que acaba de cifrar y lo compara | Con AES-GCM cifrar no falla nunca por su cuenta; sin esta comprobación, escribir ruido se descubriría el día que hiciera falta el token |
| Aborta si alguna fila no abre con la clave vieja | Rotar «solo las que abren» dejaría el resto ilegible para siempre |
| Cuenta las filas al empezar y al acabar | Convierte la carrera con la API en un aborto en vez de en una fila perdida |
| Usa `DATABASE_ADMIN_URL` | Con el rol de la aplicación, RLS escondería filas, y rotar «las que se ven» es la forma de perder media bóveda sin un solo error |

**Después de rotar, tres cosas en el mismo rato:** pegar la clave nueva en
`.env.production`, reiniciar la API, y abrir una conexión guardada para
comprobar que responde. **Guarda la clave vieja hasta que ese tercer paso salga
bien.**

Y una que se olvida: **los respaldos anteriores siguen cifrados con la clave
vieja.** Restaurar un volcado de antes de la rotación pide aquella clave, no la
nueva. Anota la fecha del cambio junto a las dos.

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

### La carrera de arranque, y por qué el reintento es corto

Costó dos días de respaldos perdidos descubrirlo, así que queda escrito.

`depends_on: condition: service_healthy` ordena el arranque **solo cuando lo
arranca Compose**. Cuando se reinicia el demonio de Docker —y en esta máquina ha
pasado varias veces, cada vez que se cierra la aplicación— la política `restart: unless-stopped` devuelve
todos los contenedores a la vez y sin ese orden. El respaldo salía antes que
Postgres, `pg_dump` daba «connection refused», y el bucle se dormía el intervalo
entero: **veinticuatro horas sin copia por una carrera de treinta segundos**.

Por eso el planificador vive en `scripts/respaldo-en-bucle.sh` y reintenta cada
minuto hasta diez veces antes de esperar al ciclo siguiente. Diez minutos cubren
cualquier arranque de Postgres; si a los diez minutos sigue fallando ya no es una
carrera sino una avería, y castigar la máquina cada minuto no la arregla.

Cómo se ve que pasó: los archivos `.parcial-*.dump` de cero bytes en
`base-de-datos/` son intentos que murieron antes del volcado. Uno suelto no dice
nada; varios seguidos sin ningún `devup-*.dump` entre ellos es exactamente este
fallo.
